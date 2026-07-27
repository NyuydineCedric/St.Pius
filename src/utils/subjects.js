export const GENERAL_SUBJECTS = [
  { name: "English Language", coefficient: 5 },
  { name: "French Language", coefficient: 5 },
  { name: "Citizenship", coefficient: 3 },
  { name: "Sports", coefficient: 1 },
];

export const SCIENCE_SUBJECTS = [
  { name: "Mathematics", coefficient: 5 },
  { name: "Physics", coefficient: 3 },
  { name: "Chemistry", coefficient: 3 },
  { name: "Biology", coefficient: 3 },
  { name: "Computer Science", coefficient: 3 },
];

export const ARTS_SUBJECTS = [
  { name: "Literature in English", coefficient: 3 },
  { name: "History", coefficient: 3 },
  { name: "Geography", coefficient: 3 },
];

export const ELECTIVE_SUBJECTS = [
  { name: "Manual Labour", coefficient: 1 },
  { name: "Food and Nutrition", coefficient: 3 },
  { name: "Sound and Word Building", coefficient: 3 },
];

export const ALL_SUBJECTS = [
  ...GENERAL_SUBJECTS,
  ...SCIENCE_SUBJECTS,
  ...ARTS_SUBJECTS,
  ...ELECTIVE_SUBJECTS,
];

const MATHEMATICS = SCIENCE_SUBJECTS.find((s) => s.name === "Mathematics");
const CHEMISTRY = SCIENCE_SUBJECTS.find((s) => s.name === "Chemistry");
const HISTORY = ARTS_SUBJECTS.find((s) => s.name === "History");

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

// Sixth formers pick their own subjects, capped at 5 total (including the
// one compulsory anchor subject for their stream).
export const SIXTH_FORM_MAX_SUBJECTS = 5;

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
//  - Forms 1-3: everyone studies everything, no streaming.
//  - Form 4/5: general subjects + full stream core, and Mathematics is
//    compulsory for EVERYONE here regardless of stream (Science already
//    includes it; Arts gets it added on top of its own core).
//  - Lower/Upper Sixth: only one compulsory anchor subject per stream —
//    Chemistry for Science, History for Arts. Everything else is chosen
//    freely from that stream's pool, up to the 5-subject cap.
export function getCoreSubjects(className, option) {
  if (!requiresStream(className)) return ALL_SUBJECTS;

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
// subjects from (their stream's remaining subjects, plus electives),
// excluding whichever subject is already the compulsory anchor.
export function getSixthFormElectivePool(option) {
  if (option === "Science") {
    return [
      ...SCIENCE_SUBJECTS.filter((s) => s.name !== "Chemistry"),
      ...ELECTIVE_SUBJECTS,
    ];
  }
  if (option === "Arts") {
    return [
      ...ARTS_SUBJECTS.filter((s) => s.name !== "History"),
      ...ELECTIVE_SUBJECTS,
    ];
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
    return [...core, ...chosen].slice(0, SIXTH_FORM_MAX_SUBJECTS);
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
