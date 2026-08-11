package com.reportcard;

import java.io.File;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.time.Duration;
import java.util.List;
import java.util.Map;

/**
 * Background sync for the desktop app.
 *
 * The desktop always works against its own local store — that is what makes it
 * usable in a school whose internet is out for a week — and this pushes those
 * changes to the shared server when a connection is available, pulling back
 * whatever the teachers entered online.
 *
 * Deliberately not the same thing as pointing the desktop at the remote
 * database directly. That approach stops working the moment the connection
 * does, and puts database credentials on a school secretary's PC.
 *
 * Inactive unless SYNC_SERVER_URL is configured, so a standalone install is
 * unaffected.
 */
final class SyncClient {

    /**
     * Two cursors, because two clocks are involved.
     *
     * {@code remoteCursor} is the server's own timestamp, sent back as
     * {@code since} so the server decides what we haven't seen.
     *
     * {@code localCursor} is this machine's clock at the last successful push,
     * used to decide which local rows still need sending. Comparing local
     * updatedAt values against a server timestamp would silently skip or
     * re-send changes whenever the two clocks disagree — which, on the sort of
     * hardware schools actually own, they routinely do.
     */
    private long remoteCursor;
    private long localCursor;

    private final String serverUrl;
    private final String email;
    private final String password;
    private final File stateFile;
    private final HttpClient http;

    private volatile String token;
    private volatile long lastSyncedAt;
    private volatile String lastError = "";
    private volatile boolean syncing;

    private static SyncClient instance;
    private static boolean initialised;

    private SyncClient(String serverUrl, String email, String password, File dataDir) {
        this.serverUrl = serverUrl.replaceAll("/+$", "");
        this.email = email;
        this.password = password;
        this.stateFile = new File(dataDir, "sync-state");
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build();
        loadState();
    }

    static synchronized SyncClient get(File dataDir) {
        if (initialised)
            return instance;
        initialised = true;

        String url = System.getenv("SYNC_SERVER_URL");
        String email = System.getenv("SYNC_EMAIL");
        String password = System.getenv("SYNC_PASSWORD");
        if (url == null || url.isBlank()) {
            System.out.println("Sync: not configured (SYNC_SERVER_URL unset) — running standalone.");
            return null;
        }
        if (email == null || email.isBlank() || password == null || password.isBlank()) {
            System.out.println("Sync: SYNC_SERVER_URL is set but SYNC_EMAIL/SYNC_PASSWORD are not — cannot sync.");
            return null;
        }
        instance = new SyncClient(url, email, password, dataDir);
        System.out.println("Sync: enabled, server " + url);
        return instance;
    }

    // ------------------------------------------------------------- state

    private void loadState() {
        try {
            if (!stateFile.isFile())
                return;
            String[] parts = Files.readString(stateFile.toPath()).trim().split(",");
            remoteCursor = Long.parseLong(parts[0]);
            localCursor = parts.length > 1 ? Long.parseLong(parts[1]) : 0;
            lastSyncedAt = parts.length > 2 ? Long.parseLong(parts[2]) : 0;
        } catch (Exception e) {
            // A corrupt cursor just means a full resync, which is safe: merges
            // are idempotent because they compare timestamps.
            System.err.println("Sync: could not read saved cursor, starting from scratch.");
            remoteCursor = 0;
            localCursor = 0;
        }
    }

    private void saveState() {
        try {
            Files.writeString(stateFile.toPath(), remoteCursor + "," + localCursor + "," + lastSyncedAt);
        } catch (Exception e) {
            System.err.println("Sync: could not save cursor: " + e.getMessage());
        }
    }

    /** How many local changes are waiting to be pushed. */
    int pendingCount(Main.DataStore store) {
        try {
            return store.studentsChangedSince(localCursor).size()
                    + store.teachersChangedSince(localCursor).size()
                    + store.marksChangedSince(localCursor).size();
        } catch (RuntimeException e) {
            return 0;
        }
    }

    String statusJson(Main.DataStore store) {
        return "{\"configured\":true"
                + ",\"server\":" + Json.str(serverUrl)
                + ",\"syncing\":" + syncing
                + ",\"lastSyncedAt\":" + lastSyncedAt
                + ",\"pending\":" + pendingCount(store)
                + ",\"lastError\":" + Json.str(lastError)
                + "}";
    }

