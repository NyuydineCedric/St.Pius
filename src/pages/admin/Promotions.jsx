import { useEffect, useMemo, useState } from "react";
import { ArrowUpCircle, CheckCircle2, RefreshCcw, XCircle } from "lucide-react";
import { Card, CardHeader, PageHeading, Button, Select, Badge } from "../../components/ui";
import {
  getClasses,
  getRoster,
  getMarks,
  getSettings,
  getAcademicYears,
  updateStudent,
  logActivity,
} from "../../utils/api";
import { termSequences, computeTermAverage, computeFinalAverage } from "../../utils/grading";
import {
  getSubjectsForStudent,
  getClassLevel,
  parseClassName,
  buildClassName,
  compareClassNames,
} from "../../utils/subjects";

// Only these levels auto-promote on an annual average. Form 5 and Upper
// Sixth are exam (GCE) classes — real-world progression out of them isn't
// decided by this system, so they're deliberately left out.
const PROMOTION_MAP = {
  "Form 1": "Form 2",
  "Form 2": "Form 3",
  "Form 3": "Form 4",
  "Form 4": "Form 5",
  "Lower Sixth": "Upper Sixth",
};
const ELIGIBLE_LEVELS = Object.keys(PROMOTION_MAP);
const ALL_TERMS = Object.keys(termSequences);
const ALL_SEQUENCES = Object.values(termSequences).flat();

const fmt1 = (v) => (v == null || Number.isNaN(v) ? "—" : Number(v).toFixed(1));

