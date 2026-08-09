// Builds a styled .xlsx mastersheet workbook that mirrors the school's own
// paper/Excel master sheet template: identity columns (AD/CN/NAME/SEX/HOUSE/
// CLASS), one column per subject, Term 1 / Term 2 / Term 3 / Mastersheet
// blocks side by side, then Teacher's Remarks, Subject Progress, and a Class
// Council Decision block — same layout, fonts, rotation, and block-divider
// colors as the template.
//
// The numbers themselves stay consistent with the rest of the app (the same
// coefficient-weighted average and configurable pass mark used on report
// cards and the on-screen Mastersheet), so nothing here ever disagrees with
// what's printed elsewhere — only the look and structure match the template.
import ExcelJS from "exceljs/dist/exceljs.min.js";
import {
  termSequences,
  computeFinalAverage,
  computePosition,
  competitionRank,
  buildStudentRecords,
  statusForScale,
} from "./grading";

const TERMS = Object.keys(termSequences);

const IDENTITY_FONT = { name: "Arial Narrow", bold: true, size: 10 };
const HEADER_FONT = { name: "Arial Narrow", bold: true, size: 8 };
const LABEL_FONT = { name: "Arial Narrow", bold: true, size: 9, color: { argb: "FFFFFFFF" } };
const DATA_FONT = { name: "Arial", size: 8 };
const THIN_BORDER = {
  top: { style: "thin" },
  bottom: { style: "thin" },
  left: { style: "thin" },
  right: { style: "thin" },
};
const GREEN_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF00B050" } };
const RED_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC00000" } };
const HEADER_ROW_HEIGHT = 80;

function teacherRemarkTier(mark, scale) {
  if (mark == null) return "-";
  const pct = mark / (Number(scale) || 20);
  if (pct <= 0) return "-";
  if (pct <= 0.297) return "V. Weak";
  if (pct <= 0.497) return "Weak";
  if (pct <= 0.597) return "Could do better";
  if (pct <= 0.647) return "Fair";
  if (pct <= 0.747) return "Good";
  if (pct <= 0.897) return "V. Good";
  return "Excellent";
}

function classCouncilDecision(pct) {
  if (pct <= 0.497) return "ACADEMIC WARNING";
  if (pct <= 0.597) return "AVERAGE";
  if (pct <= 0.797) return "GOOD";
  if (pct <= 0.897) return "VERY GOOD";
  return "EXCELLENT";
}

function passFailLabel(mark, scale, passAverage) {
  if (mark == null) return "-";
  const passPct = (Number(passAverage) || 50) / 100;
  const pct = mark / (Number(scale) || 20);
  return pct >= passPct ? "Passed" : "Failed";
}

function round1(v) {
  return v == null || Number.isNaN(v) ? null : Math.round(v * 10) / 10;
}

// Applies the template's header look: bold Arial Narrow, thin borders,
// centered + rotated 90° (except the wide identity columns, which stay
// horizontal — exactly like the original).
function styleHeaderCell(cell, { rotate = true, font = HEADER_FONT } = {}) {
  cell.font = font;
  cell.border = THIN_BORDER;
  cell.alignment = {
    horizontal: "center",
    vertical: "middle",
    textRotation: rotate ? 90 : 0,
    wrapText: !rotate,
  };
}

function styleLabelCell(cell, fill) {
  cell.font = LABEL_FONT;
  cell.border = THIN_BORDER;
  cell.fill = fill;
  cell.alignment = { horizontal: "center", vertical: "middle", textRotation: 90 };
}

function styleDataCell(cell) {
  cell.font = DATA_FONT;
  cell.border = THIN_BORDER;
  cell.alignment = { horizontal: "center", vertical: "middle" };
}

// One "term-shaped" block: AD, CN, NAME, SEX, HOUSE, CLASS, subjects…,
// TOTAL, AVERAGE, NSS, NSP., Rank.
function termBlockColumns(subjectColumns) {
  return [
    { header: "AD", width: 10, rotate: false, identity: true },
    { header: "CN", width: 6, rotate: false, identity: true },
    { header: "NAME", width: 26, rotate: false, identity: true },
    { header: "SEX", width: 5, rotate: true, identity: true },
    { header: "HOUSE", width: 7, rotate: true, identity: true },
    { header: "CLASS", width: 7, rotate: true, identity: true },
    ...subjectColumns.map((name) => ({ header: name.toUpperCase(), width: 5, rotate: true })),
    { header: "TOTAL", width: 6, rotate: true },
    { header: "AVERAGE", width: 6, rotate: true },
    { header: "NSS", width: 4.5, rotate: true },
    { header: "NSP.", width: 4.5, rotate: true },
    { header: "Rank", width: 5, rotate: true },
  ];
}

