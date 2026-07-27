package com.reportcard;

import java.util.*;

/**
 * Loads a realistic Anglophone Cameroon secondary-school demo dataset
 * (GBHS Bamenda) for walkthroughs and screenshots.
 *
 * Invoked via POST /api/demo/seed (see Main.DemoSeedHandler).
 */
final class DemoSeed {

    static final String ADMIN_EMAIL = "admin@gbhs-demo.cm";
    static final String ADMIN_PASSWORD = "DemoAdmin123!";
    static final String TEACHER_EMAIL = "teacher@gbhs-demo.cm";
    static final String TEACHER_PASSWORD = "DemoTeacher123!";

    private static final String[] SEQUENCES = {
            "Sequence 1", "Sequence 2", "Sequence 3", "Sequence 4",
            "Sequence 5", "Sequence 6"
    };

    private static final String[] JUNIOR_SUBJECTS = {
            "English Language", "French Language", "Citizenship", "Sports",
            "Mathematics", "Physics", "Chemistry", "Biology", "Computer Science",
            "Literature in English", "History", "Geography",
            "Manual Labour", "Food and Nutrition", "Sound and Word Building"
    };

    private static final String[] SCIENCE_OLEVEL = {
            "English Language", "French Language", "Citizenship", "Sports",
            "Mathematics", "Physics", "Chemistry", "Biology", "Computer Science"
    };

    private static final String[] ARTS_OLEVEL = {
            "English Language", "French Language", "Citizenship", "Sports",
            "Literature in English", "History", "Geography", "Mathematics"
    };

    private DemoSeed() {
    }

