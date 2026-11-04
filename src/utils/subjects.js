const s = (name, coefficient) => ({ name, coefficient });

// ---------------------------------------------------------------------------
// Form 4 / Form 5 master lists (stream logic works from these)
// ---------------------------------------------------------------------------
export const GENERAL_SUBJECTS = [
  s("English Language", 5),
  s("French Language", 5),
  s("Citizenship", 5),
  s("Religious Studies", 5),
  s("Sports", 2),
];

export const SCIENCE_SUBJECTS = [
  s("Mathematics", 5),
  s("Physics", 5),
  s("Chemistry", 5),
  s("Biology", 5),
  s("Computer Science", 5),
];

export const ARTS_SUBJECTS = [
  s("Literature in English", 5),
  s("History", 5),
  s("Geography", 5),
  s("Economics", 5),
  s("Accounting", 5),
  s("Logic", 5),
  s("Commerce", 5),
];

export const ELECTIVE_SUBJECTS = [
  s("Manual Labour", 2),
  s("Food and Nutrition", 5),
];

// ---------------------------------------------------------------------------
// Form 1 & 2: everyone studies everything
// ---------------------------------------------------------------------------
export const FORM_1_2_SUBJECTS = [
  s("English Language", 4),
  s("Mathematics", 4),
  s("French Language", 4),
  s("Geography", 2),
  s("History", 2),
  s("Citizenship", 2),
  s("Religious Studies", 2),
  s("Food and Nutrition", 2),
  s("Literature in English", 2),
  s("Biology", 2),
  s("Chemistry", 2),
  s("Physics", 2),
  s("Computer Science", 2),
  s("Sports", 2),
  s("Manual Labour", 2),
];

// ---------------------------------------------------------------------------
// Form 3: everyone studies everything
// ---------------------------------------------------------------------------
export const FORM_3_SUBJECTS = [
  ...FORM_1_2_SUBJECTS,
  s("Accounting", 2),
  s("Logic", 2),
  s("Economics", 2),
  s("Commerce", 2),
];

// ---------------------------------------------------------------------------
// Lower / Upper Sixth: students pick from their stream's list
// ---------------------------------------------------------------------------
export const SIXTH_FORM_ARTS_SUBJECTS = [
  s("Geography", 5),
  s("History", 5),
  s("Economics", 5),
  s("Literature in English", 5),
  s("Philosophy", 5),
  s("Religious Studies", 5),
  s("Maths Statistics", 5),
  s("ICT", 5),
  s("Commerce", 5),
  s("Sports", 2),
  s("Manual Labour", 2),
];

export const SIXTH_FORM_SCIENCE_SUBJECTS = [
  s("Chemistry", 5),
  s("Physics", 5),
  s("Maths Mechanics", 5),
  s("Computer Science", 5),
  s("Religious Studies", 5),
  s("Biology", 5),
  s("Sports", 2),
];

// Every subject taught anywhere in the school, each name once. Used by the
// teacher-assignment dropdown in Settings. Must stay BELOW all the lists above.
export const ALL_SUBJECTS = Array.from(
  new Map(
    [
      ...FORM_1_2_SUBJECTS,
      ...FORM_3_SUBJECTS,
      ...GENERAL_SUBJECTS,
      ...SCIENCE_SUBJECTS,
      ...ARTS_SUBJECTS,
      ...ELECTIVE_SUBJECTS,
      ...SIXTH_FORM_ARTS_SUBJECTS,
      ...SIXTH_FORM_SCIENCE_SUBJECTS,
    ].map((subject) => [subject.name, subject]),
  ).values(),
);

const MATHEMATICS = SCIENCE_SUBJECTS.find((s) => s.name === "Mathematics");
const CHEMISTRY = SIXTH_FORM_SCIENCE_SUBJECTS.find((s) => s.name === "Chemistry");
const HISTORY = SIXTH_FORM_ARTS_SUBJECTS.find((s) => s.name === "History");

/** Curriculum levels (no section letter). */
export const CLASS_LEVELS = [
  "Form 1",
  "Form 2",
  "Form 3",
  "Form 4",
  "Form 5",
  "Lower Sixth",
  "Upper Sixth",
];

/** @deprecated Use CLASS_LEVELS — kept for older imports */
export const CLASS_NAMES = CLASS_LEVELS;

export const O_LEVEL_STREAM_LEVELS = ["Form 4", "Form 5"];
export const SIXTH_FORM_LEVELS = ["Lower Sixth", "Upper Sixth"];
export const STREAM_LEVELS = [...O_LEVEL_STREAM_LEVELS, ...SIXTH_FORM_LEVELS];

/** @deprecated Use O_LEVEL_STREAM_LEVELS */
export const O_LEVEL_STREAM_CLASSES = O_LEVEL_STREAM_LEVELS;
/** @deprecated Use SIXTH_FORM_LEVELS */
export const SIXTH_FORM_CLASSES = SIXTH_FORM_LEVELS;
/** @deprecated Use STREAM_LEVELS */
export const STREAM_CLASSES = STREAM_LEVELS;

/** Common Cameroon parallel-arm letters schools pick from. */
export const SECTION_SUGGESTIONS = ["A", "B", "C", "D", "E", "F"];

