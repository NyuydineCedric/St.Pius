import AuthImage from "../../components/AuthImage";
import { useEffect, useMemo, useState } from "react";
import { X, Printer, User, CalendarDays } from "lucide-react";
import {
  getRoster,
  getMarks,
  getTeachers,
  getClasses,
  getSettings,
  getAcademicYears,
} from "../../utils/api";
import {
  termSequences,
  computeTermAverage,
  computeFinalAverage,
  computePosition,
  computeSubjectRanks,
  computeSubjectClassAverage,
  buildStudentRecords,
  remarkForScale,
} from "../../utils/grading";
import { getSubjectsForStudent } from "../../utils/subjects";
import { ReportCardBody } from "./ReportCards";

const TERMS = Object.keys(termSequences);

function formatAdmission(dateStr) {
  if (!dateStr || dateStr === "—") return "—";
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export default function StudentHistoryModal({ student, onClose }) {
  const [roster, setRoster] = useState([]);
  const [classMarks, setClassMarks] = useState({});
  const [teachers, setTeachers] = useState([]);
  const [classMasterByClass, setClassMasterByClass] = useState({});
  const [settings, setSettings] = useState({
    academicYear: "",
    marksScale: "20",
    passAverage: "50",
  });
  const [term, setTerm] = useState("First Term");
  const [academicYears, setAcademicYears] = useState([]);
  const [selectedYear, setSelectedYear] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Load the roster/teachers/classes/settings once, and figure out which
  // academic year to start on — the currently configured one.
  useEffect(() => {
    let active = true;

    Promise.all([getRoster(student.class), getTeachers(), getClasses(), getSettings(), getAcademicYears()])
      .then(([rosterData, teacherData, classData, settingsData, years]) => {
        if (!active) return;
        setRoster(rosterData);
        setTeachers(teacherData);
        setSettings(settingsData);
        setAcademicYears(years);
        setSelectedYear((y) => y || settingsData.academicYear);
        if (termSequences[settingsData.currentTerm]) setTerm(settingsData.currentTerm);
        const masterMap = {};
        classData.forEach((c) => {
          masterMap[c.name] = c.teacher || "—";
        });
        setClassMasterByClass(masterMap);
      })
      .catch((err) => active && setError(err.message));

    return () => {
      active = false;
    };
  }, [student.id, student.class]);

  // Re-fetch marks whenever the selected academic year changes (or the
  // roster/student changes) so switching years shows that year's data.
  useEffect(() => {
    if (!selectedYear || roster.length === 0) return;
    let active = true;
    setLoading(true);
    setError("");

    const allSequences = Object.values(termSequences).flat();
    const subjectNames = Array.from(
      new Set(roster.flatMap((s) => getSubjectsForStudent(s).map((sub) => sub.name))),
    );
    Promise.all(
      subjectNames.flatMap((subjectName) =>
        allSequences.map((sequence) =>
          getMarks(student.class, subjectName, sequence, selectedYear).then((marks) => ({
            subject: subjectName,
            sequence,
            marks,
          })),
        ),
      ),
    )
      .then((results) => {
        if (!active) return;
        const bySubject = {};
        results.forEach(({ subject, sequence, marks }) => {
          bySubject[subject] = bySubject[subject] || {};
          bySubject[subject][sequence] = marks;
        });
        setClassMarks(bySubject);
      })
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [student.id, student.class, roster, selectedYear]);

  const recordsByTerm = useMemo(() => {
    const out = {};
    TERMS.forEach((t) => {
      out[t] = buildStudentRecords(roster, classMarks, t, teachers, settings);
    });
    return out;
  }, [roster, classMarks, teachers, settings]);

  const termAveragesByStudent = useMemo(
    () => ({
      "First Term": computeTermAverage(student, "First Term", classMarks),
      "Second Term": computeTermAverage(student, "Second Term", classMarks),
      "Third Term": computeTermAverage(student, "Third Term", classMarks),
    }),
    [student, classMarks],
  );
  const finalAverage = computeFinalAverage(termAveragesByStudent);

  const classNumber = useMemo(() => {
    const idx = roster.findIndex((s) => s.id === student.id);
    return idx >= 0 ? idx + 1 : null;
  }, [roster, student.id]);

  const activeRecords = recordsByTerm[term] || [];
  const record = activeRecords.find((r) => r.student.id === student.id) || null;
  const rank = record ? computePosition(student.id, activeRecords) : null;
  const scored = activeRecords.filter((r) => r.average != null);
  const classAverage = scored.length
    ? scored.reduce((sum, r) => sum + r.average, 0) / scored.length
    : null;
  const subjects = record
    ? record.subjects.map((s) => ({
        ...s,
        rank: computeSubjectRanks(student.id, activeRecords, s.name),
        classAverage: computeSubjectClassAverage(activeRecords, s.name),
        remark: remarkForScale(s.average, settings.marksScale),
      }))
    : [];

  function handlePrint() {
    window.print();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 print:hidden print:bg-transparent">
      <style>{`
        @media print {
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          @page { size: A4; margin: 8mm; }
          body * { visibility: hidden !important; }
          .student-history-print-area, .student-history-print-area * {
            visibility: visible !important;
          }
          .student-history-print-area {
            position: fixed !important;
            inset: 0 !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
          }
        }
      `}</style>

      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl print:max-h-none print:w-auto print:overflow-visible print:rounded-none print:shadow-none">
        {/* Header — profile + admission info */}
        <div className="flex items-start justify-between gap-4 border-b border-[#e2e8f0] p-5 print:hidden">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-md border border-[#e2e8f0] bg-[#f8fafc]">
              <AuthImage
                src={student.photo}
                alt={`${student.name} — photo`}
                className="h-full w-full object-cover"
                fallback={<User size={22} className="text-slate-300" />}
              />
            </div>
            <div>
              <h3 className="text-lg font-bold tracking-tight text-[#1e3a8a]">
                {student.name}
              </h3>
              <p className="font-mono text-xs text-slate-400">{student.code || student.id}</p>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                <CalendarDays size={13} className="text-slate-400" />
                Admitted: {formatAdmission(student.admittedOn)}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 hover:bg-[#f1f5f9] hover:text-[#1e3a8a]"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Academic year + term tabs + print action */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e2e8f0] px-5 py-3 print:hidden">
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="rounded-lg border border-[#e2e8f0] bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 focus:border-[#0ea5e9] focus:outline-none"
            >
              {academicYears.length === 0 && selectedYear && (
                <option value={selectedYear}>{selectedYear}</option>
              )}
              {academicYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <div className="flex gap-1 rounded-lg bg-[#f1f5f9] p-1">
              {TERMS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTerm(t)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                    term === t
                      ? "bg-white text-[#0b61a6] shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={handlePrint}
            disabled={!record || record.average == null}
            className="inline-flex items-center gap-2 rounded-lg border border-[#e2e8f0] px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-[#0ea5e9] hover:text-[#0b61a6] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Printer size={14} />
            Print this term
          </button>
        </div>

        <div className="overflow-y-auto p-5 print:overflow-visible print:p-0">
          {error && <p className="mb-4 text-sm text-rose-500 print:hidden">{error}</p>}

          {loading ? (
            <p className="py-12 text-center text-sm text-slate-400 print:hidden">
              Loading report cards…
            </p>
          ) : !record || record.average == null ? (
            <div className="rounded-xl border border-dashed border-[#e2e8f0] p-10 text-center text-sm text-slate-400 print:hidden">
              No marks recorded for {student.name} in {term} of {selectedYear} yet.
            </div>
          ) : (
            <div className="student-history-print-area flex justify-center">
              <ReportCardBody
                student={student}
                subjects={subjects}
                term={term}
                average={record.average}
                rank={rank}
                classSize={scored.length}
                classAverage={classAverage}
                totalWeighted={record.totalWeighted}
                papersPassed={record.papersPassed}
                papersSat={record.papersSat}
                papersFailed={record.papersFailed}
                classMasterByClass={classMasterByClass}
                settings={{ ...settings, academicYear: selectedYear }}
                classNumber={classNumber}
                termAverages={termAveragesByStudent}
                finalAverage={finalAverage}
              />
            </div>
          )}

          <p className="mt-4 text-center text-xs text-slate-400 print:hidden">
            Showing academic year {selectedYear || "—"}. Use the dropdown above to switch
            between any year this student has recorded marks in.
          </p>
        </div>
      </div>
    </div>
  );
}