    static Map<String, Object> run(Main.DataStore store) {
        store.wipeAcademicData();

        Map<String, String> settings = new LinkedHashMap<>();
        settings.put("schoolName", "Government Bilingual High School Bamenda");
        settings.put("schoolCode", "GBHS-BDA");
        settings.put("region", "North-West");
        settings.put("schoolTown", "Bamenda");
        settings.put("regionalDelegation", "North-West Regional Delegation of Secondary Education");
        settings.put("subDivision", "Bamenda I");
        settings.put("motto", "Knowledge is Light");
        settings.put("currentTerm", "Second Term");
        settings.put("currentSequence", "Sequence 4");
        settings.put("academicYear", "2025 – 2026");
        settings.put("marksScale", "20");
        store.updateSettings(settings);

        store.ensureUser("Mr. Nfor Divine", ADMIN_EMAIL, Main.Passwords.hash(ADMIN_PASSWORD), "admin");
        store.ensureUser("Mrs. Ekema Grace", TEACHER_EMAIL, Main.Passwords.hash(TEACHER_PASSWORD), "teacher");

        String[] classNames = {
                "Form 1A", "Form 1B", "Form 2A", "Form 3A",
                "Form 4A", "Form 4B", "Form 5A",
                "Lower Sixth", "Upper Sixth"
        };
        for (String name : classNames) {
            store.addClass(name);
        }

        Main.Teacher english = store.addTeacher("Mrs. Ekema Grace", TEACHER_EMAIL, "677 100 201");
        Main.Teacher maths = store.addTeacher("Mr. Tanyi John", "j.tanyi@gbhs-demo.cm", "677 100 202");
        Main.Teacher french = store.addTeacher("Mme. Fotso Claire", "c.fotso@gbhs-demo.cm", "677 100 203");
        Main.Teacher physics = store.addTeacher("Mr. Ngwa Peter", "p.ngwa@gbhs-demo.cm", "677 100 204");
        Main.Teacher arts = store.addTeacher("Mrs. Awah Mary", "m.awah@gbhs-demo.cm", "677 100 205");
        Main.Teacher bio = store.addTeacher("Mr. Fon Eric", "e.fon@gbhs-demo.cm", "677 100 206");

        assign(store, english.id, classNames, "English Language");
        assign(store, french.id, classNames, "French Language");
        assign(store, maths.id, new String[] { "Form 1A", "Form 1B", "Form 2A", "Form 3A", "Form 4A", "Form 4B", "Form 5A" },
                "Mathematics");
        assign(store, physics.id, new String[] { "Form 1A", "Form 2A", "Form 3A", "Form 4A", "Form 5A", "Lower Sixth",
                "Upper Sixth" }, "Physics");
        assign(store, physics.id, new String[] { "Form 4A", "Form 5A", "Lower Sixth", "Upper Sixth" }, "Chemistry");
        assign(store, bio.id, new String[] { "Form 1A", "Form 2A", "Form 3A", "Form 4A", "Form 5A", "Lower Sixth" },
                "Biology");
        assign(store, bio.id, new String[] { "Form 1A", "Form 2A", "Form 3A", "Form 4A", "Form 5A" },
                "Computer Science");
        assign(store, arts.id, new String[] { "Form 1A", "Form 1B", "Form 2A", "Form 3A", "Form 4B", "Form 5A",
                "Lower Sixth", "Upper Sixth" }, "History");
        assign(store, arts.id, new String[] { "Form 1A", "Form 2A", "Form 3A", "Form 4B", "Form 5A", "Lower Sixth",
                "Upper Sixth" }, "Geography");
        assign(store, arts.id, new String[] { "Form 1A", "Form 2A", "Form 3A", "Form 4B", "Form 5A", "Lower Sixth",
                "Upper Sixth" }, "Literature in English");
        assign(store, english.id, new String[] { "Form 1A", "Form 1B", "Form 2A", "Form 3A", "Form 4A", "Form 4B",
                "Form 5A" }, "Citizenship");
        assign(store, bio.id, new String[] { "Form 1A", "Form 1B", "Form 2A", "Form 3A" }, "Sports");

        store.setClassMaster("Form 1A", english.id);
        store.setClassMaster("Form 4A", physics.id);
        store.setClassMaster("Form 4B", arts.id);
        store.setClassMaster("Lower Sixth", bio.id);

        List<Main.Student> allStudents = new ArrayList<>();
        allStudents.addAll(enrol(store, "Form 1A", null, "", juniorRoster()));
        allStudents.addAll(enrol(store, "Form 1B", null, "", juniorRosterB()));
        allStudents.addAll(enrol(store, "Form 2A", null, "", form2Roster()));
        allStudents.addAll(enrol(store, "Form 3A", null, "", form3Roster()));
        allStudents.addAll(enrol(store, "Form 4A", "Science", "Manual Labour", form4Science()));
        allStudents.addAll(enrol(store, "Form 4B", "Arts", "Food and Nutrition", form4Arts()));
        allStudents.addAll(enrol(store, "Form 5A", "Science", "", form5Science()));
        allStudents.addAll(enrol(store, "Form 5A", "Arts", "", form5Arts()));
        allStudents.addAll(enrol(store, "Lower Sixth", "Science", "Mathematics,Physics,Biology,Computer Science",
                lowerSixthScience()));
        allStudents.addAll(enrol(store, "Lower Sixth", "Arts", "Literature in English,Geography,Food and Nutrition",
                lowerSixthArts()));
        allStudents.addAll(enrol(store, "Upper Sixth", "Science", "Mathematics,Physics,Biology",
                upperSixthScience()));
        allStudents.addAll(enrol(store, "Upper Sixth", "Arts", "Literature in English,Geography",
                upperSixthArts()));

        for (Main.Student s : allStudents) {
            String[] subjects = subjectsFor(s);
            for (String subject : subjects) {
                for (String seq : SEQUENCES) {
                    Double mark = demoMark(s.id, subject, seq);
                    if (mark == null)
                        continue;
                    Map<String, Double> sets = new HashMap<>();
                    sets.put(s.id, mark);
                    store.saveMarks(s.className, subject, seq, sets, Collections.emptySet());
                }
            }
        }

        store.clearActivities();
        store.logActivity("Account", "Demo dataset loaded — GBHS Bamenda");
        store.logActivity("Class", "Classes ready — Form 1A through Upper Sixth");
        store.logActivity("Staff", "6 teachers assigned across core subjects");
        store.logActivity("Student", allStudents.size() + " students enrolled for demo");
        store.logActivity("Marks", "Sequences 1–4 seeded for report-card demos");
        store.logActivity("Report Card", "Ready to print — open Report Cards → Form 4A");

        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("school", "Government Bilingual High School Bamenda");
        summary.put("classes", classNames.length);
        summary.put("teachers", 6);
        summary.put("students", allStudents.size());
        summary.put("adminEmail", ADMIN_EMAIL);
        summary.put("adminPassword", ADMIN_PASSWORD);
        summary.put("teacherEmail", TEACHER_EMAIL);
        summary.put("teacherPassword", TEACHER_PASSWORD);
        return summary;
    }