/**
 * Normalize a class display name: trim, collapse spaces, glue section letter
 * to the level ("Form 1 A" / "Form 1A" → "Form 1A").
 */
export function normalizeClassName(raw) {
  if (raw == null) return "";
  let s = String(raw).trim().replace(/\s+/g, " ");
  if (!s) return "";

  for (const level of CLASS_LEVELS) {
    if (s === level) return level;
    // "Form 1A" or "Form 1 A" or "form 1 a"
    const escaped = level.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`^${escaped}\\s*([A-Za-z])$`, "i");
    const m = s.match(re);
    if (m) return `${level}${m[1].toUpperCase()}`;
  }
  return s;
}

/**
 * Split "Form 1A" → { level: "Form 1", section: "A" }.
 * Unknown names return the whole string as level with empty section.
 */
export function parseClassName(name) {
  const normalized = normalizeClassName(name);
  if (!normalized) return { level: "", section: "" };

  for (const level of CLASS_LEVELS) {
    if (normalized === level) return { level, section: "" };
    if (normalized.startsWith(level)) {
      const rest = normalized.slice(level.length);
      if (/^[A-Za-z]$/.test(rest)) {
        return { level, section: rest.toUpperCase() };
      }
    }
  }
  return { level: normalized, section: "" };
}

export function buildClassName(level, section) {
  const lvl = (level || "").trim();
  if (!lvl) return "";
  const sec = (section || "").trim().toUpperCase();
  if (!sec) return normalizeClassName(lvl);
  // If level already includes a section, prefer explicit section arg.
  const base = parseClassName(lvl).level || lvl;
  return normalizeClassName(`${base}${sec}`);
}

export function getClassLevel(className) {
  return parseClassName(className).level;
}

export function requiresStream(className) {
  return STREAM_LEVELS.includes(getClassLevel(className));
}

export function isSixthForm(className) {
  return SIXTH_FORM_LEVELS.includes(getClassLevel(className));
}

/** Sort key for display: level order, then section letter. */
export function classSortKey(className) {
  const { level, section } = parseClassName(className);
  const levelIdx = CLASS_LEVELS.indexOf(level);
  return [
    levelIdx >= 0 ? levelIdx : 99,
    section || "",
    className || "",
  ];
}

export function compareClassNames(a, b) {
  const ka = classSortKey(a);
  const kb = classSortKey(b);
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] < kb[i]) return -1;
    if (ka[i] > kb[i]) return 1;
  }
  return 0;
}

// The compulsory ("locked in") subjects for a class + stream, before any
// student-chosen extras are added on top.
//  - Forms 1-3: everyone studies everything, no streaming (Form 1/2 and
//    Form 3 each have their own list and coefficients).
//  - Form 4/5: general subjects + full stream core, and Mathematics is
//    compulsory for EVERYONE here regardless of stream (Science already
//    includes it; Arts gets it added on top of its own core).
//  - Lower/Upper Sixth: only one compulsory anchor subject per stream —
//    Chemistry for Science, History for Arts. Everything else is chosen
//    freely from that stream's pool, with no limit on how many.
export function getCoreSubjects(className, option) {
  if (!requiresStream(className)) {
    // Form 3 has its own list; Form 1 and 2 share one.
    return getClassLevel(className) === "Form 3"
      ? FORM_3_SUBJECTS
      : FORM_1_2_SUBJECTS;
  }

  if (isSixthForm(className)) {
    if (option === "Science") return [CHEMISTRY];
    if (option === "Arts") return [HISTORY];
    return [];
  }

  // Form 4 / Form 5 (any section)
  if (option === "Science") {
    return [...GENERAL_SUBJECTS, ...SCIENCE_SUBJECTS];
  }
  if (option === "Arts") {
    return [...GENERAL_SUBJECTS, ...ARTS_SUBJECTS, MATHEMATICS];
  }
  return GENERAL_SUBJECTS;
}

// The pool a Lower/Upper Sixth student can freely choose additional
// subjects from (their stream's remaining subjects), excluding whichever
// subject is already the compulsory anchor.
export function getSixthFormElectivePool(option) {
  if (option === "Science") {
    return SIXTH_FORM_SCIENCE_SUBJECTS.filter((s) => s.name !== "Chemistry");
  }
  if (option === "Arts") {
    return SIXTH_FORM_ARTS_SUBJECTS.filter((s) => s.name !== "History");
  }
  return [];
}

// student: { class, option, electives } — electives is a comma-separated
// string of subject names stored by the backend.
export function getSubjectsForStudent(student) {
  const core = getCoreSubjects(student.class, student.option);
  const electiveNames = (student.electives || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (isSixthForm(student.class)) {
    const pool = getSixthFormElectivePool(student.option);
    const chosen = pool.filter((s) => electiveNames.includes(s.name));
    return [...core, ...chosen];
  }

  const extra = ELECTIVE_SUBJECTS.filter((s) => electiveNames.includes(s.name));
  const already = new Set(core.map((s) => s.name));
  return [...core, ...extra.filter((s) => !already.has(s.name))];
}

// assigned teacher for a class + subject from Staff Management data.
export function getTeacherName(teachers, className, subjectName) {
  const match = teachers.find((t) =>
    t.assignments.some(
      (a) => a.class === className && a.subject === subjectName,
    ),
  );
  return match ? match.name : "Unassigned";
}