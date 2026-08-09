// All thresholds are expressed as a percentage of the configured Marks
// Scale, so grading/status/remarks stay correct whether the school marks
// out of 20 or out of 100.

import { getSubjectsForStudent, getTeacherName } from "./subjects";

// A term is two sequences. Shared by Report Cards, the Mastersheet, and the
// per-student history view so all three always agree on the same numbers.
export const termSequences = {
  "First Term": ["Sequence 1", "Sequence 2"],
  "Second Term": ["Sequence 3", "Sequence 4"],
  "Third Term": ["Sequence 5", "Sequence 6"],
};

// Display-only rename: the school calls these "CATs" (Continuous
// Assessment Tests), but the underlying identifier ("Sequence 1", etc.)
// stays exactly as-is everywhere else — API params, storage keys, dropdown
// values — so existing marks data and every internal lookup keep working
// unchanged. Only what's shown on screen/print says "CAT N".
export function catLabel(sequence) {
  const m = /^Sequence (\d+)$/.exec(sequence || "");
  return m ? `CAT ${m[1]}` : sequence || "";
}

// Takes the full student object (not just the id) because the subject list
// — and therefore the weighting — depends on the student's class/option/electives.
//
// Term average = coefficient-weighted mean of each subject's sequence average.
// A subject's sequence average uses only sequences that have a mark (missing ≠ 0).
export function computeTermAverage(student, term, classMarksData) {
  const sequences = termSequences[term] || [];
  if (sequences.length === 0) return null;

  const subjectList = getSubjectsForStudent(student);
  let totalWeighted = 0;
  let totalCoefficient = 0;
  let hasAnyMark = false;

  subjectList.forEach((subject) => {
    const marks = sequences.map((sequence) => {
      const raw = classMarksData[subject.name]?.[sequence]?.[student.id];
      return raw === undefined || raw === null || raw === ""
        ? null
        : Number(raw);
    });
    const present = marks.filter((m) => m !== null && !Number.isNaN(m));
    if (present.length === 0) return;
    hasAnyMark = true;
    const subjectAverage =
      present.reduce((sum, m) => sum + m, 0) / present.length;
    totalWeighted += subjectAverage * subject.coefficient;
    totalCoefficient += subject.coefficient;
  });

  if (!hasAnyMark || !totalCoefficient) return null;
  return totalWeighted / totalCoefficient;
}

/** Annual (year) average = mean of the three term averages. Needs all three. */
export function computeFinalAverage(termAvgs) {
  if (!termAvgs) return null;
  const first = termAvgs["First Term"];
  const second = termAvgs["Second Term"];
  const third = termAvgs["Third Term"];
  if (first == null || second == null || third == null) return null;
  return (first + second + third) / 3;
}

/** Competition ranking: 1, 2, 2, 4 — equal scores share the same place. */
export function competitionRank(studentId, ranking) {
  if (!ranking.length) return null;
  let rank = 1;
  for (let i = 0; i < ranking.length; i++) {
    if (i > 0 && ranking[i].score < ranking[i - 1].score) {
      rank = i + 1;
    }
    if (ranking[i].id === studentId) return rank;
  }
  return null;
}

/** Class position for a term (1 = highest average). Ties share rank. */
export function computePosition(studentId, records) {
  const ranking = records
    .filter((r) => r.average != null)
    .map((r) => ({ id: r.student.id, score: r.average }))
    .sort((a, b) => b.score - a.score);
  return competitionRank(studentId, ranking);
}

