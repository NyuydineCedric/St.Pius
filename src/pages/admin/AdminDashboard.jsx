import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  UserPlus,
  PenSquare,
  Users,
  FileText,
  ArrowUpRight,
  Award,
  ChevronRight,
  GraduationCap,
  CalendarRange,
  Layers,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { Card, focusRing } from "../../components/ui";
import {
  getStudents,
  getClasses,
  getRoster,
  getMarks,
  getActivities,
  getSettings,
} from "../../utils/api";
import { getSubjectsForStudent } from "../../utils/subjects";

const quickActions = [
  { label: "Add New Student", icon: UserPlus, to: "/students" },
  { label: "Enter Marks", icon: PenSquare, to: "/marks" },
  { label: "Generate Report Card", icon: FileText, to: "/report-cards" },
  { label: "View Classes", icon: Users, to: "/classes" },
];

const iconByType = {
  Student: UserPlus,
  Marks: PenSquare,
  "Report Card": FileText,
  Class: Users,
  Staff: GraduationCap,
};

const toneByType = {
  Student: "bg-[#1e3a8a] text-white",
  Marks: "bg-[#0ea5e9] text-white",
  "Report Card": "bg-[#10b981] text-white",
  Class: "bg-slate-300 text-slate-700",
  Staff: "bg-amber-400 text-white",
};