    // -------------------------------------------------------------- sync

    /** Returns true on success. Never throws — offline is normal, not an error. */
    synchronized boolean syncNow(Main.DataStore store) {
        if (syncing)
            return false;
        syncing = true;
        long localStart = System.currentTimeMillis();
        try {
            if (token == null && !login()) {
                return false;
            }

            // Push/pull the school licence before academic sync. /api/sync is
            // licence-gated, so an unlicensed cloud would otherwise refuse every
            // sync forever even when the desktop already has a valid key.
            ensureSchoolLicense(store);

            String payload = buildPayload(store);
            HttpResponse<String> response = post("/api/sync", payload, token);
            if (response != null && response.statusCode() == 401) {
                // Token expired — one retry after a fresh login.
                token = null;
                if (!login())
                    return false;
                response = post("/api/sync", payload, token);
            }
            if (response == null) {
                lastError = "Could not reach the server";
                return false;
            }
            if (response.statusCode() != 200) {
                lastError = "Server returned " + response.statusCode();
                return false;
            }

            Map<String, Object> body = Json.parseObject(response.body());
            applyRemoteChanges(store, Json.getObject(body, "changes"));

            remoteCursor = (long) Json.getDouble(body, "serverTime", remoteCursor);
            // Only advance the local cursor to where we started, so anything
            // edited *during* the request is picked up next time rather than
            // being skipped.
            localCursor = localStart;
            lastSyncedAt = System.currentTimeMillis();
            lastError = "";
            saveState();
            store.save();
            return true;
        } catch (Exception e) {
            lastError = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            return false;
        } finally {
            syncing = false;
        }
    }