    private static void assign(Main.DataStore store, String teacherId, String[] classes, String subject) {
        for (String cls : classes) {
            store.addAssignment(teacherId, cls, subject);
        }
    }

    private static List<Main.Student> enrol(Main.DataStore store, String className, String option, String electives,
            String[][] rows) {
        List<Main.Student> out = new ArrayList<>();
        for (String[] row : rows) {
            // name, gender, guardian, phone, dob
            out.add(store.addStudent(row[0], className, row[1], row[2], row[3], row[4],
                    option == null ? "" : option, electives == null ? "" : electives));
        }
        return out;
    }

    private static String[] subjectsFor(Main.Student s) {
        String cls = s.className == null ? "" : s.className;
        String option = s.option == null ? "" : s.option;
        if (cls.startsWith("Form 4") || cls.startsWith("Form 5")) {
            if ("Arts".equals(option))
                return ARTS_OLEVEL;
            return SCIENCE_OLEVEL;
        }
        if (cls.contains("Sixth")) {
            List<String> list = new ArrayList<>();
            if ("Science".equals(option)) {
                list.add("Chemistry");
            } else if ("Arts".equals(option)) {
                list.add("History");
            }
            if (s.electives != null) {
                for (String part : s.electives.split(",")) {
                    String name = part.trim();
                    if (!name.isEmpty() && !list.contains(name))
                        list.add(name);
                }
            }
            while (list.size() > 5)
                list.remove(list.size() - 1);
            return list.toArray(new String[0]);
        }
        return JUNIOR_SUBJECTS;
    }

    /** Deterministic mark on /20; ~8% missing for realism. */
    private static Double demoMark(String studentId, String subject, String sequence) {
        int h = Objects.hash(studentId, subject, sequence);
        if (Math.floorMod(h, 12) == 0)
            return null; // missing
        double base = 9 + Math.floorMod(h, 10); // 9..18
        double jitter = Math.floorMod(h / 7, 3) * 0.5;
        double mark = Math.min(20, base + jitter);
        // Lift a few known high performers
        if (studentId != null && (studentId.endsWith("0001") || studentId.endsWith("0007")))
            mark = Math.min(20, mark + 2);
        return Math.round(mark * 2) / 2.0;
    }

    // ---- Rosters (Cameroonian names) ----

    private static String[][] juniorRoster() {
        return new String[][] {
                { "Ngwa Blessing Acha", "Female", "Mrs. Ngwa Florence", "677 211 101", "12/03/2013" },
                { "Tanjong Ethan Mbah", "Male", "Mr. Tanjong Paul", "677 211 102", "04/07/2012" },
                { "Fomukong Sarah Chi", "Female", "Mrs. Fomukong Grace", "677 211 103", "21/11/2013" },
                { "Ndi Bryan Force", "Male", "Mr. Ndi Samuel", "677 211 104", "15/01/2013" },
                { "Awah Precious Nkwelle", "Female", "Mrs. Awah Helen", "677 211 105", "30/05/2012" },
                { "Fon Derek Tata", "Male", "Mr. Fon Joseph", "677 211 106", "09/09/2013" },
                { "Lumnwi Faith Bong", "Female", "Mrs. Lumnwi Agnes", "677 211 107", "18/02/2013" },
                { "Che Divine Asong", "Male", "Mr. Che Peter", "677 211 108", "27/08/2012" },
                { "Nkwenti Joy Manka", "Female", "Mrs. Nkwenti Rose", "677 211 109", "03/12/2013" },
                { "Baba Kelvin Ntung", "Male", "Mr. Baba John", "677 211 110", "14/06/2012" },
        };
    }

