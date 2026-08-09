import { useEffect, useMemo, useState } from "react";
import { ChevronRight, FileSpreadsheet, Printer } from "lucide-react";
import { Card, CardHeader, PageHeading, Button, Select } from "../../components/ui";
import {
  getClasses,
  getMarks,
  getRoster,
  getTeachers,
  getSettings,
  getAcademicYears,
  logActivity,
} from "../../utils/api";
import {
  termSequences,
  statusForScale,
  computePosition,
  buildStudentRecords,
} from "../../utils/grading";
import { getSubjectsForStudent, compareClassNames } from "../../utils/subjects";
import { exportMastersheetWorkbook, downloadWorkbookBuffer } from "../../utils/mastersheetExport";

const TERMS = Object.keys(termSequences);

const fmt1 = (v) => (v == null || Number.isNaN(v) ? "—" : Number(v).toFixed(1));

export default function Mastersheet() {
  const [classes, setClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState("");
  const [term, setTerm] = useState("First Term");
  const [students, setStudents] = useState([]);
  const [classMarks, setClassMarks] = useState({});
  const [teachers, setTeachers] = useState([]);
  const [settings, setSettings] = useState({
    academicYear: "",
    marksScale: "20",
    passAverage: "50",
  });
  const [academicYears, setAcademicYears] = useState([]);
  const [selectedYear, setSelectedYear] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    getClasses()
      .then((data) => {
        const names = data.map((c) => c.name).sort(compareClassNames);
        setClasses(names);
        if (names.length > 0) setSelectedClass(names[0]);
      })
      .catch((err) => setError(err.message));

    getTeachers().then(setTeachers).catch((err) => setError(err.message));

    getSettings()
      .then((s) => {
        setSettings(s);
        setSelectedYear(s.academicYear);
        if (termSequences[s.currentTerm]) setTerm(s.currentTerm);
      })
      .catch(() => {});

    getAcademicYears()
      .then(setAcademicYears)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedClass) return;
    getRoster(selectedClass)
      .then(setStudents)
      .catch((err) => setError(err.message));
  }, [selectedClass]);

  useEffect(() => {
    if (!selectedClass || students.length === 0 || !selectedYear) {
      setClassMarks({});
      return;
    }
    let active = true;
    const allSequences = Object.values(termSequences).flat();

    (async () => {
      setLoading(true);
      try {
        const subjectNames = Array.from(
          new Set(students.flatMap((s) => getSubjectsForStudent(s).map((sub) => sub.name))),
        );
        const results = await Promise.all(
          subjectNames.flatMap((subjectName) =>
            allSequences.map((sequence) =>
              getMarks(selectedClass, subjectName, sequence, selectedYear).then((marks) => ({
                subject: subjectName,
                sequence,
                marks,
              })),
            ),
          ),
        );
        if (!active) return;
        const bySubject = {};
        results.forEach(({ subject, sequence, marks }) => {
          bySubject[subject] = bySubject[subject] || {};
          bySubject[subject][sequence] = marks;
        });
        setClassMarks(bySubject);
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [selectedClass, students, selectedYear]);

  // Column set = every subject taken by anyone in the class (a student who
  // doesn't take a given subject just shows a dash in that column), sorted
  // by how often it's actually taken so the most common subjects lead.
  const subjectColumns = useMemo(() => {
    const counts = new Map();
    students.forEach((s) => {
      getSubjectsForStudent(s).forEach((sub) => {
        counts.set(sub.name, (counts.get(sub.name) || 0) + 1);
      });
    });
    return Array.from(counts.keys()).sort((a, b) => counts.get(b) - counts.get(a));
  }, [students]);

  const records = useMemo(
    () => buildStudentRecords(students, classMarks, term, teachers, settings),
    [students, classMarks, term, teachers, settings.marksScale, settings.passAverage],
  );

  const rows = useMemo(
    () =>
      records
        .map((r) => ({
          ...r,
          rank: computePosition(r.student.id, records),
        }))
        .sort((a, b) => {
          if (a.average == null) return 1;
          if (b.average == null) return -1;
          return b.average - a.average;
        }),
    [records],
  );

  const classAverage = useMemo(() => {
    const scored = records.filter((r) => r.average != null);
    if (!scored.length) return null;
    return scored.reduce((sum, r) => sum + r.average, 0) / scored.length;
  }, [records]);

  function subjectMarkFor(row, subjectName) {
    const subj = row.subjects.find((s) => s.name === subjectName);
    return subj ? subj.average : null;
  }

  async function handleExport() {
    if (!students.length) return;
    setExporting(true);
    setError("");
    try {
      const buffer = await exportMastersheetWorkbook({
        className: selectedClass,
        academicYear: selectedYear,
        roster: students,
        teachers,
        settings,
        subjectColumns,
        classMarks,
      });
      downloadWorkbookBuffer(buffer, `${selectedClass} - Mastersheet.xlsx`);
      logActivity(
        "Mastersheet",
        `Mastersheet exported — ${selectedClass} (${students.length} students)`,
      ).catch(() => {});
    } catch (err) {
      setError(err.message || "Could not generate the Excel file.");
    } finally {
      setExporting(false);
    }
  }

  function handlePrint() {
    logActivity(
      "Mastersheet",
      `Mastersheet printed — ${selectedClass}, ${term} (${rows.length} students)`,
    ).catch(() => {});
    window.print();
  }

  return (
    <>
      <style>{`
        @media print {
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          @page { size: A4 landscape; margin: 8mm; }
          body * { visibility: hidden !important; }
          .mastersheet-print-area, .mastersheet-print-area * {
            visibility: visible !important;
          }
          .mastersheet-print-area {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
          }
        }
      `}</style>

      <div className="print:hidden">
        <PageHeading
          title="Mastersheet"
          subtitle="A whole-class, per-term summary of every student's marks — export or print, class by class."
          action={
            <div className="flex gap-2">
              <Button
                icon={Printer}
                variant="outline"
                onClick={handlePrint}
                disabled={!rows.length}
              >
                Print
              </Button>
              <Button
                icon={FileSpreadsheet}
                onClick={handleExport}
                disabled={!rows.length || exporting}
              >
                {exporting ? "Generating…" : "Export to Excel"}
              </Button>
            </div>
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[240px_1fr]">
        <div className="space-y-6 print:hidden">
          <Card>
            <CardHeader title="Classes" subtitle="Pick a class to view its mastersheet." />
            <div className="space-y-2">
              {classes.map((name) => (
                <button
                  key={name}
                  className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
                    selectedClass === name
                      ? "border-[#0ea5e9] bg-[#0ea5e9]/10 text-[#0b61a6]"
                      : "border-[#e2e8f0] bg-white text-slate-700 hover:border-[#0ea5e9] hover:bg-[#f1f5f9]"
                  }`}
                  onClick={() => setSelectedClass(name)}
                >
                  <span>{name}</span>
                  <ChevronRight size={18} />
                </button>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="print:hidden">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex w-full flex-col gap-4 sm:max-w-md sm:flex-row">
                <div className="w-full sm:w-48">
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Academic Year
                  </label>
                  <Select
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(e.target.value)}
                  >
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
                <div className="w-full sm:w-48">
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Term
                  </label>
                  <Select value={term} onChange={(e) => setTerm(e.target.value)}>
                    {TERMS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <div className="flex gap-6 text-sm text-slate-500">
                <p>
                  Students: <span className="font-semibold text-slate-700">{students.length}</span>
                </p>
                <p>
                  Class Average:{" "}
                  <span className="font-semibold text-slate-700">{fmt1(classAverage)}</span>
                </p>
              </div>
            </div>
          </Card>

          <div className="mastersheet-print-area">
            <div className="mb-3 hidden print:block">
              <p className="text-center text-lg font-bold uppercase">
                {selectedClass} — {term} Mastersheet ({selectedYear})
              </p>
            </div>

            {error && <p className="mb-4 text-sm text-rose-500">{error}</p>}

            {!selectedClass ? (
              <div className="rounded-xl border border-dashed border-[#e2e8f0] p-10 text-center text-sm text-slate-400">
                Pick a class to generate its mastersheet.
              </div>
            ) : loading ? (
              <div className="rounded-xl border border-dashed border-[#e2e8f0] p-10 text-center text-sm text-slate-400">
                Loading marks…
              </div>
            ) : rows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#e2e8f0] p-10 text-center text-sm text-slate-400">
                No students in this class yet.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-[#e2e8f0]">
                <table className="w-full min-w-max border-collapse text-left text-xs">
                  <thead className="bg-[#f1f5f9]">
                    <tr>
                      <th className="sticky left-0 z-10 border-b border-[#e2e8f0] bg-[#f1f5f9] px-3 py-2 font-semibold uppercase tracking-wide text-slate-500">
                        AD Nº
                      </th>
                      <th className="sticky left-[76px] z-10 border-b border-[#e2e8f0] bg-[#f1f5f9] px-3 py-2 font-semibold uppercase tracking-wide text-slate-500">
                        Name
                      </th>
                      <th className="border-b border-[#e2e8f0] px-2 py-2 text-center font-semibold uppercase tracking-wide text-slate-500">
                        Sex
                      </th>
                      {subjectColumns.map((name) => (
                        <th
                          key={name}
                          className="border-b border-[#e2e8f0] px-2 py-2 text-center font-semibold uppercase tracking-wide text-slate-500"
                        >
                          {name}
                        </th>
                      ))}
                      <th className="border-b border-[#e2e8f0] px-2 py-2 text-center font-semibold uppercase tracking-wide text-slate-500">
                        Total
                      </th>
                      <th className="border-b border-[#e2e8f0] px-2 py-2 text-center font-semibold uppercase tracking-wide text-slate-500">
                        Average
                      </th>
                      <th className="border-b border-[#e2e8f0] px-2 py-2 text-center font-semibold uppercase tracking-wide text-slate-500">
                        NSS
                      </th>
                      <th className="border-b border-[#e2e8f0] px-2 py-2 text-center font-semibold uppercase tracking-wide text-slate-500">
                        NSP
                      </th>
                      <th className="border-b border-[#e2e8f0] px-2 py-2 text-center font-semibold uppercase tracking-wide text-slate-500">
                        Rank
                      </th>
                      <th className="border-b border-[#e2e8f0] px-2 py-2 text-center font-semibold uppercase tracking-wide text-slate-500">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e2e8f0]">
                    {rows.map((row) => {
                      const total = subjectColumns.reduce((sum, name) => {
                        const v = subjectMarkFor(row, name);
                        return v == null ? sum : sum + v;
                      }, 0);
                      const status = statusForScale(
                        row.average,
                        settings.marksScale,
                        settings.passAverage,
                      );
                      return (
                        <tr key={row.student.id} className="hover:bg-[#f8fafc]">
                          <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-slate-700">
                            {row.student.id}
                          </td>
                          <td className="sticky left-[76px] z-10 bg-white px-3 py-2 font-medium text-slate-700">
                            {row.student.name}
                          </td>
                          <td className="px-2 py-2 text-center text-slate-500">
                            {row.student.gender ? row.student.gender[0] : "—"}
                          </td>
                          {subjectColumns.map((name) => (
                            <td key={name} className="px-2 py-2 text-center text-slate-600">
                              {fmt1(subjectMarkFor(row, name))}
                            </td>
                          ))}
                          <td className="px-2 py-2 text-center font-semibold text-slate-700">
                            {fmt1(total)}
                          </td>
                          <td className="px-2 py-2 text-center font-semibold text-slate-700">
                            {fmt1(row.average)}
                          </td>
                          <td className="px-2 py-2 text-center text-slate-500">{row.papersSat}</td>
                          <td className="px-2 py-2 text-center text-slate-500">
                            {row.papersPassed}
                          </td>
                          <td className="px-2 py-2 text-center font-semibold text-slate-700">
                            {row.rank ?? "—"}
                          </td>
                          <td
                            className={`px-2 py-2 text-center font-semibold ${
                              status === "Pass"
                                ? "text-emerald-600"
                                : status === "Fail"
                                  ? "text-rose-500"
                                  : "text-amber-600"
                            }`}
                          >
                            {status}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
