import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardHeader, PageHeading, Badge, Select } from "../../components/ui";
import { getClasses, getRoster, getMarks } from "../../utils/api";

const subjectRows = [
  { name: "English Language", coefficient: 5 },
  { name: "French Language", coefficient: 5 },
  { name: "Mathematics", coefficient: 5 },
  { name: "Geography", coefficient: 3 },
  { name: "Physics", coefficient: 3 },
  { name: "Chemistry", coefficient: 3 },
  { name: "Biology", coefficient: 3 },
  { name: "History", coefficient: 3 },
  { name: "Literature in English", coefficient: 3 },
  { name: "Computer Science", coefficient: 3 },
  { name: "Sports", coefficient: 1 },
  { name: "Manual Labour", coefficient: 1 },
  { name: "Citizenship", coefficient: 3 },
  { name: "Food and Nutrition", coefficient: 3 },
  { name: "Sound and Word Building", coefficient: 3 },
];

const allSequences = [
  "Sequence 1",
  "Sequence 2",
  "Sequence 3",
  "Sequence 4",
  "Sequence 5",
  "Sequence 6",
];

const termSequences = {
  "First Term": ["Sequence 1", "Sequence 2"],
  "Second Term": ["Sequence 3", "Sequence 4"],
  "Third Term": ["Sequence 5", "Sequence 6"],
};

const totalCoefficient = subjectRows.reduce((sum, s) => sum + s.coefficient, 0);

function sequenceShortLabel(sequence) {
  return sequence.replace("Sequence ", "Seq ");
}

// Weighted average across all subjects for ONE sequence, for one student in one class.
function weightedSequenceAverage(classMarks, studentId, sequence) {
  const weighted = subjectRows.reduce((sum, subject) => {
    const mark = Number(
      classMarks?.[subject.name]?.[sequence]?.[studentId] ?? 0,
    );
    return sum + mark * subject.coefficient;
  }, 0);
  return totalCoefficient ? weighted / totalCoefficient : 0;
}

// Average of the two sequence-averages for a given term (e.g. Second Term = Seq 3 & Seq 4).
function termAverage(classMarks, studentId, term) {
  const sequences = termSequences[term] || [];
  if (sequences.length === 0) return 0;
  const sum = sequences.reduce(
    (acc, sequence) =>
      acc + weightedSequenceAverage(classMarks, studentId, sequence),
    0,
  );
  return sum / sequences.length;
}

