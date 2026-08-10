package com.reportcard;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.reportcard.Main.ActivityEntry;
import com.reportcard.Main.Assignment;
import com.reportcard.Main.ClassInfo;
import com.reportcard.Main.DataStore;
import com.reportcard.Main.MarkRow;
import com.reportcard.Main.SchoolSettings;
import com.reportcard.Main.Student;
import com.reportcard.Main.Teacher;
import com.reportcard.Main.User;

/**
 * Whole-database export and import, in plain JSON.
 *
 * This replaces the previous backup path, which streamed the raw
 * {@code backend-data.ser} file and restored it with
 * {@code ObjectInputStream.readObject()}. That had two problems:
 *
 * <ul>
 * <li>Restoring deserialized a user-supplied file into live Java objects — a
 * well-known remote-code-execution vector. Being admin-only narrowed who could
 * trigger it but did not make it safe, since an admin can be talked into
 * restoring a file someone emailed them.</li>
 * <li>It only worked on file storage. In cloud (Postgres) mode there was no
 * local file, so backup returned an error — leaving the one configuration with
 * no automatic database backups (Supabase free tier) with no backup at all.</li>
 * </ul>
 *
 * Everything here goes through the {@link DataStore} interface, so one
 * implementation serves both the desktop file store and Postgres.
 */
final class Backup {

    /** Marker so we can reject files that aren't ours before touching data. */
    static final String FORMAT = "report-card-backup";
    static final int VERSION = 1;

    private Backup() {
    }

    /** Raised for a file that parses as JSON but isn't a usable backup. */
    static final class InvalidBackupException extends RuntimeException {
        InvalidBackupException(String message) {
            super(message);
        }
    }

    // ---------------------------------------------------------------- export

    static String export(DataStore store, String exportedAt) {
        StringBuilder sb = new StringBuilder(1 << 16);
        sb.append("{\"format\":").append(Json.str(FORMAT))
                .append(",\"version\":").append(VERSION)
                .append(",\"exportedAt\":").append(Json.str(exportedAt));

        SchoolSettings s = store.getSettings();
        sb.append(",\"settings\":").append(s == null ? "{}" : s.toJson());

        sb.append(",\"classes\":[");
        List<ClassInfo> classes = store.getClasses();
        for (int i = 0; i < classes.size(); i++) {
            ClassInfo c = classes.get(i);
            if (i > 0)
                sb.append(',');
            sb.append("{\"name\":").append(Json.str(c.name))
                    .append(",\"teacher\":").append(Json.str(c.teacher))
                    .append(",\"average\":").append(c.average == null ? "null" : c.average)
                    .append(",\"students\":").append(c.students)
                    .append(",\"classMasterId\":").append(Json.str(c.classMasterId))
                    .append('}');
        }
        sb.append(']');

        sb.append(",\"teachers\":[");
        List<Teacher> teachers = store.getTeachers();
        for (int i = 0; i < teachers.size(); i++) {
            Teacher t = teachers.get(i);
            if (i > 0)
                sb.append(',');
            sb.append("{\"id\":").append(Json.str(t.id))
                    .append(",\"name\":").append(Json.str(t.name))
                    .append(",\"email\":").append(Json.str(t.email))
                    .append(",\"phone\":").append(Json.str(t.phone))
                    .append(",\"assignments\":[");
            List<Assignment> as = t.assignments == null ? new ArrayList<>() : t.assignments;
            for (int j = 0; j < as.size(); j++) {
                if (j > 0)
                    sb.append(',');
                sb.append("{\"className\":").append(Json.str(as.get(j).className))
                        .append(",\"subject\":").append(Json.str(as.get(j).subject))
                        .append('}');
            }
            sb.append("]}");
        }
        sb.append(']');

        sb.append(",\"students\":[");
        List<Student> students = store.getStudents();
        for (int i = 0; i < students.size(); i++) {
            if (i > 0)
                sb.append(',');
            sb.append(students.get(i).toJson());
        }
        sb.append(']');

        // Password hashes are included deliberately: a backup restored onto a
        // fresh machine must still let the school log in. They are PBKDF2
        // digests, not recoverable passwords — but this is why the download is
        // admin-only and why the file should be kept somewhere private.
        sb.append(",\"users\":[");
        List<User> users = store.getUsers();
        for (int i = 0; i < users.size(); i++) {
            User u = users.get(i);
            if (i > 0)
                sb.append(',');
            sb.append("{\"id\":").append(Json.str(u.id))
                    .append(",\"name\":").append(Json.str(u.name))
                    .append(",\"email\":").append(Json.str(u.email))
                    .append(",\"password\":").append(Json.str(u.password))
                    .append(",\"role\":").append(Json.str(u.role))
                    .append('}');
        }
        sb.append(']');

        sb.append(",\"marks\":[");
        List<MarkRow> marks = store.getAllMarks();
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
                    .append('}');
        }
        sb.append(']');

