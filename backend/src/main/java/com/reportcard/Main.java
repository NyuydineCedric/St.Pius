package com.reportcard;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import java.io.*;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.spec.KeySpec;
import java.sql.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public class Main {

    // Which storage backend is active for this process. Desktop (Electron)
    // never sets DATABASE_URL, so it always gets FileDataStore — exactly
    // the same serialized-file behavior as before. Render sets
    // DATABASE_URL to the Supabase connection string, so it gets
    // PostgresDataStore instead. Nothing else in this file needs to know
    // or care which one is active.
    private static DataStore store;

    // Writable data directory, kept so the restore handler can drop a
    // pre-restore snapshot somewhere sensible on both storage backends.
    private static File dataDirectory = new File(".");

    // Upper bound on an uploaded backup. Generous enough for a large school
    // with photos, small enough that a bogus upload can't exhaust memory.
    private static final int MAX_BACKUP_BYTES = 200 * 1024 * 1024;

    /**
     * How long tombstones are kept before being swept.
     *
     * Must comfortably exceed the longest realistic offline stretch: sweep a
     * tombstone sooner than a device's last sync and that device resurrects
     * the deleted record. A term is about 90 days.
     */
    private static final long SYNC_TOMBSTONE_RETENTION_DAYS = 180;

    // Current licence. Replaced wholesale on activation or revalidation, so
    // it's volatile rather than synchronised — readers only ever need the
    // latest reference.
    private static volatile License license = null;

    // In-memory sessions (Bearer tokens). Lost on process restart — users
    // simply log in again. Fine for desktop; for multi-instance cloud you
    // would move these to Redis/DB.
    private static final SessionStore sessions = new SessionStore();
    private static final ThreadLocal<Session> CURRENT = new ThreadLocal<>();

    // Cross-origin: never default to *. Desktop is same-origin. Web must set
    // ALLOWED_ORIGIN to the frontend origin (e.g. https://app.example.com).
    private static final String ALLOWED_ORIGIN = System.getenv("ALLOWED_ORIGIN");

    private static void applyCors(HttpExchange exchange) {
        if (ALLOWED_ORIGIN != null && !ALLOWED_ORIGIN.isBlank() && !"*".equals(ALLOWED_ORIGIN)) {
            exchange.getResponseHeaders().set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
            exchange.getResponseHeaders().set("Access-Control-Allow-Credentials", "true");
        } else {
            String origin = exchange.getRequestHeaders().getFirst("Origin");
            if (origin != null && (origin.startsWith("http://localhost:")
                    || origin.startsWith("http://127.0.0.1:"))) {
                exchange.getResponseHeaders().set("Access-Control-Allow-Origin", origin);
                exchange.getResponseHeaders().set("Access-Control-Allow-Credentials", "true");
            }
        }
        exchange.getResponseHeaders().set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
        exchange.getResponseHeaders().set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    }

    private static HttpHandler withCors(HttpHandler handler) {
        return exchange -> {
            applyCors(exchange);
            if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod())) {
                exchange.sendResponseHeaders(204, -1);
                return;
            }
            handler.handle(exchange);
        };
    }

    private static HttpHandler requireAuth(HttpHandler handler) {
        return withCors(exchange -> {
            Session s = sessions.resolve(exchange);
            if (s == null) {
                sendJson(exchange, 401, "{\"error\":\"Unauthorized\"}");
                return;
            }
            // Re-check the account against the store, so a teacher removed
            // from staff (whose login account is deleted alongside them)
            // stops being able to use the dashboard instead of staying signed
            // in until their token expires.
            //
            // Cached briefly: at ~700ms round trip to a remote database this
            // was the single largest cost on every authenticated request. The
            // trade is that a deleted account keeps working for at most
            // USER_RECHECK_TTL_MS rather than being cut off instantly.
            User liveUser;
            try {
                liveUser = lookupUserCached(s.email);
            } catch (RuntimeException e) {
                // The database is unreachable or busy. This says nothing about
                // whether the account is still valid, so do NOT revoke — that
                // would turn a blip in connectivity into a permanent logout.
                System.err.println("Auth re-check unavailable: " + e.getMessage());
                sendJson(exchange, 503, "{\"error\":\"Service temporarily unavailable, please retry\"}");
                return;
            }
            if (liveUser == null || !Objects.equals(liveUser.role, s.role)) {
                sessions.revoke(SessionStore.extractToken(exchange));
                sendJson(exchange, 401, "{\"error\":\"Unauthorized\"}");
                return;
            }
            CURRENT.set(s);
            try {
                handler.handle(exchange);
            } finally {
                CURRENT.remove();
            }
        });
    }

    /**
     * Blocks changes when the licence isn't active, while leaving reads alone.
     *
     * A school whose licence lapsed mid-term must still be able to open and
     * print the report cards it has already produced — locking them out of
     * their own records turns a billing matter into an emergency for them and
     * a support emergency for us. So GET stays available in every state and
     * only writes are refused.
     */
    private static HttpHandler requireLicense(HttpHandler handler) {
        return exchange -> {
            String method = exchange.getRequestMethod();
            boolean isRead = "GET".equalsIgnoreCase(method)
                    || "HEAD".equalsIgnoreCase(method)
                    || "OPTIONS".equalsIgnoreCase(method);

            License current = license;
            if (!isRead && current != null && !current.allowsWrites()) {
                sendJson(exchange, 402,
                        "{\"error\":\"" + escapeJson(current.message) + "\",\"licenseStatus\":\""
                                + current.status + "\",\"readOnly\":true}");
                return;
            }
            handler.handle(exchange);
        };
    }

    // Short-lived cache for the per-request account re-check above. Long
    // enough to spare a remote round trip on every call, short enough that
    // removing a member of staff takes effect while the admin is still
    // looking at the screen.
    private static final long USER_RECHECK_TTL_MS = 30_000;
    private static final ConcurrentHashMap<String, Object[]> USER_CACHE = new ConcurrentHashMap<>();

    private static User lookupUserCached(String email) {
        if (email == null)
            return null;
        String key = email.toLowerCase(Locale.ROOT);
        Object[] hit = USER_CACHE.get(key);
        if (hit != null && (Long) hit[1] > System.currentTimeMillis())
            return (User) hit[0];

        User fresh = store.findUserByEmail(email);
        USER_CACHE.put(key, new Object[] { fresh, System.currentTimeMillis() + USER_RECHECK_TTL_MS });
        return fresh;
    }

    /** Drops a cached account so a deletion or role change applies at once. */
    static void invalidateUserCache(String email) {
        if (email != null)
            USER_CACHE.remove(email.toLowerCase(Locale.ROOT));
    }

    private static HttpHandler requireAdmin(HttpHandler handler) {
        return requireAuth(exchange -> {
            if (!"admin".equals(CURRENT.get().role)) {
                sendJson(exchange, 403, "{\"error\":\"Admin access required\"}");
                return;
            }
            handler.handle(exchange);
        });
    }

    public static void main(String[] args) throws IOException {
        // args[0] = writable per-user data directory (e.g. Electron's
        // app.getPath("userData")). Only meaningful for FileDataStore.
        // args[1] = static frontend files directory (e.g. dist/ copied into
        // backend/.../public)
        File dataDir = args.length > 0
                ? new File(args[0])
                : new File(System.getenv().getOrDefault("DATA_DIR", "."));
        File staticDir = args.length > 1 ? new File(args[1]) : new File("public");

        if (!dataDir.exists()) {
            dataDir.mkdirs();
        }
        dataDirectory = dataDir;

        String databaseUrl = System.getenv("DATABASE_URL");
        if (databaseUrl != null && !databaseUrl.isBlank()) {
            store = new PostgresDataStore(databaseUrl);
        } else {
            store = new FileDataStore();
        }
        store.init(dataDir);

        // Creates the bucket on first run; a no-op once it exists.
        SupabaseStorage storageForBucket = SupabaseStorage.get();
        if (storageForBucket != null)
            storageForBucket.ensureBucket();

        // School-scoped: one key covers every account on this install. Prefer
        // env/file, then the shared store so a cloud restart (ephemeral disk)
        // still finds the key the admin already activated.
        String storedKey = store.getLicenseKey();
        license = License.load(dataDir, storedKey);
        if (license.allowsWrites()) {
            String token = License.readToken(dataDir);
            if (token == null || token.isBlank())
                token = storedKey;
            persistLicenseKey(token);
        }
        System.out.println("Licence: " + license.status + " — " + license.message);
        if (!license.allowsWrites())
            System.out.println("  Running READ-ONLY: existing records can be viewed and printed, "
                    + "but no changes can be saved.");

        // Optional bootstrap admin, applied only when the store has no admin
        // at all. With no bootstrap env vars set, the first account registered
        // through /api/register becomes the admin (see RegisterHandler) — that
        // is how a school install is meant to be set up.
        //
        // This deliberately does NOT hardcode credentials. Doing so shipped
        // every deployment the same publicly-known admin login, and re-applying
        // it on each boot silently reverted whatever password the school set.
        String bootstrapEmail = System.getenv("BOOTSTRAP_ADMIN_EMAIL");
        String bootstrapPassword = System.getenv("BOOTSTRAP_ADMIN_PASSWORD");
        if (bootstrapEmail != null && !bootstrapEmail.isBlank()
                && bootstrapPassword != null && !bootstrapPassword.isBlank()) {
            if (store.hasAdmin()) {
                System.out.println("Bootstrap admin skipped — an admin account already exists.");
            } else {
                String bootstrapName = System.getenv().getOrDefault("BOOTSTRAP_ADMIN_NAME", "Admin");
                store.ensureUser(bootstrapName, bootstrapEmail.trim(),
                        Passwords.hash(bootstrapPassword), "admin");
                System.out.println("Bootstrap admin created for " + bootstrapEmail.trim()
                        + " — change this password after first login.");
            }
        }
        store.save();

        // Electron always spawns this process with no PORT env var set, so
        // the desktop build keeps using 8080 exactly as before. Render sets
        // its own PORT at runtime, which this now respects.
        int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "8080"));
        // Default to loopback so LAN peers cannot hit open APIs. Cloud
        // (DATABASE_URL or BIND_HOST=0.0.0.0) binds all interfaces.
        String bindHost = System.getenv("BIND_HOST");
        if (bindHost == null || bindHost.isBlank()) {
            bindHost = (databaseUrl != null && !databaseUrl.isBlank()) ? "0.0.0.0" : "127.0.0.1";
        }
        HttpServer server = HttpServer.create(new InetSocketAddress(bindHost, port), 0);

        boolean cloudStorage = databaseUrl != null && !databaseUrl.isBlank();
        server.createContext("/api/health", exchange -> {
            String json = "{\"status\":\"UP\",\"service\":\"report-card-backend\",\"message\":\"Backend is running\",\"storage\":\""
                    + (cloudStorage ? "postgres" : "file") + "\"}";
            sendJson(exchange, 200, json);
        });

        server.createContext("/api/auth/status", withCors(new AuthStatusHandler()));
        server.createContext("/api/login", withCors(new LoginHandler()));
        server.createContext("/api/logout", requireAuth(new LogoutHandler()));
        server.createContext("/api/register", withCors(new RegisterHandler()));

        // Authenticated reads; admin-only writes where noted in handlers.
        server.createContext("/api/students", requireAuth(requireLicense(new StudentsHandler())));
        server.createContext("/api/classes", requireAuth(requireLicense(new ClassesHandler())));
        server.createContext("/api/classes/master", requireAdmin(requireLicense(new ClassMasterHandler())));
        server.createContext("/api/roster", requireAuth(requireLicense(new RosterHandler())));
        server.createContext("/api/marks", requireAuth(requireLicense(new MarksHandler())));
        server.createContext("/api/activities", requireAuth(requireLicense(new ActivitiesHandler())));
        server.createContext("/api/teachers", requireAuth(requireLicense(new TeachersHandler())));
        server.createContext("/api/settings", requireAuth(requireLicense(new SettingsHandler())));
        server.createContext("/api/academic-years", requireAuth(requireLicense(new AcademicYearsHandler())));
        // Wipes every student, mark, teacher and class, then loads sample
        // data. Off unless explicitly switched on, and the route isn't even
        // registered otherwise — a school's real data must not be one request
        // away from being replaced by a demo set.
        boolean demoSeedEnabled = "1".equals(System.getenv("ALLOW_DEMO_SEED"))
                || "true".equalsIgnoreCase(System.getenv("ALLOW_DEMO_SEED"));
        if (demoSeedEnabled) {
            server.createContext("/api/demo/seed", withCors(requireLicense(new DemoSeedHandler())));
            System.out.println("WARNING: demo seed endpoint is ENABLED — it erases all academic data. "
                    + "Unset ALLOW_DEMO_SEED before shipping to a school.");
        }
        // Backup deliberately stays available without a licence — a school
        // must always be able to get its own data out, whatever its billing
        // status. Holding data hostage is never an acceptable lever.
        server.createContext("/api/backup", requireAdmin(new BackupHandler()));
        // Restore IS licence-gated, unlike export. Getting your data out is a
        // right; loading data back in is using the product.
        server.createContext("/api/backup/restore", requireAdmin(requireLicense(new BackupRestoreHandler())));

        // Changing your own password is deliberately NOT licence-gated. A
        // school must always be able to secure its account, whatever its
        // billing state — and rotating a leaked credential is exactly the
        // moment you don't want a paywall.
        server.createContext("/api/account/password", requireAuth(new ChangePasswordHandler()));

        // Sync is a write path, so it is licence-gated like the rest.
        server.createContext("/api/sync", requireAuth(requireLicense(new SyncHandler())));

        server.createContext("/api/sync/status", requireAuth(new SyncStatusHandler()));
        server.createContext("/api/sync/now", requireAdmin(new SyncNowHandler()));

        server.createContext("/api/license", requireAuth(new LicenseHandler()));
        server.createContext("/api/license/activate", requireAdmin(new LicenseActivateHandler()));
        // Lets a desktop sync client pull the school key onto another machine
        // after the admin activated it once (cloud or primary desktop).
        server.createContext("/api/license/key", requireAdmin(new LicenseKeyHandler()));

        // Static frontend files (the built React app). Registered last / at
        // root so it acts as the catch-all for anything not matched by an
        // /api/* context above.
        server.createContext("/", new StaticFileHandler(staticDir));

        // A null executor makes HttpServer run every handler on the dispatcher
        // thread, so requests are served strictly one at a time — one slow
        // query stalls everyone else. Fine for a single desktop user, not for a
        // staffroom of teachers entering marks at once.
        //
        // Safe to parallelise: request state lives in a ThreadLocal, sessions
        // are a ConcurrentHashMap, FileDataStore's methods are synchronized,
        // and PostgresDataStore holds no mutable state.
        int handlerThreads = 16;
        String configuredThreads = System.getenv("HTTP_THREADS");
        if (configuredThreads != null && !configuredThreads.isBlank()) {
            try {
                handlerThreads = Math.max(1, Integer.parseInt(configuredThreads.trim()));
            } catch (NumberFormatException e) {
                System.err.println("Ignoring invalid HTTP_THREADS=" + configuredThreads);
            }
        }
        ExecutorService httpExecutor = Executors.newFixedThreadPool(handlerThreads, r -> {
            Thread t = new Thread(r, "http-handler");
            t.setDaemon(true);
            return t;
        });
        server.setExecutor(httpExecutor);
        server.start();

        // Expired sessions would otherwise pile up forever now that they're
        // persisted. Runs hourly, and once at startup to clear out whatever
        // expired while the process was down.
        ScheduledExecutorService housekeeping = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "housekeeping");
            t.setDaemon(true);
            return t;
        });
        housekeeping.scheduleAtFixedRate(sessions::purgeExpired, 0, 1, TimeUnit.HOURS);

        // Sweep tombstones that are older than any device could plausibly be
        // offline. Done daily rather than on every write so a slow delete never
        // blocks a user.
        housekeeping.scheduleAtFixedRate(() -> {
            try {
                store.purgeTombstones(System.currentTimeMillis()
                        - SYNC_TOMBSTONE_RETENTION_DAYS * 86_400_000L);
            } catch (RuntimeException e) {
                System.err.println("Tombstone sweep failed: " + e.getMessage());
            }
        }, 1, 24, TimeUnit.HOURS);

        // Desktop sync loop. Failure is silent and expected — a school being
        // offline is the normal case this exists for, not an error state.
        SyncClient syncClient = SyncClient.get(dataDir);
        if (syncClient != null) {
            housekeeping.scheduleAtFixedRate(() -> syncClient.syncNow(store), 15, 300, TimeUnit.SECONDS);
        }

        // Revocation check, when a licence server is configured. Runs on
        // startup and every 6 hours. Failure is silent and harmless: an
        // unreachable server leaves the licence exactly as it was, so a school
        // never loses access because something on our side is down.
        if (System.getenv("LICENSE_SERVER_URL") != null
                && !System.getenv("LICENSE_SERVER_URL").isBlank()) {
            housekeeping.scheduleAtFixedRate(() -> {
                License before = license;
                if (before == null)
                    return;
                License after = before.revalidate(dataDirectory);
                if (after.status != before.status) {
                    license = after;
                    System.out.println("Licence status changed: " + before.status + " -> " + after.status);
                }
                if (License.graceExhausted(dataDirectory))
                    System.out.println("WARNING: licence server unreachable for over "
                            + License.daysSinceLastCheck(dataDirectory) + " days.");
            }, 0, 6, TimeUnit.HOURS);
        }

        System.out.println("Report Card backend running on http://" + bindHost + ":" + port);
        System.out.println("Storage: " + (databaseUrl != null && !databaseUrl.isBlank()
                ? "PostgreSQL (Supabase)"
                : "Local file (" + new File(dataDir, "backend-data.ser").getAbsolutePath() + ")"));
        System.out.println("Static dir: " + staticDir.getAbsolutePath());
    }

    // ------------------------------------------------------------------
    // Password hashing (PBKDF2-HMAC-SHA256) + in-memory sessions
    // ------------------------------------------------------------------
    static final class Passwords {
        private static final int ITERATIONS = 120_000;
        private static final int SALT_LEN = 16;
        private static final int KEY_LEN = 256;
        private static final String PREFIX = "pbkdf2$";

        static String hash(String password) {
            try {
                byte[] salt = new byte[SALT_LEN];
                new SecureRandom().nextBytes(salt);
                byte[] dk = pbkdf2(password.toCharArray(), salt, ITERATIONS);
                return PREFIX + ITERATIONS + "$" + Base64.getEncoder().encodeToString(salt)
                        + "$" + Base64.getEncoder().encodeToString(dk);
            } catch (Exception e) {
                throw new RuntimeException("Password hash failed", e);
            }
        }

        static boolean matches(String password, String stored) {
            if (stored == null)
                return false;
            if (stored.startsWith(PREFIX)) {
                try {
                    String[] parts = stored.split("\\$");
                    if (parts.length != 4)
                        return false;
                    int iterations = Integer.parseInt(parts[1]);
                    byte[] salt = Base64.getDecoder().decode(parts[2]);
                    byte[] expected = Base64.getDecoder().decode(parts[3]);
                    byte[] actual = pbkdf2(password.toCharArray(), salt, iterations);
                    return MessageDigest.isEqual(expected, actual);
                } catch (Exception e) {
                    return false;
                }
            }
            // Legacy plaintext — constant-time-ish compare then migrate on login.
            return MessageDigest.isEqual(
                    stored.getBytes(StandardCharsets.UTF_8),
                    password.getBytes(StandardCharsets.UTF_8));
        }

        static boolean isHashed(String stored) {
            return stored != null && stored.startsWith(PREFIX);
        }

        private static byte[] pbkdf2(char[] password, byte[] salt, int iterations) throws Exception {
            KeySpec spec = new PBEKeySpec(password, salt, iterations, KEY_LEN);
            return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
        }
    }

    // Serializable so the file store can persist live sessions across a
    // desktop app restart, the same way the Postgres store does across a
    // server restart.
    static final class Session implements Serializable {
        private static final long serialVersionUID = 1L;
        final String userId;
        final String email;
        final String role;
        final String name;
        final long expiresAt;

        Session(String userId, String email, String role, String name, long expiresAt) {
            this.userId = userId;
            this.email = email;
            this.role = role;
            this.name = name;
            this.expiresAt = expiresAt;
        }
    }

    // Sessions live in the data store, not just in memory.
    //
    // They used to be a plain in-memory map, which meant every restart logged
    // every user out — painful on Render's free tier, which spins the service
    // down whenever it goes idle — and made it impossible to run more than one
    // backend instance, since neither would recognise the other's tokens.
    //
    // The map below is now a cache in front of the store: the common path is
    // still a single in-memory lookup, and only a token this process hasn't
    // seen before (after a restart, or issued by another instance) costs a
    // read from storage.
    static final class SessionStore {
        private static final long TTL_MS = 24L * 60 * 60 * 1000;
        private final ConcurrentHashMap<String, Session> cache = new ConcurrentHashMap<>();
        private final SecureRandom random = new SecureRandom();

        String create(User user) {
            byte[] bytes = new byte[32];
            random.nextBytes(bytes);
            StringBuilder sb = new StringBuilder(bytes.length * 2);
            for (byte b : bytes)
                sb.append(String.format(Locale.ROOT, "%02x", b));
            String token = sb.toString();
            Session session = new Session(user.id, user.email, user.role, user.name,
                    System.currentTimeMillis() + TTL_MS);
            cache.put(token, session);
            try {
                store.saveSession(token, session);
            } catch (RuntimeException e) {
                // A storage hiccup shouldn't block a login — the session still
                // works on this instance until it restarts.
                System.err.println("Could not persist session: " + e.getMessage());
            }
            return token;
        }

        void revoke(String token) {
            if (token == null)
                return;
            cache.remove(token);
            try {
                store.deleteSession(token);
            } catch (RuntimeException e) {
                System.err.println("Could not delete persisted session: " + e.getMessage());
            }
        }

        Session resolve(HttpExchange exchange) {
            String token = extractToken(exchange);
            if (token == null || token.isEmpty())
                return null;

            Session s = cache.get(token);
            if (s == null) {
                try {
                    s = store.findSession(token);
                } catch (RuntimeException e) {
                    System.err.println("Could not read persisted session: " + e.getMessage());
                    return null;
                }
                if (s != null)
                    cache.put(token, s);
            }
            if (s == null)
                return null;
            if (s.expiresAt < System.currentTimeMillis()) {
                revoke(token);
                return null;
            }
            return s;
        }

        /** Drops expired sessions from both the cache and storage. */
        void purgeExpired() {
            long now = System.currentTimeMillis();
            cache.entrySet().removeIf(e -> e.getValue().expiresAt < now);
            try {
                store.purgeExpiredSessions(now);
            } catch (RuntimeException e) {
                System.err.println("Session purge failed: " + e.getMessage());
            }
        }

        static String extractToken(HttpExchange exchange) {
            String header = exchange.getRequestHeaders().getFirst("Authorization");
            if (header == null || !header.regionMatches(true, 0, "Bearer ", 0, 7))
                return null;
            return header.substring(7).trim();
        }
    }

    private static boolean teacherCanAccessMarks(Session session, String cls, String subject) {
        if (session == null)
            return false;
        if ("admin".equals(session.role))
            return true;
        Teacher teacher = store.findTeacherByEmail(session.email);
        if (teacher == null)
            return false;
        for (Assignment a : teacher.assignments) {
            if (Objects.equals(a.className, cls) && Objects.equals(a.subject, subject))
                return true;
        }
        return false;
    }

    private static String authUserJson(User user, String token) {
        return String.format(Locale.ROOT,
                "{\"id\":\"%s\",\"name\":\"%s\",\"email\":\"%s\",\"role\":\"%s\",\"token\":\"%s\"}",
                escapeJson(user.id), escapeJson(user.name), escapeJson(user.email), escapeJson(user.role),
                escapeJson(token));
    }

    private static String escapeJson(String s) {
        return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private static void sendJson(HttpExchange exchange, int code, String json) throws IOException {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=UTF-8");
        exchange.sendResponseHeaders(code, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }

    private static Map<String, String> parseJsonObject(String s) {
        Map<String, String> map = new HashMap<>();
        if (s == null)
            return map;
        s = s.trim();
        if (s.startsWith("{"))
            s = s.substring(1);
        if (s.endsWith("}"))
            s = s.substring(0, s.length() - 1);
        boolean inQuotes = false;
        StringBuilder cur = new StringBuilder();
        List<String> parts = new ArrayList<>();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"')
                inQuotes = !inQuotes;
            if (c == ',' && !inQuotes) {
                parts.add(cur.toString());
                cur.setLength(0);
            } else {
                cur.append(c);
            }
        }
        if (cur.length() > 0)
            parts.add(cur.toString());
        for (String p : parts) {
            int idx = p.indexOf(':');
            if (idx < 0)
                continue;
            String k = p.substring(0, idx).trim();
            String v = p.substring(idx + 1).trim();
            k = stripQuotes(k);
            v = stripQuotes(v);
            map.put(k, v);
        }
        return map;
    }

    private static String stripQuotes(String s) {
        s = s.trim();
        if (s.startsWith("\"") && s.endsWith("\""))
            return s.substring(1, s.length() - 1);
        return s;
    }

    private static Map<String, String> queryParams(HttpExchange exchange) {
        Map<String, String> qmap = new HashMap<>();
        String query = exchange.getRequestURI().getQuery();
        if (query != null) {
            for (String q : query.split("&")) {
                int idx = q.indexOf('=');
                if (idx > 0) {
                    String k = q.substring(0, idx);
                    String v = java.net.URLDecoder.decode(q.substring(idx + 1), StandardCharsets.UTF_8);
                    qmap.put(k, v);
                }
            }
        }
        return qmap;
    }

    // GET /api/auth/status — public bootstrap flag for the register page
    static class AuthStatusHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendJson(exchange, 405, "{\"error\":\"Method not allowed\"}");
                return;
            }
            boolean hasAdmin = store.hasAdmin();
            sendJson(exchange, 200, "{\"hasAdmin\":" + hasAdmin + ",\"bootstrapAdmin\":" + (!hasAdmin) + "}");
        }
    }

    // POST /api/login { "email": "...", "password": "..." }
    // Passwords are stored as PBKDF2 hashes. Legacy plaintext values are
    // accepted once, then rewritten as hashes on successful login.
    static class LoginHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendJson(exchange, 405, "{\"error\":\"Method not allowed\"}");
                return;
            }
            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            Map<String, String> obj = parseJsonObject(body);
            String email = obj.getOrDefault("email", "").trim();
            String password = obj.getOrDefault("password", "");

            User user = store.findUserByEmail(email);
            if (user == null || !Passwords.matches(password, user.password)) {
                sendJson(exchange, 401, "{\"error\":\"Invalid email or password\"}");
                return;
            }
            if (!Passwords.isHashed(user.password)) {
                store.updateUserPassword(user.id, Passwords.hash(password));
                store.save();
                user = store.findUserByEmail(email);
            }
            String token = sessions.create(user);
            sendJson(exchange, 200, authUserJson(user, token));
        }
    }

    static class LogoutHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendJson(exchange, 405, "{\"error\":\"Method not allowed\"}");
                return;
            }
            sessions.revoke(SessionStore.extractToken(exchange));
            sendJson(exchange, 200, "{\"status\":\"ok\"}");
        }
    }

    // POST /api/register { "name", "email", "password", "role"? }
    // First account (no admin yet) may register as admin (bootstrap).
    // After that, public registration is teacher-only. Creating another
    // admin requires an authenticated admin session.
    static class RegisterHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendJson(exchange, 405, "{\"error\":\"Method not allowed\"}");
                return;
            }
            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            Map<String, String> obj = parseJsonObject(body);
            String name = obj.getOrDefault("name", "").trim();
            String email = obj.getOrDefault("email", "").trim();
            String password = obj.getOrDefault("password", "");
            String role = obj.getOrDefault("role", "teacher").trim();

            if (name.isEmpty() || email.isEmpty() || password.isEmpty()) {
                sendJson(exchange, 400, "{\"error\":\"Name, email, and password are required\"}");
                return;
            }
            if (password.length() < 6) {
                sendJson(exchange, 400, "{\"error\":\"Password must be at least 6 characters\"}");
                return;
            }
            if (!"admin".equals(role) && !"teacher".equals(role)) {
                role = "teacher";
            }

            boolean hasAdmin = store.hasAdmin();

            // Creating accounts is a write, so it needs a licence — but the
            // very first admin must be able to register on a brand-new
            // install, otherwise setup deadlocks: activating a licence
            // requires an admin, and creating an admin would require a
            // licence. Bootstrap is exempt; everyone after is not.
            License current = license;
            if (hasAdmin && current != null && !current.allowsWrites()) {
                sendJson(exchange, 402,
                        "{\"error\":\"" + escapeJson(current.message) + "\",\"readOnly\":true}");
                return;
            }

            Session caller = sessions.resolve(exchange);
            if ("admin".equals(role)) {
                if (hasAdmin && (caller == null || !"admin".equals(caller.role))) {
                    sendJson(exchange, 403, "{\"error\":\"Admin accounts can only be created by an existing admin\"}");
                    return;
                }
            } else if (!hasAdmin) {
                // Force first account to be admin so the school is never
                // stuck without an administrator.
                role = "admin";
            }

            if (store.findUserByEmail(email) != null) {
                sendJson(exchange, 409, "{\"error\":\"An account with that email already exists\"}");
                return;
            }

            User user = store.addUser(name, email, Passwords.hash(password), role);
            store.save();
            sendJson(exchange, 201, user.toJson());
        }
    }

    // Serves the built frontend (index.html, /assets/*, favicon, etc.) from
    // staticDir, with SPA-style fallback to index.html for unknown paths so
    // client-side routing doesn't 404 on a hard refresh.
    static class StaticFileHandler implements HttpHandler {
        private final File root;

        StaticFileHandler(File root) {
            this.root = root;
        }

        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
                exchange.sendResponseHeaders(405, -1);
                return;
            }

            String path = exchange.getRequestURI().getPath();
            if (path.equals("/") || path.isEmpty()) {
                path = "/index.html";
            }

            File rootCanonical = root.getCanonicalFile();
            File requested = new File(root, path).getCanonicalFile();

            // Prevent path traversal outside the static root.
            if (!requested.getPath().startsWith(rootCanonical.getPath())) {
                exchange.sendResponseHeaders(403, -1);
                return;
            }

            File file = requested;
            if (!file.exists() || file.isDirectory()) {
                // SPA fallback for client-side routes (e.g. /students/5).
                file = new File(rootCanonical, "index.html");
            }

            if (!file.exists()) {
                String msg = "404 Not Found";
                byte[] bytes = msg.getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "text/plain; charset=UTF-8");
                exchange.sendResponseHeaders(404, bytes.length);
                try (OutputStream os = exchange.getResponseBody()) {
                    os.write(bytes);
                }
                return;
            }

            byte[] bytes = Files.readAllBytes(file.toPath());
            exchange.getResponseHeaders().set("Content-Type", guessContentType(file.getName()));
            exchange.sendResponseHeaders(200, bytes.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(bytes);
            }
        }

        private String guessContentType(String name) {
            String lower = name.toLowerCase(Locale.ROOT);
            if (lower.endsWith(".html"))
                return "text/html; charset=UTF-8";
            if (lower.endsWith(".js") || lower.endsWith(".mjs"))
                return "application/javascript";
            if (lower.endsWith(".css"))
                return "text/css";
            if (lower.endsWith(".svg"))
                return "image/svg+xml";
            if (lower.endsWith(".json"))
                return "application/json";
            if (lower.endsWith(".png"))
                return "image/png";
            if (lower.endsWith(".jpg") || lower.endsWith(".jpeg"))
                return "image/jpeg";
            if (lower.endsWith(".webp"))
                return "image/webp";
            if (lower.endsWith(".ico"))
                return "image/x-icon";
            if (lower.endsWith(".woff"))
                return "font/woff";
            if (lower.endsWith(".woff2"))
                return "font/woff2";
            return "application/octet-stream";
        }
    }

    // Handlers
    static class StudentsHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            String method = exchange.getRequestMethod();
            String path = exchange.getRequestURI().getPath();
            String[] parts = path.split("/");

            if ("GET".equalsIgnoreCase(method) && parts.length == 3) {
                // Photos are omitted by default — see toJsonWithoutPhoto. Pass
                // ?includePhotos=1 when the caller genuinely needs them (the
                // student editor does, since it saves the form back and would
                // otherwise blank out the photo it never received).
                String query = exchange.getRequestURI().getQuery();
                boolean includePhotos = query != null
                        && (query.contains("includePhotos=1") || query.contains("includePhotos=true"));

                List<Student> list = store.getStudents();
                StringBuilder sb = new StringBuilder();
                sb.append('[');
                for (int i = 0; i < list.size(); i++) {
                    if (i > 0)
                        sb.append(',');
                    sb.append(includePhotos ? list.get(i).toApiJson() : list.get(i).toJsonWithoutPhoto());
                }
                sb.append(']');
                sendJson(exchange, 200, sb.toString());
                return;
            }

            // GET /api/students/{id}/photo — readable by any signed-in user,
            // same as the roster it appears alongside.
            if ("GET".equalsIgnoreCase(method) && parts.length == 5 && "photo".equals(parts[4])) {
                StudentPhoto.serve(exchange, parts[3]);
                return;
            }

            if (!"admin".equals(CURRENT.get().role)) {
                sendJson(exchange, 403, "{\"error\":\"Admin access required\"}");
                return;
            }

            if ("POST".equalsIgnoreCase(method) && parts.length == 3) {
                String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                Map<String, String> obj = parseJsonObject(body);
                Student s = store.addStudent(
                        obj.getOrDefault("name", ""),
                        obj.getOrDefault("class", obj.getOrDefault("className", "Form 1")),
                        obj.getOrDefault("gender", "Male"),
                        obj.getOrDefault("guardian", "—"),
                        obj.getOrDefault("phone", "—"),
                        obj.getOrDefault("dob", "—"),
                        obj.getOrDefault("option", ""),
                        obj.getOrDefault("electives", ""),
                        obj.getOrDefault("photo", ""),
                        obj.getOrDefault("admittedOn", ""));
                // The student ID is only known once the store has assigned it,
                // so the photo moves to Storage on a second pass.
                String stored = storePhotoIfPossible(s.id, s.photo);
                if (!stored.equals(s.photo))
                    s = store.updateStudent(s.id, Map.of("photo", stored));
                store.save();
                sendJson(exchange, 201, s.toApiJson());
                return;
            }

            if (parts.length == 4) {
                String studentId = parts[3];
                if ("PUT".equalsIgnoreCase(method)) {
                    String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                    Map<String, String> obj = parseJsonObject(body);
                    // A newly-taken photo arrives inline; move it to Storage
                    // before it ever reaches the database.
                    if (obj.containsKey("photo")) {
                        obj = new HashMap<>(obj);
                        obj.put("photo", storePhotoIfPossible(studentId, obj.get("photo")));
                    }
                    Student updated = store.updateStudent(studentId, obj);
                    if (updated == null) {
                        sendJson(exchange, 404, "{\"error\":\"Student not found\"}");
                        return;
                    }
                    store.save();
                    sendJson(exchange, 200, updated.toApiJson());
                    return;
                }
                if ("DELETE".equalsIgnoreCase(method)) {
                    boolean ok = store.deleteStudent(studentId);
                    if (!ok) {
                        sendJson(exchange, 404, "{\"error\":\"Student not found\"}");
                        return;
                    }
                    store.save();
                    sendJson(exchange, 200, "{\"status\":\"ok\"}");
                    return;
                }
            }

            sendJson(exchange, 405, "{\"error\":\"Method not allowed\"}");
        }
    }

    private static String normalizeClassName(String raw) {
        if (raw == null)
            return "";
        String s = raw.trim().replaceAll("\\s+", " ");
        if (s.isEmpty())
            return "";
        String[] levels = { "Form 1", "Form 2", "Form 3", "Form 4", "Form 5", "Lower Sixth",
                "Upper Sixth" };
        for (String level : levels) {
            if (s.equalsIgnoreCase(level))
                return level;
            if (s.length() > level.length() && s.regionMatches(true, 0, level, 0, level.length())) {
                String rest = s.substring(level.length()).trim();
                if (rest.length() == 1 && Character.isLetter(rest.charAt(0)))
                    return level + Character.toUpperCase(rest.charAt(0));
            }
        }
        return s;
    }

    static class ClassesHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if ("GET".equalsIgnoreCase(exchange.getRequestMethod())) {
                List<ClassInfo> classes = store.getClasses();
                StringBuilder sb = new StringBuilder();
                sb.append('[');
                for (int i = 0; i < classes.size(); i++) {
                    if (i > 0)
                        sb.append(',');
                    sb.append(classes.get(i).toJson());
                }
                sb.append(']');
                sendJson(exchange, 200, sb.toString());
                return;
            }
            if ("POST".equalsIgnoreCase(exchange.getRequestMethod())) {
                if (!"admin".equals(CURRENT.get().role)) {
                    sendJson(exchange, 403, "{\"error\":\"Admin access required\"}");
                    return;
                }
                String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                Map<String, String> obj = parseJsonObject(body);
                String name = normalizeClassName(obj.getOrDefault("name", ""));
                if (name.isEmpty()) {
                    sendJson(exchange, 400, "{\"error\":\"Class name is required\"}");
                    return;
                }
                ClassInfo existing = store.findClass(name);
                if (existing != null) {
                    sendJson(exchange, 409, "{\"error\":\"A class with that name already exists\"}");
                    return;
                }
                ClassInfo c = store.addClass(name);
                store.save();
                sendJson(exchange, 201, c.toJson());
                return;
            }
            sendJson(exchange, 405, "{\"error\":\"Method not allowed\"}");
        }
    }

    // POST /api/classes/master { "class": "...", "teacherId": "..." }
    static class ClassMasterHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendJson(exchange, 405, "{\"error\":\"Method not allowed\"}");
                return;
            }
            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            Map<String, String> obj = parseJsonObject(body);
            String className = obj.getOrDefault("class", "");
            String teacherId = obj.getOrDefault("teacherId", "");
            ClassInfo updated = store.setClassMaster(className, teacherId);
            if (updated == null) {
                sendJson(exchange, 404, "{\"error\":\"Class or teacher not found\"}");
                return;
            }
            store.save();
            sendJson(exchange, 200, updated.toJson());
        }
    }

    static class RosterHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendJson(exchange, 405, "{\"error\":\"Method not allowed\"}");
                return;
            }
            Map<String, String> q = queryParams(exchange);
            String className = q.getOrDefault("class", "");
            List<Student> roster = store.getStudentsByClass(className);
            StringBuilder sb = new StringBuilder();
            sb.append('[');
            for (int i = 0; i < roster.size(); i++) {
                if (i > 0)
                    sb.append(',');
                sb.append(roster.get(i).toApiJson());
            }
            sb.append(']');
            sendJson(exchange, 200, sb.toString());
        }
    }

    static class MarksHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            String method = exchange.getRequestMethod();
            if ("GET".equalsIgnoreCase(method)) {
                Map<String, String> qmap = queryParams(exchange);
                String cls = qmap.getOrDefault("class", "");
                String subject = qmap.getOrDefault("subject", "");
                String sequence = qmap.getOrDefault("sequence", "");
                // Optional — omit (or leave blank) to read the currently
                // configured academic year. Student History / Mastersheet
                // pass an explicit year to look back at prior years.
                String academicYear = qmap.getOrDefault("academicYear", "");
                // Reads are allowed for any logged-in user so report cards
                // can assemble full subject sets. Writes stay assignment-scoped.
                Map<String, Double> marks = store.getMarks(academicYear, cls, subject, sequence);
                StringBuilder sb = new StringBuilder();
                sb.append('{');
                boolean first = true;
                for (Map.Entry<String, Double> e : marks.entrySet()) {
                    if (!first)
                        sb.append(',');
                    first = false;
                    sb.append('"').append(e.getKey()).append('"').append(':').append(e.getValue());
                }
                sb.append('}');
                sendJson(exchange, 200, sb.toString());
                return;
            }
            if ("POST".equalsIgnoreCase(method)) {
                String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                Map<String, String> obj = parseJsonObject(body);
                String cls = obj.getOrDefault("class", "");
                String subject = obj.getOrDefault("subject", "");
                String sequence = obj.getOrDefault("sequence", "");
                if (!teacherCanAccessMarks(CURRENT.get(), cls, subject)) {
                    sendJson(exchange, 403, "{\"error\":\"Not assigned to this class/subject\"}");
                    return;
                }
                Map<String, Double> sets = new HashMap<>();
                Set<String> clears = new HashSet<>();
                parseMarksPayload(body, sets, clears);
                // Writes always target the current academic year (null here
                // resolves to settings.academicYear) — teachers can never
                // accidentally overwrite a prior year's marks this way, and
                // a new year always starts with nothing recorded.
                store.saveMarks(null, cls, subject, sequence, sets, clears);
                store.save();
                sendJson(exchange, 200, "{\"status\":\"ok\"}");
                return;
            }
            sendJson(exchange, 405, "{\"error\":\"Method not allowed\"}");
        }
    }

    // Parses the nested "marks":{...} object. Values that are null or empty
    // strings are treated as clears so teachers can wipe a mistaken mark.
    private static void parseMarksPayload(String body, Map<String, Double> sets, Set<String> clears) {
        int midx = body.indexOf("\"marks\"");
        if (midx < 0)
            return;
        int colon = body.indexOf(':', midx);
        int start = body.indexOf('{', colon);
        if (start < 0)
            return;
        int depth = 0;
        int end = -1;
        for (int i = start; i < body.length(); i++) {
            char c = body.charAt(i);
            if (c == '{')
                depth++;
            else if (c == '}') {
                depth--;
                if (depth == 0) {
                    end = i;
                    break;
                }
            }
        }
        if (end < 0)
            return;
        String inner = body.substring(start + 1, end).trim();
        if (inner.isEmpty())
            return;
        boolean inQuotes = false;
        StringBuilder cur = new StringBuilder();
        List<String> parts = new ArrayList<>();
        for (int i = 0; i < inner.length(); i++) {
            char c = inner.charAt(i);
            if (c == '"')
                inQuotes = !inQuotes;
            if (c == ',' && !inQuotes) {
                parts.add(cur.toString());
                cur.setLength(0);
            } else {
                cur.append(c);
            }
        }
        if (cur.length() > 0)
            parts.add(cur.toString());
        for (String p : parts) {
            int idx = p.indexOf(':');
            if (idx <= 0)
                continue;
            String k = stripQuotes(p.substring(0, idx).trim());
            String v = p.substring(idx + 1).trim();
            if (k.isEmpty())
                continue;
            if (v.isEmpty() || "null".equals(v)) {
                clears.add(k);
                continue;
            }
            try {
                sets.put(k, Double.parseDouble(stripQuotes(v)));
            } catch (NumberFormatException ex) {
                clears.add(k);
            }
        }
    }

    static class ActivitiesHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            String method = exchange.getRequestMethod();
            if ("GET".equalsIgnoreCase(method)) {
                List<ActivityEntry> list = store.getActivities();
                StringBuilder sb = new StringBuilder();
                sb.append('[');
                for (int i = 0; i < list.size(); i++) {
                    if (i > 0)
                        sb.append(',');
                    sb.append(list.get(i).toJson());
                }
                sb.append(']');
                sendJson(exchange, 200, sb.toString());
                return;
            }
            if ("POST".equalsIgnoreCase(method)) {
                String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                Map<String, String> obj = parseJsonObject(body);
                String type = obj.getOrDefault("type", "Report Card");
                String text = obj.getOrDefault("text", "Report card generated");
                store.logActivity(type, text);
                store.save();
                sendJson(exchange, 201, "{\"status\":\"ok\"}");
                return;
            }
            sendJson(exchange, 405, "{\"error\":\"Method not allowed\"}");
        }
    }

    static class TeachersHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            String method = exchange.getRequestMethod();
            String path = exchange.getRequestURI().getPath();
            String[] parts = path.split("/");
            boolean isAdmin = "admin".equals(CURRENT.get().role);

            if ("GET".equalsIgnoreCase(method) && parts.length == 3) {
                List<Teacher> list = store.getTeachers();
                StringBuilder sb = new StringBuilder();
                sb.append('[');
                for (int i = 0; i < list.size(); i++) {
                    if (i > 0)
                        sb.append(',');
                    sb.append(list.get(i).toJson());
                }
                sb.append(']');
                sendJson(exchange, 200, sb.toString());
                return;
            }

            if (!isAdmin) {
                sendJson(exchange, 403, "{\"error\":\"Admin access required\"}");
                return;
            }

            if ("POST".equalsIgnoreCase(method) && parts.length == 3) {
                String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                Map<String, String> obj = parseJsonObject(body);
                Teacher t = store.addTeacher(
                        obj.getOrDefault("name", ""),
                        obj.getOrDefault("email", "—"),
                        obj.getOrDefault("phone", "—"));
                store.save();
                sendJson(exchange, 201, t.toJson());
                return;
            }

            if (parts.length == 5 && "assignments".equals(parts[4])) {
                String teacherId = parts[3];
                if ("POST".equalsIgnoreCase(method)) {
                    String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                    Map<String, String> obj = parseJsonObject(body);
                    String cls = obj.getOrDefault("class", "");
                    String subject = obj.getOrDefault("subject", "");
                    boolean ok = store.addAssignment(teacherId, cls, subject);
                    if (!ok) {
                        sendJson(exchange, 404, "{\"error\":\"Teacher not found\"}");
                        return;
                    }
                    store.save();
                    sendJson(exchange, 201, "{\"status\":\"ok\"}");
                    return;
                }
                if ("DELETE".equalsIgnoreCase(method)) {
                    Map<String, String> q = queryParams(exchange);
                    String cls = q.getOrDefault("class", "");
                    String subject = q.getOrDefault("subject", "");
                    store.removeAssignment(teacherId, cls, subject);
                    store.save();
                    sendJson(exchange, 200, "{\"status\":\"ok\"}");
                    return;
                }
            }

            if (parts.length == 4 && "DELETE".equalsIgnoreCase(method)) {
                String teacherId = parts[3];
                // Grab the email before deleting the staff record so we can
                // also revoke their login account — otherwise they'd keep
                // being able to sign in with credentials tied to a teacher
                // profile that no longer exists.
                String email = null;
                for (Teacher t : store.getTeachers()) {
                    if (t.id.equals(teacherId)) {
                        email = t.email;
                        break;
                    }
                }
                store.deleteTeacher(teacherId);
                if (email != null) {
                    store.deleteTeacherAccountByEmail(email);
                    // Drop the cached auth re-check so the removed teacher is
                    // locked out on their very next request, not up to
                    // USER_RECHECK_TTL_MS later.
                    invalidateUserCache(email);
                }
                store.save();
                sendJson(exchange, 200, "{\"status\":\"ok\"}");
                return;
            }

            sendJson(exchange, 405, "{\"error\":\"Method not allowed\"}");
        }
    }

    static class SettingsHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            String method = exchange.getRequestMethod();
            if ("GET".equalsIgnoreCase(method)) {
                sendJson(exchange, 200, store.getSettings().toJson());
                return;
            }
            if ("POST".equalsIgnoreCase(method)) {
                if (!"admin".equals(CURRENT.get().role)) {
                    sendJson(exchange, 403, "{\"error\":\"Admin access required\"}");
                    return;
                }
                String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                Map<String, String> obj = parseJsonObject(body);
                SchoolSettings updated = store.updateSettings(obj);
                store.save();
                sendJson(exchange, 200, updated.toJson());
                return;
            }
            sendJson(exchange, 405, "{\"error\":\"Method not allowed\"}");
        }
    }

    /**
     * GET /api/academic-years — every academic year that has recorded
     * marks, plus the currently configured one, sorted. Powers year
     * pickers on Student History and Mastersheet.
     */
    static class AcademicYearsHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendJson(exchange, 405, "{\"error\":\"Method not allowed\"}");
                return;
            }
            List<String> years = store.getAcademicYears();
            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < years.size(); i++) {
                if (i > 0)
                    sb.append(',');
                String y = years.get(i) == null ? "" : years.get(i);
                sb.append('"').append(y.replace("\\", "\\\\").replace("\"", "\\\"")).append('"');
            }
            sb.append(']');
            sendJson(exchange, 200, sb.toString());
        }
    }

    /**
     * POST /api/demo/seed — replaces academic data with the GBHS Bamenda demo.
     * Allowed when: (1) caller is an authenticated admin, or (2) request is from
     * loopback and sends header {@code X-Demo-Seed-Key: demo} (or DEMO_SEED_KEY).
     */
    static class DemoSeedHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendJson(exchange, 405, "{\"error\":\"Method not allowed\"}");
                return;
            }

            // Reaching this handler at all means ALLOW_DEMO_SEED was set, so
            // this is the second gate rather than the only one.
            //
            // Being an admin is deliberately NOT sufficient on its own. This
            // erases every student, mark, teacher and class, and the admin is
            // exactly the person who would trigger it by accident; the shared
            // key makes it a decision rather than a misclick.
            String expectedKey = System.getenv("DEMO_SEED_KEY");
            if (expectedKey == null || expectedKey.isBlank())
                expectedKey = "demo";
            String provided = exchange.getRequestHeaders().getFirst("X-Demo-Seed-Key");
            if (!expectedKey.equals(provided)) {
                sendJson(exchange, 403,
                        "{\"error\":\"Demo seed denied — a valid X-Demo-Seed-Key header is required.\"}");
                return;
            }

            try {
                Map<String, Object> summary = DemoSeed.run(store);
                store.save();
                StringBuilder sb = new StringBuilder();
                sb.append('{');
                sb.append("\"status\":\"ok\"");
                for (Map.Entry<String, Object> e : summary.entrySet()) {
                    sb.append(',');
                    sb.append('"').append(e.getKey()).append('"').append(':');
                    Object v = e.getValue();
                    if (v instanceof Number) {
                        sb.append(v);
                    } else {
                        sb.append('"').append(String.valueOf(v).replace("\\", "\\\\").replace("\"", "\\\""))
                                .append('"');
                    }
                }
                sb.append('}');
                sendJson(exchange, 200, sb.toString());
            } catch (Exception ex) {
                ex.printStackTrace();
                sendJson(exchange, 500, "{\"error\":\"Demo seed failed: "
                        + String.valueOf(ex.getMessage()).replace("\\", "\\\\").replace("\"", "\\\"") + "\"}");
            }
        }
    }

    // GET /api/backup — admin only. Exports the whole database as JSON so an
    // admin can save it somewhere safe (USB drive, cloud folder, email to
    // themselves). Works on both storage backends: cloud/Postgres deployments
    // need this most, since Supabase's free tier has no automated backups.
    static class BackupHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendJson(exchange, 405, "{\"error\":\"Method not allowed\"}");
                return;
            }
            // Flush whatever is currently in memory first, so the download
            // always reflects the latest saved marks.
            store.save();

            String stamp = java.time.LocalDate.now().toString();
            byte[] data = Backup.export(store, java.time.Instant.now().toString())
                    .getBytes(StandardCharsets.UTF_8);

            exchange.getResponseHeaders().add("Content-Type", "application/json; charset=UTF-8");
            exchange.getResponseHeaders().add("Content-Disposition",
                    "attachment; filename=\"report-card-backup-" + stamp + ".json\"");
            exchange.sendResponseHeaders(200, data.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(data);
            }
        }
    }

    // POST /api/backup/restore — admin only. Body is a JSON file previously
    // downloaded from /api/backup. Parses and validates it in full before
    // touching stored data, snapshots what's currently live, then applies the
    // restore in place (no restart needed).
    //
    // Parsing is deliberately plain JSON. This used to call readObject() on
    // the uploaded bytes, which let a malicious backup file execute code on
    // the server — an admin only had to be talked into restoring it.
    static class BackupRestoreHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendJson(exchange, 405, "{\"error\":\"Method not allowed\"}");
                return;
            }
            byte[] uploaded = exchange.getRequestBody().readAllBytes();
            if (uploaded.length == 0) {
                sendJson(exchange, 400, "{\"error\":\"No file received\"}");
                return;
            }
            if (uploaded.length > MAX_BACKUP_BYTES) {
                sendJson(exchange, 413, "{\"error\":\"That file is too large to be a backup\"}");
                return;
            }

            // Parse and validate fully before touching any stored data. This
            // is plain JSON parsing — it builds maps and lists only, and can
            // never instantiate arbitrary classes the way the previous
            // ObjectInputStream restore could.
            Map<String, Object> parsed;
            String summary;
            try {
                parsed = Json.parseObject(new String(uploaded, StandardCharsets.UTF_8));
                summary = Backup.describe(parsed);
            } catch (Json.ParseException | Backup.InvalidBackupException ex) {
                sendJson(exchange, 400, "{\"error\":\"" + escapeJson(ex.getMessage()) + "\"}");
                return;
            }

            // Snapshot what's live right now, so a restore that turns out to be
            // the wrong file is recoverable. Written next to the data dir for
            // the file store; for Postgres it is the only pre-restore copy that
            // exists, which matters on plans without automated backups.
            try {
                File safety = new File(dataDirectory, "pre-restore-" + System.currentTimeMillis() + ".json");
                java.nio.file.Files.write(safety.toPath(),
                        Backup.export(store, java.time.Instant.now().toString()).getBytes(StandardCharsets.UTF_8));
                System.out.println("Pre-restore snapshot written to " + safety.getAbsolutePath());
            } catch (Exception ex) {
                // Best-effort — never block a restore over it, but say so.
                System.err.println("Could not write pre-restore snapshot: " + ex.getMessage());
            }

            try {
                Backup.apply(store, parsed);
            } catch (RuntimeException ex) {
                sendJson(exchange, 500,
                        "{\"error\":\"Restore failed part-way: " + escapeJson(String.valueOf(ex.getMessage())) + "\"}");
                return;
            }
            store.logActivity("backup", "Data restored from an uploaded backup (" + summary + ")");
            store.save();
            sendJson(exchange, 200, "{\"status\":\"ok\",\"restored\":\"" + escapeJson(summary) + "\"}");
        }
    }

    // One recorded mark, flattened out of whatever shape each store keeps
    // internally. Used only by the backup export.
    static class MarkRow {
        final String academicYear, className, subject, sequence, studentId;
        final double score;
        /** Change time, so two devices merge per cell rather than per class. */
        long updatedAt;

        MarkRow(String academicYear, String className, String subject, String sequence, String studentId,
                double score) {
            this.academicYear = academicYear;
            this.className = className;
            this.subject = subject;
            this.sequence = sequence;
            this.studentId = studentId;
            this.score = score;
        }
    }

    /**
     * Moves an inline photo into Supabase Storage and returns the object path
     * to save instead.
     *
     * Returns the original data URL untouched when storage isn't configured or
     * the upload fails — a storage outage must degrade to the old inline
     * behaviour, never drop a photo the admin just took.
     */
    private static String storePhotoIfPossible(String studentId, String photo) {
        SupabaseStorage storage = SupabaseStorage.get();
        if (storage == null || !SupabaseStorage.isDataUrl(photo))
            return photo;
        String path = storage.uploadDataUrl(photo, SupabaseStorage.studentPhotoPath(studentId));
        return path != null ? path : photo;
    }

    // GET /api/students/{id}/photo — serves a student's photo.
    //
    // The bucket is private (these are children's photographs), so bytes are
    // fetched server-side for an already-authenticated caller rather than
    // handing out a public URL. Responses carry an ETag and a private
    // cache directive so a browser re-uses them instead of re-fetching a
    // class full of photos on every navigation.
    static final class StudentPhoto {
        static void serve(HttpExchange exchange, String studentId) throws IOException {
            Student student = null;
            for (Student s : store.getStudents())
                if (s.id.equals(studentId)) {
                    student = s;
                    break;
                }
            if (student == null || student.photo == null || student.photo.isEmpty()) {
                sendJson(exchange, 404, "{\"error\":\"No photo for that student\"}");
                return;
            }

            byte[] bytes;
            String contentType = "image/jpeg";
            if (SupabaseStorage.isDataUrl(student.photo)) {
                // Legacy record still inline in the database.
                int comma = student.photo.indexOf(',');
                try {
                    bytes = Base64.getDecoder().decode(student.photo.substring(comma + 1));
                } catch (RuntimeException e) {
                    sendJson(exchange, 500, "{\"error\":\"Stored photo is corrupt\"}");
                    return;
                }
            } else {
                SupabaseStorage storage = SupabaseStorage.get();
                bytes = storage == null ? null : storage.download(student.photo);
                if (bytes == null) {
                    sendJson(exchange, 502, "{\"error\":\"Photo storage is unavailable\"}");
                    return;
                }
            }

            String etag = "\"" + Integer.toHexString(java.util.Arrays.hashCode(bytes)) + "\"";
            String ifNoneMatch = exchange.getRequestHeaders().getFirst("If-None-Match");
            if (etag.equals(ifNoneMatch)) {
                exchange.sendResponseHeaders(304, -1);
                exchange.close();
                return;
            }

            exchange.getResponseHeaders().add("Content-Type", contentType);
            exchange.getResponseHeaders().add("ETag", etag);
            // "private" so shared proxies never hold a pupil's photograph.
            exchange.getResponseHeaders().add("Cache-Control", "private, max-age=3600");
            exchange.sendResponseHeaders(200, bytes.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(bytes);
            }
        }
    }

    // POST /api/account/password {"currentPassword":"...","newPassword":"..."}
    // Changes the signed-in user's own password. There was previously no way
    // to do this at all, so a school could never rotate a credential that had
    // leaked — including the well-known one earlier builds seeded.
    static class ChangePasswordHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendJson(exchange, 405, "{\"error\":\"Method not allowed\"}");
                return;
            }
            Session session = CURRENT.get();
            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            Map<String, String> obj = parseJsonObject(body);
            String current = obj.getOrDefault("currentPassword", "");
            String next = obj.getOrDefault("newPassword", "");

            if (next.length() < 8) {
                sendJson(exchange, 400,
                        "{\"error\":\"New password must be at least 8 characters\"}");
                return;
            }

            User user = store.findUserByEmail(session.email);
            if (user == null) {
                sendJson(exchange, 401, "{\"error\":\"Account no longer exists\"}");
                return;
            }
            // Re-check the current password even though the caller is already
            // authenticated, so a borrowed unlocked screen can't be used to
            // take the account over.
            if (!Passwords.matches(current, user.password)) {
                sendJson(exchange, 403, "{\"error\":\"Current password is incorrect\"}");
                return;
            }
            if (Passwords.matches(next, user.password)) {
                sendJson(exchange, 400, "{\"error\":\"New password must be different from the current one\"}");
                return;
            }

            store.updateUserPassword(user.id, Passwords.hash(next));
            store.save();
            invalidateUserCache(user.email);
            store.logActivity("Security", "Password changed for " + user.email);
            sendJson(exchange, 200, "{\"status\":\"ok\"}");
        }
    }

    /**
     * POST /api/sync — two-way merge for offline-capable clients.
     *
     * Request:  {"since": <millis>, "changes": {"students":[…],"teachers":[…],"marks":[…]}}
     * Response: {"serverTime": <millis>, "changes": {…}, "applied": {…}}
     *
     * The client sends what changed locally since its last successful sync and
     * gets back everything the server has seen since then.
     *
     * `serverTime` is the cursor to send as `since` next time. It is
     * deliberately the SERVER's clock: a client using its own would silently
     * skip or re-send changes whenever its clock drifts, and on cheap hardware
     * with a flat CMOS battery that is routine rather than exotic. Every
     * updatedAt written here is server-stamped for the same reason, so
     * last-write-wins compares like with like.
     */
    static class SyncHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendJson(exchange, 405, "{\"error\":\"Method not allowed\"}");
                return;
            }

            Map<String, Object> body;
            try {
                body = Json.parseObject(
                        new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            } catch (Json.ParseException e) {
                sendJson(exchange, 400, "{\"error\":\"" + escapeJson(e.getMessage()) + "\"}");
                return;
            }

            long since = (long) Json.getDouble(body, "since", 0);
            Session caller = CURRENT.get();
            boolean admin = caller != null && "admin".equals(caller.role);

            // Read the cursor BEFORE applying anything. Stamping it afterwards
            // would exclude changes that landed while this request was running,
            // and the client would never see them.
            long serverTime = System.currentTimeMillis();

            int appliedStudents = 0, appliedTeachers = 0, appliedMarks = 0, rejected = 0;
            Map<String, Object> incoming = Json.getObject(body, "changes");

            if (incoming != null) {
                // Teachers may push marks (that is the whole point of letting
                // them work offline) but must not push student or staff
                // records — the same rule the REST handlers enforce.
                for (Map<String, Object> m : Json.getObjectList(incoming, "marks")) {
                    MarkRow row = new MarkRow(
                            Json.getString(m, "academicYear", ""),
                            Json.getString(m, "className", ""),
                            Json.getString(m, "subject", ""),
                            Json.getString(m, "sequence", ""),
                            Json.getString(m, "studentId", ""),
                            Json.getDouble(m, "score", 0));
                    if (row.className.isBlank() || row.studentId.isBlank()) {
                        rejected++;
                        continue;
                    }
                    if (!admin && !teacherCanAccessMarks(caller, row.className, row.subject)) {
                        rejected++;
                        continue;
                    }
                    row.updatedAt = clampToNow(Json.getDouble(m, "updatedAt", serverTime), serverTime);
                    if (store.mergeMark(row))
                        appliedMarks++;
                }

                if (admin) {
                    for (Map<String, Object> st : Json.getObjectList(incoming, "students")) {
                        String id = Json.getString(st, "id", "");
                        if (id.isBlank()) {
                            rejected++;
                            continue;
                        }
                        Student s = new Student(id,
                                Json.getString(st, "name", ""),
                                Json.getString(st, "class", Json.getString(st, "className", "")),
                                Json.getString(st, "gender", ""),
                                Json.getString(st, "guardian", ""),
                                Json.getString(st, "phone", ""),
                                Json.getString(st, "dob", ""),
                                Json.getString(st, "option", ""),
                                Json.getString(st, "electives", ""));
                        s.code = Json.getString(st, "code", id);
                        s.status = Json.getString(st, "status", "Active");
                        s.photo = Json.getString(st, "photo", "");
                        s.admittedOn = Json.getString(st, "admittedOn", "");
                        s.updatedAt = clampToNow(Json.getDouble(st, "updatedAt", serverTime), serverTime);
                        double deleted = Json.getDouble(st, "deletedAt", 0);
                        s.deletedAt = deleted > 0 ? (long) deleted : null;
                        if (store.mergeStudent(s))
                            appliedStudents++;
                    }
                    for (Map<String, Object> t : Json.getObjectList(incoming, "teachers")) {
                        String id = Json.getString(t, "id", "");
                        if (id.isBlank()) {
                            rejected++;
                            continue;
                        }
                        Teacher teacher = new Teacher(id, Json.getString(t, "name", ""),
                                Json.getString(t, "email", ""), Json.getString(t, "phone", ""));
                        teacher.updatedAt = clampToNow(Json.getDouble(t, "updatedAt", serverTime), serverTime);
                        if (store.mergeTeacher(teacher))
                            appliedTeachers++;
                    }
                } else if (!Json.getObjectList(incoming, "students").isEmpty()
                        || !Json.getObjectList(incoming, "teachers").isEmpty()) {
                    rejected += Json.getObjectList(incoming, "students").size()
                            + Json.getObjectList(incoming, "teachers").size();
                }
            }
            if (appliedStudents + appliedTeachers + appliedMarks > 0)
                store.save();

            StringBuilder sb = new StringBuilder(1 << 14);
            sb.append("{\"serverTime\":").append(serverTime);
            sb.append(",\"applied\":{\"students\":").append(appliedStudents)
                    .append(",\"teachers\":").append(appliedTeachers)
                    .append(",\"marks\":").append(appliedMarks)
                    .append(",\"rejected\":").append(rejected).append('}');

            sb.append(",\"changes\":{\"students\":[");
            List<Student> students = store.studentsChangedSince(since);
            for (int i = 0; i < students.size(); i++) {
                if (i > 0)
                    sb.append(',');
                sb.append(students.get(i).toSyncJson());
            }
            sb.append("],\"teachers\":[");
            List<Teacher> teachers = store.teachersChangedSince(since);
            for (int i = 0; i < teachers.size(); i++) {
                Teacher t = teachers.get(i);
                if (i > 0)
                    sb.append(',');
                sb.append("{\"id\":").append(Json.str(t.id))
                        .append(",\"name\":").append(Json.str(t.name))
                        .append(",\"email\":").append(Json.str(t.email))
                        .append(",\"phone\":").append(Json.str(t.phone))
                        .append(",\"updatedAt\":").append(t.updatedAt).append('}');
            }
            sb.append("],\"marks\":[");
            List<MarkRow> marks = store.marksChangedSince(since);
            for (int i = 0; i < marks.size(); i++) {
                MarkRow m = marks.get(i);
                if (i > 0)
                    sb.append(',');
                sb.append("{\"academicYear\":").append(Json.str(m.academicYear))
                        .append(",\"className\":").append(Json.str(m.className))
                        .append(",\"subject\":").append(Json.str(m.subject))
                        .append(",\"sequence\":").append(Json.str(m.sequence))
                        .append(",\"studentId\":").append(Json.str(m.studentId))
                        .append(",\"score\":").append(m.score)
                        .append(",\"updatedAt\":").append(m.updatedAt).append('}');
            }
            sb.append("]}}");
            sendJson(exchange, 200, sb.toString());
        }
    }

    /**
     * Client timestamps are honoured for ordering but never allowed past the
     * server's clock.
     *
     * A device whose clock runs fast would otherwise stamp changes into the
     * future. Those rows sit permanently beyond every cursor the server hands
     * out, so the client re-receives them on every sync, forever. Clamping
     * keeps "this was edited at T while offline" meaningful while making the
     * server's clock the ceiling — which is the same reason the cursor itself
     * is server-issued. A clock that is merely slow is fine and needs no
     * special handling: those changes simply lose a conflict they would have
     * lost anyway.
     */
    private static long clampToNow(double clientSupplied, long serverTime) {
        long value = (long) clientSupplied;
        if (value <= 0 || value > serverTime)
            return serverTime;
        return value;
    }

    // GET /api/sync/status — what the desktop's sync is doing, for the UI.
    // Silent sync is how people stop trusting a tool, so this is surfaced
    // rather than left to the logs.
    static class SyncStatusHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            SyncClient client = SyncClient.get(dataDirectory);
            if (client == null) {
                sendJson(exchange, 200, "{\"configured\":false}");
                return;
            }
            sendJson(exchange, 200, client.statusJson(store));
        }
    }

    // POST /api/sync/now — admin-triggered sync, for "I'm online now, go".
    static class SyncNowHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            SyncClient client = SyncClient.get(dataDirectory);
            if (client == null) {
                sendJson(exchange, 400, "{\"error\":\"Sync isn't set up on this machine\"}");
                return;
            }
            boolean ok = client.syncNow(store);
            sendJson(exchange, ok ? 200 : 502, client.statusJson(store));
        }
    }

    // GET /api/license — current licence state, for the banner in the UI.
    static class LicenseHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendJson(exchange, 405, "{\"error\":\"Method not allowed\"}");
                return;
            }
            License current = license;
            if (current == null) {
                sendJson(exchange, 200, "{\"status\":\"MISSING\",\"readOnly\":false,\"message\":\"\"}");
                return;
            }
            sendJson(exchange, 200, current.toJson());
        }
    }

    // POST /api/license/activate {"key":"..."} — admin only. Verifies the key
    // and, if good, stores it so it survives a restart — both on disk and in
    // the shared school store, so every teacher on this install inherits it.
    static class LicenseActivateHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendJson(exchange, 405, "{\"error\":\"Method not allowed\"}");
                return;
            }
            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            String key = parseJsonObject(body).getOrDefault("key", "").trim();
            if (key.isEmpty()) {
                sendJson(exchange, 400, "{\"error\":\"No licence key supplied\"}");
                return;
            }

            License candidate = License.verify(key);
            if (candidate.status != License.Status.ACTIVE) {
                // Rejected keys are never written, so a bad paste can't knock
                // a working licence out.
                sendJson(exchange, 400, "{\"error\":\"" + escapeJson(candidate.message) + "\",\"status\":\""
                        + candidate.status + "\"}");
                return;
            }

            try {
                persistLicenseKey(key);
            } catch (IOException e) {
                sendJson(exchange, 500,
                        "{\"error\":\"Licence is valid but could not be saved: " + escapeJson(e.getMessage()) + "\"}");
                return;
            }

            license = candidate;
            store.logActivity("Licence", "Licence activated for " + candidate.school
                    + " (expires " + candidate.expires + ")");
            sendJson(exchange, 200, candidate.toJson());
        }
    }

    // GET /api/license/key — admin only. Returns the raw school key so a
    // desktop sync client can cache it locally after the admin activated
    // once elsewhere. Never exposed to teachers.
    static class LicenseKeyHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendJson(exchange, 405, "{\"error\":\"Method not allowed\"}");
                return;
            }
            String key = store.getLicenseKey();
            if (key == null || key.isBlank())
                key = License.readToken(dataDirectory);
            if (key == null || key.isBlank()) {
                sendJson(exchange, 404, "{\"error\":\"No school licence key is stored yet\"}");
                return;
            }
            sendJson(exchange, 200, "{\"key\":" + Json.str(key) + "}");
        }
    }

    /**
     * Writes the school licence key to the local file and the shared store.
     * Teachers never see this — they inherit whatever this install has loaded.
     */
    static void persistLicenseKey(String key) throws IOException {
        if (key == null || key.isBlank())
            return;
        java.nio.file.Files.writeString(new File(dataDirectory, "license.key").toPath(), key.trim());
        store.setLicenseKey(key.trim());
    }

    /** Applies a school licence that SyncClient pulled from the shared server. */
    static void installPulledLicense(License verified) {
        if (verified != null && verified.allowsWrites())
            license = verified;
    }

    // Data classes — shared by both storage backends.
    static class Student implements Serializable {
        private static final long serialVersionUID = 1L;
        /**
         * Internal identity. A UUID for anything created from now on.
         *
         * It used to be a sequential "SPXCC0042", which two devices working
         * offline would both mint for different students — and since marks are
         * keyed by student id, the collision would silently land one child's
         * marks on another's report card. Records created before this change
         * keep their old id: they are already unique within their own store,
         * and re-keying them would mean rewriting every mark that points at
         * them for no safety gain.
         */
        String id;
        /**
         * The number humans see — on rosters, report cards and student cards.
         * Still sequential and still "SPXCC0042", because schools read these
         * aloud and write them on paper; a UUID would be a real regression.
         * Purely presentational: nothing references a student by code.
         */
        String code;
        String name, className, gender, guardian, phone, dob, option, electives, status;
        /** When this row last changed, epoch millis. Drives last-write-wins. */
        long updatedAt;
        /**
         * Set when the record is deleted, instead of dropping the row.
         *
         * A device that was offline when a pupil was withdrawn cannot learn
         * about a row that simply disappeared, so on reconnect it would push
         * the pupil back. The tombstone is what lets a delete survive a merge.
         */
        Long deletedAt;
        // Passport-style photo, stored as a data URL (e.g. "data:image/jpeg;base64,...").
        // Resized/compressed client-side before upload, so this stays small.
        String photo;
        // Date the student was admitted to the school, "yyyy-mm-dd" from a
        // date input. Optional — blank for students entered before this field
        // existed, or if the admin doesn't have the exact date on hand.
        String admittedOn;

        Student(String id, String name, String className, String gender, String guardian, String phone, String dob,
                String option, String electives) {
            this.id = id;
            this.name = name;
            this.className = className;
            this.gender = gender;
            this.guardian = guardian;
            this.phone = phone;
            this.dob = dob;
            this.option = option;
            this.electives = electives;
            this.status = "Active";
            this.photo = "";
            this.admittedOn = "";
            // Legacy records (and any caller that doesn't set one) display
            // their id, which is exactly what they showed before.
            this.code = id;
        }

        String toJson() {
            return String.format(Locale.ROOT,
                    "{\"id\":\"%s\",\"code\":\"%s\",\"name\":\"%s\",\"class\":\"%s\",\"gender\":\"%s\",\"guardian\":\"%s\",\"phone\":\"%s\",\"dob\":\"%s\",\"option\":\"%s\",\"electives\":\"%s\",\"status\":\"%s\",\"photo\":\"%s\",\"admittedOn\":\"%s\"}",
                    escape(id), escape(displayCode()), escape(name), escape(className), escape(gender), escape(guardian), escape(phone),
                    escape(dob), escape(option), escape(electives), escape(status), escape(photo), escape(admittedOn));
        }

        /**
         * JSON for API responses.
         *
         * The stored photo may be an inline data URL (older records, and the
         * desktop file store) or a Supabase Storage object path. A raw storage
         * path is meaningless to a browser, so it's rendered as the endpoint
         * that serves the bytes. Backups deliberately use toJson() instead, so
         * they keep the real stored value.
         */
        String toApiJson() {
            if (!SupabaseStorage.isStoragePath(photo))
                return toJson();
            String saved = photo;
            try {
                photo = "/api/students/" + id + "/photo";
                return toJson();
            } finally {
                photo = saved;
            }
        }

        /**
         * Same as toJson but with the photo replaced by a "hasPhoto" flag.
         *
         * Photos are base64 data URLs of ~40–80KB each, stored on the student
         * row. Returning them for every student in the school turned the plain
         * student list into a multi-megabyte response — and that list is
         * fetched on every page load. Screens that actually display photos
         * work off a single class at a time, which is a bounded payload.
         */
        String toJsonWithoutPhoto() {
            return String.format(Locale.ROOT,
                    "{\"id\":\"%s\",\"code\":\"%s\",\"name\":\"%s\",\"class\":\"%s\",\"gender\":\"%s\",\"guardian\":\"%s\",\"phone\":\"%s\",\"dob\":\"%s\",\"option\":\"%s\",\"electives\":\"%s\",\"status\":\"%s\",\"hasPhoto\":%b,\"admittedOn\":\"%s\"}",
                    escape(id), escape(displayCode()), escape(name), escape(className), escape(gender), escape(guardian), escape(phone),
                    escape(dob), escape(option), escape(electives), escape(status),
                    photo != null && !photo.isEmpty(), escape(admittedOn));
        }

        /**
         * Payload for /api/sync. Unlike toApiJson this keeps the raw stored
         * photo (a storage path, not a URL) and carries the sync metadata, so
         * the record can be merged verbatim on the other side.
         */
        String toSyncJson() {
            StringBuilder sb = new StringBuilder(toJson());
            sb.setLength(sb.length() - 1); // drop the closing brace
            sb.append(",\"updatedAt\":").append(updatedAt);
            if (deletedAt != null)
                sb.append(",\"deletedAt\":").append(deletedAt);
            return sb.append('}').toString();
        }

        /** Falls back to the id for records written before codes existed. */
        String displayCode() {
            return code == null || code.isBlank() ? id : code;
        }

        private String escape(String s) {
            return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"");
        }
    }

    static class ClassInfo implements Serializable {
        private static final long serialVersionUID = 1L;
        String name;
        String teacher;
        Double average;
        int students;
        String classMasterId; // references Teacher.id; "teacher" field holds the display name

        ClassInfo(String name) {
            this.name = name;
            this.teacher = "Unassigned";
            this.average = null;
            this.students = 0;
            this.classMasterId = null;
        }

        String toJson() {
            return String.format(Locale.ROOT,
                    "{\"name\":\"%s\",\"students\":%d,\"average\":%s,\"teacher\":\"%s\",\"classMasterId\":\"%s\"}",
                    escape(name), students, average == null ? "null" : String.format(Locale.ROOT, "%.2f", average),
                    escape(teacher), escape(classMasterId));
        }

        private String escape(String s) {
            return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"");
        }
    }

    static class ActivityEntry implements Serializable {
        private static final long serialVersionUID = 1L;
        String type;
        String text;
        long timestamp;

        ActivityEntry(String type, String text, long timestamp) {
            this.type = type;
            this.text = text;
            this.timestamp = timestamp;
        }

        String toJson() {
            return String.format(Locale.ROOT, "{\"type\":\"%s\",\"text\":\"%s\",\"timestamp\":%d}", escape(type),
                    escape(text), timestamp);
        }

        private String escape(String s) {
            return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"");
        }
    }

    static class Assignment implements Serializable {
        private static final long serialVersionUID = 1L;
        String className;
        String subject;

        Assignment(String className, String subject) {
            this.className = className;
            this.subject = subject;
        }

        String toJson() {
            return String.format(Locale.ROOT, "{\"class\":\"%s\",\"subject\":\"%s\"}", escape(className),
                    escape(subject));
        }

        private String escape(String s) {
            return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"");
        }
    }

    static class Teacher implements Serializable {
        private static final long serialVersionUID = 1L;
        String id, name, email, phone;
        /** Change time, for last-write-wins during a sync. */
        long updatedAt;
        List<Assignment> assignments = new ArrayList<>();

        Teacher(String id, String name, String email, String phone) {
            this.id = id;
            this.name = name;
            this.email = email;
            this.phone = phone;
        }

        String toJson() {
            StringBuilder assignSb = new StringBuilder("[");
            for (int i = 0; i < assignments.size(); i++) {
                if (i > 0)
                    assignSb.append(',');
                assignSb.append(assignments.get(i).toJson());
            }
            assignSb.append(']');
            return String.format(Locale.ROOT,
                    "{\"id\":\"%s\",\"name\":\"%s\",\"email\":\"%s\",\"phone\":\"%s\",\"assignments\":%s}",
                    escape(id), escape(name), escape(email), escape(phone), assignSb.toString());
        }

        private String escape(String s) {
            return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"");
        }
    }

    // Login/register account. Kept separate from Teacher — a Teacher is a
    // staff record used for class/subject assignments, while a User is a
    // login credential that may or may not correspond to a Teacher record.
    static class User implements Serializable {
        private static final long serialVersionUID = 1L;
        String id, name, email, password, role; // role: "admin" | "teacher"

        User(String id, String name, String email, String password, String role) {
            this.id = id;
            this.name = name;
            this.email = email;
            this.password = password;
            this.role = role;
        }

        // Deliberately omits "password" — this is what gets sent back to
        // the frontend after login/register, never the raw credential.
        String toJson() {
            return String.format(Locale.ROOT,
                    "{\"id\":\"%s\",\"name\":\"%s\",\"email\":\"%s\",\"role\":\"%s\"}",
                    escape(id), escape(name), escape(email), escape(role));
        }

        private String escape(String s) {
            return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"");
        }
    }

    static class SchoolSettings implements Serializable {
        private static final long serialVersionUID = 1L;
        String schoolName = "SCHOOL";
        String schoolCode = "SCH";
        String region = "North-West";
        String schoolTown = "";
        String regionalDelegation = "";
        String subDivision = "";
        String motto = "";
        String currentTerm = "Term 2";
        String currentSequence = "Sequence 4";
        String academicYear = "2025 – 2026";
        String marksScale = "20";
        boolean emailNotif = true;
        boolean autoLock = false;
        boolean publicResults = false;
        // Percentage (0-100) of the marks scale a student must reach to be
        // considered a "Pass" — set by the principal, applied everywhere the
        // app decides pass/fail (report card conduct box, papers passed/failed,
        // GCE-style status).
        String passAverage = "50";
        // Data URLs ("data:image/...;base64,...") for the principal's stamp
        // and signature, printed on the report card's signature line.
        String principalStamp = "";
        String principalSignature = "";
        // Date (yyyy-MM-dd, from an <input type="date">) the next term
        // begins — shown on the report card's "Next Term: …" line.
        String nextTermBegins = "";

        String toJson() {
            return String.format(Locale.ROOT,
                    "{\"schoolName\":\"%s\",\"schoolCode\":\"%s\",\"region\":\"%s\",\"schoolTown\":\"%s\",\"regionalDelegation\":\"%s\",\"subDivision\":\"%s\",\"motto\":\"%s\",\"currentTerm\":\"%s\",\"currentSequence\":\"%s\",\"academicYear\":\"%s\",\"marksScale\":\"%s\",\"emailNotif\":%b,\"autoLock\":%b,\"publicResults\":%b,\"passAverage\":\"%s\",\"principalStamp\":\"%s\",\"principalSignature\":\"%s\",\"nextTermBegins\":\"%s\"}",
                    escape(schoolName), escape(schoolCode), escape(region), escape(schoolTown),
                    escape(regionalDelegation), escape(subDivision), escape(motto),
                    escape(currentTerm), escape(currentSequence), escape(academicYear), escape(marksScale),
                    emailNotif, autoLock, publicResults, escape(passAverage), escape(principalStamp),
                    escape(principalSignature), escape(nextTermBegins));
        }

        private String escape(String s) {
            return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"");
        }
    }

    // ------------------------------------------------------------------
    // DataStore: the storage abstraction. FileDataStore (below) is the
    // original serialized-file logic, untouched in behavior, used by the
    // desktop app. PostgresDataStore is the new Supabase-backed
    // implementation, used only on Render when DATABASE_URL is set.
    // ------------------------------------------------------------------
    interface DataStore {
        void init(File dataDir);

        void save();

        void logActivity(String type, String text);

        List<ActivityEntry> getActivities();

        Student addStudent(String name, String className, String gender, String guardian,
                String phone, String dob, String option, String electives, String photo, String admittedOn);

        Student updateStudent(String id, Map<String, String> fields);

        boolean deleteStudent(String id);

        List<Student> getStudents();

        List<Student> getStudentsByClass(String className);

        List<ClassInfo> getClasses();

        ClassInfo findClass(String name);

        ClassInfo addClass(String name);

        ClassInfo setClassMaster(String className, String teacherId);

        /**
         * Saves marks under a specific academic year. Pass null or "" to
         * target whatever year is currently configured in settings — this
         * is what live mark entry should always do, so a new academic year
         * automatically starts every class/subject/sequence with a clean
         * slate instead of overwriting a prior year's scores.
         */
        void saveMarks(String academicYear, String cls, String subject, String sequence, Map<String, Double> sets,
                Set<String> clears);

        /** Pass null or "" for academicYear to read the current year's marks. */
        Map<String, Double> getMarks(String academicYear, String cls, String subject, String sequence);

        /** Every academic year that has recorded marks, plus the current one, sorted. */
        List<String> getAcademicYears();

        Teacher addTeacher(String name, String email, String phone);

        List<Teacher> getTeachers();

        boolean addAssignment(String teacherId, String className, String subject);

        void removeAssignment(String teacherId, String className, String subject);

        void deleteTeacher(String teacherId);

        /**
         * Deletes the login account for this email, but only if that
         * account's role is "teacher" — guards against ever touching an
         * admin account that happens to share an email with a removed
         * teacher. Returns true if an account was actually deleted.
         */
        boolean deleteTeacherAccountByEmail(String email);

        User findUserByEmail(String email);

        User addUser(String name, String email, String password, String role);

        boolean hasAdmin();

        void updateUserPassword(String userId, String passwordHash);

        Teacher findTeacherByEmail(String email);

        SchoolSettings getSettings();

        SchoolSettings updateSettings(Map<String, String> fields);

        /**
         * School-wide licence key. One key covers every account (admin and
         * teachers) on this install — it is not per-user. Empty string when
         * none is stored. Never returned through the public settings JSON.
         */
        String getLicenseKey();

        void setLicenseKey(String key);

        /** Clears students, teachers, marks, activities, and classes (keeps users). */
        void wipeAcademicData();

        void clearActivities();

        /** Create or update a login account by email (demo seeding). */
        void ensureUser(String name, String email, String passwordHash, String role);

        // ---- Session persistence -----------------------------------------
        // Sessions outlive the process so a restart doesn't sign everyone out,
        // and so a second instance recognises tokens the first one issued.

        void saveSession(String token, Session session);

        /** Returns null if the token is unknown. Expiry is checked by the caller. */
        Session findSession(String token);

        void deleteSession(String token);

        void purgeExpiredSessions(long nowMillis);

        /**
         * Permanently removes rows tombstoned before the cutoff. Sweeping too
         * eagerly would let a long-offline device resurrect deleted records,
         * so callers pass a generous cutoff.
         */
        void purgeTombstones(long cutoffMillis);

        // ---- Sync (see SyncHandler) --------------------------------------
        // "Changed since" reads deliberately include tombstones: a deletion is
        // a change the other side must learn about.

        List<Student> studentsChangedSince(long since);

        List<Teacher> teachersChangedSince(long since);

        List<MarkRow> marksChangedSince(long since);

        /**
         * Applies an incoming record if it is newer than what's stored.
         * Returns true when it won. Last-write-wins on updatedAt: adequate
         * here because the data is naturally partitioned — a teacher edits
         * their own class's marks, an admin edits students — so genuine
         * concurrent edits to the same field are rare, and a CRDT's cost
         * would buy almost nothing.
         */
        boolean mergeStudent(Student incoming);

        boolean mergeTeacher(Teacher incoming);

        boolean mergeMark(MarkRow incoming);

        // ---- Backup support (see Backup.java) ----------------------------
        // These exist so a backup can be exported and restored through this
        // interface alone, without either store needing its own copy of the
        // export logic.

        /** Every login account, password hashes included. Admin-only paths. */
        List<User> getUsers();

        /** Every recorded mark across all academic years, flattened. */
        List<MarkRow> getAllMarks();

        /**
         * Inserts a student with the ID it already carries, rather than
         * generating a fresh one. Marks reference the student ID, so a restore
         * that renumbered students would detach every score from its owner.
         */
        void restoreStudent(Student student);

        /** Inserts a teacher, and their assignments, with the given ID. */
        void restoreTeacher(Teacher teacher);

        /** Inserts a login account with an already-hashed password. */
        void restoreUser(User user);

        /**
         * The raw on-disk file backing this store, for download as a backup.
         * Returns null for stores that aren't file-based (e.g. Postgres,
         * where the data already lives safely in a managed database).
         */
        File getBackupFile();

        /**
         * Re-reads all data from the backing store, discarding whatever is
         * currently in memory. Used right after a backup file is restored so
         * the running app picks up the new data without a restart. No-op for
         * stores that always read live (e.g. Postgres).
         */
        void reload();
    }

    // Original file-based storage, adapted from static methods to an
    // instance implementing DataStore. Behavior is identical to before —
    // this is exactly what the desktop app has always used.
    static class FileDataStore implements DataStore {
        private final List<Student> students = new ArrayList<>();
        private final List<ClassInfo> classes = new ArrayList<>();
        private final List<ActivityEntry> activities = new ArrayList<>();
        private final List<Teacher> teachers = new ArrayList<>();
        private final List<User> users = new ArrayList<>();
        private SchoolSettings settings = new SchoolSettings();
        // School-wide licence key. Kept outside SchoolSettings so it is never
        // accidentally serialised into the public /api/settings JSON.
        private String licenseKey = "";
        // Legacy, pre-academic-year layout (class -> subject -> sequence ->
        // studentId -> score). Only ever populated on load(), from data
        // written before this field existed, then migrated into
        // marksByYear and left empty from then on.
        private final Map<String, Map<String, Map<String, Map<String, Double>>>> marks = new HashMap<>();
        // Current layout: academicYear -> class -> subject -> sequence ->
        // studentId -> score. Keeps every year's marks around so switching
        // settings.academicYear doesn't lose prior years' data, and a new
        // year always starts with nothing recorded.
        private final Map<String, Map<String, Map<String, Map<String, Map<String, Double>>>>> marksByYear = new HashMap<>();
        // Live login sessions, persisted so closing and reopening the desktop
        // app doesn't sign the user out mid-task.
        private final Map<String, Session> sessionsByToken = new HashMap<>();
        private File dataFile;

        @Override
        public synchronized void init(File dataDir) {
            this.dataFile = new File(dataDir, "backend-data.ser");
            load();
            if (savePending) {
                savePending = false;
                save();
            }
        }

        @SuppressWarnings("unchecked")
        private synchronized void load() {
            if (!dataFile.exists()) {
                for (String n : Arrays.asList("Form 1", "Form 2", "Form 3", "Form 4", "Form 5", "Lower Sixth",
                        "Upper Sixth"))
                    classes.add(new ClassInfo(n));
                return;
            }
            try (ObjectInputStream ois = new ObjectInputStream(new FileInputStream(dataFile))) {
                Object obj = ois.readObject();
                if (obj instanceof Map) {
                    Map<?, ?> m = (Map<?, ?>) obj;
                    Object s = m.get("students");
                    Object c = m.get("classes");
                    Object mk = m.get("marks");
                    Object mky = m.get("marksByYear");
                    Object ac = m.get("activities");
                    Object tc = m.get("teachers");
                    Object us = m.get("users");
                    Object st = m.get("settings");
                    Object se = m.get("sessions");
                    students.clear();
                    classes.clear();
                    marks.clear();
                    marksByYear.clear();
                    activities.clear();
                    teachers.clear();
                    users.clear();
                    if (s instanceof List)
                        students.addAll((List<Student>) s);
                    if (c instanceof List)
                        classes.addAll((List<ClassInfo>) c);
                    if (mk instanceof Map)
                        marks.putAll((Map) mk);
                    if (mky instanceof Map)
                        marksByYear.putAll((Map) mky);
                    if (ac instanceof List)
                        activities.addAll((List<ActivityEntry>) ac);
                    if (tc instanceof List)
                        teachers.addAll((List<Teacher>) tc);
                    if (us instanceof List)
                        users.addAll((List<User>) us);
                    // Absent in files written before sessions were persisted —
                    // those simply start with nobody logged in, as before.
                    sessionsByToken.clear();
                    if (se instanceof Map)
                        sessionsByToken.putAll((Map<String, Session>) se);
                    if (st instanceof SchoolSettings)
                        settings = (SchoolSettings) st;
                    Object lk = m.get("licenseKey");
                    if (lk instanceof String)
                        licenseKey = (String) lk;

                    // One-time migration: marks recorded before academic-year
                    // scoping existed live in the old flat "marks" map — file
                    // them under whatever academic year is currently
                    // configured so they don't just disappear, then stop
                    // touching the legacy field going forward.
                    if (!marks.isEmpty() && marksByYear.isEmpty()) {
                        marksByYear.put(settings.academicYear, new HashMap<>(marks));
                        marks.clear();
                        savePending = true;
                    }
                    for (String n : Arrays.asList("Lower Sixth", "Upper Sixth")) {
                        boolean found = false;
                        for (ClassInfo ci : classes)
                            if (ci.name.equals(n)) {
                                found = true;
                                break;
                            }
                        if (!found)
                            classes.add(new ClassInfo(n));
                    }

                    // One-time repair for data saved by earlier builds: addStudent()
                    // below used to compute the "next" numeric ID against a prefix
                    // ("SPXCC-") that never matched the actual ID format it wrote
                    // ("SPXCCxxxx", no dash), so nextNumericId() always saw zero
                    // matches and handed out "SPXCC0001" to every single student.
                    // Every student sharing one ID meant their marks — which are
                    // keyed by student ID — collapsed onto a single shared record,
                    // which is why report cards looked identical across a class.
                    // Give any duplicate a fresh, unique ID so the app behaves
                    // correctly from here on.
                    if (dedupeStudentIds()) {
                        savePending = true;
                    }
                }
            } catch (Exception ex) {
                System.err.println("Failed to load datastore: " + ex.getMessage());
            }
        }

        // Set by load() when it had to repair duplicate student IDs; init()
        // saves once immediately afterward so the fix is persisted right away.
        private boolean savePending = false;

        /**
         * Reassigns a fresh "SPXCCxxxx" ID to every student after the first
         * one found holding a given ID. Returns true if anything changed.
         */
        private synchronized boolean dedupeStudentIds() {
            int maxNum = 0;
            for (Student s : students) {
                if (s.id != null && s.id.startsWith("SPXCC")) {
                    try {
                        maxNum = Math.max(maxNum, Integer.parseInt(s.id.substring("SPXCC".length())));
                    } catch (NumberFormatException ignored) {
                    }
                }
            }
            Set<String> seen = new HashSet<>();
            boolean changed = false;
            for (Student s : students) {
                if (s.id != null && seen.add(s.id)) {
                    continue; // first time we've seen this ID — keep it
                }
                String oldId = s.id;
                maxNum++;
                s.id = String.format("SPXCC%04d", maxNum);
                seen.add(s.id);
                changed = true;
                System.err.println("FileDataStore: reassigned duplicate student ID " + oldId + " -> " + s.id
                        + " (" + s.name + "). Re-check this student's marks — they may have been sharing"
                        + " results with another student under the old ID.");
            }
            return changed;
        }

        @Override
        public synchronized void save() {
            File tmp = new File(dataFile.getAbsolutePath() + ".tmp");
            File bak = new File(dataFile.getAbsolutePath() + ".bak");
            try {
                try (ObjectOutputStream oos = new ObjectOutputStream(new FileOutputStream(tmp))) {
                    Map<String, Object> m = new HashMap<>();
                    m.put("students", new ArrayList<>(students));
                    m.put("classes", new ArrayList<>(classes));
                    m.put("marksByYear", new HashMap<>(marksByYear));
                    m.put("activities", new ArrayList<>(activities));
                    m.put("teachers", new ArrayList<>(teachers));
                    m.put("users", new ArrayList<>(users));
                    m.put("settings", settings);
                    m.put("licenseKey", licenseKey == null ? "" : licenseKey);
                    m.put("sessions", new HashMap<>(sessionsByToken));
                    oos.writeObject(m);
                }
                if (dataFile.exists()) {
                    try {
                        Files.copy(dataFile.toPath(), bak.toPath(),
                                java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                    } catch (Exception bakEx) {
                        System.err.println("Failed to write datastore backup: " + bakEx.getMessage());
                    }
                }
                try {
                    Files.move(tmp.toPath(), dataFile.toPath(),
                            java.nio.file.StandardCopyOption.REPLACE_EXISTING,
                            java.nio.file.StandardCopyOption.ATOMIC_MOVE);
                } catch (java.nio.file.AtomicMoveNotSupportedException e) {
                    Files.move(tmp.toPath(), dataFile.toPath(),
                            java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                }
            } catch (Exception ex) {
                System.err.println("Failed to save datastore: " + ex.getMessage());
                try {
                    Files.deleteIfExists(tmp.toPath());
                } catch (Exception ignored) {
                }
            }
        }

        @Override
        public synchronized void logActivity(String type, String text) {
            activities.add(0, new ActivityEntry(type, text, System.currentTimeMillis()));
            while (activities.size() > 200) {
                activities.remove(activities.size() - 1);
            }
        }

        @Override
        public synchronized List<ActivityEntry> getActivities() {
            return new ArrayList<>(activities);
        }

        private synchronized int nextNumericId(String prefix, List<? extends Object> items,
                java.util.function.Function<Object, String> idFn) {
            int max = 0;
            for (Object item : items) {
                String id = idFn.apply(item);
                if (id != null && id.startsWith(prefix)) {
                    try {
                        max = Math.max(max, Integer.parseInt(id.substring(prefix.length())));
                    } catch (NumberFormatException ignored) {
                    }
                }
            }
            return max + 1;
        }

        @Override
        public synchronized Student addStudent(String name, String className, String gender, String guardian,
                String phone, String dob, String option, String electives, String photo, String admittedOn) {
            // Identity is a UUID so two devices working offline can never mint
            // the same one. The sequential "SPXCC0042" lives on as the display
            // code, scanned across existing codes (falling back to the id for
            // records written before codes existed) so the numbering the school
            // already knows carries on uninterrupted.
            String id = UUID.randomUUID().toString();
            String code = String.format("SPXCC%04d",
                    nextNumericId("SPXCC", students, o -> ((Student) o).displayCode()));
            Student s = new Student(id, name, className, gender, guardian, phone, dob, option, electives);
            s.code = code;
            s.updatedAt = System.currentTimeMillis();
            s.photo = photo == null ? "" : photo;
            s.admittedOn = admittedOn == null ? "" : admittedOn;
            students.add(s);
            boolean found = false;
            for (ClassInfo c : classes)
                if (c.name.equals(className)) {
                    c.students++;
                    found = true;
                    break;
                }
            if (!found)
                classes.add(new ClassInfo(className));
            logActivity("Student", "New student enrolled — " + name + " (" + className + ")");
            return s;
        }

        @Override
        public synchronized Student updateStudent(String id, Map<String, String> fields) {
            Student target = null;
            for (Student s : students) {
                if (s.id.equals(id)) {
                    target = s;
                    break;
                }
            }
            if (target == null)
                return null;

            String oldClass = target.className;
            if (fields.containsKey("name"))
                target.name = fields.get("name");
            if (fields.containsKey("class") || fields.containsKey("className"))
                target.className = fields.getOrDefault("class", fields.getOrDefault("className", target.className));
            if (fields.containsKey("gender"))
                target.gender = fields.get("gender");
            if (fields.containsKey("guardian"))
                target.guardian = fields.get("guardian");
            if (fields.containsKey("phone"))
                target.phone = fields.get("phone");
            if (fields.containsKey("dob"))
                target.dob = fields.get("dob");
            if (fields.containsKey("option"))
                target.option = fields.get("option");
            if (fields.containsKey("electives"))
                target.electives = fields.get("electives");
            if (fields.containsKey("status"))
                target.status = fields.get("status");
            if (fields.containsKey("photo"))
                target.photo = fields.get("photo");
            target.updatedAt = System.currentTimeMillis();
            if (fields.containsKey("admittedOn"))
                target.admittedOn = fields.get("admittedOn");

            if (!Objects.equals(oldClass, target.className)) {
                for (ClassInfo c : classes) {
                    if (c.name.equals(oldClass) && c.students > 0)
                        c.students--;
                    if (c.name.equals(target.className))
                        c.students++;
                }
                boolean found = false;
                for (ClassInfo c : classes) {
                    if (c.name.equals(target.className)) {
                        found = true;
                        break;
                    }
                }
                if (!found)
                    classes.add(new ClassInfo(target.className));
            }
            logActivity("Student", "Student updated — " + target.name + " (" + target.id + ")");
            return target;
        }

        @Override
        public synchronized boolean deleteStudent(String id) {
            Student target = null;
            for (Student s : students) {
                if (s.id.equals(id)) {
                    target = s;
                    break;
                }
            }
            if (target == null || target.deletedAt != null)
                return false;
            // Tombstone rather than remove — see Student.deletedAt.
            target.deletedAt = System.currentTimeMillis();
            target.updatedAt = target.deletedAt;
            for (ClassInfo c : classes) {
                if (c.name.equals(target.className) && c.students > 0)
                    c.students--;
            }
            // Drop this student's marks everywhere, across every academic year.
            for (Map<String, Map<String, Map<String, Map<String, Double>>>> byClass : marksByYear.values()) {
                for (Map<String, Map<String, Map<String, Double>>> bySubject : byClass.values()) {
                    for (Map<String, Map<String, Double>> bySeq : bySubject.values()) {
                        for (Map<String, Double> byStudent : bySeq.values()) {
                            byStudent.remove(id);
                        }
                    }
                }
            }
            logActivity("Student", "Student removed — " + target.name + " (" + id + ")");
            return true;
        }

        @Override
        public synchronized List<Student> getStudents() {
            List<Student> live = new ArrayList<>(students.size());
            for (Student s : students)
                if (s.deletedAt == null)
                    live.add(s);
            return live;
        }

        /** Includes tombstones. Only the sync layer should need these. */
        synchronized List<Student> getStudentsIncludingDeleted() {
            return new ArrayList<>(students);
        }

        @Override
        public synchronized List<Student> getStudentsByClass(String className) {
            if (className == null || className.isEmpty())
                return new ArrayList<>(students);
            List<Student> out = new ArrayList<>();
            for (Student s : students)
                if (className.equals(s.className))
                    out.add(s);
            return out;
        }

        @Override
        public synchronized List<ClassInfo> getClasses() {
            return new ArrayList<>(classes);
        }

        @Override
        public synchronized ClassInfo findClass(String name) {
            if (name == null)
                return null;
            for (ClassInfo c : classes) {
                if (c.name.equalsIgnoreCase(name))
                    return c;
            }
            return null;
        }

        @Override
        public synchronized ClassInfo addClass(String name) {
            ClassInfo c = new ClassInfo(name);
            classes.add(c);
            logActivity("Class", "New class added — " + name);
            return c;
        }

        @Override
        public synchronized ClassInfo setClassMaster(String className, String teacherId) {
            ClassInfo target = null;
            for (ClassInfo c : classes)
                if (c.name.equals(className)) {
                    target = c;
                    break;
                }
            if (target == null)
                return null;

            Teacher t = null;
            for (Teacher tc : teachers)
                if (tc.id.equals(teacherId)) {
                    t = tc;
                    break;
                }
            if (t == null)
                return null;

            target.teacher = t.name;
            target.classMasterId = t.id;
            logActivity("Staff", t.name + " assigned as Class Master of " + className);
            return target;
        }

        @Override
        public synchronized void saveMarks(String academicYear, String cls, String subject, String sequence,
                Map<String, Double> sets, Set<String> clears) {
            String year = (academicYear == null || academicYear.isBlank()) ? settings.academicYear : academicYear;
            Map<String, Double> existing = marksByYear
                    .computeIfAbsent(year, k -> new HashMap<>())
                    .computeIfAbsent(cls, k -> new HashMap<>())
                    .computeIfAbsent(subject, k -> new HashMap<>())
                    .computeIfAbsent(sequence, k -> new HashMap<>());
            if (clears != null) {
                for (String id : clears)
                    existing.remove(id);
            }
            if (sets != null)
                existing.putAll(sets);
            logActivity("Marks", "Marks entered — " + cls + ", " + subject + ", " + sequence + " (" + year + ")");
        }

        @Override
        public synchronized Map<String, Double> getMarks(String academicYear, String cls, String subject,
                String sequence) {
            String year = (academicYear == null || academicYear.isBlank()) ? settings.academicYear : academicYear;
            return marksByYear.getOrDefault(year, Collections.emptyMap())
                    .getOrDefault(cls, Collections.emptyMap())
                    .getOrDefault(subject, Collections.emptyMap())
                    .getOrDefault(sequence, Collections.emptyMap());
        }

        @Override
        public synchronized List<String> getAcademicYears() {
            List<String> years = new ArrayList<>(marksByYear.keySet());
            if (!years.contains(settings.academicYear))
                years.add(settings.academicYear);
            Collections.sort(years);
            return years;
        }

        @Override
        public synchronized Teacher addTeacher(String name, String email, String phone) {
            // UUID for the same reason students use one: two devices adding
            // staff offline would otherwise both mint "TCH-0003". Teacher ids
            // are never shown to users, so unlike students there is no
            // human-readable code to preserve alongside it.
            String id = UUID.randomUUID().toString();
            Teacher t = new Teacher(id, name, email, phone);
            t.updatedAt = System.currentTimeMillis();
            teachers.add(t);
            logActivity("Staff", "New teacher added — " + name);
            return t;
        }

        @Override
        public synchronized List<Teacher> getTeachers() {
            return new ArrayList<>(teachers);
        }

        @Override
        public synchronized boolean addAssignment(String teacherId, String className, String subject) {
            for (Teacher t : teachers) {
                if (t.id.equals(teacherId)) {
                    boolean exists = false;
                    for (Assignment a : t.assignments) {
                        if (a.className.equals(className) && a.subject.equals(subject)) {
                            exists = true;
                            break;
                        }
                    }
                    if (!exists) {
                        t.assignments.add(new Assignment(className, subject));
                        logActivity("Staff", t.name + " assigned to " + subject + " (" + className + ")");
                    }
                    return true;
                }
            }
            return false;
        }

        @Override
        public synchronized void removeAssignment(String teacherId, String className, String subject) {
            for (Teacher t : teachers) {
                if (t.id.equals(teacherId)) {
                    t.assignments.removeIf(a -> a.className.equals(className) && a.subject.equals(subject));
                    return;
                }
            }
        }

        @Override
        public synchronized void deleteTeacher(String teacherId) {
            teachers.removeIf(t -> t.id.equals(teacherId));
            for (ClassInfo c : classes) {
                if (teacherId.equals(c.classMasterId)) {
                    c.classMasterId = null;
                    c.teacher = "Unassigned";
                }
            }
        }

        @Override
        public synchronized boolean deleteTeacherAccountByEmail(String email) {
            if (email == null || email.isBlank() || "—".equals(email))
                return false;
            boolean[] removed = { false };
            users.removeIf(u -> {
                if (u.email != null && u.email.equalsIgnoreCase(email) && "teacher".equals(u.role)) {
                    removed[0] = true;
                    return true;
                }
                return false;
            });
            return removed[0];
        }

        @Override
        public synchronized User findUserByEmail(String email) {
            if (email == null)
                return null;
            for (User u : users) {
                if (u.email.equalsIgnoreCase(email)) {
                    return u;
                }
            }
            return null;
        }

        @Override
        public synchronized User addUser(String name, String email, String password, String role) {
            String id = String.format("USR-%04d", nextNumericId("USR-", users, o -> ((User) o).id));
            User u = new User(id, name, email, password, role);
            users.add(u);
            logActivity("Account", "New " + role + " account registered — " + name);
            return u;
        }

        @Override
        public synchronized boolean hasAdmin() {
            for (User u : users) {
                if ("admin".equals(u.role))
                    return true;
            }
            return false;
        }

        @Override
        public synchronized void updateUserPassword(String userId, String passwordHash) {
            for (User u : users) {
                if (u.id.equals(userId)) {
                    u.password = passwordHash;
                    return;
                }
            }
        }

        @Override
        public synchronized Teacher findTeacherByEmail(String email) {
            if (email == null)
                return null;
            for (Teacher t : teachers) {
                if (t.email != null && t.email.equalsIgnoreCase(email))
                    return t;
            }
            return null;
        }

        @Override
        public synchronized SchoolSettings getSettings() {
            return settings;
        }

        @Override
        public synchronized String getLicenseKey() {
            return licenseKey == null ? "" : licenseKey;
        }

        @Override
        public synchronized void setLicenseKey(String key) {
            licenseKey = key == null ? "" : key.trim();
            save();
        }

        @Override
        public synchronized SchoolSettings updateSettings(Map<String, String> fields) {
            if (fields.containsKey("schoolName"))
                settings.schoolName = fields.get("schoolName");
            if (fields.containsKey("schoolCode"))
                settings.schoolCode = fields.get("schoolCode");
            if (fields.containsKey("region"))
                settings.region = fields.get("region");
            if (fields.containsKey("schoolTown"))
                settings.schoolTown = fields.get("schoolTown");
            if (fields.containsKey("regionalDelegation"))
                settings.regionalDelegation = fields.get("regionalDelegation");
            if (fields.containsKey("subDivision"))
                settings.subDivision = fields.get("subDivision");
            if (fields.containsKey("motto"))
                settings.motto = fields.get("motto");
            if (fields.containsKey("currentTerm"))
                settings.currentTerm = fields.get("currentTerm");
            if (fields.containsKey("currentSequence"))
                settings.currentSequence = fields.get("currentSequence");
            if (fields.containsKey("academicYear")) {
                String newYear = fields.get("academicYear");
                if (newYear != null && !newYear.equals(settings.academicYear)) {
                    // A new academic year means a new staffing lineup — clear
                    // every teacher's class/subject assignments so the admin
                    // deliberately re-assigns them instead of carrying over
                    // last year's (possibly stale) roster.
                    for (Teacher t : teachers)
                        t.assignments.clear();
                    logActivity("Settings",
                            "Academic year changed to " + newYear + " — all teacher assignments were cleared");
                }
                settings.academicYear = newYear;
            }
            if (fields.containsKey("marksScale"))
                settings.marksScale = fields.get("marksScale");
            if (fields.containsKey("emailNotif"))
                settings.emailNotif = Boolean.parseBoolean(fields.get("emailNotif"));
            if (fields.containsKey("autoLock"))
                settings.autoLock = Boolean.parseBoolean(fields.get("autoLock"));
            if (fields.containsKey("publicResults"))
                settings.publicResults = Boolean.parseBoolean(fields.get("publicResults"));
            if (fields.containsKey("passAverage"))
                settings.passAverage = fields.get("passAverage");
            if (fields.containsKey("principalStamp"))
                settings.principalStamp = fields.get("principalStamp");
            if (fields.containsKey("principalSignature"))
                settings.principalSignature = fields.get("principalSignature");
            if (fields.containsKey("nextTermBegins"))
                settings.nextTermBegins = fields.get("nextTermBegins");
            return settings;
        }

        @Override
        public synchronized void wipeAcademicData() {
            students.clear();
            teachers.clear();
            activities.clear();
            marks.clear();
            marksByYear.clear();
            classes.clear();
        }

        @Override
        public synchronized void clearActivities() {
            activities.clear();
        }

        @Override
        public synchronized void ensureUser(String name, String email, String passwordHash, String role) {
            User existing = findUserByEmail(email);
            if (existing != null) {
                existing.name = name;
                existing.password = passwordHash;
                existing.role = role;
                return;
            }
            addUser(name, email, passwordHash, role);
        }

        @Override
        public File getBackupFile() {
            return dataFile;
        }

        @Override
        public synchronized void reload() {
            load();
        }

        @Override
        public synchronized void saveSession(String token, Session session) {
            sessionsByToken.put(token, session);
            save();
        }

        @Override
        public synchronized Session findSession(String token) {
            return sessionsByToken.get(token);
        }

        @Override
        public synchronized void deleteSession(String token) {
            if (sessionsByToken.remove(token) != null)
                save();
        }

        @Override
        public synchronized List<Student> studentsChangedSince(long since) {
            List<Student> out = new ArrayList<>();
            for (Student s : students)
                if (s.updatedAt > since)
                    out.add(s);
            return out;
        }

        @Override
        public synchronized List<Teacher> teachersChangedSince(long since) {
            List<Teacher> out = new ArrayList<>();
            for (Teacher t : teachers)
                if (t.updatedAt > since)
                    out.add(t);
            return out;
        }

        @Override
        public synchronized List<MarkRow> marksChangedSince(long since) {
            List<MarkRow> out = new ArrayList<>();
            for (MarkRow m : getAllMarks())
                if (m.updatedAt > since)
                    out.add(m);
            return out;
        }

        @Override
        public synchronized boolean mergeStudent(Student incoming) {
            for (int i = 0; i < students.size(); i++) {
                Student existing = students.get(i);
                if (!existing.id.equals(incoming.id))
                    continue;
                if (incoming.updatedAt <= existing.updatedAt)
                    return false;
                students.set(i, incoming);
                return true;
            }
            students.add(incoming);
            return true;
        }

        @Override
        public synchronized boolean mergeTeacher(Teacher incoming) {
            for (int i = 0; i < teachers.size(); i++) {
                Teacher existing = teachers.get(i);
                if (!existing.id.equals(incoming.id))
                    continue;
                if (incoming.updatedAt <= existing.updatedAt)
                    return false;
                teachers.set(i, incoming);
                return true;
            }
            teachers.add(incoming);
            return true;
        }

        @Override
        public synchronized boolean mergeMark(MarkRow incoming) {
            for (MarkRow existing : getAllMarks()) {
                if (existing.academicYear.equals(incoming.academicYear)
                        && existing.className.equals(incoming.className)
                        && existing.subject.equals(incoming.subject)
                        && existing.sequence.equals(incoming.sequence)
                        && existing.studentId.equals(incoming.studentId)) {
                    if (incoming.updatedAt <= existing.updatedAt)
                        return false;
                    break;
                }
            }
            saveMarks(incoming.academicYear, incoming.className, incoming.subject, incoming.sequence,
                    Map.of(incoming.studentId, incoming.score), Set.of());
            return true;
        }

        @Override
        public synchronized void purgeTombstones(long cutoffMillis) {
            if (students.removeIf(s -> s.deletedAt != null && s.deletedAt < cutoffMillis))
                save();
        }

        @Override
        public synchronized void purgeExpiredSessions(long nowMillis) {
            if (sessionsByToken.entrySet().removeIf(e -> e.getValue().expiresAt < nowMillis))
                save();
        }

        @Override
        public synchronized List<User> getUsers() {
            return new ArrayList<>(users);
        }

        @Override
        public synchronized List<MarkRow> getAllMarks() {
            List<MarkRow> rows = new ArrayList<>();
            for (Map.Entry<String, Map<String, Map<String, Map<String, Map<String, Double>>>>> year : marksByYear
                    .entrySet())
                for (Map.Entry<String, Map<String, Map<String, Map<String, Double>>>> cls : year.getValue().entrySet())
                    for (Map.Entry<String, Map<String, Map<String, Double>>> subject : cls.getValue().entrySet())
                        for (Map.Entry<String, Map<String, Double>> seq : subject.getValue().entrySet())
                            for (Map.Entry<String, Double> score : seq.getValue().entrySet())
                                rows.add(new MarkRow(year.getKey(), cls.getKey(), subject.getKey(), seq.getKey(),
                                        score.getKey(), score.getValue()));
            return rows;
        }

        @Override
        public synchronized void restoreStudent(Student student) {
            students.removeIf(s -> s.id.equals(student.id));
            students.add(student);
            for (ClassInfo c : classes)
                if (c.name.equals(student.className)) {
                    c.students++;
                    return;
                }
            // Student references a class the backup didn't list — recreate it
            // rather than dropping the student on the floor.
            ClassInfo created = new ClassInfo(student.className);
            created.students = 1;
            classes.add(created);
        }

        @Override
        public synchronized void restoreTeacher(Teacher teacher) {
            teachers.removeIf(t -> t.id.equals(teacher.id));
            teachers.add(teacher);
        }

        @Override
        public synchronized void restoreUser(User user) {
            // Keyed by email, matching how logins are looked up — wipeAcademicData
            // deliberately keeps existing accounts, so a restore overwrites the
            // matching one instead of creating a duplicate nobody can log into.
            users.removeIf(u -> u.email != null && u.email.equalsIgnoreCase(user.email));
            users.add(user);
        }
    }

    // Supabase (Postgres) backed storage. Used when DATABASE_URL is set —
    // on Render, and on the desktop app in cloud mode.
    //
    // Connections come from a pool. Each method still borrows and returns one
    // per call, but against a remote database actually opening one per call
    // costs a TCP connect, a TLS handshake and an auth round trip every time,
    // and burns through the server's connection limit under real use.
    static class PostgresDataStore implements DataStore {
        private final String url;
        private final ConnectionPool pool;

        static {
            try {
                Class.forName("org.postgresql.Driver");
            } catch (ClassNotFoundException e) {
                throw new RuntimeException(
                        "PostgreSQL JDBC driver not found on classpath. Check the Dockerfile's -cp flag.", e);
            }
        }

        PostgresDataStore(String url) {
            this.url = normalizeJdbcUrl(url);

            // Small by default. Supabase's free tier allows few connections,
            // and this backend is one of several clients (the web app, the
            // desktop app in cloud mode) sharing that budget.
            int size = 8;
            String configured = System.getenv("DB_POOL_SIZE");
            if (configured != null && !configured.isBlank()) {
                try {
                    size = Math.max(1, Integer.parseInt(configured.trim()));
                } catch (NumberFormatException e) {
                    System.err.println("Ignoring invalid DB_POOL_SIZE=" + configured);
                }
            }
            this.pool = new ConnectionPool(this.url, size);
            Runtime.getRuntime().addShutdownHook(new Thread(pool::close));
            System.out.println("Postgres connection pool ready (max " + size + ")");
        }

        // Render/Supabase/Heroku-style connection strings look like
        // "postgres://user:pass@host:5432/db?sslmode=require" — the plain
        // "postgresql://user:pass@host/db" JDBC URL form does NOT support
        // embedded "user:pass@" credentials, so we rewrite them into
        // "jdbc:postgresql://host:5432/db?user=..&password=..&sslmode=require".
        // Already-correct jdbc: URLs pass through unchanged (idempotent).
        private static String normalizeJdbcUrl(String raw) {
            String u = raw.trim();
            String withoutJdbc = u.startsWith("jdbc:") ? u.substring("jdbc:".length()) : u;
            try {
                URI uri = new URI(withoutJdbc);
                if (uri.getHost() == null) {
                    return u.startsWith("jdbc:") ? u : "jdbc:" + u;
                }
                int port = uri.getPort() == -1 ? 5432 : uri.getPort();
                String path = uri.getPath() == null ? "" : uri.getPath();

                StringBuilder params = new StringBuilder();
                String userInfo = uri.getUserInfo();
                if (userInfo != null && !userInfo.isBlank()) {
                    String[] parts = userInfo.split(":", 2);
                    String user = URLDecoder.decode(parts[0], StandardCharsets.UTF_8);
                    String pass = parts.length > 1 ? URLDecoder.decode(parts[1], StandardCharsets.UTF_8) : "";
                    params.append("user=").append(URLEncoder.encode(user, StandardCharsets.UTF_8))
                            .append("&password=").append(URLEncoder.encode(pass, StandardCharsets.UTF_8));
                }
                String query = uri.getQuery();
                if (query != null && !query.isBlank()) {
                    if (params.length() > 0) params.append("&");
                    params.append(query);
                }
                if (params.indexOf("sslmode=") == -1) {
                    if (params.length() > 0) params.append("&");
                    params.append("sslmode=require");
                }

                return "jdbc:postgresql://" + uri.getHost() + ":" + port + path
                        + (params.length() > 0 ? "?" + params : "");
            } catch (Exception e) {
                // Not a parseable URI (unexpected format) — best effort fallback.
                return u.startsWith("jdbc:") ? u : "jdbc:" + u;
            }
        }

        // Returns a pooled connection. Callers close it as usual — that
        // returns it to the pool rather than actually closing the socket.
        private Connection connect() throws SQLException {
            return pool.borrow();
        }

        @Override
        public void init(File dataDir) {
            String schema = """
                    CREATE TABLE IF NOT EXISTS users (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        email TEXT NOT NULL UNIQUE,
                        password TEXT NOT NULL,
                        role TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS teachers (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        email TEXT,
                        phone TEXT
                    );
                    CREATE TABLE IF NOT EXISTS assignments (
                        teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
                        class_name TEXT NOT NULL,
                        subject TEXT NOT NULL,
                        PRIMARY KEY (teacher_id, class_name, subject)
                    );
                    CREATE TABLE IF NOT EXISTS classes (
                        name TEXT PRIMARY KEY,
                        teacher TEXT DEFAULT 'Unassigned',
                        average DOUBLE PRECISION,
                        students INT DEFAULT 0,
                        class_master_id TEXT REFERENCES teachers(id)
                    );
                    CREATE TABLE IF NOT EXISTS students (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        class_name TEXT NOT NULL,
                        gender TEXT,
                        guardian TEXT,
                        phone TEXT,
                        dob TEXT,
                        option_name TEXT,
                        electives TEXT,
                        status TEXT DEFAULT 'Active',
                        photo TEXT DEFAULT '',
                        admitted_on TEXT DEFAULT ''
                    );
                    ALTER TABLE students ADD COLUMN IF NOT EXISTS photo TEXT DEFAULT '';
                    -- Human-readable student number, split out from the primary
                    -- key so ids can become collision-free UUIDs without the
                    -- school losing the numbering printed on its report cards.
                    ALTER TABLE students ADD COLUMN IF NOT EXISTS code TEXT DEFAULT '';
                    UPDATE students SET code = id WHERE code IS NULL OR code = '';

                    -- Sync metadata. Every syncable row carries when it last
                    -- changed and, if removed, when it was deleted.
                    --
                    -- Deletes are recorded as tombstones rather than actually
                    -- removing the row: a device that was offline when a pupil
                    -- was withdrawn has no way to learn about a row that simply
                    -- vanished, so on reconnect it would helpfully "restore"
                    -- them. The tombstone is what makes a delete survive a
                    -- merge. Swept once they are older than any plausible
                    -- offline stretch (see SYNC_TOMBSTONE_RETENTION_DAYS).
                    ALTER TABLE students ADD COLUMN IF NOT EXISTS updated_at BIGINT NOT NULL DEFAULT 0;
                    ALTER TABLE students ADD COLUMN IF NOT EXISTS deleted_at BIGINT;
                    ALTER TABLE teachers ADD COLUMN IF NOT EXISTS updated_at BIGINT NOT NULL DEFAULT 0;
                    ALTER TABLE teachers ADD COLUMN IF NOT EXISTS deleted_at BIGINT;
                    ALTER TABLE marks    ADD COLUMN IF NOT EXISTS updated_at BIGINT NOT NULL DEFAULT 0;
                    ALTER TABLE classes  ADD COLUMN IF NOT EXISTS updated_at BIGINT NOT NULL DEFAULT 0;
                    CREATE INDEX IF NOT EXISTS idx_students_updated_at ON students(updated_at);
                    CREATE INDEX IF NOT EXISTS idx_teachers_updated_at ON teachers(updated_at);
                    CREATE INDEX IF NOT EXISTS idx_marks_updated_at ON marks(updated_at);
                    -- Backfill: rows that predate sync are stamped once so a
                    -- first sync sees them as existing data rather than as
                    -- changes made at the epoch.
                    UPDATE students SET updated_at = EXTRACT(EPOCH FROM now())*1000 WHERE updated_at = 0;
                    UPDATE teachers SET updated_at = EXTRACT(EPOCH FROM now())*1000 WHERE updated_at = 0;
                    UPDATE marks    SET updated_at = EXTRACT(EPOCH FROM now())*1000 WHERE updated_at = 0;
                    UPDATE classes  SET updated_at = EXTRACT(EPOCH FROM now())*1000 WHERE updated_at = 0;
                    ALTER TABLE students ADD COLUMN IF NOT EXISTS admitted_on TEXT DEFAULT '';
                    CREATE TABLE IF NOT EXISTS marks (
                        class_name TEXT NOT NULL,
                        subject TEXT NOT NULL,
                        sequence TEXT NOT NULL,
                        student_id TEXT NOT NULL,
                        score DOUBLE PRECISION NOT NULL,
                        academic_year TEXT NOT NULL DEFAULT '',
                        PRIMARY KEY (class_name, subject, sequence, student_id)
                    );
                    ALTER TABLE marks ADD COLUMN IF NOT EXISTS academic_year TEXT NOT NULL DEFAULT '';
                    CREATE TABLE IF NOT EXISTS activities (
                        id SERIAL PRIMARY KEY,
                        type TEXT,
                        text TEXT,
                        ts BIGINT
                    );
                    CREATE TABLE IF NOT EXISTS settings (
                        id INT PRIMARY KEY DEFAULT 1,
                        school_name TEXT DEFAULT 'SCHOOL',
                        school_code TEXT DEFAULT 'SCH',
                        region TEXT DEFAULT 'North-West',
                        school_town TEXT DEFAULT '',
                        regional_delegation TEXT DEFAULT '',
                        sub_division TEXT DEFAULT '',
                        motto TEXT DEFAULT '',
                        current_term TEXT DEFAULT 'Term 2',
                        current_sequence TEXT DEFAULT 'Sequence 4',
                        academic_year TEXT DEFAULT '2025 – 2026',
                        marks_scale TEXT DEFAULT '20',
                        email_notif BOOLEAN DEFAULT TRUE,
                        auto_lock BOOLEAN DEFAULT FALSE,
                        public_results BOOLEAN DEFAULT FALSE,
                        pass_average TEXT DEFAULT '50',
                        principal_stamp TEXT DEFAULT '',
                        principal_signature TEXT DEFAULT '',
                        next_term_begins TEXT DEFAULT ''
                    );
                    ALTER TABLE settings ADD COLUMN IF NOT EXISTS pass_average TEXT DEFAULT '50';
                    ALTER TABLE settings ADD COLUMN IF NOT EXISTS principal_stamp TEXT DEFAULT '';
                    ALTER TABLE settings ADD COLUMN IF NOT EXISTS principal_signature TEXT DEFAULT '';
                    ALTER TABLE settings ADD COLUMN IF NOT EXISTS next_term_begins TEXT DEFAULT '';
                    -- School-wide licence key. Survives ephemeral disks (Render
                    -- free tier) where license.key would otherwise vanish on
                    -- every restart — teachers share whatever the admin set.
                    ALTER TABLE settings ADD COLUMN IF NOT EXISTS license_key TEXT DEFAULT '';
                    CREATE TABLE IF NOT EXISTS keep_alive (
                        id INT PRIMARY KEY DEFAULT 1,
                        pinged_at TIMESTAMPTZ DEFAULT now()
                    );
                    -- Login sessions. Persisted so a restart (Render's free
                    -- tier spins down when idle) doesn't sign everyone out,
                    -- and so a second instance accepts the first's tokens.
                    CREATE TABLE IF NOT EXISTS sessions (
                        token TEXT PRIMARY KEY,
                        user_id TEXT NOT NULL,
                        email TEXT,
                        role TEXT,
                        name TEXT,
                        expires_at BIGINT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
                    -- Lookup paths that were doing sequential scans: every
                    -- class roster, and every read of a class/subject/sequence
                    -- worth of marks.
                    CREATE INDEX IF NOT EXISTS idx_students_class_name ON students(class_name);
                    CREATE INDEX IF NOT EXISTS idx_marks_lookup
                        ON marks(academic_year, class_name, subject, sequence);
                    CREATE INDEX IF NOT EXISTS idx_marks_student ON marks(student_id);
                    CREATE INDEX IF NOT EXISTS idx_assignments_teacher ON assignments(teacher_id);
                    INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
                    INSERT INTO keep_alive (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
                    -- One-time backfill: marks recorded before academic-year
                    -- scoping existed have a blank academic_year — tag them
                    -- with whatever year is currently configured so they
                    -- remain visible as "this year's" data after the upgrade.
                    UPDATE marks SET academic_year = (SELECT academic_year FROM settings WHERE id = 1)
                        WHERE academic_year IS NULL OR academic_year = '';
                    -- Widen the primary key to include academic_year so the
                    -- same class/subject/sequence/student combo can hold a
                    -- separate score per year. Only runs once — skipped once
                    -- the key already includes academic_year.
                    DO $$
                    BEGIN
                        IF NOT EXISTS (
                            SELECT 1 FROM information_schema.table_constraints tc
                            JOIN information_schema.key_column_usage kcu
                                ON tc.constraint_name = kcu.constraint_name
                                AND tc.table_schema = kcu.table_schema
                            WHERE tc.table_name = 'marks'
                                AND tc.constraint_type = 'PRIMARY KEY'
                                AND kcu.column_name = 'academic_year'
                        ) THEN
                            ALTER TABLE marks DROP CONSTRAINT IF EXISTS marks_pkey;
                            ALTER TABLE marks ADD PRIMARY KEY (academic_year, class_name, subject, sequence, student_id);
                        END IF;
                    END $$;
                    """;
            try (Connection c = connect(); Statement st = c.createStatement()) {
                st.execute(schema);

                // Seed the default class list, same as FileDataStore does
                // for a brand-new install.
                ResultSet rs = st.executeQuery("SELECT COUNT(*) FROM classes");
                rs.next();
                if (rs.getInt(1) == 0) {
                    try (PreparedStatement ps = c.prepareStatement(
                            "INSERT INTO classes (name) VALUES (?) ON CONFLICT DO NOTHING")) {
                        for (String n : Arrays.asList("Form 1", "Form 2", "Form 3", "Form 4", "Form 5",
                                "Lower Sixth", "Upper Sixth")) {
                            ps.setString(1, n);
                            ps.addBatch();
                        }
                        ps.executeBatch();
                    }
                }
            } catch (SQLException e) {
                throw new RuntimeException("Failed to initialize Postgres schema: " + e.getMessage(), e);
            }
        }

        @Override
        public void save() {
            // No-op: every method below writes immediately.
        }

        @Override
        public void logActivity(String type, String text) {
            try (Connection c = connect()) {
                try (PreparedStatement ps = c.prepareStatement(
                        "INSERT INTO activities (type, text, ts) VALUES (?, ?, ?)")) {
                    ps.setString(1, type);
                    ps.setString(2, text);
                    ps.setLong(3, System.currentTimeMillis());
                    ps.executeUpdate();
                }
                try (Statement st = c.createStatement()) {
                    st.executeUpdate(
                            "DELETE FROM activities WHERE id NOT IN (SELECT id FROM activities ORDER BY id DESC LIMIT 200)");
                }
            } catch (SQLException e) {
                System.err.println("logActivity failed: " + e.getMessage());
            }
        }

        @Override
        public List<ActivityEntry> getActivities() {
            List<ActivityEntry> out = new ArrayList<>();
            try (Connection c = connect();
                    Statement st = c.createStatement();
                    ResultSet rs = st.executeQuery("SELECT type, text, ts FROM activities ORDER BY id DESC")) {
                while (rs.next()) {
                    out.add(new ActivityEntry(rs.getString("type"), rs.getString("text"), rs.getLong("ts")));
                }
            } catch (SQLException e) {
                System.err.println("getActivities failed: " + e.getMessage());
            }
            return out;
        }

        /** Highest existing display code + 1. Scans the code column, not the id. */
        private String nextPrefixedCode(Connection c, String table, String prefix) throws SQLException {
            int max = 0;
            try (Statement st = c.createStatement();
                    ResultSet rs = st.executeQuery("SELECT code FROM " + table)) {
                while (rs.next()) {
                    String code = rs.getString(1);
                    if (code == null)
                        continue;
                    // Historic codes came in both "SPXCC-0042" and "SPXCC0042"
                    // shapes; accept either so numbering doesn't restart.
                    String digits = code.replaceFirst("^" + java.util.regex.Pattern.quote(prefix), "")
                            .replaceFirst("^" + java.util.regex.Pattern.quote(prefix.replace("-", "")), "");
                    try {
                        max = Math.max(max, Integer.parseInt(digits));
                    } catch (NumberFormatException ignored) {
                        // Not one of ours (e.g. a UUID from before codes existed).
                    }
                }
            }
            return String.format(Locale.ROOT, "%s%04d", prefix, max + 1);
        }

        private String nextPrefixedId(Connection c, String table, String prefix) throws SQLException {
            int max = 0;
            try (Statement st = c.createStatement();
                    ResultSet rs = st.executeQuery("SELECT id FROM " + table)) {
                while (rs.next()) {
                    String id = rs.getString(1);
                    if (id != null && id.startsWith(prefix)) {
                        try {
                            max = Math.max(max, Integer.parseInt(id.substring(prefix.length())));
                        } catch (NumberFormatException ignored) {
                        }
                    }
                }
            }
            return String.format(Locale.ROOT, "%s%04d", prefix, max + 1);
        }

        @Override
        public Student addStudent(String name, String className, String gender, String guardian,
                String phone, String dob, String option, String electives, String photo, String admittedOn) {
            try (Connection c = connect()) {
                c.setAutoCommit(false);
                try {
                    // UUID identity, sequential display code — see Student.id.
                    String id = UUID.randomUUID().toString();
                    String code = nextPrefixedCode(c, "students", "SPXCC-");

                    try (PreparedStatement ps = c.prepareStatement(
                            "INSERT INTO students (id, code, name, class_name, gender, guardian, phone, dob, option_name, electives, status, photo, admitted_on, updated_at) "
                                    + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?, ?)")) {
                        ps.setString(1, id);
                        ps.setString(2, code);
                        ps.setString(3, name);
                        ps.setString(4, className);
                        ps.setString(5, gender);
                        ps.setString(6, guardian);
                        ps.setString(7, phone);
                        ps.setString(8, dob);
                        ps.setString(9, option);
                        ps.setString(10, electives);
                        ps.setString(11, photo == null ? "" : photo);
                        ps.setString(12, admittedOn == null ? "" : admittedOn);
                        ps.setLong(13, System.currentTimeMillis());
                        ps.executeUpdate();
                    }

                    try (PreparedStatement check = c.prepareStatement("SELECT 1 FROM classes WHERE name = ?")) {
                        check.setString(1, className);
                        boolean exists = check.executeQuery().next();
                        if (exists) {
                            try (PreparedStatement upd = c.prepareStatement(
                                    "UPDATE classes SET students = students + 1 WHERE name = ?")) {
                                upd.setString(1, className);
                                upd.executeUpdate();
                            }
                        } else {
                            try (PreparedStatement ins = c.prepareStatement(
                                    "INSERT INTO classes (name, students) VALUES (?, 1)")) {
                                ins.setString(1, className);
                                ins.executeUpdate();
                            }
                        }
                    }

                    c.commit();
                    Student s = new Student(id, name, className, gender, guardian, phone, dob, option, electives);
                    s.photo = photo == null ? "" : photo;
                    s.admittedOn = admittedOn == null ? "" : admittedOn;
                    logActivity("Student", "New student enrolled — " + name + " (" + className + ")");
                    return s;
                } catch (SQLException e) {
                    c.rollback();
                    throw e;
                } finally {
                    c.setAutoCommit(true);
                }
            } catch (SQLException e) {
                throw new RuntimeException("addStudent failed: " + e.getMessage(), e);
            }
        }

        @Override
        public Student updateStudent(String id, Map<String, String> fields) {
            try (Connection c = connect()) {
                c.setAutoCommit(false);
                try {
                    Student existing = null;
                    try (PreparedStatement ps = c.prepareStatement(
                            "SELECT * FROM students WHERE id = ? AND deleted_at IS NULL")) {
                        ps.setString(1, id);
                        try (ResultSet rs = ps.executeQuery()) {
                            if (rs.next())
                                existing = mapStudent(rs);
                        }
                    }
                    if (existing == null) {
                        c.rollback();
                        return null;
                    }

                    String name = fields.getOrDefault("name", existing.name);
                    String className = fields.containsKey("class") ? fields.get("class")
                            : fields.getOrDefault("className", existing.className);
                    String gender = fields.getOrDefault("gender", existing.gender);
                    String guardian = fields.getOrDefault("guardian", existing.guardian);
                    String phone = fields.getOrDefault("phone", existing.phone);
                    String dob = fields.getOrDefault("dob", existing.dob);
                    String option = fields.getOrDefault("option", existing.option);
                    String electives = fields.getOrDefault("electives", existing.electives);
                    String status = fields.getOrDefault("status", existing.status);
                    String photo = fields.getOrDefault("photo", existing.photo);
                    String admittedOn = fields.getOrDefault("admittedOn", existing.admittedOn);

                    try (PreparedStatement ps = c.prepareStatement(
                            "UPDATE students SET name=?, class_name=?, gender=?, guardian=?, phone=?, dob=?, "
                                    + "option_name=?, electives=?, status=?, photo=?, admitted_on=?, updated_at=? WHERE id=?")) {
                        ps.setString(1, name);
                        ps.setString(2, className);
                        ps.setString(3, gender);
                        ps.setString(4, guardian);
                        ps.setString(5, phone);
                        ps.setString(6, dob);
                        ps.setString(7, option);
                        ps.setString(8, electives);
                        ps.setString(9, status);
                        ps.setString(10, photo == null ? "" : photo);
                        ps.setString(11, admittedOn == null ? "" : admittedOn);
                        ps.setLong(12, System.currentTimeMillis());
                        ps.setString(13, id);
                        ps.executeUpdate();
                    }

                    if (!Objects.equals(existing.className, className)) {
                        try (PreparedStatement dec = c.prepareStatement(
                                "UPDATE classes SET students = GREATEST(students - 1, 0) WHERE name = ?")) {
                            dec.setString(1, existing.className);
                            dec.executeUpdate();
                        }
                        try (PreparedStatement check = c.prepareStatement("SELECT 1 FROM classes WHERE name = ?")) {
                            check.setString(1, className);
                            if (check.executeQuery().next()) {
                                try (PreparedStatement inc = c.prepareStatement(
                                        "UPDATE classes SET students = students + 1 WHERE name = ?")) {
                                    inc.setString(1, className);
                                    inc.executeUpdate();
                                }
                            } else {
                                try (PreparedStatement ins = c.prepareStatement(
                                        "INSERT INTO classes (name, students) VALUES (?, 1)")) {
                                    ins.setString(1, className);
                                    ins.executeUpdate();
                                }
                            }
                        }
                    }

                    c.commit();
                    Student s = new Student(id, name, className, gender, guardian, phone, dob, option, electives);
                    s.status = status;
                    s.photo = photo == null ? "" : photo;
                    s.admittedOn = admittedOn == null ? "" : admittedOn;
                    logActivity("Student", "Student updated — " + name + " (" + id + ")");
                    return s;
                } catch (SQLException e) {
                    c.rollback();
                    throw e;
                } finally {
                    c.setAutoCommit(true);
                }
            } catch (SQLException e) {
                throw new RuntimeException("updateStudent failed: " + e.getMessage(), e);
            }
        }

        @Override
        public boolean deleteStudent(String id) {
            try (Connection c = connect()) {
                c.setAutoCommit(false);
                try {
                    String className = null;
                    String name = null;
                    try (PreparedStatement ps = c.prepareStatement(
                            "SELECT name, class_name FROM students WHERE id = ? AND deleted_at IS NULL")) {
                        ps.setString(1, id);
                        try (ResultSet rs = ps.executeQuery()) {
                            if (!rs.next()) {
                                c.rollback();
                                return false;
                            }
                            name = rs.getString("name");
                            className = rs.getString("class_name");
                        }
                    }
                    try (PreparedStatement ps = c.prepareStatement(
                            "DELETE FROM marks WHERE student_id = ?")) {
                        ps.setString(1, id);
                        ps.executeUpdate();
                    }
                    // Tombstone, not DELETE — see Student.deletedAt. Marks are
                    // still removed: they are keyed by student id and a
                    // withdrawn pupil's scores should not reappear anywhere.
                    try (PreparedStatement ps = c.prepareStatement(
                            "UPDATE students SET deleted_at = ?, updated_at = ? WHERE id = ?")) {
                        long now = System.currentTimeMillis();
                        ps.setLong(1, now);
                        ps.setLong(2, now);
                        ps.setString(3, id);
                        ps.executeUpdate();
                    }
                    try (PreparedStatement dec = c.prepareStatement(
                            "UPDATE classes SET students = GREATEST(students - 1, 0) WHERE name = ?")) {
                        dec.setString(1, className);
                        dec.executeUpdate();
                    }
                    c.commit();
                    logActivity("Student", "Student removed — " + name + " (" + id + ")");
                    return true;
                } catch (SQLException e) {
                    c.rollback();
                    throw e;
                } finally {
                    c.setAutoCommit(true);
                }
            } catch (SQLException e) {
                throw new RuntimeException("deleteStudent failed: " + e.getMessage(), e);
            }
        }

        private Student mapStudent(ResultSet rs) throws SQLException {
            Student s = new Student(rs.getString("id"), rs.getString("name"), rs.getString("class_name"),
                    rs.getString("gender"), rs.getString("guardian"), rs.getString("phone"), rs.getString("dob"),
                    rs.getString("option_name"), rs.getString("electives"));
            s.status = rs.getString("status");
            String photo = rs.getString("photo");
            s.photo = photo == null ? "" : photo;
            String code = rs.getString("code");
            s.code = code == null || code.isBlank() ? s.id : code;
            s.updatedAt = rs.getLong("updated_at");
            long deleted = rs.getLong("deleted_at");
            s.deletedAt = rs.wasNull() ? null : deleted;
            String admittedOn = rs.getString("admitted_on");
            s.admittedOn = admittedOn == null ? "" : admittedOn;
            return s;
        }

        @Override
        public List<Student> getStudents() {
            List<Student> out = new ArrayList<>();
            try (Connection c = connect();
                    Statement st = c.createStatement();
                    ResultSet rs = st.executeQuery("SELECT * FROM students WHERE deleted_at IS NULL ORDER BY code, id")) {
                while (rs.next())
                    out.add(mapStudent(rs));
            } catch (SQLException e) {
                System.err.println("getStudents failed: " + e.getMessage());
            }
            return out;
        }

        @Override
        public List<Student> getStudentsByClass(String className) {
            if (className == null || className.isEmpty())
                return getStudents();
            List<Student> out = new ArrayList<>();
            try (Connection c = connect();
                    PreparedStatement ps = c.prepareStatement(
                            "SELECT * FROM students WHERE class_name = ? AND deleted_at IS NULL ORDER BY code, id")) {
                ps.setString(1, className);
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next())
                        out.add(mapStudent(rs));
                }
            } catch (SQLException e) {
                System.err.println("getStudentsByClass failed: " + e.getMessage());
            }
            return out;
        }

        @Override
        public List<ClassInfo> getClasses() {
            List<ClassInfo> out = new ArrayList<>();
            try (Connection c = connect();
                    Statement st = c.createStatement();
                    ResultSet rs = st.executeQuery("SELECT * FROM classes ORDER BY name")) {
                while (rs.next()) {
                    ClassInfo ci = new ClassInfo(rs.getString("name"));
                    ci.teacher = rs.getString("teacher");
                    double avg = rs.getDouble("average");
                    ci.average = rs.wasNull() ? null : avg;
                    ci.students = rs.getInt("students");
                    ci.classMasterId = rs.getString("class_master_id");
                    out.add(ci);
                }
            } catch (SQLException e) {
                System.err.println("getClasses failed: " + e.getMessage());
            }
            return out;
        }

        @Override
        public ClassInfo findClass(String name) {
            if (name == null)
                return null;
            try (Connection c = connect();
                    PreparedStatement ps = c.prepareStatement(
                            "SELECT * FROM classes WHERE LOWER(name) = LOWER(?)")) {
                ps.setString(1, name);
                try (ResultSet rs = ps.executeQuery()) {
                    if (rs.next()) {
                        ClassInfo ci = new ClassInfo(rs.getString("name"));
                        ci.students = rs.getInt("students");
                        ci.teacher = rs.getString("teacher") != null ? rs.getString("teacher") : "Unassigned";
                        ci.classMasterId = rs.getString("class_master_id");
                        double avg = rs.getDouble("average");
                        ci.average = rs.wasNull() ? null : avg;
                        return ci;
                    }
                }
            } catch (SQLException e) {
                System.err.println("findClass failed: " + e.getMessage());
            }
            return null;
        }

        @Override
        public ClassInfo addClass(String name) {
            try (Connection c = connect();
                    PreparedStatement ps = c.prepareStatement(
                            "INSERT INTO classes (name) VALUES (?)")) {
                ps.setString(1, name);
                ps.executeUpdate();
                logActivity("Class", "New class added — " + name);
                return new ClassInfo(name);
            } catch (SQLException e) {
                throw new RuntimeException("addClass failed: " + e.getMessage(), e);
            }
        }

        @Override
        public ClassInfo setClassMaster(String className, String teacherId) {
            try (Connection c = connect()) {
                String teacherName = null;
                try (PreparedStatement ps = c.prepareStatement("SELECT name FROM teachers WHERE id = ?")) {
                    ps.setString(1, teacherId);
                    try (ResultSet rs = ps.executeQuery()) {
                        if (rs.next())
                            teacherName = rs.getString("name");
                    }
                }
                if (teacherName == null)
                    return null;

                try (PreparedStatement check = c.prepareStatement("SELECT 1 FROM classes WHERE name = ?")) {
                    check.setString(1, className);
                    if (!check.executeQuery().next())
                        return null;
                }

                try (PreparedStatement upd = c.prepareStatement(
                        "UPDATE classes SET teacher = ?, class_master_id = ? WHERE name = ?")) {
                    upd.setString(1, teacherName);
                    upd.setString(2, teacherId);
                    upd.setString(3, className);
                    upd.executeUpdate();
                }

                logActivity("Staff", teacherName + " assigned as Class Master of " + className);

                for (ClassInfo ci : getClasses()) {
                    if (ci.name.equals(className))
                        return ci;
                }
                return null;
            } catch (SQLException e) {
                throw new RuntimeException("setClassMaster failed: " + e.getMessage(), e);
            }
        }

        @Override
        public void saveMarks(String academicYear, String cls, String subject, String sequence,
                Map<String, Double> sets, Set<String> clears) {
            String year = (academicYear == null || academicYear.isBlank()) ? getSettings().academicYear
                    : academicYear;
            try (Connection c = connect()) {
                c.setAutoCommit(false);
                try {
                    if (clears != null && !clears.isEmpty()) {
                        try (PreparedStatement del = c.prepareStatement(
                                "DELETE FROM marks WHERE academic_year = ? AND class_name = ? AND subject = ? AND sequence = ? AND student_id = ?")) {
                            for (String studentId : clears) {
                                del.setString(1, year);
                                del.setString(2, cls);
                                del.setString(3, subject);
                                del.setString(4, sequence);
                                del.setString(5, studentId);
                                del.addBatch();
                            }
                            del.executeBatch();
                        }
                    }
                    if (sets != null && !sets.isEmpty()) {
                        try (PreparedStatement ps = c.prepareStatement(
                                "INSERT INTO marks (academic_year, class_name, subject, sequence, student_id, score, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) "
                                        + "ON CONFLICT (academic_year, class_name, subject, sequence, student_id) DO UPDATE SET score = EXCLUDED.score, updated_at = EXCLUDED.updated_at")) {
                            for (Map.Entry<String, Double> e : sets.entrySet()) {
                                ps.setString(1, year);
                                ps.setString(2, cls);
                                ps.setString(3, subject);
                                ps.setString(4, sequence);
                                ps.setString(5, e.getKey());
                                ps.setDouble(6, e.getValue());
                                ps.setLong(7, System.currentTimeMillis());
                                ps.addBatch();
                            }
                            ps.executeBatch();
                        }
                    }
                    c.commit();
                    logActivity("Marks", "Marks entered — " + cls + ", " + subject + ", " + sequence + " (" + year
                            + ")");
                } catch (SQLException e) {
                    c.rollback();
                    throw e;
                } finally {
                    c.setAutoCommit(true);
                }
            } catch (SQLException e) {
                throw new RuntimeException("saveMarks failed: " + e.getMessage(), e);
            }
        }

        @Override
        public Map<String, Double> getMarks(String academicYear, String cls, String subject, String sequence) {
            String year = (academicYear == null || academicYear.isBlank()) ? getSettings().academicYear
                    : academicYear;
            Map<String, Double> out = new HashMap<>();
            try (Connection c = connect();
                    PreparedStatement ps = c.prepareStatement(
                            "SELECT student_id, score FROM marks WHERE academic_year = ? AND class_name = ? AND subject = ? AND sequence = ?")) {
                ps.setString(1, year);
                ps.setString(2, cls);
                ps.setString(3, subject);
                ps.setString(4, sequence);
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next())
                        out.put(rs.getString("student_id"), rs.getDouble("score"));
                }
            } catch (SQLException e) {
                System.err.println("getMarks failed: " + e.getMessage());
            }
            return out;
        }

        @Override
        public List<String> getAcademicYears() {
            List<String> years = new ArrayList<>();
            try (Connection c = connect();
                    PreparedStatement ps = c.prepareStatement(
                            "SELECT DISTINCT academic_year FROM marks WHERE academic_year <> ''")) {
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next())
                        years.add(rs.getString(1));
                }
            } catch (SQLException e) {
                System.err.println("getAcademicYears failed: " + e.getMessage());
            }
            String current = getSettings().academicYear;
            if (!years.contains(current))
                years.add(current);
            Collections.sort(years);
            return years;
        }

        @Override
        public Teacher addTeacher(String name, String email, String phone) {
            try (Connection c = connect()) {
                // UUID — see the file store's addTeacher for why.
                String id = UUID.randomUUID().toString();
                try (PreparedStatement ps = c.prepareStatement(
                        "INSERT INTO teachers (id, name, email, phone) VALUES (?, ?, ?, ?)")) {
                    ps.setString(1, id);
                    ps.setString(2, name);
                    ps.setString(3, email);
                    ps.setString(4, phone);
                    ps.executeUpdate();
                }
                logActivity("Staff", "New teacher added — " + name);
                return new Teacher(id, name, email, phone);
            } catch (SQLException e) {
                throw new RuntimeException("addTeacher failed: " + e.getMessage(), e);
            }
        }

        @Override
        public List<Teacher> getTeachers() {
            Map<String, Teacher> byId = new LinkedHashMap<>();
            String sql = "SELECT t.id, t.name, t.email, t.phone, a.class_name, a.subject " +
                    "FROM teachers t LEFT JOIN assignments a ON a.teacher_id = t.id ORDER BY t.id";
            try (Connection c = connect();
                    Statement st = c.createStatement();
                    ResultSet rs = st.executeQuery(sql)) {
                while (rs.next()) {
                    String id = rs.getString("id");
                    Teacher t = byId.get(id);
                    if (t == null) {
                        t = new Teacher(id, rs.getString("name"), rs.getString("email"), rs.getString("phone"));
                        byId.put(id, t);
                    }
                    String cls = rs.getString("class_name");
                    String subj = rs.getString("subject");
                    if (cls != null && subj != null) {
                        t.assignments.add(new Assignment(cls, subj));
                    }
                }
            } catch (SQLException e) {
                System.err.println("getTeachers failed: " + e.getMessage());
            }
            return new ArrayList<>(byId.values());
        }

        @Override
        public boolean addAssignment(String teacherId, String className, String subject) {
            try (Connection c = connect()) {
                String teacherName = null;
                try (PreparedStatement ps = c.prepareStatement("SELECT name FROM teachers WHERE id = ?")) {
                    ps.setString(1, teacherId);
                    try (ResultSet rs = ps.executeQuery()) {
                        if (rs.next())
                            teacherName = rs.getString("name");
                    }
                }
                if (teacherName == null)
                    return false;

                try (PreparedStatement ps = c.prepareStatement(
                        "INSERT INTO assignments (teacher_id, class_name, subject) VALUES (?, ?, ?) ON CONFLICT DO NOTHING")) {
                    ps.setString(1, teacherId);
                    ps.setString(2, className);
                    ps.setString(3, subject);
                    int updated = ps.executeUpdate();
                    if (updated > 0) {
                        logActivity("Staff", teacherName + " assigned to " + subject + " (" + className + ")");
                    }
                }
                return true;
            } catch (SQLException e) {
                throw new RuntimeException("addAssignment failed: " + e.getMessage(), e);
            }
        }

        @Override
        public void removeAssignment(String teacherId, String className, String subject) {
            try (Connection c = connect();
                    PreparedStatement ps = c.prepareStatement(
                            "DELETE FROM assignments WHERE teacher_id = ? AND class_name = ? AND subject = ?")) {
                ps.setString(1, teacherId);
                ps.setString(2, className);
                ps.setString(3, subject);
                ps.executeUpdate();
            } catch (SQLException e) {
                System.err.println("removeAssignment failed: " + e.getMessage());
            }
        }

        @Override
        public void deleteTeacher(String teacherId) {
            try (Connection c = connect()) {
                try (PreparedStatement clear = c.prepareStatement(
                        "UPDATE classes SET teacher = 'Unassigned', class_master_id = NULL WHERE class_master_id = ?")) {
                    clear.setString(1, teacherId);
                    clear.executeUpdate();
                }
                try (PreparedStatement del = c.prepareStatement("DELETE FROM teachers WHERE id = ?")) {
                    del.setString(1, teacherId);
                    del.executeUpdate();
                }
            } catch (SQLException e) {
                System.err.println("deleteTeacher failed: " + e.getMessage());
            }
        }

        @Override
        public boolean deleteTeacherAccountByEmail(String email) {
            if (email == null || email.isBlank() || "—".equals(email))
                return false;
            try (Connection c = connect();
                    PreparedStatement ps = c.prepareStatement(
                            "DELETE FROM users WHERE LOWER(email) = LOWER(?) AND role = 'teacher'")) {
                ps.setString(1, email);
                return ps.executeUpdate() > 0;
            } catch (SQLException e) {
                System.err.println("deleteTeacherAccountByEmail failed: " + e.getMessage());
                return false;
            }
        }

        @Override
        public User findUserByEmail(String email) {
            if (email == null)
                return null;
            try (Connection c = connect();
                    PreparedStatement ps = c.prepareStatement(
                            "SELECT * FROM users WHERE LOWER(email) = LOWER(?)")) {
                ps.setString(1, email);
                try (ResultSet rs = ps.executeQuery()) {
                    if (rs.next()) {
                        return new User(rs.getString("id"), rs.getString("name"), rs.getString("email"),
                                rs.getString("password"), rs.getString("role"));
                    }
                }
            } catch (SQLException e) {
                // Deliberately throws rather than returning null. Callers treat
                // null as "this account no longer exists" and revoke the
                // session over it, so swallowing a transient database error
                // here used to sign the user out permanently — a dropped
                // connection or a busy pool was enough to do it.
                throw new RuntimeException("findUserByEmail failed: " + e.getMessage(), e);
            }
            return null;
        }

        @Override
        public User addUser(String name, String email, String password, String role) {
            try (Connection c = connect()) {
                String id = nextPrefixedId(c, "users", "USR-");
                try (PreparedStatement ps = c.prepareStatement(
                        "INSERT INTO users (id, name, email, password, role) VALUES (?, ?, ?, ?, ?)")) {
                    ps.setString(1, id);
                    ps.setString(2, name);
                    ps.setString(3, email);
                    ps.setString(4, password);
                    ps.setString(5, role);
                    ps.executeUpdate();
                }
                logActivity("Account", "New " + role + " account registered — " + name);
                return new User(id, name, email, password, role);
            } catch (SQLException e) {
                throw new RuntimeException("addUser failed: " + e.getMessage(), e);
            }
        }

        @Override
        public boolean hasAdmin() {
            try (Connection c = connect();
                    PreparedStatement ps = c.prepareStatement(
                            "SELECT 1 FROM users WHERE role = 'admin' LIMIT 1");
                    ResultSet rs = ps.executeQuery()) {
                return rs.next();
            } catch (SQLException e) {
                System.err.println("hasAdmin failed: " + e.getMessage());
                return false;
            }
        }

        @Override
        public void updateUserPassword(String userId, String passwordHash) {
            try (Connection c = connect();
                    PreparedStatement ps = c.prepareStatement(
                            "UPDATE users SET password = ? WHERE id = ?")) {
                ps.setString(1, passwordHash);
                ps.setString(2, userId);
                ps.executeUpdate();
            } catch (SQLException e) {
                throw new RuntimeException("updateUserPassword failed: " + e.getMessage(), e);
            }
        }

        @Override
        public Teacher findTeacherByEmail(String email) {
            if (email == null)
                return null;
            try (Connection c = connect();
                    PreparedStatement ps = c.prepareStatement(
                            "SELECT * FROM teachers WHERE LOWER(email) = LOWER(?)")) {
                ps.setString(1, email);
                try (ResultSet rs = ps.executeQuery()) {
                    if (rs.next()) {
                        Teacher t = new Teacher(rs.getString("id"), rs.getString("name"), rs.getString("email"),
                                rs.getString("phone"));
                        try (PreparedStatement aps = c.prepareStatement(
                                "SELECT class_name, subject FROM assignments WHERE teacher_id = ?")) {
                            aps.setString(1, t.id);
                            try (ResultSet ars = aps.executeQuery()) {
                                while (ars.next()) {
                                    t.assignments.add(new Assignment(ars.getString("class_name"),
                                            ars.getString("subject")));
                                }
                            }
                        }
                        return t;
                    }
                }
            } catch (SQLException e) {
                System.err.println("findTeacherByEmail failed: " + e.getMessage());
            }
            return null;
        }

        @Override
        public SchoolSettings getSettings() {
            SchoolSettings s = new SchoolSettings();
            try (Connection c = connect();
                    Statement st = c.createStatement();
                    ResultSet rs = st.executeQuery("SELECT * FROM settings WHERE id = 1")) {
                if (rs.next()) {
                    s.schoolName = rs.getString("school_name");
                    s.schoolCode = rs.getString("school_code");
                    s.region = rs.getString("region");
                    s.schoolTown = rs.getString("school_town");
                    s.regionalDelegation = rs.getString("regional_delegation");
                    s.subDivision = rs.getString("sub_division");
                    s.motto = rs.getString("motto");
                    s.currentTerm = rs.getString("current_term");
                    s.currentSequence = rs.getString("current_sequence");
                    s.academicYear = rs.getString("academic_year");
                    s.marksScale = rs.getString("marks_scale");
                    s.emailNotif = rs.getBoolean("email_notif");
                    s.autoLock = rs.getBoolean("auto_lock");
                    s.publicResults = rs.getBoolean("public_results");
                    s.passAverage = rs.getString("pass_average");
                    s.principalStamp = rs.getString("principal_stamp");
                    s.principalSignature = rs.getString("principal_signature");
                    s.nextTermBegins = rs.getString("next_term_begins");
                }
            } catch (SQLException e) {
                System.err.println("getSettings failed: " + e.getMessage());
            }
            return s;
        }

        @Override
        public SchoolSettings updateSettings(Map<String, String> fields) {
            SchoolSettings s = getSettings();
            String previousYear = s.academicYear;
            if (fields.containsKey("schoolName"))
                s.schoolName = fields.get("schoolName");
            if (fields.containsKey("schoolCode"))
                s.schoolCode = fields.get("schoolCode");
            if (fields.containsKey("region"))
                s.region = fields.get("region");
            if (fields.containsKey("schoolTown"))
                s.schoolTown = fields.get("schoolTown");
            if (fields.containsKey("regionalDelegation"))
                s.regionalDelegation = fields.get("regionalDelegation");
            if (fields.containsKey("subDivision"))
                s.subDivision = fields.get("subDivision");
            if (fields.containsKey("motto"))
                s.motto = fields.get("motto");
            if (fields.containsKey("currentTerm"))
                s.currentTerm = fields.get("currentTerm");
            if (fields.containsKey("currentSequence"))
                s.currentSequence = fields.get("currentSequence");
            if (fields.containsKey("academicYear"))
                s.academicYear = fields.get("academicYear");
            if (fields.containsKey("marksScale"))
                s.marksScale = fields.get("marksScale");
            if (fields.containsKey("emailNotif"))
                s.emailNotif = Boolean.parseBoolean(fields.get("emailNotif"));
            if (fields.containsKey("autoLock"))
                s.autoLock = Boolean.parseBoolean(fields.get("autoLock"));
            if (fields.containsKey("publicResults"))
                s.publicResults = Boolean.parseBoolean(fields.get("publicResults"));
            if (fields.containsKey("passAverage"))
                s.passAverage = fields.get("passAverage");
            if (fields.containsKey("principalStamp"))
                s.principalStamp = fields.get("principalStamp");
            if (fields.containsKey("principalSignature"))
                s.principalSignature = fields.get("principalSignature");
            if (fields.containsKey("nextTermBegins"))
                s.nextTermBegins = fields.get("nextTermBegins");

            try (Connection c = connect();
                    PreparedStatement ps = c.prepareStatement(
                            "UPDATE settings SET school_name=?, school_code=?, region=?, school_town=?, "
                                    + "regional_delegation=?, sub_division=?, motto=?, current_term=?, current_sequence=?, "
                                    + "academic_year=?, marks_scale=?, email_notif=?, auto_lock=?, public_results=?, "
                                    + "pass_average=?, principal_stamp=?, principal_signature=?, next_term_begins=? WHERE id = 1")) {
                ps.setString(1, s.schoolName);
                ps.setString(2, s.schoolCode);
                ps.setString(3, s.region);
                ps.setString(4, s.schoolTown);
                ps.setString(5, s.regionalDelegation);
                ps.setString(6, s.subDivision);
                ps.setString(7, s.motto);
                ps.setString(8, s.currentTerm);
                ps.setString(9, s.currentSequence);
                ps.setString(10, s.academicYear);
                ps.setString(11, s.marksScale);
                ps.setBoolean(12, s.emailNotif);
                ps.setBoolean(13, s.autoLock);
                ps.setBoolean(14, s.publicResults);
                ps.setString(15, s.passAverage);
                ps.setString(16, s.principalStamp);
                ps.setString(17, s.principalSignature);
                ps.setString(18, s.nextTermBegins);
                ps.executeUpdate();

                if (fields.containsKey("academicYear") && s.academicYear != null
                        && !s.academicYear.equals(previousYear)) {
                    // A new academic year means a new staffing lineup — clear
                    // every teacher's class/subject assignments so the admin
                    // deliberately re-assigns them instead of carrying over
                    // last year's (possibly stale) roster.
                    try (Statement clearAssignments = c.createStatement()) {
                        clearAssignments.executeUpdate("DELETE FROM assignments");
                    }
                    logActivity("Settings", "Academic year changed to " + s.academicYear
                            + " — all teacher assignments were cleared");
                }
            } catch (SQLException e) {
                throw new RuntimeException("updateSettings failed: " + e.getMessage(), e);
            }
            return s;
        }

        @Override
        public String getLicenseKey() {
            try (Connection c = connect();
                    Statement st = c.createStatement();
                    ResultSet rs = st.executeQuery("SELECT license_key FROM settings WHERE id = 1")) {
                if (rs.next()) {
                    String key = rs.getString("license_key");
                    return key == null ? "" : key;
                }
            } catch (SQLException e) {
                System.err.println("getLicenseKey failed: " + e.getMessage());
            }
            return "";
        }

        @Override
        public void setLicenseKey(String key) {
            String value = key == null ? "" : key.trim();
            try (Connection c = connect();
                    PreparedStatement ps = c.prepareStatement(
                            "UPDATE settings SET license_key = ? WHERE id = 1")) {
                ps.setString(1, value);
                ps.executeUpdate();
            } catch (SQLException e) {
                throw new RuntimeException("setLicenseKey failed: " + e.getMessage(), e);
            }
        }

        @Override
        public void wipeAcademicData() {
            try (Connection c = connect(); Statement st = c.createStatement()) {
                st.executeUpdate("UPDATE classes SET class_master_id = NULL");
                st.executeUpdate("DELETE FROM marks");
                st.executeUpdate("DELETE FROM assignments");
                st.executeUpdate("DELETE FROM students");
                st.executeUpdate("DELETE FROM teachers");
                st.executeUpdate("DELETE FROM activities");
                st.executeUpdate("DELETE FROM classes");
            } catch (SQLException e) {
                throw new RuntimeException("wipeAcademicData failed: " + e.getMessage(), e);
            }
        }

        @Override
        public void clearActivities() {
            try (Connection c = connect(); Statement st = c.createStatement()) {
                st.executeUpdate("DELETE FROM activities");
            } catch (SQLException e) {
                throw new RuntimeException("clearActivities failed: " + e.getMessage(), e);
            }
        }

        @Override
        public void ensureUser(String name, String email, String passwordHash, String role) {
            User existing = findUserByEmail(email);
            if (existing != null) {
                try (Connection c = connect();
                        PreparedStatement ps = c.prepareStatement(
                                "UPDATE users SET name = ?, password = ?, role = ? WHERE email = ?")) {
                    ps.setString(1, name);
                    ps.setString(2, passwordHash);
                    ps.setString(3, role);
                    ps.setString(4, email);
                    ps.executeUpdate();
                } catch (SQLException e) {
                    throw new RuntimeException("ensureUser update failed: " + e.getMessage(), e);
                }
                return;
            }
            addUser(name, email, passwordHash, role);
        }

        @Override
        public File getBackupFile() {
            // Not file-based — there is no local file to stream. Backups here
            // go through Backup.export() instead, which works for both stores.
            return null;
        }

        @Override
        public void reload() {
            // No-op: every method above reads live from the database, so
            // there's no in-memory snapshot that needs refreshing.
        }

        @Override
        public void saveSession(String token, Session session) {
            try (Connection c = connect();
                    PreparedStatement ps = c.prepareStatement(
                            "INSERT INTO sessions (token, user_id, email, role, name, expires_at) "
                                    + "VALUES (?, ?, ?, ?, ?, ?) "
                                    + "ON CONFLICT (token) DO UPDATE SET expires_at = EXCLUDED.expires_at")) {
                ps.setString(1, token);
                ps.setString(2, session.userId);
                ps.setString(3, session.email);
                ps.setString(4, session.role);
                ps.setString(5, session.name);
                ps.setLong(6, session.expiresAt);
                ps.executeUpdate();
            } catch (SQLException e) {
                throw new RuntimeException("saveSession failed: " + e.getMessage(), e);
            }
        }

        @Override
        public Session findSession(String token) {
            try (Connection c = connect();
                    PreparedStatement ps = c.prepareStatement(
                            "SELECT user_id, email, role, name, expires_at FROM sessions WHERE token = ?")) {
                ps.setString(1, token);
                try (ResultSet rs = ps.executeQuery()) {
                    if (!rs.next())
                        return null;
                    return new Session(rs.getString("user_id"), rs.getString("email"), rs.getString("role"),
                            rs.getString("name"), rs.getLong("expires_at"));
                }
            } catch (SQLException e) {
                throw new RuntimeException("findSession failed: " + e.getMessage(), e);
            }
        }

        @Override
        public void deleteSession(String token) {
            try (Connection c = connect();
                    PreparedStatement ps = c.prepareStatement("DELETE FROM sessions WHERE token = ?")) {
                ps.setString(1, token);
                ps.executeUpdate();
            } catch (SQLException e) {
                throw new RuntimeException("deleteSession failed: " + e.getMessage(), e);
            }
        }

        @Override
        public List<Student> studentsChangedSince(long since) {
            List<Student> out = new ArrayList<>();
            try (Connection c = connect();
                    PreparedStatement ps = c.prepareStatement(
                            "SELECT * FROM students WHERE updated_at > ? ORDER BY updated_at")) {
                ps.setLong(1, since);
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next())
                        out.add(mapStudent(rs));
                }
            } catch (SQLException e) {
                throw new RuntimeException("studentsChangedSince failed: " + e.getMessage(), e);
            }
            return out;
        }

        @Override
        public List<Teacher> teachersChangedSince(long since) {
            List<Teacher> out = new ArrayList<>();
            try (Connection c = connect();
                    PreparedStatement ps = c.prepareStatement(
                            "SELECT id, name, email, phone, updated_at FROM teachers WHERE updated_at > ?")) {
                ps.setLong(1, since);
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) {
                        Teacher t = new Teacher(rs.getString("id"), rs.getString("name"),
                                rs.getString("email"), rs.getString("phone"));
                        t.updatedAt = rs.getLong("updated_at");
                        out.add(t);
                    }
                }
            } catch (SQLException e) {
                throw new RuntimeException("teachersChangedSince failed: " + e.getMessage(), e);
            }
            return out;
        }

        @Override
        public List<MarkRow> marksChangedSince(long since) {
            List<MarkRow> out = new ArrayList<>();
            try (Connection c = connect();
                    PreparedStatement ps = c.prepareStatement(
                            "SELECT academic_year, class_name, subject, sequence, student_id, score, updated_at "
                                    + "FROM marks WHERE updated_at > ? ORDER BY updated_at")) {
                ps.setLong(1, since);
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) {
                        MarkRow row = new MarkRow(rs.getString("academic_year"), rs.getString("class_name"),
                                rs.getString("subject"), rs.getString("sequence"), rs.getString("student_id"),
                                rs.getDouble("score"));
                        row.updatedAt = rs.getLong("updated_at");
                        out.add(row);
                    }
                }
            } catch (SQLException e) {
                throw new RuntimeException("marksChangedSince failed: " + e.getMessage(), e);
            }
            return out;
        }

        @Override
        public boolean mergeStudent(Student incoming) {
            try (Connection c = connect()) {
                try (PreparedStatement ps = c.prepareStatement(
                        "SELECT updated_at FROM students WHERE id = ?")) {
                    ps.setString(1, incoming.id);
                    try (ResultSet rs = ps.executeQuery()) {
                        if (rs.next() && incoming.updatedAt <= rs.getLong("updated_at"))
                            return false;
                    }
                }
                try (PreparedStatement ps = c.prepareStatement(
                        "INSERT INTO students (id, code, name, class_name, gender, guardian, phone, dob, "
                                + "option_name, electives, status, photo, admitted_on, updated_at, deleted_at) "
                                + "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) "
                                + "ON CONFLICT (id) DO UPDATE SET code=EXCLUDED.code, name=EXCLUDED.name, "
                                + "class_name=EXCLUDED.class_name, gender=EXCLUDED.gender, guardian=EXCLUDED.guardian, "
                                + "phone=EXCLUDED.phone, dob=EXCLUDED.dob, option_name=EXCLUDED.option_name, "
                                + "electives=EXCLUDED.electives, status=EXCLUDED.status, photo=EXCLUDED.photo, "
                                + "admitted_on=EXCLUDED.admitted_on, updated_at=EXCLUDED.updated_at, "
                                + "deleted_at=EXCLUDED.deleted_at")) {
                    ps.setString(1, incoming.id);
                    ps.setString(2, incoming.displayCode());
                    ps.setString(3, incoming.name);
                    ps.setString(4, incoming.className);
                    ps.setString(5, incoming.gender);
                    ps.setString(6, incoming.guardian);
                    ps.setString(7, incoming.phone);
                    ps.setString(8, incoming.dob);
                    ps.setString(9, incoming.option);
                    ps.setString(10, incoming.electives);
                    ps.setString(11, incoming.status == null ? "Active" : incoming.status);
                    ps.setString(12, incoming.photo == null ? "" : incoming.photo);
                    ps.setString(13, incoming.admittedOn == null ? "" : incoming.admittedOn);
                    ps.setLong(14, incoming.updatedAt);
                    if (incoming.deletedAt == null)
                        ps.setNull(15, java.sql.Types.BIGINT);
                    else
                        ps.setLong(15, incoming.deletedAt);
                    ps.executeUpdate();
                }
                return true;
            } catch (SQLException e) {
                throw new RuntimeException("mergeStudent failed: " + e.getMessage(), e);
            }
        }

        @Override
        public boolean mergeTeacher(Teacher incoming) {
            try (Connection c = connect()) {
                try (PreparedStatement ps = c.prepareStatement(
                        "SELECT updated_at FROM teachers WHERE id = ?")) {
                    ps.setString(1, incoming.id);
                    try (ResultSet rs = ps.executeQuery()) {
                        if (rs.next() && incoming.updatedAt <= rs.getLong("updated_at"))
                            return false;
                    }
                }
                try (PreparedStatement ps = c.prepareStatement(
                        "INSERT INTO teachers (id, name, email, phone, updated_at) VALUES (?,?,?,?,?) "
                                + "ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, email=EXCLUDED.email, "
                                + "phone=EXCLUDED.phone, updated_at=EXCLUDED.updated_at")) {
                    ps.setString(1, incoming.id);
                    ps.setString(2, incoming.name);
                    ps.setString(3, incoming.email);
                    ps.setString(4, incoming.phone);
                    ps.setLong(5, incoming.updatedAt);
                    ps.executeUpdate();
                }
                return true;
            } catch (SQLException e) {
                throw new RuntimeException("mergeTeacher failed: " + e.getMessage(), e);
            }
        }

        @Override
        public boolean mergeMark(MarkRow incoming) {
            try (Connection c = connect()) {
                try (PreparedStatement ps = c.prepareStatement(
                        "SELECT updated_at FROM marks WHERE academic_year=? AND class_name=? AND subject=? "
                                + "AND sequence=? AND student_id=?")) {
                    ps.setString(1, incoming.academicYear);
                    ps.setString(2, incoming.className);
                    ps.setString(3, incoming.subject);
                    ps.setString(4, incoming.sequence);
                    ps.setString(5, incoming.studentId);
                    try (ResultSet rs = ps.executeQuery()) {
                        if (rs.next() && incoming.updatedAt <= rs.getLong("updated_at"))
                            return false;
                    }
                }
                try (PreparedStatement ps = c.prepareStatement(
                        "INSERT INTO marks (academic_year, class_name, subject, sequence, student_id, score, updated_at) "
                                + "VALUES (?,?,?,?,?,?,?) ON CONFLICT (academic_year, class_name, subject, sequence, student_id) "
                                + "DO UPDATE SET score=EXCLUDED.score, updated_at=EXCLUDED.updated_at")) {
                    ps.setString(1, incoming.academicYear);
                    ps.setString(2, incoming.className);
                    ps.setString(3, incoming.subject);
                    ps.setString(4, incoming.sequence);
                    ps.setString(5, incoming.studentId);
                    ps.setDouble(6, incoming.score);
                    ps.setLong(7, incoming.updatedAt);
                    ps.executeUpdate();
                }
                return true;
            } catch (SQLException e) {
                throw new RuntimeException("mergeMark failed: " + e.getMessage(), e);
            }
        }

        @Override
        public void purgeTombstones(long cutoffMillis) {
            try (Connection c = connect();
                    PreparedStatement ps = c.prepareStatement(
                            "DELETE FROM students WHERE deleted_at IS NOT NULL AND deleted_at < ?")) {
                ps.setLong(1, cutoffMillis);
                int removed = ps.executeUpdate();
                if (removed > 0)
                    System.out.println("Swept " + removed + " tombstoned student record(s).");
            } catch (SQLException e) {
                throw new RuntimeException("purgeTombstones failed: " + e.getMessage(), e);
            }
        }

        @Override
        public void purgeExpiredSessions(long nowMillis) {
            try (Connection c = connect();
                    PreparedStatement ps = c.prepareStatement("DELETE FROM sessions WHERE expires_at < ?")) {
                ps.setLong(1, nowMillis);
                ps.executeUpdate();
            } catch (SQLException e) {
                throw new RuntimeException("purgeExpiredSessions failed: " + e.getMessage(), e);
            }
        }

        @Override
        public List<User> getUsers() {
            List<User> out = new ArrayList<>();
            try (Connection c = connect();
                    Statement st = c.createStatement();
                    ResultSet rs = st.executeQuery("SELECT id, name, email, password, role FROM users ORDER BY id")) {
                while (rs.next())
                    out.add(new User(rs.getString("id"), rs.getString("name"), rs.getString("email"),
                            rs.getString("password"), rs.getString("role")));
            } catch (SQLException e) {
                throw new RuntimeException("getUsers failed: " + e.getMessage(), e);
            }
            return out;
        }

        @Override
        public List<MarkRow> getAllMarks() {
            List<MarkRow> out = new ArrayList<>();
            try (Connection c = connect();
                    Statement st = c.createStatement();
                    ResultSet rs = st.executeQuery(
                            "SELECT academic_year, class_name, subject, sequence, student_id, score, updated_at FROM marks")) {
                while (rs.next()) {
                    MarkRow row = new MarkRow(rs.getString("academic_year"), rs.getString("class_name"),
                            rs.getString("subject"), rs.getString("sequence"), rs.getString("student_id"),
                            rs.getDouble("score"));
                    row.updatedAt = rs.getLong("updated_at");
                    out.add(row);
                }
            } catch (SQLException e) {
                throw new RuntimeException("getAllMarks failed: " + e.getMessage(), e);
            }
            return out;
        }

        @Override
        public void restoreStudent(Student s) {
            try (Connection c = connect()) {
                c.setAutoCommit(false);
                try {
                    try (PreparedStatement ps = c.prepareStatement(
                            "INSERT INTO students (id, code, name, class_name, gender, guardian, phone, dob, option_name, electives, status, photo, admitted_on) "
                                    + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
                                    + "ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, class_name = EXCLUDED.class_name, "
                                    + "gender = EXCLUDED.gender, guardian = EXCLUDED.guardian, phone = EXCLUDED.phone, "
                                    + "dob = EXCLUDED.dob, option_name = EXCLUDED.option_name, electives = EXCLUDED.electives, "
                                    + "status = EXCLUDED.status, photo = EXCLUDED.photo, admitted_on = EXCLUDED.admitted_on")) {
                        ps.setString(1, s.id);
                        ps.setString(2, s.displayCode());
                        ps.setString(3, s.name);
                        ps.setString(4, s.className);
                        ps.setString(5, s.gender);
                        ps.setString(6, s.guardian);
                        ps.setString(7, s.phone);
                        ps.setString(8, s.dob);
                        ps.setString(9, s.option);
                        ps.setString(10, s.electives);
                        ps.setString(11, s.status == null || s.status.isBlank() ? "Active" : s.status);
                        ps.setString(12, s.photo == null ? "" : s.photo);
                        ps.setString(13, s.admittedOn == null ? "" : s.admittedOn);
                        ps.executeUpdate();
                    }
                    // Keep the denormalised per-class count in step, recreating
                    // the class if the backup referenced one it didn't list.
                    try (PreparedStatement ins = c.prepareStatement(
                            "INSERT INTO classes (name, students) VALUES (?, 1) "
                                    + "ON CONFLICT (name) DO UPDATE SET students = classes.students + 1")) {
                        ins.setString(1, s.className);
                        ins.executeUpdate();
                    }
                    c.commit();
                } catch (SQLException e) {
                    c.rollback();
                    throw e;
                } finally {
                    c.setAutoCommit(true);
                }
            } catch (SQLException e) {
                throw new RuntimeException("restoreStudent failed: " + e.getMessage(), e);
            }
        }

        @Override
        public void restoreTeacher(Teacher t) {
            try (Connection c = connect()) {
                c.setAutoCommit(false);
                try {
                    try (PreparedStatement ps = c.prepareStatement(
                            "INSERT INTO teachers (id, name, email, phone) VALUES (?, ?, ?, ?) "
                                    + "ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, "
                                    + "email = EXCLUDED.email, phone = EXCLUDED.phone")) {
                        ps.setString(1, t.id);
                        ps.setString(2, t.name);
                        ps.setString(3, t.email);
                        ps.setString(4, t.phone);
                        ps.executeUpdate();
                    }
                    if (t.assignments != null && !t.assignments.isEmpty()) {
                        try (PreparedStatement ps = c.prepareStatement(
                                "INSERT INTO assignments (teacher_id, class_name, subject) VALUES (?, ?, ?) "
                                        + "ON CONFLICT DO NOTHING")) {
                            for (Assignment a : t.assignments) {
                                ps.setString(1, t.id);
                                ps.setString(2, a.className);
                                ps.setString(3, a.subject);
                                ps.addBatch();
                            }
                            ps.executeBatch();
                        }
                    }
                    c.commit();
                } catch (SQLException e) {
                    c.rollback();
                    throw e;
                } finally {
                    c.setAutoCommit(true);
                }
            } catch (SQLException e) {
                throw new RuntimeException("restoreTeacher failed: " + e.getMessage(), e);
            }
        }

        @Override
        public void restoreUser(User u) {
            // Keyed by email to match how logins resolve. The stored ID may
            // differ from the backup's if that email already has an account —
            // harmless, since nothing else references users by ID.
            try (Connection c = connect();
                    PreparedStatement ps = c.prepareStatement(
                            "INSERT INTO users (id, name, email, password, role) VALUES (?, ?, ?, ?, ?) "
                                    + "ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, "
                                    + "password = EXCLUDED.password, role = EXCLUDED.role")) {
                ps.setString(1, u.id == null || u.id.isBlank() ? "USR-" + UUID.randomUUID() : u.id);
                ps.setString(2, u.name);
                ps.setString(3, u.email);
                ps.setString(4, u.password);
                ps.setString(5, u.role);
                ps.executeUpdate();
            } catch (SQLException e) {
                throw new RuntimeException("restoreUser failed: " + e.getMessage(), e);
            }
        }
    }
}