function identityOnlyColumns(subjectColumns, prefix) {
  return [
    { header: "AD", width: 10, rotate: false, identity: true },
    { header: "CN", width: 6, rotate: false, identity: true },
    { header: "NAME", width: 26, rotate: false, identity: true },
    { header: "SEX", width: 5, rotate: true, identity: true },
    { header: "HOUSE", width: 7, rotate: true, identity: true },
    { header: "CLASS", width: 7, rotate: true, identity: true },
    ...subjectColumns.map((name) => ({
      header: `${prefix}${name.toUpperCase()}`,
      width: 10,
      rotate: true,
    })),
  ];
}

export async function exportMastersheetWorkbook({
  className,
  academicYear,
  roster,
  teachers,
  settings,
  subjectColumns,
  classMarks,
}) {
  const recordsByTerm = {};
  TERMS.forEach((t) => {
    recordsByTerm[t] = buildStudentRecords(roster, classMarks, t, teachers, settings);
  });

  const passAverage = settings.passAverage || 50;
  const scale = settings.marksScale || 20;

  // Per-student term averages (coefficient-weighted — same as report cards)
  // and the annual/mastersheet average (mean of the three term averages).
  const termAveragesByStudent = {};
  const finalAverageByStudent = {};
  roster.forEach((s) => {
    const avgs = {};
    TERMS.forEach((t) => {
      const rec = recordsByTerm[t].find((r) => r.student.id === s.id);
      avgs[t] = rec ? rec.average : null;
    });
    termAveragesByStudent[s.id] = avgs;
    finalAverageByStudent[s.id] = computeFinalAverage(avgs);
  });

  // Per-student, per-subject "mastersheet mark" = mean of the term subject
  // averages that actually have data (up to 3).
  const mastersheetSubject = {};
  roster.forEach((s) => {
    mastersheetSubject[s.id] = {};
    subjectColumns.forEach((subjectName) => {
      const vals = TERMS.map((t) => {
        const rec = recordsByTerm[t].find((r) => r.student.id === s.id);
        const subj = rec?.subjects.find((sub) => sub.name === subjectName);
        return subj?.average ?? null;
      }).filter((v) => v != null);
      mastersheetSubject[s.id][subjectName] = vals.length
        ? vals.reduce((sum, v) => sum + v, 0) / vals.length
        : null;
    });
  });

  // Class-wide rank for each subject's mastersheet mark (for the subject
  // position columns in the Class Council block).
  const subjectRankByStudent = {};
  subjectColumns.forEach((subjectName) => {
    const ranking = roster
      .map((s) => ({ id: s.id, score: mastersheetSubject[s.id][subjectName] }))
      .filter((r) => r.score != null)
      .sort((a, b) => b.score - a.score);
    roster.forEach((s) => {
      subjectRankByStudent[s.id] = subjectRankByStudent[s.id] || {};
      subjectRankByStudent[s.id][subjectName] = competitionRank(s.id, ranking);
    });
  });

  // Pseudo-records shaped the way computePosition expects, so annual rank
  // can reuse the same ranking helper as everywhere else in the app.
  const mastersheetRecords = roster.map((s) => ({
    student: s,
    average: finalAverageByStudent[s.id],
  }));

  const workbook = new ExcelJS.Workbook();
  const sheetName = className.replace(/[*?:/\\[\]]/g, "").slice(0, 31) || "Mastersheet";
  const ws = workbook.addWorksheet(sheetName, { views: [{ state: "frozen", xSplit: 3, ySplit: 1 }] });

  let col = 1;
  const headerRow = ws.getRow(1);
  headerRow.height = HEADER_ROW_HEIGHT;

  function writeLabelColumn(text, fill) {
    ws.getColumn(col).width = 4;
    const cell = headerRow.getCell(col);
    cell.value = text;
    styleLabelCell(cell, fill);
    col++;
  }

  function writeBlock(columns, rowFn) {
    const startCol = col;
    columns.forEach((c) => {
      ws.getColumn(col).width = c.width;
      const cell = headerRow.getCell(col);
      cell.value = c.header;
      styleHeaderCell(cell, { rotate: c.rotate, font: c.identity ? IDENTITY_FONT : HEADER_FONT });
      col++;
    });
    roster.forEach((student, i) => {
      const rowIdx = i + 2;
      const row = ws.getRow(rowIdx);
      const values = rowFn(student, i);
      values.forEach((val, offset) => {
        const cell = row.getCell(startCol + offset);
        cell.value = val == null ? "" : val;
        styleDataCell(cell);
      });
    });
  }

  function termRowValues(student, term) {
    const rec = recordsByTerm[term].find((r) => r.student.id === student.id);
    const rank = rec ? computePosition(student.id, recordsByTerm[term]) : null;
    const subjectVals = subjectColumns.map((name) => {
      const subj = rec?.subjects.find((s) => s.name === name);
      return round1(subj?.average ?? null);
    });
    const total = subjectVals.reduce((sum, v) => (v == null ? sum : sum + v), 0);
    return [
      student.id,
      "",
      student.name,
      student.gender ? student.gender[0] : "",
      "",
      student.class,
      ...subjectVals,
      subjectVals.some((v) => v != null) ? round1(total) : "",
      round1(rec?.average ?? null),
      rec?.papersSat ?? "",
      rec?.papersPassed ?? "",
      rank ?? "",
    ];
  }

  // Term 1 (no divider column before it — matches the template).
  writeBlock(termBlockColumns(subjectColumns), (student) => termRowValues(student, "First Term"));

  // Term 2 / Term 3 — each preceded by a single colored divider column.
  writeLabelColumn("TERM 2", GREEN_FILL);
  writeBlock(termBlockColumns(subjectColumns), (student) => termRowValues(student, "Second Term"));

  writeLabelColumn("TERM 3", GREEN_FILL);
  writeBlock(termBlockColumns(subjectColumns), (student) => termRowValues(student, "Third Term"));

  // Mastersheet — annual figures.
  writeLabelColumn("MASTERSHEET", RED_FILL);
  writeBlock(termBlockColumns(subjectColumns), (student) => {
    const subjectVals = subjectColumns.map((name) => round1(mastersheetSubject[student.id][name]));
    const total = subjectVals.reduce((sum, v) => (v == null ? sum : sum + v), 0);
    const nss = subjectVals.filter((v) => v != null).length;
    const passThreshold = scale * (passAverage / 100);
    const nsp = subjectVals.filter((v) => v != null && v >= passThreshold).length;
    const rank = computePosition(student.id, mastersheetRecords);
    return [
      student.id,
      "",
      student.name,
      student.gender ? student.gender[0] : "",
      "",
      student.class,
      ...subjectVals,
      nss ? round1(total) : "",
      round1(finalAverageByStudent[student.id]),
      nss,
      nsp,
      rank ?? "",
    ];
  });

  // Teacher's Remarks — worded tier per subject, from the mastersheet mark.
  writeLabelColumn("TEACHERS REMARKS", GREEN_FILL);
  writeBlock(identityOnlyColumns(subjectColumns, "R/"), (student) => [
    student.id,
    "",
    student.name,
    student.gender ? student.gender[0] : "",
    "",
    student.class,
    ...subjectColumns.map((name) => teacherRemarkTier(mastersheetSubject[student.id][name], scale)),
  ]);

  // Subject Progress — Passed/Failed per subject against the configured pass mark.
  writeLabelColumn("SUBJECT PROGRESS", GREEN_FILL);
  writeBlock(identityOnlyColumns(subjectColumns, "PROG. "), (student) => [
    student.id,
    "",
    student.name,
    student.gender ? student.gender[0] : "",
    "",
    student.class,
    ...subjectColumns.map((name) =>
      passFailLabel(mastersheetSubject[student.id][name], scale, passAverage),
    ),
  ]);

  // Class Council Decision — overall average, pass/fail, worded decision,
  // and each subject's class-wide rank.
  writeLabelColumn("CL. C.D.", GREEN_FILL);
  const councilColumns = [
    { header: "AD", width: 10, rotate: false, identity: true },
    { header: "CN", width: 6, rotate: false, identity: true },
    { header: "NAME", width: 26, rotate: false, identity: true },
    { header: "GENDER", width: 6, rotate: true, identity: true },
    { header: "Ave", width: 6, rotate: true },
    { header: "Progress", width: 6, rotate: true },
    { header: "Cl. C. Decisions", width: 8, rotate: true },
    ...subjectColumns.map((name) => ({ header: `sR/${name.toUpperCase()}`, width: 6, rotate: true })),
  ];
  writeBlock(councilColumns, (student) => {
    const avg = finalAverageByStudent[student.id];
    const pct = avg == null ? null : avg / scale;
    return [
      student.id,
      "",
      student.name,
      student.gender ? student.gender[0] : "",
      round1(avg),
      avg == null ? "-" : statusForScale(avg, scale, passAverage) === "Fail" ? "Failed" : "Passed",
      pct == null ? "-" : classCouncilDecision(pct),
      ...subjectColumns.map((name) => subjectRankByStudent[student.id]?.[name] ?? ""),
    ];
  });

  ws.getCell(1, 1).note = `${className} — ${academicYear || ""} Mastersheet`;

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

export function downloadWorkbookBuffer(buffer, fileName) {
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