    private String buildPayload(Main.DataStore store) {
        StringBuilder sb = new StringBuilder(1 << 14);
        sb.append("{\"since\":").append(remoteCursor).append(",\"changes\":{\"students\":[");
        List<Main.Student> students = store.studentsChangedSince(localCursor);
        for (int i = 0; i < students.size(); i++) {
            if (i > 0)
                sb.append(',');
            sb.append(students.get(i).toSyncJson());
        }
        sb.append("],\"teachers\":[");
        List<Main.Teacher> teachers = store.teachersChangedSince(localCursor);
        for (int i = 0; i < teachers.size(); i++) {
            if (i > 0)
                sb.append(',');
            sb.append(teachers.get(i).toSyncJson());
        }
        sb.append("],\"marks\":[");
        List<Main.MarkRow> marks = store.marksChangedSince(localCursor);
        for (int i = 0; i < marks.size(); i++) {
            Main.MarkRow m = marks.get(i);
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
        return sb.append("]}}").toString();
    }

    private void applyRemoteChanges(Main.DataStore store, Map<String, Object> changes) {
        if (changes == null)
            return;

        for (Map<String, Object> st : Json.getObjectList(changes, "students")) {
            String id = Json.getString(st, "id", "");
            if (id.isBlank())
                continue;
            Main.Student s = new Main.Student(id,
                    Json.getString(st, "name", ""),
                    Json.getString(st, "class", ""),
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
            s.updatedAt = (long) Json.getDouble(st, "updatedAt", 0);
            double deleted = Json.getDouble(st, "deletedAt", 0);
            s.deletedAt = deleted > 0 ? (long) deleted : null;
            store.mergeStudent(s);
        }

        for (Map<String, Object> t : Json.getObjectList(changes, "teachers")) {
            String id = Json.getString(t, "id", "");
            if (id.isBlank())
                continue;
            Main.Teacher teacher = new Main.Teacher(id, Json.getString(t, "name", ""),
                    Json.getString(t, "email", ""), Json.getString(t, "phone", ""));
            teacher.updatedAt = (long) Json.getDouble(t, "updatedAt", 0);
            for (Map<String, Object> a : Json.getObjectList(t, "assignments")) {
                String cls = Json.getString(a, "class", "");
                String subject = Json.getString(a, "subject", "");
                if (!cls.isBlank())
                    teacher.assignments.add(new Main.Assignment(cls, subject));
            }
            store.mergeTeacher(teacher);
        }

        for (Map<String, Object> m : Json.getObjectList(changes, "marks")) {
            Main.MarkRow row = new Main.MarkRow(
                    Json.getString(m, "academicYear", ""),
                    Json.getString(m, "className", ""),
                    Json.getString(m, "subject", ""),
                    Json.getString(m, "sequence", ""),
                    Json.getString(m, "studentId", ""),
                    Json.getDouble(m, "score", 0));
            if (row.className.isBlank() || row.studentId.isBlank())
                continue;
            row.updatedAt = (long) Json.getDouble(m, "updatedAt", 0);
            store.mergeMark(row);
        }
    }

    /**
     * Keeps the school licence aligned between this desktop and the shared
     * server. Teachers inherit the same school key — there is no per-teacher
     * licence — so activating once (anywhere) must reach every install.
     */
    private void ensureSchoolLicense(Main.DataStore store) {
        File dataDir = stateFile.getParentFile();
        String localKey = localLicenseKey(store, dataDir);

        if (localKey != null && !localKey.isBlank()) {
            try {
                String body = "{\"key\":" + Json.str(localKey) + "}";
                HttpResponse<String> activated = post("/api/license/activate", body, token);
                if (activated != null && activated.statusCode() == 200) {
                    // Cloud now has the key; teachers signing into the web app
                    // share that process's licence automatically.
                } else if (activated != null && activated.statusCode() == 401) {
                    token = null;
                }
            } catch (Exception e) {
                System.err.println("Sync: could not push school licence: " + e.getMessage());
            }
            return;
        }

        // Local install has no key — pull the school key the admin activated
        // on the server (or on another desktop that already synced it up).
        try {
            HttpResponse<String> response = get("/api/license/key", token);
            if (response == null || response.statusCode() != 200)
                return;
            String key = Json.getString(Json.parseObject(response.body()), "key", "");
            if (key.isBlank())
                return;
            License verified = License.verify(key);
            if (verified.status != License.Status.ACTIVE)
                return;
            try {
                Files.writeString(new File(dataDir, "license.key").toPath(), key);
            } catch (Exception e) {
                System.err.println("Sync: could not save pulled licence key: " + e.getMessage());
            }
            store.setLicenseKey(key);
            Main.installPulledLicense(verified);
            System.out.println("Sync: pulled school licence for " + verified.school);
        } catch (Exception e) {
            System.err.println("Sync: could not pull school licence: " + e.getMessage());
        }
    }

    private static String localLicenseKey(Main.DataStore store, File dataDir) {
        String token = License.readToken(dataDir);
        if (token != null && !token.isBlank())
            return token;
        String stored = store.getLicenseKey();
        return (stored == null || stored.isBlank()) ? null : stored.trim();
    }

    // -------------------------------------------------------------- http

    private boolean login() {
        try {
            String body = "{\"email\":" + Json.str(email) + ",\"password\":" + Json.str(password) + "}";
            HttpResponse<String> response = post("/api/login", body, null);
            if (response == null || response.statusCode() != 200) {
                lastError = response == null
                        ? "Could not reach the server"
                        : "Sign-in to the sync server failed (" + response.statusCode() + ")";
                return false;
            }
            token = Json.getString(Json.parseObject(response.body()), "token", null);
            if (token == null) {
                lastError = "Sync server did not return a session";
                return false;
            }
            return true;
        } catch (Exception e) {
            lastError = e.getMessage() == null ? "Sign-in failed" : e.getMessage();
            return false;
        }
    }

    /** Returns null when the server is unreachable — the normal offline case. */
    private HttpResponse<String> post(String path, String body, String bearer) {
        try {
            HttpRequest.Builder builder = HttpRequest.newBuilder()
                    .uri(URI.create(serverUrl + path))
                    .timeout(Duration.ofSeconds(120))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8));
            if (bearer != null)
                builder.header("Authorization", "Bearer " + bearer);
            return http.send(builder.build(), HttpResponse.BodyHandlers.ofString());
        } catch (Exception e) {
            return null;
        }
    }

    private HttpResponse<String> get(String path, String bearer) {
        try {
            HttpRequest.Builder builder = HttpRequest.newBuilder()
                    .uri(URI.create(serverUrl + path))
                    .timeout(Duration.ofSeconds(30))
                    .header("Accept", "application/json")
                    .GET();
            if (bearer != null)
                builder.header("Authorization", "Bearer " + bearer);
            return http.send(builder.build(), HttpResponse.BodyHandlers.ofString());
        } catch (Exception e) {
            return null;
        }
    }
}