        sb.append(",\"activities\":[");
        List<ActivityEntry> activities = store.getActivities();
        for (int i = 0; i < activities.size(); i++) {
            ActivityEntry a = activities.get(i);
            if (i > 0)
                sb.append(',');
            sb.append("{\"type\":").append(Json.str(a.type))
                    .append(",\"text\":").append(Json.str(a.text))
                    .append(",\"timestamp\":").append(a.timestamp)
                    .append('}');
        }
        sb.append(']');

        return sb.append('}').toString();
    }

    // ---------------------------------------------------------------- import

    /**
     * Validates a backup without applying it. Returns a short human-readable
     * summary of what it contains, so the caller can log or show it.
     * Throws {@link Json.ParseException} or {@link InvalidBackupException}
     * before anything on disk is touched.
     */
    static String describe(Map<String, Object> root) {
        if (!FORMAT.equals(Json.getString(root, "format", null)))
            throw new InvalidBackupException("That file isn't a report card backup");
        double version = Json.getDouble(root, "version", -1);
        if (version < 1 || version > VERSION)
            throw new InvalidBackupException("Backup version " + (int) version
                    + " isn't supported by this version of the app");

        int students = Json.getObjectList(root, "students").size();
        int marks = Json.getObjectList(root, "marks").size();
        int teachers = Json.getObjectList(root, "teachers").size();
        if (students == 0 && marks == 0 && teachers == 0)
            throw new InvalidBackupException("That backup is empty — nothing to restore");

        return students + " students, " + marks + " marks, " + teachers + " staff";
    }

    /**
     * Replaces everything in the store with the contents of the backup.
     *
     * Call {@link #describe} first — this assumes the structure is already
     * validated, so a failure part-way leaves the store half-written.
     */
    static void apply(DataStore store, Map<String, Object> root) {
        store.wipeAcademicData();

        // Settings must land before teachers. updateSettings() clears every
        // teacher's assignments when academicYear changes, so restoring staff
        // first would silently drop all their class/subject assignments.
        Map<String, Object> settings = Json.getObject(root, "settings");
        if (settings != null)
            store.updateSettings(settingsToStringMap(settings));

        for (Map<String, Object> c : Json.getObjectList(root, "classes")) {
            String name = Json.getString(c, "name", "");
            if (name.isBlank())
                continue;
            store.addClass(name);
            String masterId = Json.getString(c, "classMasterId", "");
            if (!masterId.isBlank())
                store.setClassMaster(name, masterId);
        }

        for (Map<String, Object> t : Json.getObjectList(root, "teachers")) {
            String id = Json.getString(t, "id", "");
            if (id.isBlank())
                continue;
            Teacher teacher = new Teacher(id, Json.getString(t, "name", ""),
                    Json.getString(t, "email", ""), Json.getString(t, "phone", ""));
            for (Map<String, Object> a : Json.getObjectList(t, "assignments")) {
                teacher.assignments.add(new Assignment(
                        Json.getString(a, "className", ""), Json.getString(a, "subject", "")));
            }
            store.restoreTeacher(teacher);
        }

        for (Map<String, Object> s : Json.getObjectList(root, "students")) {
            String id = Json.getString(s, "id", "");
            if (id.isBlank())
                continue;
            // IDs are preserved rather than regenerated: marks reference the
            // student ID, so renumbering on restore would detach every score
            // from the student who earned it.
            Student student = new Student(id,
                    Json.getString(s, "name", ""),
                    // Exports write "class"; accept "className" too so a file
                    // hand-edited by an admin still restores.
                    Json.getString(s, "class", Json.getString(s, "className", "")),
                    Json.getString(s, "gender", ""),
                    Json.getString(s, "guardian", ""),
                    Json.getString(s, "phone", ""),
                    Json.getString(s, "dob", ""),
                    Json.getString(s, "option", ""),
                    Json.getString(s, "electives", ""));
            // Keep the number the school knows this pupil by; without this a
            // restore would renumber every student on their report cards.
            student.code = Json.getString(s, "code", id);
            student.status = Json.getString(s, "status", "Active");
            student.photo = Json.getString(s, "photo", "");
            student.admittedOn = Json.getString(s, "admittedOn", "");
            store.restoreStudent(student);
        }

        for (Map<String, Object> u : Json.getObjectList(root, "users")) {
            String email = Json.getString(u, "email", "");
            String password = Json.getString(u, "password", "");
            if (email.isBlank() || password.isBlank())
                continue;
            String role = Json.getString(u, "role", "teacher");
            if (!"admin".equals(role) && !"teacher".equals(role))
                role = "teacher";
            store.restoreUser(new User(Json.getString(u, "id", ""),
                    Json.getString(u, "name", ""), email, password, role));
        }

        // Group marks per (year, class, subject, sequence) so each group is one
        // saveMarks call — the Postgres store opens a transaction per call, so
        // one call per mark would mean thousands of round trips.
        Map<String, Map<String, Double>> grouped = new LinkedHashMap<>();
        List<String[]> groupKeys = new ArrayList<>();
        for (Map<String, Object> m : Json.getObjectList(root, "marks")) {
            String year = Json.getString(m, "academicYear", "");
            String cls = Json.getString(m, "className", Json.getString(m, "class", ""));
            String subject = Json.getString(m, "subject", "");
            String sequence = Json.getString(m, "sequence", "");
            String studentId = Json.getString(m, "studentId", "");
            if (cls.isBlank() || subject.isBlank() || sequence.isBlank() || studentId.isBlank())
                continue;
            String key = year + ' ' + cls + ' ' + subject + ' ' + sequence;
            if (!grouped.containsKey(key)) {
                grouped.put(key, new LinkedHashMap<>());
                groupKeys.add(new String[] { year, cls, subject, sequence });
            }
            grouped.get(key).put(studentId, Json.getDouble(m, "score", 0));
        }
        for (String[] k : groupKeys) {
            String key = k[0] + ' ' + k[1] + ' ' + k[2] + ' ' + k[3];
            store.saveMarks(k[0], k[1], k[2], k[3], grouped.get(key), java.util.Set.of());
        }

        store.save();
    }

    /**
     * Flattens the settings object into the string map updateSettings expects.
     * Booleans and numbers are stringified, since that method parses them back
     * out of strings.
     */
    private static Map<String, String> settingsToStringMap(Map<String, Object> settings) {
        Map<String, String> out = new LinkedHashMap<>();
        for (Map.Entry<String, Object> e : settings.entrySet()) {
            Object v = e.getValue();
            if (v instanceof String)
                out.put(e.getKey(), (String) v);
            else if (v instanceof Boolean)
                out.put(e.getKey(), v.toString());
            else if (v instanceof Double)
                out.put(e.getKey(), trimNumber((Double) v));
        }
        return out;
    }

    /** 50.0 -> "50", so settings that are numeric strings round-trip cleanly. */
    private static String trimNumber(double d) {
        if (d == Math.floor(d) && !Double.isInfinite(d))
            return Long.toString((long) d);
        return Double.toString(d);
    }
}
