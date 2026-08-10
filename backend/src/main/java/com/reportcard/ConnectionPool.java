package com.reportcard;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.ArrayDeque;
import java.util.Deque;

/**
 * A small JDBC connection pool.
 *
 * Every store method used to call {@code DriverManager.getConnection()} and
 * close it again. Against a local database that is merely wasteful; against a
 * remote one (Supabase) it means a TCP connect, a TLS handshake and a Postgres
 * authentication round trip on every single API call — hundreds of milliseconds
 * added to each request, and a steady churn of connections that runs into the
 * server's connection limit as soon as more than a few people are using the app.
 *
 * Written by hand rather than pulling in HikariCP because the backend has no
 * dependency manager: jars are fetched by curl in three separate packaging
 * paths (Dockerfile, stage-backend.mjs, Electron's classpath), so each new one
 * is a real maintenance cost.
 *
 * {@link #borrow()} hands out a proxy whose {@code close()} returns the
 * connection here instead of closing it, so callers keep using
 * try-with-resources exactly as before.
 */
final class ConnectionPool implements AutoCloseable {

    /**
     * How long borrow() waits for a free slot before giving up.
     *
     * Generous on purpose. Opening a connection to a distant Supabase region
     * has been measured at 6–11s on a slow link, so a short timeout means
     * requests fail while the pool is merely warming up rather than because
     * anything is actually wrong.
     */
    private static final long BORROW_TIMEOUT_MS = 45_000;

    /** Idle connections older than this are discarded rather than reused. */
    private static final long MAX_IDLE_MS = 5 * 60_000;

    /**
     * Connections returned more recently than this are handed out without an
     * isValid() check. That check is a full network round trip — ~700ms on the
     * link this was tuned against, which was most of the cost of a warm
     * borrow, so under load this is a large saving.
     *
     * Kept deliberately short. The window is the period during which a
     * connection that died server-side would still be handed out and fail on
     * use, so it trades a bounded amount of that risk for the round trip.
     * Anything idle longer than this is validated as normal.
     */
    private static final long DEFAULT_SKIP_VALIDATION_WINDOW_MS = 5_000;

    private final String url;
    private final int maxSize;
    private final long skipValidationWindowMs;

    private final Deque<Idle> idle = new ArrayDeque<>();
    private int live;
    private boolean closed;

    private static final class Idle {
        final Connection connection;
        final long returnedAt;

        Idle(Connection connection, long returnedAt) {
            this.connection = connection;
            this.returnedAt = returnedAt;
        }
    }

    ConnectionPool(String url, int maxSize) {
        this(url, maxSize, DEFAULT_SKIP_VALIDATION_WINDOW_MS);
    }

    /** Test seam: pass 0 to validate every reuse. */
    ConnectionPool(String url, int maxSize, long skipValidationWindowMs) {
        this.url = url;
        this.maxSize = Math.max(1, maxSize);
        this.skipValidationWindowMs = skipValidationWindowMs;
    }

    /**
     * Borrows a connection. The returned object is a proxy: closing it returns
     * the underlying connection to the pool. Never returns null.
     */
    Connection borrow() throws SQLException {
        long deadline = System.currentTimeMillis() + BORROW_TIMEOUT_MS;

        while (true) {
            Connection reusable = null;
            boolean trustWithoutCheck = false;

            synchronized (this) {
                if (closed)
                    throw new SQLException("Connection pool is closed");

                // Prefer a warm connection, discarding any that went stale.
                // Supabase's pooler drops idle connections on its own side, so
                // a connection sitting in this deque may already be dead.
                while (!idle.isEmpty()) {
                    Idle candidate = idle.pollLast();
                    if (System.currentTimeMillis() - candidate.returnedAt > MAX_IDLE_MS) {
                        discard(candidate.connection);
                        continue;
                    }
                    reusable = candidate.connection;
                    trustWithoutCheck =
                            System.currentTimeMillis() - candidate.returnedAt < skipValidationWindowMs;
                    break;
                }

                if (reusable == null && live < maxSize) {
                    // Reserve the slot before the (slow) connect, so parallel
                    // callers don't all decide there's room and overshoot.
                    live++;
                    break;
                }
            }

            if (reusable != null) {
                if (trustWithoutCheck || isUsable(reusable))
                    return wrap(reusable);
                synchronized (this) {
                    discard(reusable);
                }
                continue;
            }

            // At capacity — wait for someone to hand one back.
            synchronized (this) {
                long remaining = deadline - System.currentTimeMillis();
                if (remaining <= 0)
                    throw new SQLException(
                            "Timed out waiting for a database connection (pool size " + maxSize + ")");
                try {
                    wait(remaining);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new SQLException("Interrupted waiting for a database connection", e);
                }
            }
        }

        // Slot reserved above; create outside the lock so a slow handshake
        // doesn't block every other thread.
        try {
            Connection fresh = DriverManager.getConnection(url);
            return wrap(fresh);
        } catch (SQLException e) {
            synchronized (this) {
                live--;
                notifyAll();
            }
            throw e;
        }
    }

    private boolean isUsable(Connection c) {
        try {
            return !c.isClosed() && c.isValid(2);
        } catch (SQLException e) {
            return false;
        }
    }

    /** Caller must hold the monitor. */
    private void discard(Connection c) {
        live--;
        notifyAll();
        try {
            c.close();
        } catch (SQLException ignored) {
            // Already broken — nothing useful to do.
        }
    }

    private void release(Connection c) {
        // A connection handed back mid-transaction would leak that transaction
        // into whoever borrows it next, so roll back anything left open and
        // restore the default autoCommit before it goes back in the pool.
        boolean healthy = true;
        try {
            if (c.isClosed()) {
                healthy = false;
            } else {
                if (!c.getAutoCommit()) {
                    c.rollback();
                    c.setAutoCommit(true);
                }
                c.clearWarnings();
            }
        } catch (SQLException e) {
            healthy = false;
        }

        synchronized (this) {
            if (closed || !healthy) {
                discard(c);
                return;
            }
            idle.addLast(new Idle(c, System.currentTimeMillis()));
            notifyAll();
        }
    }

    private Connection wrap(Connection real) {
        return (Connection) Proxy.newProxyInstance(
                ConnectionPool.class.getClassLoader(),
                new Class<?>[] { Connection.class },
                new PooledHandler(real));
    }

    private final class PooledHandler implements InvocationHandler {
        private final Connection real;
        private boolean returned;

        PooledHandler(Connection real) {
            this.real = real;
        }

        @Override
        public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
            String name = method.getName();

            if ("close".equals(name)) {
                // Guard against a double close returning the same connection
                // to the pool twice, which would hand it to two borrowers.
                if (!returned) {
                    returned = true;
                    release(real);
                }
                return null;
            }
            if ("isClosed".equals(name))
                return returned || real.isClosed();
            if ("toString".equals(name))
                return "PooledConnection[" + (returned ? "returned" : "in use") + "]";
            if ("hashCode".equals(name))
                return System.identityHashCode(proxy);
            if ("equals".equals(name))
                return proxy == args[0];

            if (returned)
                throw new SQLException("This connection has already been returned to the pool");

            try {
                return method.invoke(real, args);
            } catch (InvocationTargetException e) {
                throw e.getCause();
            }
        }
    }

    /** Closes every pooled connection. Called on JVM shutdown. */
    @Override
    public void close() {
        synchronized (this) {
            closed = true;
            for (Idle i : idle) {
                try {
                    i.connection.close();
                } catch (SQLException ignored) {
                    // Shutting down anyway.
                }
            }
            idle.clear();
            notifyAll();
        }
    }
}