export default function Performance() {
  const [classes, setClasses] = useState([]); // [{name, students}]
  const [rostersByClass, setRostersByClass] = useState({});
  const [marksByClass, setMarksByClass] = useState({});
  const [term, setTerm] = useState("Second Term");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getClasses()
      .then((data) => setClasses(data))
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    const activeClasses = classes.filter((c) => c.students > 0);
    if (activeClasses.length === 0) {
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);

    const loadAll = async () => {
      try {
        const rosterResults = await Promise.all(
          activeClasses.map((c) =>
            getRoster(c.name).then((roster) => ({ className: c.name, roster })),
          ),
        );
        if (!active) return;

        const rosters = {};
        rosterResults.forEach(({ className, roster }) => {
          rosters[className] = roster;
        });
        setRostersByClass(rosters);

        const marksResults = await Promise.all(
          activeClasses.flatMap((c) =>
            subjectRows.flatMap((subject) =>
              allSequences.map((sequence) =>
                getMarks(c.name, subject.name, sequence).then((marks) => ({
                  className: c.name,
                  subject: subject.name,
                  sequence,
                  marks,
                })),
              ),
            ),
          ),
        );
        if (!active) return;

        const byClass = {};
        marksResults.forEach(({ className, subject, sequence, marks }) => {
          byClass[className] = byClass[className] || {};
          byClass[className][subject] = byClass[className][subject] || {};
          byClass[className][subject][sequence] = marks;
        });
        setMarksByClass(byClass);
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    };

    loadAll();

    return () => {
      active = false;
    };
  }, [classes]);

  // Every student, flattened, with their class name — used for trend, rankings, comparisons.
  const allStudents = useMemo(() => {
    return Object.entries(rostersByClass).flatMap(([className, roster]) =>
      roster.map((student) => ({ student, className })),
    );
  }, [rostersByClass]);

  const termTrend = useMemo(() => {
    return allSequences.map((sequence) => {
      if (allStudents.length === 0) {
        return { sequence: sequenceShortLabel(sequence), average: 0 };
      }
      const total = allStudents.reduce((sum, { student, className }) => {
        return (
          sum +
          weightedSequenceAverage(marksByClass[className], student.id, sequence)
        );
      }, 0);
      return {
        sequence: sequenceShortLabel(sequence),
        average: Number((total / allStudents.length).toFixed(2)),
      };
    });
  }, [allStudents, marksByClass]);

  const classComparison = useMemo(() => {
    return classes
      .filter((c) => c.students > 0)
      .map((c) => {
        const roster = rostersByClass[c.name] || [];
        if (roster.length === 0) return { name: c.name, average: 0 };
        const total = roster.reduce(
          (sum, student) =>
            sum + termAverage(marksByClass[c.name], student.id, term),
          0,
        );
        return {
          name: c.name,
          average: Number((total / roster.length).toFixed(2)),
        };
      });
  }, [classes, rostersByClass, marksByClass, term]);

  const rankedStudents = useMemo(() => {
    return allStudents
      .map(({ student, className }) => ({
        name: student.name,
        class: className,
        average: termAverage(marksByClass[className], student.id, term),
      }))
      .sort((a, b) => b.average - a.average);
  }, [allStudents, marksByClass, term]);

  const topPerformers = useMemo(
    () => rankedStudents.slice(0, 5),
    [rankedStudents],
  );
  const bottomPerformers = useMemo(
    () => [...rankedStudents].reverse().slice(0, 5),
    [rankedStudents],
  );

  return (
    <>
      <PageHeading
        title="Performance"
        subtitle="Academic trends across sequences, classes, and students."
        action={
          <Select
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            className="max-w-[180px]"
          >
            {Object.keys(termSequences).map((termName) => (
              <option key={termName}>{termName}</option>
            ))}
          </Select>
        }
      />

      {error && <p className="mb-4 text-sm text-rose-500">{error}</p>}
      {loading && (
        <p className="mb-4 text-sm text-slate-400">Crunching the numbers…</p>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Overall Trend"
            subtitle="School-wide average by sequence"
          />
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={termTrend}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#e2e8f0"
                  vertical={false}
                />
                <XAxis
                  dataKey="sequence"
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
                  contentStyle={{
                    borderRadius: 8,
                    border: "1px solid #e2e8f0",
                    fontSize: 12,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="average"
                  stroke="#0ea5e9"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: "#0ea5e9" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Class Comparison"
            subtitle={`${term} average by class`}
          />
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={classComparison}>
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
                <Bar dataKey="average" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Top Performers"
            subtitle={`Highest ${term.toLowerCase()} averages`}
            action={<TrendingUp size={18} className="text-[#10b981]" />}
          />
          <div className="flex flex-col gap-2">
            {topPerformers.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">
                No student data yet.
              </p>
            ) : (
              topPerformers.map((s, i) => (
                <div
                  key={`${s.name}-${s.class}`}
                  className="flex items-center justify-between rounded-lg border border-[#e2e8f0] px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#10b981]/10 text-xs font-bold text-[#10b981]">
                      {i + 1}
                    </span>
                    <div>
                      <div className="font-medium text-[#1e3a8a]">{s.name}</div>
                      <div className="text-xs text-slate-400">{s.class}</div>
                    </div>
                  </div>
                  <Badge tone="emerald">{s.average.toFixed(2)}</Badge>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Needs Attention"
            subtitle={`Lowest ${term.toLowerCase()} averages`}
            action={<TrendingDown size={18} className="text-rose-500" />}
          />
          <div className="flex flex-col gap-2">
            {bottomPerformers.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">
                No student data yet.
              </p>
            ) : (
              bottomPerformers.map((s, i) => (
                <div
                  key={`${s.name}-${s.class}`}
                  className="flex items-center justify-between rounded-lg border border-[#e2e8f0] px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-rose-100 text-xs font-bold text-rose-500">
                      {i + 1}
                    </span>
                    <div>
                      <div className="font-medium text-[#1e3a8a]">{s.name}</div>
                      <div className="text-xs text-slate-400">{s.class}</div>
                    </div>
                  </div>
                  <Badge tone="rose">{s.average.toFixed(2)}</Badge>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
