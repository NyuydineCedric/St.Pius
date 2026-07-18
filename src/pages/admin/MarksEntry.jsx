import { useEffect, useState } from "react";
import { Save, CheckCircle2 } from "lucide-react";
import {
  Card,
  CardHeader,
  PageHeading,
  Button,
  Label,
  Select,
} from "../../components/ui";
import {
  getClasses,
  getRoster,
  saveMarks,
  getMarks,
  getSettings,
  getTeachers,
} from "../../utils/api";
import {
  getSubjectsForStudent,
  getTeacherName,
  requiresStream,
} from "../../utils/subjects";

const termSequences = {
  "First Term": ["Sequence 1", "Sequence 2"],
  "Second Term": ["Sequence 3", "Sequence 4"],
  "Third Term": ["Sequence 5", "Sequence 6"],
};
const terms = Object.keys(termSequences);

export default function MarksEntry() {
  const [classes, setClasses] = useState([]);
  const [cls, setCls] = useState("");
  const [optionFilter, setOptionFilter] = useState("All");
  const [student, setStudent] = useState("");
  const [term, setTerm] = useState("Second Term");
  const [sequence, setSequence] = useState(termSequences["Second Term"][0]);
  const [marks, setMarks] = useState({});
  const [roster, setRoster] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [marksScale, setMarksScale] = useState(20);

  useEffect(() => {
    getClasses()
      .then((data) => {
        const list = data.map((c) => c.name);
        setClasses(list);
        if (list.length > 0) setCls(list[0]);
      })
      .catch((err) => setError(err.message));

    getTeachers()
      .then(setTeachers)
      .catch((err) => setError(err.message));

    // Default to whatever the school has set as the current term/sequence,
    // and pick up the marks scale (defaults to 20 if not set/loadable).
    getSettings()
      .then((settings) => {
        setMarksScale(Number(settings.marksScale) || 20);

        if (termSequences[settings.currentTerm]) {
          setTerm(settings.currentTerm);
          const validSequences = termSequences[settings.currentTerm];
          setSequence(
            validSequences.includes(settings.currentSequence)
              ? settings.currentSequence
              : validSequences[0],
          );
        }
      })
      .catch(() => {
        // If settings can't be loaded, just keep the built-in defaults.
      });
  }, []);

  useEffect(() => {
    if (!cls) return;
    getRoster(cls)
      .then(setRoster)
      .catch((err) => setError(err.message));
  }, [cls]);

  const streamed = requiresStream(cls);

  const filteredRoster =
    streamed && optionFilter !== "All"
      ? roster.filter((s) => s.option === optionFilter)
      : roster;

  const selectedStudentRecord =
    filteredRoster.find((s) => s.id === student) || null;
  const subjectRows = selectedStudentRecord
    ? getSubjectsForStudent(selectedStudentRecord)
    : [];

  useEffect(() => {
    if (!student || !sequence || !cls || subjectRows.length === 0) return;

    const loadMarksForStudent = async () => {
      try {
        const allMarks = {};
        for (const subject of subjectRows) {
          const subjectMarks = await getMarks(cls, subject.name, sequence);
          if (subjectMarks[student]) {
            allMarks[subject.name] = String(subjectMarks[student]);
          }
        }
        setMarks(allMarks);
      } catch (err) {
        console.error("Failed to load marks:", err);
      }
    };

    loadMarksForStudent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student, sequence, cls]);

  async function handleSave(e) {
    e.preventDefault();
    setSaved(false);
    setError("");
    if (!student) {
      setError("Please select a student");
      return;
    }
    try {
      for (const subject of Object.keys(marks)) {
        const mark = marks[subject];
        if (mark !== "" && mark !== null) {
          const marksObj = { [student]: Number(mark) };
          await saveMarks(cls, subject, sequence, marksObj);
        }
      }
      setSaved(true);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <PageHeading
        title="Marks Entry"
        subtitle={`Select a class, subject, and sequence, then enter marks out of ${marksScale}.`}
      />

      <Card>
        <CardHeader
          title="Enter Academic Results"
          subtitle="Fill marks for each subject and save them per sequence."
        />
        <div
          className={`grid gap-4 sm:grid-cols-2 ${
            streamed ? "lg:grid-cols-5" : "lg:grid-cols-4"
          }`}
        >
          <div>
            <Label htmlFor="cls">Class</Label>
            <Select
              id="cls"
              value={cls}
              onChange={(e) => {
                setCls(e.target.value);
                setOptionFilter("All");
                setStudent("");
              }}
            >
              {classes.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </div>

          {streamed && (
            <div>
              <Label htmlFor="option">Option</Label>
              <Select
                id="option"
                value={optionFilter}
                onChange={(e) => {
                  setOptionFilter(e.target.value);
                  setStudent("");
                }}
              >
                <option value="All">All</option>
                <option value="Science">Science</option>
                <option value="Arts">Arts</option>
              </Select>
            </div>
          )}

          <div>
            <Label htmlFor="student">Student</Label>
            <Select
              id="student"
              value={student}
              onChange={(e) => setStudent(e.target.value)}
            >
              <option value="">-- Select a student --</option>
              {filteredRoster.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.id}){s.option ? ` — ${s.option}` : ""}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="term">Term</Label>
            <Select
              id="term"
              value={term}
              onChange={(e) => {
                const nextTerm = e.target.value;
                setTerm(nextTerm);
                setSequence(termSequences[nextTerm][0] || "");
              }}
            >
              {terms.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="sequence">Sequence</Label>
            <Select
              id="sequence"
              value={sequence}
              onChange={(e) => setSequence(e.target.value)}
            >
              {(termSequences[term] || []).map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </div>
        </div>
      </Card>

      <Card className="mt-6">
        <CardHeader
          title={`${cls}${cls ? " · " + term + " · " + sequence : ""}`}
          subtitle={`${filteredRoster.length} student${
            filteredRoster.length === 1 ? "" : "s"
          } ${
            streamed && optionFilter !== "All"
              ? `(${optionFilter}) in this class`
              : "in this class"
          }`}
          action={
            saved && (
              <span className="flex items-center gap-1 text-sm font-medium text-[#10b981]">
                <CheckCircle2 size={16} /> Saved
              </span>
            )
          }
        />

        {error && <p className="mb-4 text-sm text-rose-500">{error}</p>}

        {filteredRoster.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#e2e8f0] py-10 text-center text-sm text-slate-400">
            {roster.length === 0
              ? `No students enrolled in ${cls} yet. Add students from the Student Entry page first.`
              : `No ${optionFilter} students in ${cls} yet.`}
          </div>
        ) : !student ? (
          <div className="rounded-xl border border-dashed border-[#e2e8f0] py-10 text-center text-sm text-slate-400">
            Select a student to enter marks.
          </div>
        ) : (
          <form onSubmit={handleSave}>
            <div className="overflow-x-auto rounded-xl border border-[#e2e8f0]">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[#e2e8f0] bg-[#0ea5e9] text-white">
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">
                      Subject
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">
                      Coefficient
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">
                      Teacher
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">
                      {`Marks (0–${marksScale})`}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e2e8f0]">
                  {subjectRows.map((subject, idx) => {
                    const mark = marks[subject.name] ?? "";
                    const teacherName = getTeacherName(
                      teachers,
                      cls,
                      subject.name,
                    );
                    return (
                      <tr
                        key={idx}
                        className="transition-colors hover:bg-[#f1f5f9]/60"
                      >
                        <td className="px-4 py-3 font-medium text-[#1e3a8a]">
                          {subject.name}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {subject.coefficient}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {teacherName}
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            min={0}
                            max={marksScale}
                            step={0.5}
                            value={mark}
                            onChange={(e) =>
                              setMarks((m) => ({
                                ...m,
                                [subject.name]: e.target.value,
                              }))
                            }
                            className="w-24 rounded-lg border border-[#e2e8f0] px-3 py-1.5 text-sm focus:border-[#0ea5e9] focus:outline-none focus:ring-2 focus:ring-[#0ea5e9]/15"
                            placeholder="—"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex gap-3">
              <Button type="submit" icon={Save} className="flex-1">
                Save Marks
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setMarks({});
                  setSaved(false);
                }}
              >
                Clear Marks
              </Button>
            </div>
          </form>
        )}
      </Card>
    </>
  );
}
