// All thresholds are expressed as a percentage of the configured Marks
// Scale, so grading/status/remarks stay correct whether the school marks
// out of 20 or out of 100.

export function gradeForScale(mark, scale) {
  if (mark === "" || mark === null || Number.isNaN(Number(mark))) return null;
  const s = Number(scale) || 20;
  const pct = Number(mark) / s;
  if (pct >= 0.8) return { label: "A", tone: "emerald" };
  if (pct >= 0.6) return { label: "B", tone: "sky" };
  if (pct >= 0.5) return { label: "C", tone: "amber" };
  return { label: "D", tone: "rose" };
}

export function statusForScale(average, scale) {
  const s = Number(scale) || 20;
  const pct = average / s;
  if (pct >= 0.5) return "Pass";
  if (pct >= 0.4) return "Trial";
  return "Fail";
}

export function remarkForScale(average, scale) {
  const s = Number(scale) || 20;
  const pct = average / s;
  if (pct >= 0.8) return "Excellent";
  if (pct >= 0.7) return "Very Good";
  if (pct >= 0.6) return "Good";
  if (pct >= 0.5) return "Fair";
  if (pct >= 0.4) return "Weak";
  return "Poor";
}