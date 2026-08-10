import AuthImage from "../../components/AuthImage";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Search, FileDown, Printer, ChevronRight, Layers } from "lucide-react";
import {
  Card,
  CardHeader,
  PageHeading,
  Button,
  Badge,
  Select,
} from "../../components/ui";

import {
  getClasses,
  getMarks,
  getRoster,
  logActivity,
  getTeachers,
  getSettings,
} from "../../utils/api";
import {
  statusForScale,
  remarkForScale,
  principalRemark,
  termSequences,
  computeTermAverage,
  computeFinalAverage,
  computePosition,
  competitionRank,
  computeSubjectRanks,
  computeSubjectClassAverage,
  buildStudentRecords,
  catLabel,
} from "../../utils/grading";
import {
  getSubjectsForStudent,
  requiresStream,
  compareClassNames,
} from "../../utils/subjects";

// Save the logo shared in chat as src/assets/sp-logo.jpeg (or update this
// path to wherever it lives in the project).
import spxccLogo from "../../assets/sp-logo.jpeg";
import {
  SCHOOL_NAME,
  SCHOOL_TOWN,
  SCHOOL_DIVISION,
  SCHOOL_MOTTO,
  SCHOOL_AGENCY,
} from "../../utils/schoolInfo";

/* ------------------------------------------------------------------ *
 *  All calculation / data logic below is UNCHANGED from the original
 *  file. Only the presentational components (the JSX + styling that
 *  render a student's report card) have been redesigned to match the
 *  school's actual "PROGRESS REPORT CARD" paper template.
 * ------------------------------------------------------------------ */