export function computeSubjectRanks(studentId, records, subjectName) {
  const ranking = records
    .map((r) => {
      const subject = r.subjects.find((s) => s.name === subjectName);
      if (!subject || subject.average == null) return null;
      return { id: r.student.id, score: subject.average };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  return competitionRank(studentId, ranking);
}

// Class-wide average for a single subject (used in the "SUBJ. AVR." column,
// which is distinct from the student's own "TERMINAL AVR." for that subject).
export function computeSubjectClassAverage(records, subjectName) {
  const scores = records
    .map((r) => r.subjects.find((s) => s.name === subjectName))
    .filter((s) => s && s.average != null)
    .map((s) => s.average);
  if (!scores.length) return null;
  return scores.reduce((sum, v) => sum + v, 0) / scores.length;
}

// Builds the same per-student record shape used throughout Report Cards,
// the Mastersheet, and student history: subject-by-subject term averages,
// totals, pass/fail counts, and the coefficient-weighted overall average.
// classMarks: { [subjectName]: { [sequence]: { [studentId]: mark } } }
export function buildStudentRecords(students, classMarks, term, teachers, settings) {
  const sequences = termSequences[term] || [];
  // Principal-configured pass average (Settings → Academic Structure),
  // expressed as a percentage of the marks scale. Defaults to 50%.
  const passThreshold =
    (Number(settings.marksScale) || 20) *
    ((Number(settings.passAverage) || 50) / 100);
  return students.map((student) => {
    const subjectList = getSubjectsForStudent(student);
    const subjects = subjectList.map((subject) => {
      const marks = sequences.map((sequence) => {
        const raw = classMarks[subject.name]?.[sequence]?.[student.id];
        return raw === undefined || raw === null || raw === ""
          ? null
          : Number(raw);
      });
      const present = marks.filter((m) => m !== null && !Number.isNaN(m));
      const average =
        present.length === 0
          ? null
          : present.reduce((sum, m) => sum + m, 0) / present.length;
      return {
        ...subject,
        teacher: getTeacherName(teachers, student.class, subject.name),
        marks,
        average,
        grade: average == null ? null : gradeForScale(average, settings.marksScale),
      };
    });
    const scored = subjects.filter((s) => s.average != null);
    const totalWeighted = scored.reduce(
      (acc, item) => acc + item.average * item.coefficient,
      0,
    );
    const totalCoefficient = scored.reduce((acc, item) => acc + item.coefficient, 0);
    const papersSat = scored.length;
    const papersPassed = scored.filter((s) => s.average >= passThreshold).length;
    const papersFailed = scored.filter((s) => s.average < passThreshold).length;
    // GCE Standard: pass if at least 4 subjects individually clear the
    // pass mark, regardless of overall average — only meaningful for
    // Form 4/5 and Lower/Upper Sixth; the footer only displays it there.
    const gceStatus = papersPassed >= 4 ? "Pass" : "Fail";
    return {
      student,
      subjects,
      totalWeighted,
      papersSat,
      papersPassed,
      papersFailed,
      gceStatus,
      average: totalCoefficient ? totalWeighted / totalCoefficient : null,
    };
  });
}

export function gradeForScale(mark, scale) {
  if (mark === "" || mark === null || Number.isNaN(Number(mark))) return null;
  const s = Number(scale) || 20;
  const pct = Number(mark) / s;
  if (pct >= 0.8) return { label: "A", tone: "emerald" };
  if (pct >= 0.6) return { label: "B", tone: "sky" };
  if (pct >= 0.5) return { label: "C", tone: "amber" };
  return { label: "D", tone: "rose" };
}

// passAverage is the principal-configured pass mark (Settings → Academic
// Structure), expressed as a percentage of the scale. Defaults to 50%.
export function statusForScale(average, scale, passAverage = 50) {
  if (average === "" || average === null || Number.isNaN(Number(average)))
    return "—";
  const s = Number(scale) || 20;
  const passPct = (Number(passAverage) || 50) / 100;
  const pct = Number(average) / s;
  if (pct >= passPct) return "Pass";
  if (pct >= Math.max(passPct - 0.1, 0)) return "Trial";
  return "Fail";
}

export function remarkForScale(average, scale) {
  if (average === "" || average === null || Number.isNaN(Number(average)))
    return "—";
  const s = Number(scale) || 20;
  const pct = Number(average) / s;
  if (pct >= 0.8) return "Excellent";
  if (pct >= 0.7) return "Very Good";
  if (pct >= 0.6) return "Good";
  if (pct >= 0.5) return "Fair";
  if (pct >= 0.4) return "Weak";
  return "Poor";
}

// A short sentence for the report card's "Principal's Remark" box —
// auto-generated from the term average so nobody has to hand-write one.
// passAverage is the principal-configured pass mark (percentage of scale).
export function principalRemark(average, scale, passAverage = 50) {
  if (average === "" || average === null || Number.isNaN(Number(average)))
    return "";
  const s = Number(scale) || 20;
  const passPct = (Number(passAverage) || 50) / 100;
  const pct = Number(average) / s;
  if (pct >= 0.8) return "Excellent result. Keep up the outstanding work.";
  if (pct >= 0.7) return "Very good result. Keep working hard.";
  if (pct >= 0.6) return "Good result. Continue putting in the effort.";
  if (pct >= passPct) return "Satisfactory result. Can still do better.";
  if (pct >= Math.max(passPct - 0.1, 0))
    return "Below average. Must work harder next term.";
  return "Weak result. Serious effort is required next term.";
}