    private static String[][] juniorRosterB() {
        return new String[][] {
                { "Yuh Angela Fru", "Female", "Mrs. Yuh Martina", "677 212 101", "11/04/2013" },
                { "Mbaku Leon Chia", "Male", "Mr. Mbaku Thomas", "677 212 102", "22/10/2012" },
                { "Nji Clarisse Toh", "Female", "Mrs. Nji Beatrice", "677 212 103", "07/07/2013" },
                { "Waindim Oscar Billa", "Male", "Mr. Waindim Eric", "677 212 104", "19/01/2013" },
                { "Sama Ruth Mehto", "Female", "Mrs. Sama Lydia", "677 212 105", "28/09/2012" },
                { "Tata Ivan Nformi", "Male", "Mr. Tata George", "677 212 106", "05/05/2013" },
                { "Killa Naomi Abong", "Female", "Mrs. Killa Esther", "677 212 107", "16/12/2012" },
                { "Nfor Junior Gwan", "Male", "Mr. Nfor Alfred", "677 212 108", "02/03/2013" },
        };
    }

    private static String[][] form2Roster() {
        return new String[][] {
                { "Asanji Michelle Ngo", "Female", "Mrs. Asanji Pauline", "677 213 101", "08/02/2012" },
                { "Billa Cedric Ndi", "Male", "Mr. Billa Moses", "677 213 102", "17/06/2011" },
                { "Chioma Grace Anye", "Female", "Mrs. Anye Stella", "677 213 103", "25/10/2011" },
                { "Doh Kelvin Fonyuy", "Male", "Mr. Doh Francis", "677 213 104", "01/04/2012" },
                { "Ewi Sandra Njie", "Female", "Mrs. Ewi Margaret", "677 213 105", "13/08/2011" },
                { "Fru Patrick Mbi", "Male", "Mr. Fru Anthony", "677 213 106", "29/11/2011" },
                { "Gwan Brenda Nkeng", "Female", "Mrs. Gwan Veronica", "677 213 107", "06/05/2012" },
                { "Hibu Arnold Tikum", "Male", "Mr. Hibu Charles", "677 213 108", "20/09/2011" },
        };
    }

    private static String[][] form3Roster() {
        return new String[][] {
                { "Ivo Vanessa Akeh", "Female", "Mrs. Ivo Dorothy", "677 214 101", "14/03/2011" },
                { "Jama Richard Nguh", "Male", "Mr. Jama Henry", "677 214 102", "23/07/2010" },
                { "Killa Tracy Mbiydzenyuy", "Female", "Mrs. Killa Alice", "677 214 103", "09/12/2010" },
                { "Lukong Brian Tasi", "Male", "Mr. Lukong Emmanuel", "677 214 104", "31/01/2011" },
                { "Manka Olivia Ndze", "Female", "Mrs. Manka Christine", "677 214 105", "18/06/2010" },
                { "Nchotu Victor Awa", "Male", "Mr. Nchotu Philip", "677 214 106", "04/10/2010" },
                { "Ojong Linda Bih", "Female", "Mrs. Ojong Felicia", "677 214 107", "27/02/2011" },
                { "Pefok Daniel Shu", "Male", "Mr. Pefok Robert", "677 214 108", "15/08/2010" },
        };
    }

    private static String[][] form4Science() {
        return new String[][] {
                { "Akeh Divine Science", "Male", "Mr. Akeh Simon", "677 215 101", "12/05/2010" },
                { "Bong Pride Nkwenti", "Female", "Mrs. Bong Julie", "677 215 102", "03/09/2009" },
                { "Chia Elvis Nformi", "Male", "Mr. Chia David", "677 215 103", "21/01/2010" },
                { "Dze Nancy Fru", "Female", "Mrs. Dze Miriam", "677 215 104", "08/07/2009" },
                { "Ekinde Joel Mbah", "Male", "Mr. Ekinde Paul", "677 215 105", "16/11/2009" },
                { "Fonyuy Clara Toh", "Female", "Mrs. Fonyuy Ruth", "677 215 106", "29/04/2010" },
                { "Gwei Max Ndi", "Male", "Mr. Gwei James", "677 215 107", "07/08/2009" },
                { "Hilda Pearl Anye", "Female", "Mrs. Hilda Grace", "677 215 108", "24/12/2009" },
        };
    }