function formatDate(date) {
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

// settings.nextTermBegins is a plain "yyyy-mm-dd" string from a date input —
// render it the same friendly way as the rest of the card, or "—" if unset.
function formatNextTerm(dateStr) {
  if (!dateStr) return "—";
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return formatDate(date);
}

/* ------------------------------------------------------------------ *
 *  Presentational pieces — redesigned to match the paper template.
 * ------------------------------------------------------------------ */

const fmt1 = (v) => (v == null || Number.isNaN(v) ? "-" : Number(v).toFixed(1));
const fmt2 = (v) => (v == null || Number.isNaN(v) ? "-" : Number(v).toFixed(2));

// Column widths taken from the original template (percent of table width).
const COLS = [15, 7, 7, 9, 9, 5, 9, 8, 15, 16];

export function ReportCardBody({
  student,
  subjects,
  term,
  average,
  rank,
  classSize,
  classAverage,
  totalWeighted,
  papersPassed,
  papersSat,
  papersFailed,
  classMasterByClass,
  settings,
  className = "",
  classNumber,
  termAverages,
  finalAverage,
}) {
  const classMasterName = classMasterByClass?.[student.class] || "";
  const termLabel = (term || "").replace(" Term", "").toUpperCase();
  const isThirdTerm = term === "Third Term";
  // Principal-configured pass average (% of the marks scale) — set in
  // Settings → Academic Structure. Defaults to 50% if never configured.
  const passThreshold =
    (Number(settings.marksScale) || 20) *
    ((Number(settings.passAverage) || 50) / 100);
  const isSatisfactory = average != null && average >= passThreshold;
  const isUnsatisfactory = average != null && average < passThreshold;
  const [seqLabel1, seqLabel2] = termSequences[term] || [
    "Sequence 1",
    "Sequence 2",
  ];

  return (
    <div
      className={`report-card-sheet flex flex-col border border-black bg-white p-6 font-serif text-black print:aspect-[210/297] print:border-0 print:p-3 ${className}`}
    >
      {/* Letterhead — school logo (left), identity block (center), and the
          student's own photo (top right), all sharing the same row. */}
      <div className="flex flex-shrink-0 items-start gap-20 text-center leading-snug print:gap-20">
        <img
          src={spxccLogo}
          alt="School logo"
          style={{ borderRadius: "50%", marginLeft: "0px" }}
          className="h-40 w-40 flex-shrink-0 object-contain print:h-30 print:w-30"
        />
        <div>
          <p className="font-bold uppercase text-[12px]">{SCHOOL_AGENCY}</p>
          <p className="text-[13px] font-bold uppercase print:text-[10.5px]">
            Diocese of Kumbo, Northwest Region- Cameroon
          </p>
          <p className="mt-1.5 text-[24px] font-bold uppercase underline print:mt-1 print:text-[17px]">
            {SCHOOL_NAME}
          </p>
          <p className="mt-1 text-[14px] print:text-[11px]">
            P.O. Box 20 {SCHOOL_TOWN}
          </p>
          <p className="text-[14px] print:text-[11px]">{SCHOOL_DIVISION}</p>
          <p className="text-[14px] italic print:text-[11px]">
            ({SCHOOL_MOTTO})
          </p>
        </div>

        {/* Student passport photo — flush right on the same row as the
            school logo/identity block. */}
        <div className="ml-auto flex-shrink-0">
          <AuthImage
            src={student.photo}
            alt={`${student.name} — photo`}
            className="h-40 w-40 border border-black object-cover print:h-34 print:w-30"
            fallback={
              <div className="flex h-42 w-28 items-center justify-center border border-black text-[10px] uppercase text-slate-400 print:h-24 print:w-20 print:text-[8px]">
                Photo
              </div>
            }
          />
        </div>
      </div>

      {/* Title / academic-year / term / name block */}
      <div className="mt-4 flex-shrink-0 print:mt-3">
        <p className="text-center text-[28px] font-bold uppercase tracking-wide print:text-[20px]">
          Progress Report Card
        </p>

        <div className="mt-3 flex items-baseline justify-between px-1 text-[15px] print:mt-2 print:text-[11.5px]">
          <p className="uppercase">
            Academic Year:{" "}
            <span className="font-bold">{settings.academicYear || "—"}</span>
          </p>
          <p className="uppercase">
            Term: <span className="font-bold">{termLabel}</span>
          </p>
        </div>

        <p className="mt-2 px-1 text-[17px] font-bold uppercase print:mt-1.5 print:text-[13px]">
          Name:{" "}
          <span className="underline decoration-1 underline-offset-4">
            {student.name}
          </span>
        </p>
      </div>

      {/* Identification strip */}
      {/* border-separate (not collapse) — at the small scale this card is
          shown/printed at, collapsed borders can leave hairline gaps in
          some browsers where a shared edge doesn't get drawn. Separate
          borders with zero spacing draw every edge independently so no
          line ever silently disappears. */}
      <table className="w-full flex-shrink-0 border border-black text-center [border-collapse:separate] [border-spacing:0]">
        <thead>
          <tr>
            <th className="border border-black px-3 py-1 text-[14px] font-bold uppercase print:text-[10.5px]">
              Class
            </th>
            <th className="border border-black px-3 py-1 text-[14px] font-bold uppercase print:text-[10.5px]">
              Sex
            </th>
            <th className="border border-black px-3 py-1 text-[14px] font-bold uppercase print:text-[10.5px]">
              Class Nº
            </th>
            <th className="border border-black px-3 py-1 text-[14px] font-bold uppercase print:text-[10.5px]">
              Admin Nº
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="border border-black px-3 py-1.5 text-[16px] font-bold uppercase print:text-[12px]">
              {student.class}
            </td>
            <td className="border border-black px-3 py-1.5 text-[16px] font-bold uppercase print:text-[12px]">
              {student.gender ? student.gender[0] : "—"}
            </td>
            <td className="border border-black px-3 py-1.5 text-[16px] font-bold uppercase print:text-[12px]">
              {classNumber ?? "—"}
            </td>
            <td className="border border-black px-3 py-1.5 text-[16px] font-bold uppercase print:text-[12px]">
              {student.code || student.id}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Marks table — grows to absorb all leftover page height */}
      <div className="report-card-subjects flex flex-col print:flex-1">
        <table className="w-full text-center [border-collapse:separate] [border-spacing:0] print:h-full print:flex-1">
          <colgroup>
            {COLS.map((w, i) => (
              <col key={i} style={{ width: `${w}%` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="border border-black px-1.5 py-1.5 text-[12px] font-bold uppercase print:text-[9px]">
                Subject
              </th>
              <th className="border border-black px-1.5 py-1.5 text-[12px] font-bold uppercase leading-tight print:text-[9px]">
                {catLabel(seqLabel1)}
                <br />({settings.marksScale || 20})
              </th>
              <th className="border border-black px-1.5 py-1.5 text-[12px] font-bold uppercase leading-tight print:text-[9px]">
                {catLabel(seqLabel2)}
                <br />({settings.marksScale || 20})
              </th>
              <th className="border border-black px-1.5 py-1.5 text-[12px] font-bold uppercase print:text-[9px]">
                Terminal Avr.
              </th>
              <th className="border border-black px-1.5 py-1.5 text-[12px] font-bold uppercase print:text-[9px]">
                Terminal Coef. Mark
              </th>
              <th className="border border-black px-1.5 py-1.5 text-[12px] font-bold uppercase print:text-[9px]">
                Coef
              </th>
              <th className="border border-black px-1.5 py-1.5 text-[12px] font-bold uppercase leading-tight print:text-[9px]">
                Subj.
                <br />
                Position
              </th>
              <th className="border border-black px-1.5 py-1.5 text-[12px] font-bold uppercase leading-tight print:text-[9px]">
                Subj.
                <br />
                Avr.
              </th>
              <th className="border border-black px-1.5 py-1.5 text-[12px] font-bold uppercase leading-tight print:text-[9px]">
                Teacher's
                <br />
                Remark
              </th>
              <th className="border border-black px-1.5 py-1.5 text-[12px] font-bold uppercase print:text-[9px]">
                Teacher's Name
              </th>
            </tr>
          </thead>
          <tbody>
            {subjects.map((subject) => (
              <tr key={subject.name} className="report-card-row">
                <td className="border border-black px-1.5 py-2 text-left text-[13px] font-semibold uppercase print:text-[9.5px]">
                  {subject.name}
                </td>
                <td className="border border-black px-1.5 py-2 text-[13px] font-bold print:text-[9.5px]">
                  {fmt1(subject.marks[0])}
                </td>
                <td className="border border-black px-1.5 py-2 text-[13px] font-bold print:text-[9.5px]">
                  {fmt1(subject.marks[1])}
                </td>
                <td className="border border-black px-1.5 py-2 text-[13px] font-bold print:text-[9.5px]">
                  {fmt1(subject.average)}
                </td>
                <td className="border border-black px-1.5 py-2 text-[13px] font-bold print:text-[9.5px]">
                  {subject.average == null
                    ? "-"
                    : fmt1(subject.average * subject.coefficient)}
                </td>
                <td className="border border-black px-1.5 py-2 text-[13px] font-bold print:text-[9.5px]">
                  {subject.coefficient}
                </td>
                <td className="border border-black px-1.5 py-2 text-[13px] font-bold print:text-[9.5px]">
                  {subject.rank ?? "-"}
                </td>
                <td className="border border-black px-1.5 py-2 text-[13px] font-bold print:text-[9.5px]">
                  {fmt1(subject.classAverage)}
                </td>
                <td className="border border-black px-1.5 py-2 text-[13px] font-bold print:text-[9.5px]">
                  {subject.average == null ? "-" : subject.remark}
                </td>
                <td className="border border-black px-1.5 py-2 text-[13px] print:text-[9.5px]">
                  {subject.average == null ? "-" : subject.teacher}
                </td>
              </tr>
            ))}
            {/* Filler row absorbs any remaining height so the table always
                reaches the bottom of the page, whether the class has 8
                subjects or 18. Its height is set as an explicit pixel value
                by the beforeprint handler below — percentage heights on
                table rows/cells are not reliably honored by browsers, so we
                measure the real leftover space and assign it directly. */}
            <tr className="report-card-filler" aria-hidden="true">
              <td colSpan={10} className="border border-black p-0" />
            </tr>
          </tbody>
        </table>
      </div>

      {/* Fixed gap so the table never touches the summary strip when printed */}
      <div className="report-card-gap flex-shrink-0" aria-hidden="true" />

      {/* Summary strip — left: running totals/rank/term averages as plain
          lines; right: a small grid of pass/fail KPIs. Replaces the two
          separate tables that used to sit here. */}
      <div className="report-card-summary mt-2 flex w-full flex-shrink-0 border border-black text-left">
        <div className="flex w-[56%] flex-col justify-center gap-1 border-r border-black px-3 py-2 text-[13px] font-bold uppercase print:px-2 print:py-1.5 print:text-[10px]">
          <p>
            Tot. Marks:{" "}
            <span className="font-normal normal-case">
              {fmt2(totalWeighted)}
            </span>
          </p>
          <p>
            Average:{" "}
            <span className="font-normal normal-case">
              {fmt2(average)} / {settings.marksScale || 20}
            </span>
          </p>
          <p>
            {isThirdTerm ? "Annual Rank" : "Rank"}:{" "}
            <span className="font-normal normal-case">{rank ?? "—"}</span>
          </p>
          {term !== "First Term" && (
            <p>
              Term Averages:{" "}
              <span className="font-normal normal-case">
                {isThirdTerm
                  ? `First: ${fmt2(termAverages?.["First Term"])}, Second: ${fmt2(
                      termAverages?.["Second Term"],
                    )}, Third: ${fmt2(
                      termAverages?.["Third Term"],
                    )}, Annual: ${fmt2(finalAverage)}`
                  : `First: ${fmt2(termAverages?.["First Term"])}`}
              </span>
            </p>
          )}
        </div>

        <div className="grid w-[44%] grid-cols-3 text-center">
          <div className="border-b border-r border-black px-1 py-1.5 print:py-1">
            <p className="text-[10px] font-bold uppercase print:text-[8px]">
              {isThirdTerm ? "Annual Pos." : "Position"}
            </p>
            <p className="text-[14px] font-bold print:text-[10.5px]">
              {rank ?? "—"}/{classSize || "—"}
            </p>
          </div>
          <div className="border-b border-r border-black px-1 py-1.5 print:py-1">
            <p className="text-[10px] font-bold uppercase print:text-[8px]">
              Class Avg
            </p>
            <p className="text-[14px] font-bold print:text-[10.5px]">
              {fmt2(classAverage)}
            </p>
          </div>
          <div className="border-b border-black px-1 py-1.5 print:py-1">
            <p className="text-[10px] font-bold uppercase print:text-[8px]">
              Status
            </p>
            <p className="text-[14px] font-bold print:text-[10.5px]">
              {statusForScale(
                average,
                settings.marksScale,
                settings.passAverage,
              )}
            </p>
          </div>
          <div className="border-r border-black px-1 py-1.5 print:py-1">
            <p className="text-[10px] font-bold uppercase print:text-[8px]">
              Sat
            </p>
            <p className="text-[14px] font-bold print:text-[10.5px]">
              {papersSat ?? "—"}
            </p>
          </div>
          <div className="border-r border-black px-1 py-1.5 print:py-1">
            <p className="text-[10px] font-bold uppercase print:text-[8px]">
              Passed
            </p>
            <p className="text-[14px] font-bold print:text-[10.5px]">
              {papersPassed}
            </p>
          </div>
          <div className="px-1 py-1.5 print:py-1">
            <p className="text-[10px] font-bold uppercase print:text-[8px]">
              Failed
            </p>
            <p className="text-[14px] font-bold print:text-[10.5px]">
              {papersFailed ?? "—"}
            </p>
          </div>
        </div>
      </div>

      {/* Council decision / overall remark */}
      <div className="mt-3 flex w-full flex-shrink-0 border border-black text-left print:mt-2">
        {/* Left: Class/Disciplinary Council Decision */}
        <div className="flex w-[68%] flex-col border-r border-black">
          <div className="border-b border-black px-3 py-1 text-center text-[13px] font-bold uppercase print:text-[10px]">
            Class/Disciplinary Council Decision
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-black px-3 py-1.5 text-[12px] font-bold uppercase print:text-[9.5px]">
            <span>Conduct:</span>
            <span className="flex items-center gap-1.5">
              <span className="inline-flex h-3 w-3 flex-shrink-0 items-center justify-center border border-black text-[9px] leading-none print:h-2.5 print:w-2.5">
                {isSatisfactory ? "✓" : ""}
              </span>
              Satisfactory
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-flex h-3 w-3 flex-shrink-0 items-center justify-center border border-black text-[9px] leading-none print:h-2.5 print:w-2.5">
                {isUnsatisfactory ? "✓" : ""}
              </span>
              Unsatisfactory
            </span>
          </div>
          <div className="h-6 border-b border-black print:h-4">&nbsp;</div>
          <div className="border-b border-black px-3 py-1 text-[13px] font-bold uppercase print:text-[10px]">
            Principal's Remark
          </div>
          <div className="min-h-[2.5rem] flex-1 px-3 py-1.5 text-[12px] italic leading-snug print:min-h-[1.75rem] print:text-[9.5px]">
            {average != null
              ? principalRemark(
                  average,
                  settings.marksScale,
                  settings.passAverage,
                )
              : " "}
          </div>
        </div>

        {/* Right: Overall Remark */}
        <div className="flex w-[32%] flex-col">
          <div className="border-b border-black px-3 py-1 text-center text-[13px] font-bold uppercase print:text-[10px]">
            Overall Remark
          </div>
          <div className="flex min-h-[5rem] flex-1 items-center justify-center px-2 py-1.5 text-center text-[13px] font-bold uppercase print:min-h-[3.5rem] print:text-[10px]">
            {average != null
              ? remarkForScale(average, settings.marksScale)
              : " "}
          </div>
          <div className="border-t border-black px-3 py-1 text-right text-[12px] font-bold uppercase print:text-[9.5px]">
            Next Term: {formatNextTerm(settings.nextTermBegins)}
          </div>
        </div>
      </div>

      {/* Signatures — sit directly beneath the box above, acting as the
          underline for each name (matches the paper template, where the
          box's own bottom edge doubles as the signature line). */}
      <div className="mt-1 grid flex-shrink-0 grid-cols-3 gap-6 text-center print:mt-1">
        <div>
          <p className="text-[13px] font-bold uppercase print:text-[10px]">
            Class Master/Mistress
          </p>
          {classMasterName && (
            <p className="text-[12px] print:text-[9px]">{classMasterName}</p>
          )}
        </div>
        <div>
          <p className="text-[13px] font-bold uppercase print:text-[10px]">
            Dean of Studies
          </p>
        </div>
        <div>
          <p className="text-[13px] font-bold uppercase print:text-[10px]">
            Principal
          </p>
          {/* Principal's stamp + signature, uploaded once in Settings and
              reused on every report card — side by side, sitting below
              the "Principal" label. */}
          {(settings.principalStamp || settings.principalSignature) && (
            <div className="mx-auto mt-1 flex items-end justify-center ">
              {settings.principalSignature && (
                <img
                  src={settings.principalSignature}
                  alt="Principal's signature"
                  className="h-25 object-contain print:h-25"
                />
              )}
              {settings.principalStamp && (
                <img
                  src={settings.principalStamp}
                  alt="School stamp"
                  className="h-30 w-30 object-contain print:h-30 print:w-30"
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Page component — all data fetching / state / effects unchanged
 *  except for the new "fillSubjectRows" print helper below.
 * ------------------------------------------------------------------ */

export default function ReportCards() {
  const location = useLocation();
  const [classes, setClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState("");
  const [students, setStudents] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("Second Term");
  const [classMarks, setClassMarks] = useState({});
  const [error, setError] = useState("");
  const [printAll, setPrintAll] = useState(false);
  const [optionFilter, setOptionFilter] = useState("All");
  const [teachers, setTeachers] = useState([]);
  const [classMasterByClass, setClassMasterByClass] = useState({});
  const [settings, setSettings] = useState({
    schoolName: "SCHOOL",
    schoolTown: "",
    regionalDelegation: "",
    subDivision: "",
    motto: "",
    academicYear: "",
    marksScale: "20",
    passAverage: "50",
    principalStamp: "",
    principalSignature: "",
    nextTermBegins: "",
  });
  const [pendingJump, setPendingJump] = useState(() => location.state || null);

  useEffect(() => {
    getClasses()
      .then((data) => {
        const classNames = data
          .map((item) => item.name)
          .sort(compareClassNames);
        setClasses(classNames);

        const masterMap = {};
        data.forEach((c) => {
          masterMap[c.name] = c.teacher || "—";
        });
        setClassMasterByClass(masterMap);

        const jumpClass = pendingJump?.className;
        if (jumpClass && classNames.includes(jumpClass)) {
          setSelectedClass(jumpClass);
        } else if (classNames.length > 0) {
          setSelectedClass(classNames[0]);
        }
      })
      .catch((err) => setError(err.message));

    getTeachers()
      .then(setTeachers)
      .catch((err) => setError(err.message));

    // Default to whatever the school has set as the current term, and pick
    // up the school identity / marks-scale fields for the letterhead.
    getSettings()
      .then((s) => {
        setSettings(s);
        if (termSequences[s.currentTerm]) {
          setTerm(s.currentTerm);
        }
      })
      .catch(() => {
        // Keep the built-in defaults if settings can't be loaded.
      });
  }, []);

  useEffect(() => {
    if (!selectedClass) return;
    getRoster(selectedClass)
      .then((data) => {
        setStudents(data);
        const jumpId = pendingJump?.studentId;
        if (jumpId) {
          const match = data.find((s) => s.id === jumpId);
          setSelectedStudent(match || data[0] || null);
          if (match) setSearch(match.name);
          setPendingJump(null);
        } else {
          setSelectedStudent(data[0] || null);
        }
      })
      .catch((err) => setError(err.message));
  }, [selectedClass]);

  useEffect(() => {
    if (!selectedClass) return;

    let active = true;
    // Fetch every sequence across all three terms (not just the one
    // currently selected) so we can always compute First/Second/Third
    // term averages for the summary row, regardless of which term the
    // person is viewing.
    const allSequences = Object.values(termSequences).flat();

    const loadMarks = async () => {
      try {
        // Different students may study different subjects (Science vs
        // Arts, plus electives), so we fetch marks for the union of every
        // subject actually studied by anyone in this class roster —
        // not a single fixed subject list.
        const subjectNames = Array.from(
          new Set(
            students.flatMap((s) =>
              getSubjectsForStudent(s).map((sub) => sub.name),
            ),
          ),
        );

        const results = await Promise.all(
          subjectNames.flatMap((subjectName) =>
            allSequences.map((sequence) =>
              getMarks(selectedClass, subjectName, sequence).then((marks) => ({
                subject: subjectName,
                sequence,
                marks,
              })),
            ),
          ),
        );

        if (!active) return;

        const marksBySubject = {};
        results.forEach(({ subject, sequence, marks }) => {
          marksBySubject[subject] = marksBySubject[subject] || {};
          marksBySubject[subject][sequence] = marks;
        });

        setClassMarks(marksBySubject);
      } catch (err) {
        if (active) setError(err.message);
      }
    };

    loadMarks();

    return () => {
      active = false;
    };
  }, [selectedClass, students]);

  useEffect(() => {
    if (!printAll) return;
    const timer = setTimeout(() => {
      window.print();
    }, 150);
    return () => clearTimeout(timer);
  }, [printAll]);

  useEffect(() => {
    function handleAfterPrint() {
      setPrintAll(false);
    }
    window.addEventListener("afterprint", handleAfterPrint);
    return () => window.removeEventListener("afterprint", handleAfterPrint);
  }, []);

  // Percentage heights on <tr>/<td> are not reliably honored by browsers,
  // so the CSS-only "filler row fills leftover page height" trick leaves a
  // blank, unbordered gap between the subjects table and the summary strip
  // when printing. Right before the browser switches to print rendering
  // (by which point the @media print rules are already applied), measure
  // how much vertical space is actually left under the real subject rows
  // and assign that as an explicit pixel height on the filler row/cell —
  // pixel heights are always honored, unlike percentages on table rows.
  useEffect(() => {
    function fillSubjectRows() {
      document
        .querySelectorAll(".report-card-print-area .report-card-subjects")
        .forEach((wrapper) => {
          const table = wrapper.querySelector("table");
          const filler = table?.querySelector(".report-card-filler");
          if (!table || !filler) return;

          const tdEl = filler.querySelector("td");
          filler.style.height = "0px";
          if (tdEl) tdEl.style.height = "0px";

          const thead = table.querySelector("thead");
          const dataRows = table.querySelectorAll(
            "tbody tr:not(.report-card-filler)",
          );
          const used =
            (thead?.getBoundingClientRect().height || 0) +
            Array.from(dataRows).reduce(
              (sum, row) => sum + row.getBoundingClientRect().height,
              0,
            );

          const remaining = Math.max(
            0,
            wrapper.getBoundingClientRect().height - used,
          );
          filler.style.height = `${remaining}px`;
          if (tdEl) tdEl.style.height = `${remaining}px`;
        });
    }

    window.addEventListener("beforeprint", fillSubjectRows);
    return () => window.removeEventListener("beforeprint", fillSubjectRows);
  }, []);

  const streamed = requiresStream(selectedClass);

  const filteredStudents = useMemo(
    () =>
      students
        .filter((student) =>
          streamed && optionFilter !== "All"
            ? student.option === optionFilter
            : true,
        )
        .filter((student) =>
          `${student.name} ${student.code || student.id}`
            .toLowerCase()
            .includes(search.toLowerCase()),
        ),
    [students, search, streamed, optionFilter],
  );

  const studentRecords = useMemo(
    () => buildStudentRecords(students, classMarks, term, teachers, settings),
    [
      students,
      classMarks,
      term,
      teachers,
      settings.marksScale,
      settings.passAverage,
    ],
  );

  const selectedRecord = useMemo(
    () =>
      selectedStudent
        ? studentRecords.find(
            (record) => record.student.id === selectedStudent.id,
          )
        : null,
    [studentRecords, selectedStudent],
  );

  const classAverage = useMemo(() => {
    const scored = studentRecords.filter((record) => record.average != null);
    if (!scored.length) return null;
    return (
      scored.reduce((sum, record) => sum + record.average, 0) / scored.length
    );
  }, [studentRecords]);

  const selectedRank = useMemo(
    () =>
      selectedRecord
        ? computePosition(selectedRecord.student.id, studentRecords)
        : null,
    [selectedRecord, studentRecords],
  );

  const selectedSubjects = useMemo(() => {
    if (!selectedRecord) return [];
    return selectedRecord.subjects.map((s) => ({
      ...s,
      rank: computeSubjectRanks(
        selectedRecord.student.id,
        studentRecords,
        s.name,
      ),
      classAverage: computeSubjectClassAverage(studentRecords, s.name),
      remark: remarkForScale(s.average, settings.marksScale),
    }));
  }, [selectedRecord, studentRecords, settings.marksScale]);

  // Each student's average for every term, independent of whichever term
  // is currently selected — used for the Third Term annual summary only.
  const termAveragesByStudent = useMemo(() => {
    const map = {};
    students.forEach((student) => {
      map[student.id] = {
        "First Term": computeTermAverage(student, "First Term", classMarks),
        "Second Term": computeTermAverage(student, "Second Term", classMarks),
        "Third Term": computeTermAverage(student, "Third Term", classMarks),
      };
    });
    return map;
  }, [students, classMarks]);

  function getTermAverages(studentId) {
    return (
      termAveragesByStudent[studentId] || {
        "First Term": null,
        "Second Term": null,
        "Third Term": null,
      }
    );
  }

  function getFinalAverage(studentId) {
    return computeFinalAverage(getTermAverages(studentId));
  }

  // Annual rankings across the class (only meaningful on Third Term cards).
  const annualStats = useMemo(() => {
    const ranking = students
      .map((s) => ({
        id: s.id,
        score: computeFinalAverage(termAveragesByStudent[s.id]),
      }))
      .filter((row) => row.score != null)
      .sort((a, b) => b.score - a.score);

    const classAvg =
      ranking.length === 0
        ? null
        : ranking.reduce((sum, row) => sum + row.score, 0) / ranking.length;

    const byId = {};
    students.forEach((s) => {
      byId[s.id] = {
        rank: competitionRank(s.id, ranking),
        classSize: ranking.length,
        classAverage: classAvg,
      };
    });
    return byId;
  }, [students, termAveragesByStudent]);

  const scoredClassSize = useMemo(
    () => studentRecords.filter((r) => r.average != null).length,
    [studentRecords],
  );

  // "Class Nº" = the student's number/position in the class. Prefers a
  // real backend field if one exists; otherwise falls back to the
  // student's 1-based position in the class roster as returned by
  // getRoster.
  const classNumberByStudentId = useMemo(() => {
    const map = {};
    students.forEach((s, i) => {
      map[s.id] = s.classNumber ?? i + 1;
    });
    return map;
  }, [students]);

  const reportDate = formatDate(new Date());

  function handlePrint() {
    if (selectedStudent) {
      logActivity(
        "Report Card",
        `Report card generated — ${selectedStudent.name} (${selectedClass})`,
      ).catch(() => {});
    }
    window.print();
  }

  function handlePrintAll() {
    if (!studentRecords.length) return;
    logActivity(
      "Report Card",
      `Report cards generated — ${selectedClass} (${studentRecords.length} students)`,
    ).catch(() => {});
    setPrintAll(true);
  }

  return (
    <>
      <style>{`
        @media print {
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
          @page {
            size: A4;
            margin: 8mm;
          }
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            height: auto !important;
          }

          /* Isolate the report card for printing.
             Everything on the page is hidden by default, then only the
             print area (and everything inside it) is revealed again. This
             reliably hides ANY surrounding chrome — navbar, breadcrumbs,
             sidebar, search bar — even though that chrome lives in a parent
             layout component this file doesn't control, and even if that
             parent never applies a "print:hidden" class of its own. */
          body * {
            visibility: hidden !important;
          }
          .report-card-print-area,
          .report-card-print-area * {
            visibility: visible !important;
          }

          .report-card-print-area {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            height: 281mm !important;
            margin: 0 !important;
            padding: 0 !important;
          }

          /* Fill the printable A4 area (297mm − 2×8mm margins ≈ 281mm).
             Every section keeps its natural height except the subjects
             table, which grows to absorb whatever height is left so the
             card always reaches the bottom of the sheet. The actual
             leftover-space calculation for the filler row happens in JS
             (see fillSubjectRows in the component) since percentage
             heights on table rows/cells aren't reliably honored. */
          .report-card-sheet {
            box-sizing: border-box;
            height: 100% !important;
            max-height: 100% !important;
            display: flex;
            flex-direction: column;
            page-break-inside: avoid;
            break-inside: avoid;
            overflow: hidden;
          }
          .report-card-sheet > *:not(.report-card-subjects) {
            flex-shrink: 0;
          }
          .report-card-subjects {
            flex: 1 1 auto;
            min-height: 0;
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }
          .report-card-subjects table {
            width: 100%;
            height: 100%;
            border-collapse: separate;
            border-spacing: 0;
          }
          .report-card-subjects tbody {
            display: table-row-group;
          }

          .report-card-page {
            page-break-after: always;
            break-after: page;
            height: 281mm;
          }
          .report-card-page:last-child {
            page-break-after: auto;
            break-after: auto;
          }
          .report-card-sheet table {
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .report-card-row td {
            padding-top: 2px;
            padding-bottom: 1px;
          }
          .report-card-gap {
            height: 1.5mm;
          }
          .report-card-summary {
            margin-top: 0 !important;
          }
        }
      `}</style>

      <div className="print:hidden">
        <PageHeading
          title="Report Cards"
          subtitle="Choose a class and generate a printable report card for any student."
          action={
            <Button
              icon={Layers}
              variant="outline"
              onClick={handlePrintAll}
              disabled={!selectedClass || !studentRecords.length}
            >
              Print All — {selectedClass || "Select a class"}
            </Button>
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[280px_1fr]">
        <div className="space-y-6 print:hidden">
          <Card>
            <CardHeader
              title="Classes"
              subtitle="Pick a class to explore report cards."
            />
            <div className="space-y-2">
              {classes.map((name) => (
                <button
                  key={name}
                  className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
                    selectedClass === name
                      ? "border-[#0ea5e9] bg-[#0ea5e9]/10 text-[#0b61a6]"
                      : "border-[#e2e8f0] bg-white text-slate-700 hover:border-[#0ea5e9] hover:bg-[#f1f5f9]"
                  }`}
                  onClick={() => {
                    setSelectedClass(name);
                    setOptionFilter("All");
                  }}
                >
                  <span>{name}</span>
                  <ChevronRight size={18} />
                </button>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Class roster"
              subtitle={
                selectedClass
                  ? `${students.length} students`
                  : "Select a class first"
              }
            />
            <div className="relative mb-4">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search student name or ID…"
                className="w-full rounded-full border border-[#e2e8f0] bg-[#f1f5f9] py-2 pl-9 pr-3 text-sm text-slate-600 placeholder:text-slate-400 focus:border-[#0ea5e9] focus:bg-white focus:outline-none"
              />
            </div>
            {streamed && (
              <div className="mb-4">
                <Select
                  value={optionFilter}
                  onChange={(e) => {
                    setOptionFilter(e.target.value);
                    setSelectedStudent(null);
                  }}
                >
                  <option value="All">All Options</option>
                  <option value="Science">Science</option>
                  <option value="Arts">Arts</option>
                </Select>
              </div>
            )}
            {filteredStudents.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#e2e8f0] p-6 text-center text-sm text-slate-400">
                {selectedClass
                  ? "No matching students found."
                  : "Pick a class to view students."}
              </div>
            ) : (
              // Roster list scrolls internally once it grows past ~10
              // students, so a big class doesn't push the rest of the page
              // (term selector, print buttons, etc.) out of view.
              <div className="max-h-[880px] space-y-2 overflow-y-auto pr-1">
                {filteredStudents.map((student) => (
                  <button
                    key={student.code || student.id}
                    onClick={() => setSelectedStudent(student)}
                    className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
                      selectedStudent?.id === student.id
                        ? "border-[#0ea5e9] bg-[#0ea5e9]/10 text-[#0b61a6]"
                        : "border-[#e2e8f0] bg-white text-slate-700 hover:border-[#0ea5e9] hover:bg-[#f1f5f9]"
                    }`}
                  >
                    <div>
                      <div className="font-medium">{student.name}</div>
                      <div className="text-xs text-slate-400">
                        {student.code || student.id}
                        {student.option ? ` · ${student.option}` : ""}
                      </div>
                    </div>
                    <Badge tone="slate">Generate</Badge>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="print:rounded-none print:border-0 print:p-0 print:shadow-none">
            <div className="print:hidden">
              <CardHeader
                title="Report card preview"
                subtitle={
                  selectedStudent
                    ? "Ready to print or save."
                    : "Choose a student to generate the report card."
                }
              />
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm text-slate-500">Selected Class</div>
                  <div className="text-lg font-semibold text-[#1e3a8a]">
                    {selectedClass || "None"}
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Select
                    value={term}
                    onChange={(e) => setTerm(e.target.value)}
                    className="max-w-[180px]"
                  >
                    {Object.keys(termSequences).map((termName) => (
                      <option key={termName}>{termName}</option>
                    ))}
                  </Select>
                  <Button
                    variant="outline"
                    icon={Printer}
                    onClick={handlePrint}
                  >
                    Print
                  </Button>
                  <Button icon={FileDown} onClick={handlePrint}>
                    Download PDF
                  </Button>
                </div>
              </div>
              {error && <p className="text-sm text-rose-500">{error}</p>}
            </div>

            {!selectedStudent ? (
              <div className="rounded-xl border border-dashed border-[#e2e8f0] p-6 text-center text-sm text-slate-400 print:hidden">
                Pick a student to view the full report card.
              </div>
            ) : (
              <ReportCardBody
                className={printAll ? "" : "report-card-print-area"}
                student={selectedStudent}
                subjects={selectedSubjects}
                term={term}
                average={selectedRecord ? selectedRecord.average : null}
                rank={
                  term === "Third Term"
                    ? (annualStats[selectedStudent.id]?.rank ?? null)
                    : selectedRank
                }
                classSize={
                  term === "Third Term"
                    ? annualStats[selectedStudent.id]?.classSize ||
                      students.length
                    : scoredClassSize || students.length
                }
                classAverage={classAverage}
                totalWeighted={
                  selectedRecord ? selectedRecord.totalWeighted : 0
                }
                papersPassed={selectedRecord ? selectedRecord.papersPassed : 0}
                papersSat={selectedRecord ? selectedRecord.papersSat : 0}
                papersFailed={selectedRecord ? selectedRecord.papersFailed : 0}
                gceStatus={selectedRecord ? selectedRecord.gceStatus : null}
                classMasterByClass={classMasterByClass}
                settings={settings}
                classNumber={classNumberByStudentId[selectedStudent.id]}
                termAverages={getTermAverages(selectedStudent.id)}
                finalAverage={getFinalAverage(selectedStudent.id)}
              />
            )}
          </Card>
        </div>
      </div>

      {printAll && (
        <div className="report-card-print-area absolute -left-[9999px] top-0 w-full space-y-6 p-6">
          {studentRecords.map((record) => {
            const isThirdTermPrint = term === "Third Term";
            const rank = isThirdTermPrint
              ? (annualStats[record.student.id]?.rank ?? null)
              : computePosition(record.student.id, studentRecords);
            const cardClassSize = isThirdTermPrint
              ? annualStats[record.student.id]?.classSize || students.length
              : scoredClassSize || students.length;
            const augmentedSubjects = record.subjects.map((s) => ({
              ...s,
              rank: computeSubjectRanks(
                record.student.id,
                studentRecords,
                s.name,
              ),
              classAverage: computeSubjectClassAverage(studentRecords, s.name),
              remark: remarkForScale(s.average, settings.marksScale),
            }));
            return (
              <div key={record.student.id} className="report-card-page">
                <ReportCardBody
                  student={record.student}
                  subjects={augmentedSubjects}
                  term={term}
                  average={record.average}
                  rank={rank}
                  classSize={cardClassSize}
                  classAverage={classAverage}
                  totalWeighted={record.totalWeighted}
                  papersPassed={record.papersPassed}
                  papersSat={record.papersSat}
                  papersFailed={record.papersFailed}
                  gceStatus={record.gceStatus}
                  classMasterByClass={classMasterByClass}
                  settings={settings}
                  classNumber={classNumberByStudentId[record.student.id]}
                  termAverages={getTermAverages(record.student.id)}
                  finalAverage={getFinalAverage(record.student.id)}
                />
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
