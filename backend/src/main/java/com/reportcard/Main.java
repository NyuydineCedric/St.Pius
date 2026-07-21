package com.reportcard;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import java.io.*;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.sql.*;
import java.util.*;

public class Main {

    // Which storage backend is active for this process. Desktop (Electron)
    // never sets DATABASE_URL, so it always gets FileDataStore — exactly
    // the same serialized-file behavior as before. Render sets
    // DATABASE_URL to the Supabase connection string, so it gets
    // PostgresDataStore instead. Nothing else in this file needs to know
    // or care which one is active.
    private static DataStore store;

    // Cross-origin config — only relevant for the web deployment (Render +
    // Vercel), where frontend and backend live on different domains. In
    // the Electron desktop build, requests are same-origin (both served
    // from http://localhost:8080), so these headers are simply ignored.
    private static final String ALLOWED_ORIGIN = System.getenv().getOrDefault("ALLOWED_ORIGIN", "*");

    private static HttpHandler withCors(HttpHandler handler) {
        return exchange -> {
            exchange.getResponseHeaders().set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
            exchange.getResponseHeaders().set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
            exchange.getResponseHeaders().set("Access-Control-Allow-Headers", "Content-Type");
            exchange.getResponseHeaders().set("Access-Control-Allow-Credentials", "true");
            if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod())) {
                exchange.sendResponseHeaders(204, -1);
                return;
            }
            handler.handle(exchange);
        };
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

        String databaseUrl = System.getenv("DATABASE_URL");
        if (databaseUrl != null && !databaseUrl.isBlank()) {
            store = new PostgresDataStore(databaseUrl);
        } else {
            store = new FileDataStore();
        }
        store.init(dataDir);

        // Electron always spawns this process with no PORT env var set, so
        // the desktop build keeps using 8080 exactly as before. Render sets
        // its own PORT at runtime, which this now respects.
        int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "8080"));
        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);

        server.createContext("/api/health", exchange -> {
            String json = "{\"status\":\"UP\",\"service\":\"report-card-backend\",\"message\":\"Backend is running\"}";
            sendJson(exchange, 200, json);
        });

        server.createContext("/api/login", withCors(new LoginHandler()));
        server.createContext("/api/register", withCors(new RegisterHandler()));
        server.createContext("/api/students", withCors(new StudentsHandler()));
        server.createContext("/api/classes", withCors(new ClassesHandler()));
        server.createContext("/api/classes/master", withCors(new ClassMasterHandler()));
        server.createContext("/api/roster", withCors(new RosterHandler()));
        server.createContext("/api/marks", withCors(new MarksHandler()));
        server.createContext("/api/activities", withCors(new ActivitiesHandler()));
        server.createContext("/api/teachers", withCors(new TeachersHandler()));
        server.createContext("/api/settings", withCors(new SettingsHandler()));

        // Static frontend files (the built React app). Registered last / at
        // root so it acts as the catch-all for anything not matched by an
        // /api/* context above.
        server.createContext("/", new StaticFileHandler(staticDir));

        server.setExecutor(null);
        server.start();

        System.out.println("Report Card backend running on port " + port);
        System.out.println("Storage: " + (databaseUrl != null && !databaseUrl.isBlank()
                ? "PostgreSQL (Supabase)"
                : "Local file (" + new File(dataDir, "backend-data.ser").getAbsolutePath() + ")"));
        System.out.println("Static dir: " + staticDir.getAbsolutePath());
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

    // POST /api/login { "email": "...", "password": "..." }
    // NOTE: passwords are stored and compared in plaintext. Flagged here
    // deliberately — this should be hashed before real institutional use.
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
            if (user == null || !user.password.equals(password)) {
                sendJson(exchange, 401, "{\"error\":\"Invalid email or password\"}");
                return;
            }
            sendJson(exchange, 200, user.toJson());
        }
    }

    // POST /api/register { "name": "...", "email": "...", "password": "...",
    // "role": "admin"|"teacher" }
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
            if (!"admin".equals(role) && !"teacher".equals(role)) {
                role = "teacher";
            }
            if (store.findUserByEmail(email) != null) {
                sendJson(exchange, 409, "{\"error\":\"An account with that email already exists\"}");
                return;
            }

            User user = store.addUser(name, email, password, role);
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
            if ("GET".equalsIgnoreCase(method)) {
                List<Student> list = store.getStudents();
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
                Student s = store.addStudent(
                        obj.getOrDefault("name", ""),
                        obj.getOrDefault("class", obj.getOrDefault("className", "Form 1")),
                        obj.getOrDefault("gender", "Male"),
                        obj.getOrDefault("guardian", "—"),
                        obj.getOrDefault("phone", "—"),
                        obj.getOrDefault("dob", "—"),
                        obj.getOrDefault("option", ""),
                        obj.getOrDefault("electives", ""));
                store.save();
                sendJson(exchange, 201, s.toJson());
                return;
            }
            sendJson(exchange, 405, "{\"error\":\"Method not allowed\"}");
        }
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
                String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                Map<String, String> obj = parseJsonObject(body);
                String name = obj.getOrDefault("name", "New Class");
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
                sb.append(roster.get(i).toJson());
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
                Map<String, Double> marks = store.getMarks(cls, subject, sequence);
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
                int midx = body.indexOf("\"marks\"");
                Map<String, Double> marks = new HashMap<>();
                if (midx >= 0) {
                    int colon = body.indexOf(':', midx);
                    int start = body.indexOf('{', colon);
                    int end = body.indexOf('}', start);
                    if (start > 0 && end > start) {
                        String inner = body.substring(start + 1, end);
                        for (String p : inner.split(",")) {
                            int idx = p.indexOf(':');
                            if (idx > 0) {
                                String k = stripQuotes(p.substring(0, idx).trim());
                                String v = p.substring(idx + 1).trim();
                                try {
                                    marks.put(k, Double.parseDouble(v));
                                } catch (Exception ex) {
                                }
                            }
                        }
                    }
                }
                store.saveMarks(cls, subject, sequence, marks);
                store.save();
                sendJson(exchange, 200, "{\"status\":\"ok\"}");
                return;
            }
            sendJson(exchange, 405, "{\"error\":\"Method not allowed\"}");
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
                store.deleteTeacher(teacherId);
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

    // Data classes — shared by both storage backends.
    static class Student implements Serializable {
        private static final long serialVersionUID = 1L;
        String id, name, className, gender, guardian, phone, dob, option, electives, status;

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
        }

        String toJson() {
            return String.format(Locale.ROOT,
                    "{\"id\":\"%s\",\"name\":\"%s\",\"class\":\"%s\",\"gender\":\"%s\",\"guardian\":\"%s\",\"phone\":\"%s\",\"dob\":\"%s\",\"option\":\"%s\",\"electives\":\"%s\",\"status\":\"%s\"}",
                    escape(id), escape(name), escape(className), escape(gender), escape(guardian), escape(phone),
                    escape(dob), escape(option), escape(electives), escape(status));
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

        String toJson() {
            return String.format(Locale.ROOT,
                    "{\"schoolName\":\"%s\",\"schoolCode\":\"%s\",\"region\":\"%s\",\"schoolTown\":\"%s\",\"regionalDelegation\":\"%s\",\"subDivision\":\"%s\",\"motto\":\"%s\",\"currentTerm\":\"%s\",\"currentSequence\":\"%s\",\"academicYear\":\"%s\",\"marksScale\":\"%s\",\"emailNotif\":%b,\"autoLock\":%b,\"publicResults\":%b}",
                    escape(schoolName), escape(schoolCode), escape(region), escape(schoolTown),
                    escape(regionalDelegation), escape(subDivision), escape(motto),
                    escape(currentTerm), escape(currentSequence), escape(academicYear), escape(marksScale),
                    emailNotif, autoLock, publicResults);
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
                String phone, String dob, String option, String electives);

        List<Student> getStudents();

        List<Student> getStudentsByClass(String className);

        List<ClassInfo> getClasses();

        ClassInfo addClass(String name);

        ClassInfo setClassMaster(String className, String teacherId);

        void saveMarks(String cls, String subject, String sequence, Map<String, Double> m);

        Map<String, Double> getMarks(String cls, String subject, String sequence);

        Teacher addTeacher(String name, String email, String phone);

        List<Teacher> getTeachers();

        boolean addAssignment(String teacherId, String className, String subject);

        void removeAssignment(String teacherId, String className, String subject);

        void deleteTeacher(String teacherId);

        User findUserByEmail(String email);

        User addUser(String name, String email, String password, String role);

        SchoolSettings getSettings();

        SchoolSettings updateSettings(Map<String, String> fields);
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
        private final Map<String, Map<String, Map<String, Map<String, Double>>>> marks = new HashMap<>();
        private File dataFile;

        @Override
        public synchronized void init(File dataDir) {
            this.dataFile = new File(dataDir, "backend-data.ser");
            load();
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
                    Object ac = m.get("activities");
                    Object tc = m.get("teachers");
                    Object us = m.get("users");
                    Object st = m.get("settings");
                    students.clear();
                    classes.clear();
                    marks.clear();
                    activities.clear();
                    teachers.clear();
                    users.clear();
                    if (s instanceof List)
                        students.addAll((List<Student>) s);
                    if (c instanceof List)
                        classes.addAll((List<ClassInfo>) c);
                    if (mk instanceof Map)
                        marks.putAll((Map) mk);
                    if (ac instanceof List)
                        activities.addAll((List<ActivityEntry>) ac);
                    if (tc instanceof List)
                        teachers.addAll((List<Teacher>) tc);
                    if (us instanceof List)
                        users.addAll((List<User>) us);
                    if (st instanceof SchoolSettings)
                        settings = (SchoolSettings) st;
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
                }
            } catch (Exception ex) {
                System.err.println("Failed to load datastore: " + ex.getMessage());
            }
        }

        @Override
        public synchronized void save() {
            try (ObjectOutputStream oos = new ObjectOutputStream(new FileOutputStream(dataFile))) {
                Map<String, Object> m = new HashMap<>();
                m.put("students", new ArrayList<>(students));
                m.put("classes", new ArrayList<>(classes));
                m.put("marks", new HashMap<>(marks));
                m.put("activities", new ArrayList<>(activities));
                m.put("teachers", new ArrayList<>(teachers));
                m.put("users", new ArrayList<>(users));
                m.put("settings", settings);
                oos.writeObject(m);
            } catch (Exception ex) {
                System.err.println("Failed to save datastore: " + ex.getMessage());
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

        @Override
        public synchronized Student addStudent(String name, String className, String gender, String guardian,
                String phone, String dob, String option, String electives) {
            String id = String.format("NCY-%04d", students.size() + 1);
            Student s = new Student(id, name, className, gender, guardian, phone, dob, option, electives);
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
        public synchronized List<Student> getStudents() {
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
        public synchronized void saveMarks(String cls, String subject, String sequence, Map<String, Double> m) {
            Map<String, Double> existing = marks
                    .computeIfAbsent(cls, k -> new HashMap<>())
                    .computeIfAbsent(subject, k -> new HashMap<>())
                    .computeIfAbsent(sequence, k -> new HashMap<>());
            existing.putAll(m);
            logActivity("Marks", "Marks entered — " + cls + ", " + subject + ", " + sequence);
        }

        @Override
        public synchronized Map<String, Double> getMarks(String cls, String subject, String sequence) {
            return marks.getOrDefault(cls, Collections.emptyMap()).getOrDefault(subject, Collections.emptyMap())
                    .getOrDefault(sequence, Collections.emptyMap());
        }

        @Override
        public synchronized Teacher addTeacher(String name, String email, String phone) {
            String id = String.format("TCH-%04d", teachers.size() + 1);
            Teacher t = new Teacher(id, name, email, phone);
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
            String id = String.format("USR-%04d", users.size() + 1);
            User u = new User(id, name, email, password, role);
            users.add(u);
            logActivity("Account", "New " + role + " account registered — " + name);
            return u;
        }

        @Override
        public synchronized SchoolSettings getSettings() {
            return settings;
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
            if (fields.containsKey("academicYear"))
                settings.academicYear = fields.get("academicYear");
            if (fields.containsKey("marksScale"))
                settings.marksScale = fields.get("marksScale");
            if (fields.containsKey("emailNotif"))
                settings.emailNotif = Boolean.parseBoolean(fields.get("emailNotif"));
            if (fields.containsKey("autoLock"))
                settings.autoLock = Boolean.parseBoolean(fields.get("autoLock"));
            if (fields.containsKey("publicResults"))
                settings.publicResults = Boolean.parseBoolean(fields.get("publicResults"));
            return settings;
        }
    }

    // Supabase (Postgres) backed storage. Used only when DATABASE_URL is
    // set (i.e. only on Render). Every method opens its own short-lived
    // connection — traffic here is low and the HttpServer processes one
    // request at a time by default, so a connection pool isn't needed.
    static class PostgresDataStore implements DataStore {
        private final String url;

        static {
            try {
                Class.forName("org.postgresql.Driver");
            } catch (ClassNotFoundException e) {
                throw new RuntimeException(
                        "PostgreSQL JDBC driver not found on classpath. Check the Dockerfile's -cp flag.", e);
            }
        }

        PostgresDataStore(String url) {
            // JDBC needs the "jdbc:" prefix; Supabase gives you a plain
            // "postgresql://" string, so add it if it's missing.
            this.url = url.startsWith("jdbc:") ? url : "jdbc:" + url;
        }

        private Connection connect() throws SQLException {
            return DriverManager.getConnection(url);
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
                        status TEXT DEFAULT 'Active'
                    );
                    CREATE TABLE IF NOT EXISTS marks (
                        class_name TEXT NOT NULL,
                        subject TEXT NOT NULL,
                        sequence TEXT NOT NULL,
                        student_id TEXT NOT NULL,
                        score DOUBLE PRECISION NOT NULL,
                        PRIMARY KEY (class_name, subject, sequence, student_id)
                    );
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
                        public_results BOOLEAN DEFAULT FALSE
                    );
                    CREATE TABLE IF NOT EXISTS keep_alive (
                        id INT PRIMARY KEY DEFAULT 1,
                        pinged_at TIMESTAMPTZ DEFAULT now()
                    );
                    INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
                    INSERT INTO keep_alive (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
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

        @Override
        public Student addStudent(String name, String className, String gender, String guardian,
                String phone, String dob, String option, String electives) {
            try (Connection c = connect()) {
                String id;
                try (Statement st = c.createStatement();
                        ResultSet rs = st.executeQuery("SELECT COUNT(*) FROM students")) {
                    rs.next();
                    id = String.format("NCY-%04d", rs.getInt(1) + 1);
                }

                try (PreparedStatement ps = c.prepareStatement(
                        "INSERT INTO students (id, name, class_name, gender, guardian, phone, dob, option_name, electives, status) "
                                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active')")) {
                    ps.setString(1, id);
                    ps.setString(2, name);
                    ps.setString(3, className);
                    ps.setString(4, gender);
                    ps.setString(5, guardian);
                    ps.setString(6, phone);
                    ps.setString(7, dob);
                    ps.setString(8, option);
                    ps.setString(9, electives);
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

                Student s = new Student(id, name, className, gender, guardian, phone, dob, option, electives);
                logActivity("Student", "New student enrolled — " + name + " (" + className + ")");
                return s;
            } catch (SQLException e) {
                throw new RuntimeException("addStudent failed: " + e.getMessage(), e);
            }
        }

        private Student mapStudent(ResultSet rs) throws SQLException {
            Student s = new Student(rs.getString("id"), rs.getString("name"), rs.getString("class_name"),
                    rs.getString("gender"), rs.getString("guardian"), rs.getString("phone"), rs.getString("dob"),
                    rs.getString("option_name"), rs.getString("electives"));
            s.status = rs.getString("status");
            return s;
        }

        @Override
        public List<Student> getStudents() {
            List<Student> out = new ArrayList<>();
            try (Connection c = connect();
                    Statement st = c.createStatement();
                    ResultSet rs = st.executeQuery("SELECT * FROM students ORDER BY id")) {
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
                            "SELECT * FROM students WHERE class_name = ? ORDER BY id")) {
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
        public ClassInfo addClass(String name) {
            try (Connection c = connect();
                    PreparedStatement ps = c.prepareStatement(
                            "INSERT INTO classes (name) VALUES (?) ON CONFLICT DO NOTHING")) {
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
        public void saveMarks(String cls, String subject, String sequence, Map<String, Double> m) {
            try (Connection c = connect();
                    PreparedStatement ps = c.prepareStatement(
                            "INSERT INTO marks (class_name, subject, sequence, student_id, score) VALUES (?, ?, ?, ?, ?) "
                                    + "ON CONFLICT (class_name, subject, sequence, student_id) DO UPDATE SET score = EXCLUDED.score")) {
                for (Map.Entry<String, Double> e : m.entrySet()) {
                    ps.setString(1, cls);
                    ps.setString(2, subject);
                    ps.setString(3, sequence);
                    ps.setString(4, e.getKey());
                    ps.setDouble(5, e.getValue());
                    ps.addBatch();
                }
                ps.executeBatch();
                logActivity("Marks", "Marks entered — " + cls + ", " + subject + ", " + sequence);
            } catch (SQLException e) {
                throw new RuntimeException("saveMarks failed: " + e.getMessage(), e);
            }
        }

        @Override
        public Map<String, Double> getMarks(String cls, String subject, String sequence) {
            Map<String, Double> out = new HashMap<>();
            try (Connection c = connect();
                    PreparedStatement ps = c.prepareStatement(
                            "SELECT student_id, score FROM marks WHERE class_name = ? AND subject = ? AND sequence = ?")) {
                ps.setString(1, cls);
                ps.setString(2, subject);
                ps.setString(3, sequence);
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
        public Teacher addTeacher(String name, String email, String phone) {
            try (Connection c = connect()) {
                String id;
                try (Statement st = c.createStatement();
                        ResultSet rs = st.executeQuery("SELECT COUNT(*) FROM teachers")) {
                    rs.next();
                    id = String.format("TCH-%04d", rs.getInt(1) + 1);
                }
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
                System.err.println("findUserByEmail failed: " + e.getMessage());
            }
            return null;
        }

        @Override
        public User addUser(String name, String email, String password, String role) {
            try (Connection c = connect()) {
                String id;
                try (Statement st = c.createStatement();
                        ResultSet rs = st.executeQuery("SELECT COUNT(*) FROM users")) {
                    rs.next();
                    id = String.format("USR-%04d", rs.getInt(1) + 1);
                }
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
                }
            } catch (SQLException e) {
                System.err.println("getSettings failed: " + e.getMessage());
            }
            return s;
        }

        @Override
        public SchoolSettings updateSettings(Map<String, String> fields) {
            SchoolSettings s = getSettings();
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

            try (Connection c = connect();
                    PreparedStatement ps = c.prepareStatement(
                            "UPDATE settings SET school_name=?, school_code=?, region=?, school_town=?, "
                                    + "regional_delegation=?, sub_division=?, motto=?, current_term=?, current_sequence=?, "
                                    + "academic_year=?, marks_scale=?, email_notif=?, auto_lock=?, public_results=? WHERE id = 1")) {
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
                ps.executeUpdate();
            } catch (SQLException e) {
                throw new RuntimeException("updateSettings failed: " + e.getMessage(), e);
            }
            return s;
        }
    }
}