package com.reportcard;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import java.io.*;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;

public class Main {
    // Non-final so main() can point it at the per-user data directory
    // passed in via args[0]. Falls back to the current working directory
    // if no args are given (e.g. running Main.java directly for testing).
    private static File DATA_FILE = new File("backend-data.ser");

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
            if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod())) {
                exchange.sendResponseHeaders(204, -1);
                return;
            }
            handler.handle(exchange);
        };
    }

    public static void main(String[] args) throws IOException {
        // args[0] = writable per-user data directory (e.g. Electron's
        // app.getPath("userData")). When no args are passed (e.g. running
        // as a plain web service on Render), falls back to the DATA_DIR
        // env var, then finally the current working directory.
        // args[1] = static frontend files directory (e.g. dist/ copied into
        // backend/.../public)
        File dataDir = args.length > 0
                ? new File(args[0])
                : new File(System.getenv().getOrDefault("DATA_DIR", "."));
        File staticDir = args.length > 1 ? new File(args[1]) : new File("public");

        if (!dataDir.exists()) {
            dataDir.mkdirs();
        }

        DATA_FILE = new File(dataDir, "backend-data.ser");
        DataStore.load(DATA_FILE);

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
        System.out.println("Data file: " + DATA_FILE.getAbsolutePath());
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
    // NOTE: passwords are stored and compared in plaintext (see
    // DataStore.User / DataStore.addUser). Acceptable for a local,
    // single-school deployment with no internet exposure, but flagged
    // here deliberately rather than left as a silent assumption.
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

            User user = DataStore.findUserByEmail(email);
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
            if (DataStore.findUserByEmail(email) != null) {
                sendJson(exchange, 409, "{\"error\":\"An account with that email already exists\"}");
                return;
            }

            User user = DataStore.addUser(name, email, password, role);
            DataStore.save(DATA_FILE);
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
                List<Student> list = DataStore.getStudents();
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
                Student s = DataStore.addStudent(
                        obj.getOrDefault("name", ""),
                        obj.getOrDefault("class", obj.getOrDefault("className", "Form 1")),
                        obj.getOrDefault("gender", "Male"),
                        obj.getOrDefault("guardian", "—"),
                        obj.getOrDefault("phone", "—"),
                        obj.getOrDefault("dob", "—"),
                        obj.getOrDefault("option", ""),
                        obj.getOrDefault("electives", ""));
                DataStore.save(DATA_FILE);
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
                List<ClassInfo> classes = DataStore.getClasses();
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
                ClassInfo c = DataStore.addClass(name);
                DataStore.save(DATA_FILE);
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
            ClassInfo updated = DataStore.setClassMaster(className, teacherId);
            if (updated == null) {
                sendJson(exchange, 404, "{\"error\":\"Class or teacher not found\"}");
                return;
            }
            DataStore.save(DATA_FILE);
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
            List<Student> roster = DataStore.getStudentsByClass(className);
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
                Map<String, Double> marks = DataStore.getMarks(cls, subject, sequence);
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
                DataStore.saveMarks(cls, subject, sequence, marks);
                DataStore.save(DATA_FILE);
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
                List<ActivityEntry> list = DataStore.getActivities();
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
                DataStore.logActivity(type, text);
                DataStore.save(DATA_FILE);
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
                List<Teacher> list = DataStore.getTeachers();
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
                Teacher t = DataStore.addTeacher(
                        obj.getOrDefault("name", ""),
                        obj.getOrDefault("email", "—"),
                        obj.getOrDefault("phone", "—"));
                DataStore.save(DATA_FILE);
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
                    boolean ok = DataStore.addAssignment(teacherId, cls, subject);
                    if (!ok) {
                        sendJson(exchange, 404, "{\"error\":\"Teacher not found\"}");
                        return;
                    }
                    DataStore.save(DATA_FILE);
                    sendJson(exchange, 201, "{\"status\":\"ok\"}");
                    return;
                }
                if ("DELETE".equalsIgnoreCase(method)) {
                    Map<String, String> q = queryParams(exchange);
                    String cls = q.getOrDefault("class", "");
                    String subject = q.getOrDefault("subject", "");
                    DataStore.removeAssignment(teacherId, cls, subject);
                    DataStore.save(DATA_FILE);
                    sendJson(exchange, 200, "{\"status\":\"ok\"}");
                    return;
                }
            }

            if (parts.length == 4 && "DELETE".equalsIgnoreCase(method)) {
                String teacherId = parts[3];
                DataStore.deleteTeacher(teacherId);
                DataStore.save(DATA_FILE);
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
                sendJson(exchange, 200, DataStore.getSettings().toJson());
                return;
            }
            if ("POST".equalsIgnoreCase(method)) {
                String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                Map<String, String> obj = parseJsonObject(body);
                SchoolSettings updated = DataStore.updateSettings(obj);
                DataStore.save(DATA_FILE);
                sendJson(exchange, 200, updated.toJson());
                return;
            }
            sendJson(exchange, 405, "{\"error\":\"Method not allowed\"}");
        }
    }

    // Data classes & store
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

    static class DataStore {
        private static final List<Student> students = new ArrayList<>();
        private static final List<ClassInfo> classes = new ArrayList<>();
        private static final List<ActivityEntry> activities = new ArrayList<>();
        private static final List<Teacher> teachers = new ArrayList<>();
        private static final List<User> users = new ArrayList<>();
        private static SchoolSettings settings = new SchoolSettings();
        private static final Map<String, Map<String, Map<String, Map<String, Double>>>> marks = new HashMap<>();

        static synchronized void load(File f) {
            if (!f.exists()) {
                for (String n : Arrays.asList("Form 1", "Form 2", "Form 3", "Form 4", "Form 5", "Lower Sixth",
                        "Upper Sixth"))
                    classes.add(new ClassInfo(n));
                return;
            }
            try (ObjectInputStream ois = new ObjectInputStream(new FileInputStream(f))) {
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

        static synchronized void save(File f) {
            try (ObjectOutputStream oos = new ObjectOutputStream(new FileOutputStream(f))) {
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

        static synchronized void logActivity(String type, String text) {
            activities.add(0, new ActivityEntry(type, text, System.currentTimeMillis()));
            while (activities.size() > 200) {
                activities.remove(activities.size() - 1);
            }
        }

        static synchronized List<ActivityEntry> getActivities() {
            return new ArrayList<>(activities);
        }

        static synchronized Student addStudent(String name, String className, String gender, String guardian,
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

        static synchronized List<Student> getStudents() {
            return new ArrayList<>(students);
        }

        static synchronized List<Student> getStudentsByClass(String className) {
            if (className == null || className.isEmpty())
                return new ArrayList<>(students);
            List<Student> out = new ArrayList<>();
            for (Student s : students)
                if (className.equals(s.className))
                    out.add(s);
            return out;
        }

        static synchronized List<ClassInfo> getClasses() {
            return new ArrayList<>(classes);
        }

        static synchronized ClassInfo addClass(String name) {
            ClassInfo c = new ClassInfo(name);
            classes.add(c);
            logActivity("Class", "New class added — " + name);
            return c;
        }

        static synchronized ClassInfo setClassMaster(String className, String teacherId) {
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

        static synchronized void saveMarks(String cls, String subject, String sequence, Map<String, Double> m) {
            Map<String, Double> existing = marks
                    .computeIfAbsent(cls, k -> new HashMap<>())
                    .computeIfAbsent(subject, k -> new HashMap<>())
                    .computeIfAbsent(sequence, k -> new HashMap<>());
            existing.putAll(m);
            logActivity("Marks", "Marks entered — " + cls + ", " + subject + ", " + sequence);
        }

        static synchronized Map<String, Double> getMarks(String cls, String subject, String sequence) {
            return marks.getOrDefault(cls, Collections.emptyMap()).getOrDefault(subject, Collections.emptyMap())
                    .getOrDefault(sequence, Collections.emptyMap());
        }

        static synchronized Teacher addTeacher(String name, String email, String phone) {
            String id = String.format("TCH-%04d", teachers.size() + 1);
            Teacher t = new Teacher(id, name, email, phone);
            teachers.add(t);
            logActivity("Staff", "New teacher added — " + name);
            return t;
        }

        static synchronized List<Teacher> getTeachers() {
            return new ArrayList<>(teachers);
        }

        static synchronized boolean addAssignment(String teacherId, String className, String subject) {
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

        static synchronized void removeAssignment(String teacherId, String className, String subject) {
            for (Teacher t : teachers) {
                if (t.id.equals(teacherId)) {
                    t.assignments.removeIf(a -> a.className.equals(className) && a.subject.equals(subject));
                    return;
                }
            }
        }

        static synchronized void deleteTeacher(String teacherId) {
            teachers.removeIf(t -> t.id.equals(teacherId));
            // Clear any class-master assignments pointing at the removed teacher.
            for (ClassInfo c : classes) {
                if (teacherId.equals(c.classMasterId)) {
                    c.classMasterId = null;
                    c.teacher = "Unassigned";
                }
            }
        }

        static synchronized User findUserByEmail(String email) {
            if (email == null)
                return null;
            for (User u : users) {
                if (u.email.equalsIgnoreCase(email)) {
                    return u;
                }
            }
            return null;
        }

        static synchronized User addUser(String name, String email, String password, String role) {
            String id = String.format("USR-%04d", users.size() + 1);
            User u = new User(id, name, email, password, role);
            users.add(u);
            logActivity("Account", "New " + role + " account registered — " + name);
            return u;
        }

        static synchronized SchoolSettings getSettings() {
            return settings;
        }

        static synchronized SchoolSettings updateSettings(Map<String, String> fields) {
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
}