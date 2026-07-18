import * as XLSX from "xlsx";
import { requiresStream } from "./subjects";

const COLUMN_ALIASES = {
  name: ["full name", "name", "student name"],
  dob: ["date of birth", "dob", "birth date"],
  gender: ["gender", "sex"],
  class: ["class", "form", "level"],
  option: ["option", "stream", "science/arts"],
  electives: ["electives", "elective subjects", "optional subjects"],
  guardian: ["guardian name", "guardian", "parent name"],
  phone: ["guardian phone", "phone", "parent phone", "contact"],
};

function normalizeHeader(h) {
  return String(h || "").trim().toLowerCase();
}

function findField(row, field) {
  const aliases = COLUMN_ALIASES[field];
  for (const key of Object.keys(row)) {
    if (aliases.includes(normalizeHeader(key))) {
      return row[key];
    }
  }
  return "";
}

function formatDob(value) {
  if (!value) return "";
  if (value instanceof Date) {
    return value.toISOString().split("T")[0];
  }
  return String(value).trim();
}

// Reads the uploaded file and returns one row object per student, each
// tagged with validation errors so the UI can show what needs fixing
// before anything is actually submitted.
export async function parseStudentsExcel(file, validClassNames) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  return rawRows.map((raw, index) => {
    const name = String(findField(raw, "name")).trim();
    const dob = formatDob(findField(raw, "dob"));
    const genderRaw = String(findField(raw, "gender")).trim().toLowerCase();
    const gender = genderRaw.startsWith("f") ? "Female" : "Male";
    const className = String(findField(raw, "class")).trim();
    const optionRaw = String(findField(raw, "option")).trim().toLowerCase();
    const option = optionRaw.startsWith("sci")
      ? "Science"
      : optionRaw.startsWith("art")
        ? "Arts"
        : "";
    const electives = String(findField(raw, "electives")).trim();
    const guardian = String(findField(raw, "guardian")).trim();
    const phone = String(findField(raw, "phone")).trim();

    const errors = [];
    if (!name) errors.push("Missing full name");
    if (!className) errors.push("Missing class");
    else if (validClassNames && !validClassNames.includes(className)) {
      errors.push(`Unknown class "${className}"`);
    }
    if (className && requiresStream(className) && !option) {
      errors.push("Missing Option (Science/Arts) for this class");
    }

    return {
      rowNumber: index + 2, // +2 accounts for the header row and 1-indexing
      name,
      dob: dob || "—",
      gender,
      class: className,
      option,
      electives,
      guardian: guardian || "—",
      phone: phone || "—",
      errors,
      valid: errors.length === 0,
    };
  });
}

// Generates a starter .xlsx file with the correct column headers and one
// example row, so people don't have to guess the expected format.
export function downloadTemplate() {
  const headers = [
    "Full Name",
    "Date of Birth",
    "Gender",
    "Class",
    "Option",
    "Electives",
    "Guardian Name",
    "Guardian Phone",
  ];
  const sampleRow = [
    "Ama Nkeng",
    "2010-04-12",
    "Female",
    "Form 1",
    "",
    "",
    "Mr. Nkeng Paul",
    "+237 6XX XXX XXX",
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers, sampleRow]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Students");
  XLSX.writeFile(wb, "student-import-template.xlsx");
}