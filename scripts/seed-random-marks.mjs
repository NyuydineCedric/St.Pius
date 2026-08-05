#!/usr/bin/env node
/**
 * Fill in random marks for every student already in the system — unlike
 * `npm run seed:demo`, this does NOT touch students/classes/teachers, it
 * only generates marks for all three terms (Sequence 1–6) for whoever is
 * already enrolled, so you get a full year of sample report-card data
 * without losing any real students you've entered.
 *
 * Usage:
 *   ADMIN_EMAIL=you@school.cm ADMIN_PASSWORD=yourpassword npm run seed:random-marks
 *   API_BASE=http://127.0.0.1:8080 ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/seed-random-marks.mjs
 *
 * Only fills sequences that are currently empty for a given student, so
 * it's safe to re-run — it won't overwrite marks you already entered
 * by hand. Pass FORCE=1 to overwrite everything instead.
 */
import { getSubjectsForStudent } from "../src/utils/subjects.js";

const API_BASE = (process.env.API_BASE || "http://127.0.0.1:8080").replace(/\/$/, "");
const SEQUENCES = [
  "Sequence 1",
  "Sequence 2",
  "Sequence 3",
  "Sequence 4",
  "Sequence 5",
  "Sequence 6",
];
const FORCE = process.env.FORCE === "1";

async function api(path, { method = "GET", body, headers } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(data.error || `${method} ${path} failed (${res.status})`);
  }
  return data;
}

function randomMark(scale) {
  // Roughly realistic spread: 30%–98% of the scale, half-point steps.
  const min = scale * 0.3;
  const max = scale * 0.98;
  const raw = min + Math.random() * (max - min);
  return Math.round(raw * 2) / 2;
}

async function main() {
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
    throw new Error(
      "Set ADMIN_EMAIL and ADMIN_PASSWORD (your admin login) before running this script.",
    );
  }

  const login = await api("/api/login", {
    method: "POST",
    body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD },
  });
  const authHeaders = { Authorization: `Bearer ${login.token}` };
  console.log(`Authenticated as ${login.email} (${login.role})`);

  const settings = await api("/api/settings", { headers: authHeaders });
  const scale = Number(settings.marksScale) || 20;

  const classes = await api("/api/classes", { headers: authHeaders });
  if (classes.length === 0) {
    console.log("No classes found — nothing to seed.");
    return;
  }

  let totalStudents = 0;
  let totalEntries = 0;
  let totalCalls = 0;

  for (const cls of classes) {
    const roster = await api(`/api/roster?class=${encodeURIComponent(cls.name)}`, {
      headers: authHeaders,
    });
    if (roster.length === 0) continue;
    totalStudents += roster.length;

    // Union of every subject actually studied by someone in this class
    // (Form 4/5 and Sixth Form students can differ by option/electives).
    const subjectNames = new Set();
    const subjectsByStudent = new Map();
    for (const student of roster) {
      const subs = getSubjectsForStudent(student).map((s) => s.name);
      subjectsByStudent.set(student.id, new Set(subs));
      subs.forEach((name) => subjectNames.add(name));
    }

    for (const subject of subjectNames) {
      const enrolled = roster.filter((s) => subjectsByStudent.get(s.id).has(subject));
      if (enrolled.length === 0) continue;

      for (const sequence of SEQUENCES) {
        // Skip sequences that already have marks for this subject, unless
        // FORCE=1 — keeps re-runs from clobbering real data.
        let existing = {};
        if (!FORCE) {
          existing = await api(
            `/api/marks?class=${encodeURIComponent(cls.name)}&subject=${encodeURIComponent(subject)}&sequence=${encodeURIComponent(sequence)}`,
            { headers: authHeaders },
          );
        }

        const marks = {};
        for (const student of enrolled) {
          if (!FORCE && existing[student.id] != null) continue;
          marks[student.id] = randomMark(scale);
        }
        if (Object.keys(marks).length === 0) continue;

        await api("/api/marks", {
          method: "POST",
          headers: authHeaders,
          body: { class: cls.name, subject, sequence, marks },
        });
        totalEntries += Object.keys(marks).length;
        totalCalls++;
      }
    }
    console.log(`✓ ${cls.name} — ${roster.length} student(s), ${subjectNames.size} subject(s)`);
  }

  console.log(
    `\nDone. Wrote ${totalEntries} mark(s) across ${totalCalls} subject/sequence saves for ${totalStudents} student enrolments (${SEQUENCES.join(", ")}).`,
  );
  console.log("Open Report Cards to see them.\n");
}

main().catch((err) => {
  console.error("\nFailed:", err.message);
  console.error("Is the backend running? Try: npm run backend\n");
  process.exit(1);
});