    private static String[][] form4Arts() {
        return new String[][] {
                { "Ijang Brenda Che", "Female", "Mrs. Ijang Florence", "677 216 101", "11/06/2010" },
                { "Jumbam Leo Asong", "Male", "Mr. Jumbam Mark", "677 216 102", "02/10/2009" },
                { "Kinyuy Hope Bih", "Female", "Mrs. Kinyuy Sarah", "677 216 103", "19/02/2010" },
                { "Lukong Faith Ngo", "Female", "Mrs. Lukong Anna", "677 216 104", "05/05/2009" },
                { "Mba Eric Nkeng", "Male", "Mr. Mba Joseph", "677 216 105", "28/09/2009" },
                { "Ndze Queen Manka", "Female", "Mrs. Ndze Helen", "677 216 106", "14/01/2010" },
                { "Ofeh Sam Tata", "Male", "Mr. Ofeh Peter", "677 216 107", "22/07/2009" },
                { "Pinga Joy Acha", "Female", "Mrs. Pinga Rose", "677 216 108", "09/11/2009" },
        };
    }

    private static String[][] form5Science() {
        return new String[][] {
                { "Achu Brilliant Nfor", "Male", "Mr. Achu Michael", "677 217 101", "17/03/2009" },
                { "Biwoh Stella Ngwa", "Female", "Mrs. Biwoh Patricia", "677 217 102", "06/08/2008" },
                { "Choves Kelvin Fon", "Male", "Mr. Choves Andrew", "677 217 103", "25/12/2008" },
                { "Dohnji Mary Akeh", "Female", "Mrs. Dohnji Elizabeth", "677 217 104", "13/04/2009" },
                { "Ewunkem Paul Tanjong", "Male", "Mr. Ewunkem George", "677 217 105", "01/09/2008" },
        };
    }

    private static String[][] form5Arts() {
        return new String[][] {
                { "Fomuso Rita Chi", "Female", "Mrs. Fomuso Agnes", "677 218 101", "20/02/2009" },
                { "Gwanje Ben Ndi", "Male", "Mr. Gwanje Samuel", "677 218 102", "08/06/2008" },
                { "Hibu Cynthia Awah", "Female", "Mrs. Hibu Martina", "677 218 103", "30/10/2008" },
                { "Isah Frank Mbi", "Male", "Mr. Isah Robert", "677 218 104", "15/05/2009" },
        };
    }

    private static String[][] lowerSixthScience() {
        return new String[][] {
                { "Jemima Force Nkwelle", "Female", "Mrs. Jemima Carol", "677 219 101", "04/01/2008" },
                { "Kongnyuy Alex Tasi", "Male", "Mr. Kongnyuy Daniel", "677 219 102", "18/07/2007" },
                { "Lukong Pride Shu", "Male", "Mr. Lukong Isaac", "677 219 103", "26/11/2007" },
                { "Mbiydzenyuy Eva Nguh", "Female", "Mrs. Mbiydzenyuy Joan", "677 219 104", "09/03/2008" },
        };
    }

    private static String[][] lowerSixthArts() {
        return new String[][] {
                { "Nkengfua Grace Bih", "Female", "Mrs. Nkengfua Lucy", "677 220 101", "12/08/2007" },
                { "Orock Brian Anye", "Male", "Mr. Orock Stephen", "677 220 102", "03/12/2007" },
                { "Pufong Naomi Chi", "Female", "Mrs. Pufong Esther", "677 220 103", "21/04/2008" },
        };
    }

    private static String[][] upperSixthScience() {
        return new String[][] {
                { "Qisto Marvin Fon", "Male", "Mr. Qisto Philip", "677 221 101", "07/05/2007" },
                { "Ransom Belinda Ngwa", "Female", "Mrs. Ransom Faith", "677 221 102", "16/09/2006" },
                { "Sama Titus Nfor", "Male", "Mr. Sama Charles", "677 221 103", "28/01/2007" },
        };
    }

    private static String[][] upperSixthArts() {
        return new String[][] {
                { "Tikum Vanessa Acha", "Female", "Mrs. Tikum Dorothy", "677 222 101", "10/06/2007" },
                { "Umenjoh Divine Che", "Male", "Mr. Umenjoh Paul", "677 222 102", "02/10/2006" },
                { "Viban Hope Manka", "Female", "Mrs. Viban Ruth", "677 222 103", "19/02/2007" },
        };
    }
}