export default function Promotions() {
  const [classes, setClasses] = useState([]);
  const [settings, setSettings] = useState({ marksScale: "20", passAverage: "50", academicYear: "" });
  const [academicYears, setAcademicYears] = useState([]);
  const [selectedYear, setSelectedYear] = useState("");
  const [rows, setRows] = useState(null); // null = no preview generated yet
  const [overrides, setOverrides] = useState({}); // studentId -> boolean (promote?)
  const [streamChoices, setStreamChoices] = useState({}); // studentId -> "Science" | "Arts" | ""
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null); // { promoted, repeated }

  useEffect(() => {
    getClasses()
      .then(setClasses)
      .catch((err) => setError(err.message));
    getSettings()
      .then((s) => {
        setSettings(s);
        setSelectedYear(s.academicYear);
      })
      .catch(() => {});
    getAcademicYears()
      .then(setAcademicYears)
      .catch(() => {});
  }, []);

  const threshold = useMemo(
    () => (Number(settings.marksScale) || 20) * ((Number(settings.passAverage) || 50) / 100),
    [settings.marksScale, settings.passAverage],
  );

  const eligibleClasses = useMemo(
    () =>
      [...classes]
        .filter((c) => ELIGIBLE_LEVELS.includes(getClassLevel(c.name)))
        .sort((a, b) => compareClassNames(a.name, b.name)),
    [classes],
  );

  async function generatePreview() {
    if (!selectedYear) return;
    setLoading(true);
    setError("");
    setResult(null);
    setRows(null);
    try {
      const computed = [];
      for (const cls of eligibleClasses) {
        const roster = await getRoster(cls.name);
        if (roster.length === 0) continue;

        const subjectNames = Array.from(
          new Set(roster.flatMap((s) => getSubjectsForStudent(s).map((sub) => sub.name))),
        );
        const marksResults = await Promise.all(
          subjectNames.flatMap((subjectName) =>
            ALL_SEQUENCES.map((sequence) =>
              getMarks(cls.name, subjectName, sequence, selectedYear).then((marks) => ({
                subject: subjectName,
                sequence,
                marks,
              })),
            ),
          ),
        );
        const classMarks = {};
        marksResults.forEach(({ subject, sequence, marks }) => {
          classMarks[subject] = classMarks[subject] || {};
          classMarks[subject][sequence] = marks;
        });

        const level = getClassLevel(cls.name);
        const nextLevel = PROMOTION_MAP[level];
        const { section } = parseClassName(cls.name);
        const nextClassName = buildClassName(nextLevel, section);
        // Only the Form 3 → Form 4 step introduces a brand-new mandatory
        // choice (Science/Arts) that nothing on record can answer for us.
        const needsOption = level === "Form 3";

        roster.forEach((student) => {
          const termAverages = {};
          ALL_TERMS.forEach((t) => {
            termAverages[t] = computeTermAverage(student, t, classMarks);
          });
          const average = computeFinalAverage(termAverages);
          const promote = average != null && average >= threshold;
          computed.push({
            student,
            currentClass: cls.name,
            level,
            average,
            promote,
            nextClass: nextClassName,
            needsOption,
          });
        });
      }
      computed.sort((a, b) => compareClassNames(a.currentClass, b.currentClass));
      setRows(computed);
      const initialOverrides = {};
      const initialStreamChoices = {};
      computed.forEach((r) => {
        initialOverrides[r.student.id] = r.promote;
        if (r.needsOption) initialStreamChoices[r.student.id] = "";
      });
      setOverrides(initialOverrides);
      setStreamChoices(initialStreamChoices);
    } catch (err) {
      setError(err.message || "Could not compute promotions.");
    } finally {
      setLoading(false);
    }
  }

  function toggleOverride(studentId) {
    setOverrides((prev) => ({ ...prev, [studentId]: !prev[studentId] }));
  }

  function setStreamChoice(studentId, value) {
    setStreamChoices((prev) => ({ ...prev, [studentId]: value }));
  }

  const summary = useMemo(() => {
    if (!rows) return null;
    let promoted = 0;
    let repeated = 0;
    rows.forEach((r) => {
      if (overrides[r.student.id]) promoted++;
      else repeated++;
    });
    return { promoted, repeated, total: rows.length };
  }, [rows, overrides]);

  // Form 3 → Form 4 needs a Science/Arts choice made before it's safe to
  // apply — block confirming until every promoting Form 3 student has one.
  const missingStreamCount = useMemo(() => {
    if (!rows) return 0;
    return rows.filter(
      (r) => overrides[r.student.id] && r.needsOption && !streamChoices[r.student.id],
    ).length;
  }, [rows, overrides, streamChoices]);

  async function handleApply() {
    if (!rows || missingStreamCount > 0) return;
    setApplying(true);
    setError("");
    try {
      let promotedCount = 0;
      for (const row of rows) {
        if (!overrides[row.student.id]) continue;
        const payload = { class: row.nextClass };
        if (row.needsOption) {
          payload.option = streamChoices[row.student.id] || "";
          payload.electives = "";
        }
        await updateStudent(row.student.id, payload);
        promotedCount++;
      }
      await logActivity(
        "Class",
        `Promotions applied for ${selectedYear} — ${promotedCount} student${promotedCount === 1 ? "" : "s"} moved up, ${rows.length - promotedCount} repeating`,
      ).catch(() => {});
      setResult({ promoted: promotedCount, repeated: rows.length - promotedCount });
      setRows(null);
      setOverrides({});
      setStreamChoices({});
    } catch (err) {
      setError(err.message || "Could not apply promotions.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <>
      <PageHeading
        title="Promotions"
        subtitle="Preview and apply end-of-year promotions for Form 1–4 and Lower Sixth, based on annual average."
      />

      <Card className="mb-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="w-full sm:w-64">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Academic Year to evaluate
            </label>
            <Select value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)}>
              {academicYears.length === 0 && selectedYear && (
                <option value={selectedYear}>{selectedYear}</option>
              )}
              {academicYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </div>
          <div className="text-sm text-slate-500">
            Pass mark for promotion:{" "}
            <span className="font-semibold text-slate-700">
              {fmt1(threshold)} / {settings.marksScale}
            </span>
          </div>
          <Button icon={RefreshCcw} onClick={generatePreview} disabled={loading || !selectedYear}>
            {loading ? "Computing…" : "Generate Preview"}
          </Button>
        </div>
      </Card>

      {error && <p className="mb-4 text-sm text-rose-500">{error}</p>}

      {result && (
        <Card className="mb-6 border-emerald-200 bg-emerald-50/60">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="text-emerald-600" size={22} />
            <p className="text-sm text-emerald-800">
              Done — <span className="font-semibold">{result.promoted}</span> student
              {result.promoted === 1 ? "" : "s"} promoted, <span className="font-semibold">{result.repeated}</span>{" "}
              staying in their current class. Generate a new preview if you need to run this again.
            </p>
          </div>
        </Card>
      )}

      {rows && summary && (
        <>
          <Card className="mb-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex gap-6 text-sm text-slate-500">
                <p>
                  Total: <span className="font-semibold text-slate-700">{summary.total}</span>
                </p>
                <p>
                  Promoting: <span className="font-semibold text-emerald-600">{summary.promoted}</span>
                </p>
                <p>
                  Repeating: <span className="font-semibold text-rose-500">{summary.repeated}</span>
                </p>
              </div>
              <Button
                icon={ArrowUpCircle}
                onClick={handleApply}
                disabled={applying || missingStreamCount > 0}
              >
                {applying ? "Applying…" : "Confirm & Apply Promotions"}
              </Button>
            </div>
            <p className="mt-3 text-xs text-slate-400">
              Untick a student to keep them in their current class, or tick one the average didn't qualify —
              this is your call to make before confirming.
            </p>
            {missingStreamCount > 0 && (
              <p className="mt-2 text-xs font-medium text-amber-600">
                {missingStreamCount} student{missingStreamCount === 1 ? "" : "s"} moving into Form 4 still
                need{missingStreamCount === 1 ? "s" : ""} a Science/Arts choice below before you can confirm.
              </p>
            )}
          </Card>

          {ELIGIBLE_LEVELS.map((level) => {
            const levelRows = rows.filter((r) => r.level === level);
            if (levelRows.length === 0) return null;
            return (
              <Card key={level} className="mb-6">
                <CardHeader
                  title={`${level} → ${PROMOTION_MAP[level]}`}
                  subtitle={`${levelRows.length} student${levelRows.length === 1 ? "" : "s"}`}
                />
                <div className="overflow-x-auto rounded-xl border border-[#e2e8f0]">
                  <table className="w-full min-w-max border-collapse text-left text-sm">
                    <thead className="bg-[#f1f5f9]">
                      <tr>
                        <th className="border-b border-[#e2e8f0] px-3 py-2 font-semibold uppercase tracking-wide text-xs text-slate-500">
                          Student
                        </th>
                        <th className="border-b border-[#e2e8f0] px-3 py-2 font-semibold uppercase tracking-wide text-xs text-slate-500">
                          Current Class
                        </th>
                        <th className="border-b border-[#e2e8f0] px-3 py-2 text-center font-semibold uppercase tracking-wide text-xs text-slate-500">
                          Annual Average
                        </th>
                        <th className="border-b border-[#e2e8f0] px-3 py-2 text-center font-semibold uppercase tracking-wide text-xs text-slate-500">
                          Result
                        </th>
                        <th className="border-b border-[#e2e8f0] px-3 py-2 text-center font-semibold uppercase tracking-wide text-xs text-slate-500">
                          Confirm
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#e2e8f0]">
                      {levelRows.map((row) => {
                        const willPromote = overrides[row.student.id];
                        return (
                          <tr key={row.student.id} className="hover:bg-[#f8fafc]">
                            <td className="px-3 py-2 font-medium text-slate-700">
                              {row.student.name}
                              <span className="ml-1.5 font-mono text-xs text-slate-400">
                                {row.student.id}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-slate-600">{row.currentClass}</td>
                            <td className="px-3 py-2 text-center text-slate-600">
                              {fmt1(row.average)}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {willPromote ? (
                                <div className="flex flex-col items-center gap-1.5">
                                  <Badge tone="emerald">→ {row.nextClass}</Badge>
                                  {row.needsOption && (
                                    <select
                                      value={streamChoices[row.student.id] || ""}
                                      onChange={(e) =>
                                        setStreamChoice(row.student.id, e.target.value)
                                      }
                                      className={`rounded-md border px-2 py-1 text-xs font-medium focus:outline-none ${
                                        streamChoices[row.student.id]
                                          ? "border-[#e2e8f0] text-slate-600"
                                          : "border-amber-400 text-amber-700"
                                      }`}
                                    >
                                      <option value="">Choose Science/Arts…</option>
                                      <option value="Science">Science</option>
                                      <option value="Arts">Arts</option>
                                    </select>
                                  )}
                                </div>
                              ) : (
                                <Badge tone="rose">Repeats {row.currentClass}</Badge>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <button
                                type="button"
                                onClick={() => toggleOverride(row.student.id)}
                                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-[#f1f5f9]"
                              >
                                {willPromote ? (
                                  <CheckCircle2 size={16} className="text-emerald-500" />
                                ) : (
                                  <XCircle size={16} className="text-rose-400" />
                                )}
                                {willPromote ? "Promoting" : "Repeating"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            );
          })}
        </>
      )}

      {!rows && !loading && !result && (
        <Card>
          <p className="py-8 text-center text-sm text-slate-400">
            Pick the academic year that just ended and generate a preview to see who qualifies to move up.
          </p>
        </Card>
      )}
    </>
  );
}
