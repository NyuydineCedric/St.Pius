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
  gradeForScale,
  statusForScale,
  remarkForScale,
} from "../../utils/grading";
import logo from "../../assets/logo.jpg";
import stamp from "../../assets/stamp.webp";
import signature from "../../assets/signature.jpg";
import {
  getSubjectsForStudent,
  getTeacherName,
  requiresStream,
  compareClassNames,
} from "../../utils/subjects";

const termSequences = {
  "First Term": ["Sequence 1", "Sequence 2"],
  "Second Term": ["Sequence 3", "Sequence 4"],
  "Third Term": ["Sequence 5", "Sequence 6"],
};

function formatDate(date) {
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function computeSubjectRanks(studentId, records, subjectName) {
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

/** Class position for the current term (1 = highest average). Ties share rank. */
function computePosition(studentId, records) {
  const ranking = records
    .filter((r) => r.average != null)
    .map((r) => ({ id: r.student.id, score: r.average }))
    .sort((a, b) => b.score - a.score);
  return competitionRank(studentId, ranking);
}

/** Competition ranking: 1, 2, 2, 4 — equal scores share the same place. */
function competitionRank(studentId, ranking) {
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

// Takes the full student object (not just the id) because the subject list
// — and therefore the weighting — depends on the student's class/option/electives.
//
// Term average = coefficient-weighted mean of each subject's sequence average.
// A subject's sequence average uses only sequences that have a mark (missing ≠ 0).
function computeTermAverage(student, term, classMarksData) {
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
function computeFinalAverage(termAvgs) {
  if (!termAvgs) return null;
  const first = termAvgs["First Term"];
  const second = termAvgs["Second Term"];
  const third = termAvgs["Third Term"];
  if (first == null || second == null || third == null) return null;
  return (first + second + third) / 3;
}

function FieldRow({ label, value }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-semibold text-slate-600 print:text-[9.5px]">
        {label}:
      </span>
      <span className="flex-1 border-b border-dotted border-slate-300 text-slate-800 print:text-[9.5px]">
        {value || "\u00A0"}
      </span>
    </div>
  );
}

function CheckboxLine({ label, checked = false }) {
  return (
    <div className="flex items-center gap-1.5 py-0.5 print:gap-1 print:py-0">
      <span className="flex h-2.5 w-2.5 flex-shrink-0 items-center justify-center border border-slate-400 print:h-1.5 print:w-1.5">
        {checked && (
          <svg
            viewBox="0 0 10 10"
            className="h-2 w-2 text-[#1e3a8a] print:h-1.5 print:w-1.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
          >
            <path
              d="M1.5 5.2L4 7.8L8.5 2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      <span
        className={`text-[10px] print:text-[7.5px] print:leading-tight ${
          checked ? "font-semibold text-[#1e3a8a]" : "text-slate-700"
        }`}
      >
        {label}
      </span>
    </div>
  );
}

function ReportFooter({
  term,
  totalWeighted,
  average,
  rank,
  classSize,
  classAverage,
  status,
  papersSat,
  papersPassed,
  papersFailed,
  termAverages,
  finalAverage,
  annualRank,
  annualClassSize,
  annualClassAverage,
  marksScale,
  isStreamed,
  gceStatus,
}) {
  // Class council decision as % of configured marks scale:
  //  - ≥ 75%  -> Satisfactory
  //  - ≥ 50%  -> Could do better
  //  - below  -> Must work harder
  const scale = Number(marksScale) || 20;
  const councilDecision =
    average == null
      ? "must_work_harder"
      : average >= scale * 0.75
        ? "satisfactory"
        : average >= scale * 0.5
          ? "could_do_better"
          : "must_work_harder";

  const formatAvg = (value) => (value == null ? "—" : value.toFixed(2));
  const showAnnual = term === "Third Term";

  return (
    <div className="space-y-2 print:space-y-1.5">
      {/* Current-term summary only */}
      <div className="grid grid-cols-1 gap-2 rounded-xl border border-slate-300 p-2.5 sm:grid-cols-[190px_1fr] print:gap-2 print:rounded-md print:border print:p-2">
        <table className="w-full text-left text-[10px] print:text-[8.5px]">
          <tbody className="divide-y divide-slate-300">
            <tr>
              <td className="py-0.5 pr-2 font-semibold text-slate-500 print:py-0">
                Tot. Marks
              </td>
              <td className="py-0.5 font-mono font-semibold text-[#0f172a] print:py-0">
                {totalWeighted.toFixed(1)}
              </td>
            </tr>
            <tr>
              <td className="py-0.5 pr-2 font-semibold text-slate-500 print:py-0">
                Av / Moyen
              </td>
              <td className="py-0.5 font-mono font-semibold text-[#0f172a] print:py-0">
                {formatAvg(average)} / {marksScale}
              </td>
            </tr>
            <tr>
              <td className="py-0.5 pr-2 font-semibold text-slate-500 print:py-0">
                Rank / Rang
              </td>
              <td className="py-0.5 font-mono font-semibold text-[#0f172a] print:py-0">
                {rank ?? "—"}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="grid grid-cols-3 gap-1.5 print:gap-1">
          <div className="rounded-lg border border-slate-300 bg-[#f8fafc] p-1.5 text-center print:rounded print:border print:p-1">
            <div className="text-[8px] font-semibold uppercase tracking-[0.15em] text-slate-400 print:text-[6.5px]">
              Position
            </div>
            <div className="mt-0.5 text-xs font-bold text-[#1e3a8a] print:mt-0 print:text-[9px]">
              {rank ?? "—"} / {classSize}
            </div>
          </div>
          <div className="rounded-lg border border-slate-300 bg-[#f8fafc] p-1.5 text-center print:rounded print:border print:p-1">
            <div className="text-[8px] font-semibold uppercase tracking-[0.15em] text-slate-400 print:text-[6.5px]">
              Class Avg
            </div>
            <div className="mt-0.5 text-xs font-bold text-[#1e3a8a] print:mt-0 print:text-[9px]">
              {classAverage == null ? "—" : classAverage.toFixed(2)}
            </div>
          </div>
          <div className="rounded-lg border border-slate-300 bg-[#f8fafc] p-1.5 text-center print:rounded print:border print:p-1">
            <div className="text-[8px] font-semibold uppercase tracking-[0.15em] text-slate-400 print:text-[6.5px]">
              Status
            </div>
            <div className="mt-0.5 text-xs font-bold text-[#1e3a8a] print:mt-0 print:text-[9px]">
              {status}
            </div>
          </div>
          <div className="rounded-lg border border-slate-300 bg-white p-1.5 text-center print:rounded print:border print:p-1">
            <div className="text-[8px] font-semibold uppercase tracking-[0.15em] text-slate-400 print:text-[6.5px]">
              Sat
            </div>
            <div className="mt-0.5 text-xs font-bold text-emerald-600 print:mt-0 print:text-[9px]">
              {papersSat}
            </div>
          </div>
          <div className="rounded-lg border border-slate-300 bg-white p-1.5 text-center print:rounded print:border print:p-1">
            <div className="text-[8px] font-semibold uppercase tracking-[0.15em] text-slate-400 print:text-[6.5px]">
              Passed
            </div>
            <div className="mt-0.5 text-xs font-bold text-sky-600 print:mt-0 print:text-[9px]">
              {papersPassed}
            </div>
          </div>
          <div className="rounded-lg border border-slate-300 bg-white p-1.5 text-center print:rounded print:border print:p-1">
            <div className="text-[8px] font-semibold uppercase tracking-[0.15em] text-slate-400 print:text-[6.5px]">
              Failed
            </div>
            <div className="mt-0.5 text-xs font-bold text-rose-600 print:mt-0 print:text-[9px]">
              {papersFailed}
            </div>
          </div>
        </div>
      </div>

      {/* Annual summary — Third Term report cards only */}
      {showAnnual && (
        <div className="rounded-xl border border-slate-300 print:rounded-md print:border">
          <div className="border-b border-slate-300 bg-[#1e3a8a] px-2.5 py-1 text-center text-[10px] font-bold uppercase tracking-wide text-white print:px-1.5 print:py-0.5 print:text-[7.5px]">
            Annual Summary / Résumé Annuel
          </div>
          <div className="grid grid-cols-2 gap-2 p-2.5 sm:grid-cols-3 lg:grid-cols-6 print:gap-1.5 print:p-1.5">
            <div className="rounded-lg border border-slate-300 bg-[#f8fafc] p-1.5 text-center print:p-1">
              <div className="text-[8px] font-semibold uppercase tracking-[0.12em] text-slate-400 print:text-[6.5px]">
                1st Term
              </div>
              <div className="mt-0.5 font-mono text-xs font-bold text-[#1e3a8a] print:text-[9px]">
                {formatAvg(termAverages?.["First Term"])}
              </div>
            </div>
            <div className="rounded-lg border border-slate-300 bg-[#f8fafc] p-1.5 text-center print:p-1">
              <div className="text-[8px] font-semibold uppercase tracking-[0.12em] text-slate-400 print:text-[6.5px]">
                2nd Term
              </div>
              <div className="mt-0.5 font-mono text-xs font-bold text-[#1e3a8a] print:text-[9px]">
                {formatAvg(termAverages?.["Second Term"])}
              </div>
            </div>
            <div className="rounded-lg border border-slate-300 bg-[#f8fafc] p-1.5 text-center print:p-1">
              <div className="text-[8px] font-semibold uppercase tracking-[0.12em] text-slate-400 print:text-[6.5px]">
                3rd Term
              </div>
              <div className="mt-0.5 font-mono text-xs font-bold text-[#1e3a8a] print:text-[9px]">
                {formatAvg(termAverages?.["Third Term"])}
              </div>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-1.5 text-center print:p-1">
              <div className="text-[8px] font-semibold uppercase tracking-[0.12em] text-emerald-600 print:text-[6.5px]">
                Annual Avg
              </div>
              <div className="mt-0.5 font-mono text-xs font-bold text-emerald-700 print:text-[9px]">
                {finalAverage == null
                  ? "—"
                  : `${finalAverage.toFixed(2)} / ${marksScale}`}
              </div>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-1.5 text-center print:p-1">
              <div className="text-[8px] font-semibold uppercase tracking-[0.12em] text-emerald-600 print:text-[6.5px]">
                Annual Rank
              </div>
              <div className="mt-0.5 font-mono text-xs font-bold text-emerald-700 print:text-[9px]">
                {annualRank == null
                  ? "—"
                  : `${annualRank} / ${annualClassSize || "—"}`}
              </div>
            </div>
            <div className="rounded-lg border border-slate-300 bg-white p-1.5 text-center print:p-1">
              <div className="text-[8px] font-semibold uppercase tracking-[0.12em] text-slate-400 print:text-[6.5px]">
                Class Annual Avg
              </div>
              <div className="mt-0.5 font-mono text-xs font-bold text-[#1e3a8a] print:text-[9px]">
                {annualClassAverage == null
                  ? "—"
                  : annualClassAverage.toFixed(2)}
              </div>
            </div>
          </div>
          {finalAverage == null && (
            <p className="border-t border-slate-200 px-2.5 py-1.5 text-[10px] text-slate-400 print:px-1.5 print:py-1 print:text-[7.5px]">
              Annual average and rank require First, Second, and Third term
              averages for this student.
            </p>
          )}
        </div>
      )}

      {/* Dual result standard — only relevant once streaming (GCE-style
          subject choice) applies, i.e. Form 4/5 and Lower/Upper Sixth */}
      {isStreamed && (
        <div className="flex flex-col gap-2 rounded-xl border border-slate-300 bg-[#f8fafc] px-3 py-2 sm:flex-row sm:items-center sm:justify-between print:gap-1 print:rounded-md print:border print:px-1.5 print:py-1">
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-500 print:text-[7.5px]">
              Result (Average)
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold print:text-[8px] ${
                status === "Pass"
                  ? "bg-emerald-100 text-emerald-700"
                  : status === "Trial"
                    ? "bg-amber-100 text-amber-700"
                    : "bg-rose-100 text-rose-600"
              }`}
            >
              {status}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-500 print:text-[7.5px]">
              Result (GCE Standard — 4+ subjects)
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold print:text-[8px] ${
                gceStatus === "Pass"
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-rose-100 text-rose-600"
              }`}
            >
              {gceStatus} ({papersPassed}/{papersSat})
            </span>
          </div>
        </div>
      )}

      {/* General Conduct */}
      <div className="rounded-xl border border-slate-300 print:rounded-md print:border">
        <div className="border-b border-slate-300 bg-[#1e3a8a] px-2.5 py-1 text-center text-[10px] font-bold uppercase tracking-wide text-white print:px-1.5 print:py-0.5 print:text-[7.5px]">
          General Conduct / Conduite Générale
        </div>
        <div className="grid grid-cols-2 gap-2.5 p-2.5 print:gap-1.5 print:p-1.5">
          <div>
            <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500 print:mb-0 print:text-[7px]">
              Discipline
            </div>
            <CheckboxLine label="Dismissed / Exclu(e)" />
            <CheckboxLine label="Warning / Avertissement" />
            <CheckboxLine label="Serious Warning / Blâme" />
            <CheckboxLine label="Suspension in day(s) / Exclusion" />
            <CheckboxLine label="Absences in hours" />
          </div>
          <div>
            <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500 print:mb-0 print:text-[7px]">
              Academic Work / Travail
            </div>
            <CheckboxLine label="Distinction / Félicitation" />
            <CheckboxLine label="Credit / Encouragement" />
            <CheckboxLine label="Honour Roll / Tableau d'Honneur" />
            <CheckboxLine label="Dismissed / Exclu(e)" />
            <CheckboxLine label="Warning / Avertissement" />
          </div>
        </div>
      </div>

      {/* Class Council Decision */}
      <div className="rounded-xl border border-slate-300 print:rounded-md print:border">
        <div className="border-b border-slate-300 bg-[#1e3a8a] px-2.5 py-1 text-center text-[10px] font-bold uppercase tracking-wide text-white print:px-1.5 print:py-0.5 print:text-[7.5px]">
          Class Council Decision / Décision du Conseil de Classe
        </div>
        <div className="flex flex-wrap gap-x-5 p-2.5 print:gap-x-3 print:p-1.5">
          <CheckboxLine
            label="Satisfactory / Satisfaisant"
            checked={councilDecision === "satisfactory"}
          />
          <CheckboxLine
            label="Could do better / Peut mieux faire"
            checked={councilDecision === "could_do_better"}
          />
          <CheckboxLine
            label="Must work harder in / Un effort s'impose en …"
            checked={councilDecision === "must_work_harder"}
          />
        </div>
      </div>
    </div>
  );
}

function RemarkCard({ title, text, showSignature = false, showStamp = false }) {
  return (
    <div className="relative break-inside-avoid rounded-xl border border-slate-300 bg-white p-2.5 print:rounded-md print:border print:p-2 print:break-inside-avoid">
      <div className="text-xs font-semibold text-[#1e3a8a] print:text-[9.5px]">
        {title}
      </div>
      <p className="mt-1 text-[11px] text-slate-600 print:mt-1 print:text-[9px] print:leading-snug">
        {text}
      </p>
      <div className="mt-2 flex items-end justify-between gap-2 print:mt-1.5">
        <div className="flex flex-1 items-center gap-2 text-[10px] text-slate-400 print:text-[8px]">
          <span>Signature</span>
          <span className="h-px flex-1 border-t border-dashed border-slate-300" />
        </div>
        {showSignature && (
          <img
            src={signature}
            alt="Signature"
            className="pointer-events-none -mb-1 h-16 w-16 flex-shrink-0 rounded-full object-contain opacity-90 print:h-12 print:w-12"
          />
        )}
        {showStamp && (
          <img
            src={stamp}
            alt="School Stamp"
            className="pointer-events-none -mb-1 h-16 w-16 flex-shrink-0 rounded-full object-contain opacity-90 print:h-12 print:w-12"
          />
        )}
        <div className="flex flex-1 items-center gap-2 text-[10px] text-slate-400 print:text-[8px]">
          <span className="h-px flex-1 border-t border-dashed border-slate-300" />
          <span>Date</span>
        </div>
      </div>
    </div>
  );
}

function ReportCardBody({
  student,
  subjects,
  term,
  reportDate,
  average,
  rank,
  classSize,
  classAverage,
  status,
  totalWeighted,
  papersSat,
  papersPassed,
  papersFailed,
  termAverages,
  finalAverage,
  annualRank,
  annualClassSize,
  annualClassAverage,
  gceStatus,
  classMasterByClass,
  settings,
  className = "",
}) {
  const sequences = termSequences[term] || [];
  const termTitle = `${term.toUpperCase()} REPORT CARD`;
  const streamLabel = student.option ? ` — ${student.option}` : "";
  const classMasterName = classMasterByClass?.[student.class] || "—";

  return (
    <div
      className={`report-card-sheet overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-sm print:rounded-none print:shadow-none ${className}`}
    >
      <div className="h-1.5 w-full bg-gradient-to-r from-[#1e3a8a] via-[#0ea5e9] to-[#10b981] print:hidden" />

      <div className="report-card-content p-4 sm:p-5 print:p-2.5">
        {/* Bilingual Cameroon-style letterhead */}
        <div className="mb-2.5 grid grid-cols-1 items-stretch gap-2 border-b border-dashed border-slate-300 pb-2.5 sm:grid-cols-3 print:mb-0 print:gap-2 print:pb-1.5">
          <div className="rounded-lg border border-slate-300 p-2 text-center text-[9.5px] leading-snug text-slate-700 print:rounded-md print:border print:p-1.5 print:text-[8px] print:leading-snug">
            <p className="font-bold uppercase">Republic of Cameroon</p>
            <p>----------</p>
            <p>Peace – Work – Fatherland</p>
            <p>----------</p>
            <p className="font-semibold underline">{settings.schoolName}</p>
            <p className="font-semibold">{settings.schoolTown || "—"}</p>
            {settings.motto && (
              <p className="mt-0.5 italic text-slate-500">
                Motto: {settings.motto}
              </p>
            )}
          </div>

          <div className="flex flex-col items-center justify-center gap-0.5 py-1 text-center print:py-0.5">
            <img
              src={logo}
              alt="School Logo"
              className="h-25 w-25 rounded-full object-cover print:h-14 print:w-14"
            />
            <h1 className="mt-0.5 text-sm font-bold uppercase tracking-tight text-[#0f172a] print:mt-0.5 print:text-[11px]">
              {termTitle}
            </h1>
            <p className="text-[10px] text-slate-500 print:text-[8.5px]">
              Academic Year {settings.academicYear}
            </p>
          </div>

          <div className="rounded-lg border border-slate-300 p-2 text-center text-[9.5px] leading-snug text-slate-700 print:rounded-md print:border print:p-1.5 print:text-[8px] print:leading-snug">
            <p className="font-bold uppercase">République du Cameroun</p>
            <p>----------</p>
            <p>Paix – Travail – Patrie</p>
            <p>----------</p>
            <p className="font-semibold underline">
              Ministry of Secondary Education
            </p>
            <p>----------</p>
            <p className="font-semibold underline">
              {settings.regionalDelegation || "—"}
            </p>
            <p>----------</p>
            <p className="font-semibold underline">
              {settings.subDivision || "—"}
            </p>
          </div>
        </div>

        {/* Identification fields */}
        <div className="mb-2.5 grid grid-cols-1 gap-x-5 gap-y-1 text-xs sm:grid-cols-3 print:mb-0 print:gap-x-4 print:gap-y-0.5 print:text-[9.5px]">
          <FieldRow label="Full Name" value={student.name} />
          <FieldRow label="Student ID" value={student.id} />
          <FieldRow label="Class" value={`${student.class}${streamLabel}`} />
          <FieldRow label="Date of birth" value={student.dob || "—"} />
          <FieldRow label="Class Master" value={classMasterName} />
          <FieldRow label="Date issued" value={reportDate} />
        </div>

        {/* Subjects table — grows to absorb leftover page height when printing */}
        <div className="report-card-subjects mb-2.5 overflow-x-auto rounded-xl border border-slate-300 print:mb-0 print:overflow-visible print:rounded-md print:border">
          <table className="w-full min-w-[900px] border-collapse text-left text-xs print:min-w-0 print:text-[9.5px]">
            <thead>
              <tr className="bg-[#1e3a8a] text-white">
                <th className="border border-slate-300 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide print:px-2 print:py-1 print:text-[8px]">
                  Subject
                </th>
                <th className="border border-slate-300 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide print:px-2 print:py-1 print:text-[8px]">
                  Coef.
                </th>
                {sequences.map((sequence) => (
                  <th
                    key={sequence}
                    className="border border-slate-300 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide print:px-2 print:py-1 print:text-[8px]"
                  >
                    {sequence}
                  </th>
                ))}
                <th className="border border-slate-300 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide print:px-2 print:py-1 print:text-[8px]">
                  Average
                </th>
                <th className="border border-slate-300 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide print:px-2 print:py-1 print:text-[8px]">
                  Teacher
                </th>
                <th className="border border-slate-300 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide print:px-2 print:py-1 print:text-[8px]">
                  Rank
                </th>
                <th className="border border-slate-300 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide print:px-2 print:py-1 print:text-[8px]">
                  Grade
                </th>
                <th className="border border-slate-300 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide print:px-2 print:py-1 print:text-[8px]">
                  Remark
                </th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {subjects.map((subject, i) => (
                <tr
                  key={subject.name}
                  className={i % 2 === 0 ? "bg-white" : "bg-[#f8fafc]"}
                >
                  <td className="border border-slate-300 px-3 py-1.5 font-medium text-[#1e3a8a] print:px-2 print:py-0.5">
                    {subject.name}
                  </td>
                  <td className="border border-slate-300 px-3 py-1.5 text-slate-600 print:px-2 print:py-0.5">
                    {subject.coefficient}
                  </td>
                  {subject.marks.map((mark, idx) => (
                    <td
                      key={idx}
                      className="border border-slate-300 px-3 py-1.5 font-mono text-slate-600 print:px-2 print:py-0.5"
                    >
                      {mark == null || Number.isNaN(mark)
                        ? "—"
                        : Number(mark).toFixed(1)}
                    </td>
                  ))}
                  <td className="border border-slate-300 px-3 py-1.5 font-mono font-semibold text-[#0f172a] print:px-2 print:py-0.5">
                    {subject.average == null
                      ? "—"
                      : subject.average.toFixed(2)}
                  </td>
                  <td className="border border-slate-300 px-3 py-1.5 text-slate-600 print:px-2 print:py-0.5">
                    {subject.teacher}
                  </td>
                  <td className="border border-slate-300 px-3 py-1.5 text-slate-600 print:px-2 print:py-0.5">
                    {subject.rank ?? "—"}
                  </td>
                  <td className="border border-slate-300 px-3 py-1.5 print:px-2 print:py-0.5">
                    <Badge tone={subject.grade?.tone || "slate"}>
                      {subject.grade?.label || "—"}
                    </Badge>
                  </td>
                  <td className="border border-slate-300 px-3 py-1.5 text-slate-500 print:px-2 print:py-0.5">
                    {subject.remark}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ReportFooter
          term={term}
          totalWeighted={totalWeighted}
          average={average}
          rank={rank}
          classSize={classSize}
          classAverage={classAverage}
          status={status}
          papersSat={papersSat}
          papersPassed={papersPassed}
          papersFailed={papersFailed}
          termAverages={termAverages}
          finalAverage={finalAverage}
          annualRank={annualRank}
          annualClassSize={annualClassSize}
          annualClassAverage={annualClassAverage}
          marksScale={settings.marksScale}
          isStreamed={requiresStream(student.class)}
          gceStatus={gceStatus}
        />

        {/* Remarks — stamp sits on the Principal's signature line */}
        <div className="mt-2.5 grid grid-cols-2 gap-2.5 print:mt-0 print:gap-2 print:break-inside-avoid">
          <RemarkCard
            title="Class Master's Remarks"
            text="Well done. Keep working hard, and aim for consistency across all subjects."
            showSignature
          />
          <RemarkCard
            title="Principal's Remarks"
            text="Good performance. Maintain discipline and continue improving in the next term."
            showSignature
            showStamp
          />
        </div>
      </div>
    </div>
  );
}

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
  });
  const [pendingJump, setPendingJump] = useState(
    () => location.state || null,
  );

  useEffect(() => {
    getClasses()
      .then((data) => {
        const classNames = data.map((item) => item.name).sort(compareClassNames);
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
          `${student.name} ${student.id}`
            .toLowerCase()
            .includes(search.toLowerCase()),
        ),
    [students, search, streamed, optionFilter],
  );

  const studentRecords = useMemo(() => {
    const sequences = termSequences[term] || [];
    const passThreshold = (Number(settings.marksScale) || 20) / 2;
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
          grade:
            average == null
              ? null
              : gradeForScale(average, settings.marksScale),
        };
      });
      const scored = subjects.filter((s) => s.average != null);
      const totalWeighted = scored.reduce(
        (acc, item) => acc + item.average * item.coefficient,
        0,
      );
      const totalCoefficient = scored.reduce(
        (acc, item) => acc + item.coefficient,
        0,
      );
      const papersSat = scored.length;
      const papersPassed = scored.filter(
        (s) => s.average >= passThreshold,
      ).length;
      const papersFailed = scored.filter(
        (s) => s.average < passThreshold,
      ).length;
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
  }, [students, classMarks, term, teachers, settings.marksScale]);

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
            margin: 5mm;
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
            height: 287mm !important;
            margin: 0 !important;
            padding: 0 !important;
          }

          /* Fill the printable A4 area (297mm − 2×5mm margins ≈ 287mm).
             Header / footer / remarks stay natural size; the subjects block
             absorbs leftover height so the card uses the full sheet. */
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
          .report-card-content {
            flex: 1 1 auto;
            min-height: 0;
            height: 100%;
            display: flex;
            flex-direction: column;
            justify-content: flex-start;
            gap: 2.5mm;
          }
          .report-card-content > *:not(.report-card-subjects) {
            flex-shrink: 0;
          }
          .report-card-subjects {
            flex: 1 1 auto;
            min-height: 0;
            display: flex;
            flex-direction: column;
          }
          .report-card-subjects table {
            width: 100%;
            height: 100%;
            border-collapse: collapse;
          }
          .report-card-subjects tbody {
            height: 100%;
          }
          .report-card-subjects tbody tr {
            height: 1%;
          }

          .report-card-page {
            page-break-after: always;
            break-after: page;
            height: 287mm;
          }
          .report-card-page:last-child {
            page-break-after: auto;
            break-after: auto;
          }
          .report-card-sheet table {
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .report-card-sheet .break-inside-avoid {
            page-break-inside: avoid;
            break-inside: avoid;
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
              <div className="space-y-2">
                {filteredStudents.map((student) => (
                  <button
                    key={student.id}
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
                        {student.id}
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
                reportDate={reportDate}
                average={selectedRecord ? selectedRecord.average : null}
                rank={selectedRank}
                classSize={scoredClassSize || students.length}
                classAverage={classAverage}
                status={
                  selectedRecord
                    ? statusForScale(
                        selectedRecord.average,
                        settings.marksScale,
                      )
                    : "—"
                }
                totalWeighted={
                  selectedRecord ? selectedRecord.totalWeighted : 0
                }
                papersSat={selectedRecord ? selectedRecord.papersSat : 0}
                papersPassed={selectedRecord ? selectedRecord.papersPassed : 0}
                papersFailed={selectedRecord ? selectedRecord.papersFailed : 0}
                gceStatus={selectedRecord ? selectedRecord.gceStatus : "Fail"}
                termAverages={
                  selectedStudent ? getTermAverages(selectedStudent.id) : null
                }
                finalAverage={
                  selectedStudent ? getFinalAverage(selectedStudent.id) : null
                }
                annualRank={
                  selectedStudent
                    ? annualStats[selectedStudent.id]?.rank ?? null
                    : null
                }
                annualClassSize={
                  selectedStudent
                    ? annualStats[selectedStudent.id]?.classSize ?? 0
                    : 0
                }
                annualClassAverage={
                  selectedStudent
                    ? annualStats[selectedStudent.id]?.classAverage ?? null
                    : null
                }
                classMasterByClass={classMasterByClass}
                settings={settings}
              />
            )}
          </Card>
        </div>
      </div>

      {printAll && (
        <div className="report-card-print-area absolute -left-[9999px] top-0 w-full space-y-10 p-6">
          {studentRecords.map((record) => {
            const rank = computePosition(record.student.id, studentRecords);
            const augmentedSubjects = record.subjects.map((s) => ({
              ...s,
              rank: computeSubjectRanks(
                record.student.id,
                studentRecords,
                s.name,
              ),
              remark: remarkForScale(s.average, settings.marksScale),
            }));
            return (
              <div key={record.student.id} className="report-card-page">
                <ReportCardBody
                  student={record.student}
                  subjects={augmentedSubjects}
                  term={term}
                  reportDate={reportDate}
                  average={record.average}
                  rank={rank}
                  classSize={scoredClassSize || students.length}
                  classAverage={classAverage}
                  status={statusForScale(record.average, settings.marksScale)}
                  totalWeighted={record.totalWeighted}
                  papersSat={record.papersSat}
                  papersPassed={record.papersPassed}
                  papersFailed={record.papersFailed}
                  gceStatus={record.gceStatus}
                  termAverages={getTermAverages(record.student.id)}
                  finalAverage={getFinalAverage(record.student.id)}
                  annualRank={annualStats[record.student.id]?.rank ?? null}
                  annualClassSize={
                    annualStats[record.student.id]?.classSize ?? 0
                  }
                  annualClassAverage={
                    annualStats[record.student.id]?.classAverage ?? null
                  }
                  classMasterByClass={classMasterByClass}
                  settings={settings}
                />
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
