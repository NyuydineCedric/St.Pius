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