function relativeTime(timestamp) {
  const diffMs = Date.now() - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} hour${diffHour === 1 ? "" : "s"} ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay} days ago`;
  return new Date(timestamp).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });
}

function StatTile({ label, value, icon: Icon, tone }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-[#e2e8f0] bg-white p-4 transition-shadow hover:shadow-md">
      <div
        className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl ${tone}`}
      >
        <Icon size={20} />
      </div>
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
          {label}
        </div>
        <div className="font-mono text-2xl font-bold tabular-nums text-[#1e3a8a]">
          {value}
        </div>
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const [students, setStudents] = useState([]);
  const [classes, setClasses] = useState([]);
  const [activities, setActivities] = useState([]);
  const [settings, setSettings] = useState({
    schoolName: "SCHOOL",
    academicYear: "",
    currentSequence: "Sequence 1",
  });
  const [classAverages, setClassAverages] = useState([]); // [{ name, average }]
  const [loading, setLoading] = useState(true);
  const [loadingAverages, setLoadingAverages] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([getStudents(), getClasses(), getActivities(), getSettings()])
      .then(([studentList, classList, activityList, settingsData]) => {
        setStudents(studentList);
        setClasses(classList);
        setActivities(activityList);
        setSettings(settingsData);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const activeClasses = classes.filter((c) => c.students > 0);
    if (activeClasses.length === 0) {
      setClassAverages([]);
      setLoadingAverages(false);
      return;
    }

    let active = true;
    setLoadingAverages(true);
    const sequence = settings.currentSequence || "Sequence 1";

    const loadAverages = async () => {
      try {
        const results = await Promise.all(
          activeClasses.map(async (c) => {
            const roster = await getRoster(c.name);
            if (roster.length === 0) return { name: c.name, average: 0 };

            const subjectNames = Array.from(
              new Set(
                roster.flatMap((s) =>
                  getSubjectsForStudent(s).map((sub) => sub.name),
                ),
              ),
            );

            const marksBySubject = {};
            await Promise.all(
              subjectNames.map(async (subjectName) => {
                marksBySubject[subjectName] = await getMarks(
                  c.name,
                  subjectName,
                  sequence,
                );
              }),
            );

            const studentAverages = roster.map((student) => {
              const subjects = getSubjectsForStudent(student);
              let weighted = 0;
              let totalCoefficient = 0;
              subjects.forEach((subject) => {
                const mark = Number(
                  marksBySubject[subject.name]?.[student.id] ?? 0,
                );
                weighted += mark * subject.coefficient;
                totalCoefficient += subject.coefficient;
              });
              return totalCoefficient ? weighted / totalCoefficient : 0;
            });

            const average =
              studentAverages.reduce((sum, a) => sum + a, 0) /
              studentAverages.length;

            return { name: c.name, average: Number(average.toFixed(2)) };
          }),
        );

        if (active) setClassAverages(results);
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoadingAverages(false);
      }
    };

    loadAverages();

    return () => {
      active = false;
    };
  }, [classes, settings.currentSequence]);

  const topClasses = useMemo(
    () =>
      [...classAverages]
        .filter((c) => c.average > 0)
        .sort((a, b) => b.average - a.average)
        .slice(0, 3),
    [classAverages],
  );

  const recentActivity = useMemo(() => activities.slice(0, 4), [activities]);

  const ledgerStats = [
    {
      label: "Total Students",
      value: students.length,
      icon: UserPlus,
      tone: "bg-[#1e3a8a]/10 text-[#1e3a8a]",
    },
    {
      label: "Classes",
      value: classes.length,
      icon: Users,
      tone: "bg-[#0ea5e9]/10 text-[#0ea5e9]",
    },
    {
      label: "Academic Terms",
      value: 3,
      icon: CalendarRange,
      tone: "bg-[#10b981]/10 text-[#10b981]",
    },
    {
      label: "Sequences",
      value: 6,
      icon: Layers,
      tone: "bg-amber-100 text-amber-700",
    },
  ];

  return (
    <>
      {/* Hero / ribbon divider */}
      <div className="mb-6 flex items-center gap-4">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[#0ea5e9] to-transparent" />
        <span className="whitespace-nowrap text-xs font-semibold uppercase tracking-[0.2em] text-[#0ea5e9]">
          Academic Year {settings.academicYear || "—"}
        </span>
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[#0ea5e9] to-transparent" />
      </div>

      {error && <p className="mb-4 text-sm text-rose-500">{error}</p>}

      {/* System overview — redesigned as a stat tile grid */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-[#1e3a8a]">
              System Overview
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Welcome back. Here's where {settings.schoolName || "your school"}
              's academic records stand right now.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-dashed border-[#e2e8f0] py-10 text-center text-sm text-slate-400">
            Loading overview…
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {ledgerStats.map((stat) => (
              <StatTile key={stat.label} {...stat} />
            ))}
          </div>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Left column */}
        <div className="flex flex-col gap-6">
          <Card>
            <h3 className="text-lg font-bold tracking-tight text-[#1e3a8a]">
              Quick Actions
            </h3>
            <div className="mt-4 flex flex-col gap-2">
              {quickActions.map(({ label, icon: Icon, to }) => (
                <Link
                  key={label}
                  to={to}
                  className={`group flex items-center gap-3 rounded-lg border-l-4 border-[#10b981] bg-[#f1f5f9] px-4 py-3 text-left text-sm font-medium text-[#1e3a8a] transition-all duration-150 hover:-translate-y-0.5 hover:bg-[#e2e8f0] hover:shadow-sm active:translate-y-0 ${focusRing}`}
                >
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#10b981] text-white transition-transform group-hover:scale-105">
                    <Icon size={15} />
                  </span>
                  {label}
                  <ChevronRight
                    size={15}
                    className="ml-auto flex-shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-[#10b981]"
                  />
                </Link>
              ))}
            </div>
          </Card>

          <Card>
            <h3 className="text-lg font-bold tracking-tight text-[#1e3a8a]">
              Recent Activity
            </h3>
            {recentActivity.length === 0 ? (
              <p className="mt-4 py-6 text-center text-sm text-slate-400">
                No activity yet — actions you take will show up here.
              </p>
            ) : (
              <ul className="mt-4 flex flex-col gap-4">
                {recentActivity.map((item, i) => {
                  const Icon = iconByType[item.type] || FileText;
                  return (
                    <li
                      key={i}
                      className="flex items-start gap-3 rounded-lg p-1.5 transition-colors hover:bg-[#f1f5f9]"
                    >
                      <span
                        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${
                          toneByType[item.type] || "bg-slate-300 text-slate-700"
                        }`}
                      >
                        <Icon size={14} />
                      </span>
                      <div>
                        <p className="text-sm leading-snug text-[#1e293b]">
                          {item.text}
                        </p>
                        <p className="text-xs text-slate-400">
                          {relativeTime(item.timestamp)}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <Link
              to="/activities"
              className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-[#0ea5e9] hover:underline"
            >
              View all activity <ChevronRight size={14} />
            </Link>
          </Card>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-6">
          <Card>
            <h3 className="text-lg font-bold tracking-tight text-[#1e3a8a]">
              Top Performing Classes
            </h3>
            <p className="text-xs text-slate-400">
              Based on {settings.currentSequence || "current sequence"}
            </p>
            <div className="mt-4 flex flex-col gap-3">
              {loadingAverages ? (
                <p className="py-6 text-center text-sm text-slate-400">
                  Calculating averages…
                </p>
              ) : topClasses.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">
                  No marks recorded for this sequence yet.
                </p>
              ) : (
                topClasses.map((c, i) => (
                  <div
                    key={c.name}
                    className="flex items-center gap-3 rounded-lg border border-[#e2e8f0] p-3 transition-colors hover:border-[#0ea5e9]/40 hover:bg-[#0ea5e9]/5"
                  >
                    <span
                      className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${
                        i === 0
                          ? "bg-[#0ea5e9] text-white shadow-[0_0_0_3px_rgba(14,165,233,0.15)]"
                          : "bg-slate-200 text-slate-600"
                      }`}
                    >
                      <Award size={18} />
                    </span>
                    <div>
                      <div className="font-semibold text-[#1e3a8a]">
                        {c.name}
                      </div>
                      <div className="font-mono text-xs text-slate-500">
                        Avg {c.average.toFixed(2)}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card>
            <h3 className="text-lg font-bold tracking-tight text-[#1e3a8a]">
              Class Performance
            </h3>
            <p className="text-xs text-slate-400">
              {settings.currentSequence || "Current sequence"} average by class
            </p>
            <div className="mt-4 h-56">
              {loadingAverages ? (
                <div className="flex h-full items-center justify-center text-sm text-slate-400">
                  Loading chart…
                </div>
              ) : classAverages.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-slate-400">
                  No data yet.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={classAverages}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#e2e8f0"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11, fill: "#6B7280" }}
                      axisLine={{ stroke: "#e2e8f0" }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "#6B7280" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: "#f1f5f9" }}
                      contentStyle={{
                        borderRadius: 8,
                        border: "1px solid #e2e8f0",
                        fontSize: 12,
                      }}
                    />
                    <Bar
                      dataKey="average"
                      fill="#0ea5e9"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
