import { useEffect, useMemo, useState } from "react";
import { Save, CheckCircle2, Search } from "lucide-react";
import {
  Card,
  CardHeader,
  PageHeading,
  Button,
  Label,
  Select,
  Table,
} from "../../components/ui";
import {
  getTeachers,
  getRoster,
  getMarks,
  saveMarks,
  getSettings,
} from "../../utils/api";
import { getSubjectsForStudent } from "../../utils/subjects";
import { useAuth } from "../../context/AuthContext";

const termSequences = {
  "First Term": ["Sequence 1", "Sequence 2"],
  "Second Term": ["Sequence 3", "Sequence 4"],
  "Third Term": ["Sequence 5", "Sequence 6"],
};
const terms = Object.keys(termSequences);

export default function TeacherMarksEntry() {
  const { user } = useAuth();

  const [teacherRecord, setTeacherRecord] = useState(null);
  const [teacherLoading, setTeacherLoading] = useState(true);
  const [teacherLookupError, setTeacherLookupError] = useState("");

  const [className, setClassName] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [term, setTerm] = useState("Second Term");
  const [roster, setRoster] = useState([]);
  const [marksBySequence, setMarksBySequence] = useState({}); // { seq: { studentId: value } }
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [marksScale, setMarksScale] = useState(20);
  const [rosterSearch, setRosterSearch] = useState("");

  // Identify the logged-in teacher's staff record. AuthContext only gives
  // us the login account (user.id / user.email from the "users" table),
  // which is a separate record from "teachers" — so we match on email,
  // the one field both share.
  useEffect(() => {
    if (!user) {
      setTeacherLoading(false);
      return;
    }
    setTeacherLoading(true);
    getTeachers()
      .then((list) => {
        const match = list.find(
          (t) => t.email?.toLowerCase() === user.email?.toLowerCase(),
        );
        if (!match) {
          setTeacherLookupError(
            "No teacher profile is linked to your account yet. Ask an admin to check your email matches your staff record in Settings → Staff Management.",
          );
        } else {
          setTeacherRecord(match);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setTeacherLoading(false));
  }, [user]);

  const assignments = teacherRecord ? teacherRecord.assignments : [];

  // Classes this teacher teaches (deduplicated).
  const classOptions = useMemo(() => {
    const seen = new Set();
    const out = [];
    assignments.forEach((a) => {
      if (!seen.has(a.class)) {
        seen.add(a.class);
        out.push(a.class);
      }
    });
    return out;
  }, [assignments]);

  // Subjects this teacher teaches within the selected class.
  const subjectOptions = useMemo(() => {
    if (!className) return [];
    return assignments
      .filter((a) => a.class === className)
      .map((a) => a.subject);
  }, [assignments, className]);

  useEffect(() => {
    getSettings()
      .then((settings) => {
        setMarksScale(Number(settings.marksScale) || 20);
      })
      .catch(() => {
        // Keep the built-in default if settings can't be loaded.
      });
  }, []);

  const sequences = termSequences[term] || [];

  const visibleRoster = useMemo(() => {
    const q = rosterSearch.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter((s) =>
      `${s.name} ${s.id}`.toLowerCase().includes(q),
    );
  }, [roster, rosterSearch]);

  // Load the roster for the selected class, then filter down to only the
  // students who actually study this subject (Science/Arts streaming,
  // electives, Sixth Form free choice all affect this).
  useEffect(() => {
    if (!className || !subjectName) {
      setRoster([]);
      return;
    }
    setLoadingRoster(true);
    getRoster(className)
      .then((data) => {
        const relevant = data.filter((s) =>
          getSubjectsForStudent(s).some((sub) => sub.name === subjectName),
        );
        setRoster(relevant);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoadingRoster(false));
  }, [className, subjectName]);

  // Load existing marks for both sequences of the selected term.
  useEffect(() => {
    if (!className || !subjectName || sequences.length === 0) return;

    let active = true;
    const load = async () => {
      try {
        const results = await Promise.all(
          sequences.map((seq) => getMarks(className, subjectName, seq)),
        );
        if (!active) return;
        const next = {};
        sequences.forEach((seq, i) => {
          next[seq] = results[i];
        });
        setMarksBySequence(next);
      } catch (err) {
        if (active) setError(err.message);
      }
    };
    load();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [className, subjectName, term]);

  function updateMark(studentId, sequence, value) {
    setSaved(false);
    setMarksBySequence((prev) => ({
      ...prev,
      [sequence]: { ...prev[sequence], [studentId]: value },
    }));
  }

  function clampMark(value) {
    if (value === "" || value === null || value === undefined) return value;
    const n = Number(value);
    if (Number.isNaN(n)) return value;
    return Math.min(Math.max(n, 0), marksScale);
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaved(false);
    setError("");
    if (!className || !subjectName) {
      setError("Please select a class and subject.");
      return;
    }
    setSaving(true);
    try {
      for (const seq of sequences) {
        const seqMarks = marksBySequence[seq] || {};
        const cleaned = {};
        roster.forEach((s) => {
          const v = seqMarks[s.id];
          if (v === undefined) return;
          if (v === "" || v === null) {
            cleaned[s.id] = null; // clear previously saved mark
          } else if (!Number.isNaN(Number(v))) {
            cleaned[s.id] = clampMark(v);
          }
        });
        if (Object.keys(cleaned).length > 0) {
          await saveMarks(className, subjectName, seq, cleaned);
        }
      }
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (teacherLoading) {
    return (
      <>
        <PageHeading
          title="My Marks Entry"
          subtitle="Loading your teaching profile…"
        />
      </>
    );
  }

  if (teacherLookupError) {
    return (
      <>
        <PageHeading title="My Marks Entry" subtitle=" " />
        <Card>
          <p className="py-6 text-center text-sm text-rose-500">
            {teacherLookupError}
          </p>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeading
        title="My Marks Entry"
        subtitle={`Welcome ${teacherRecord?.name || ""}. Choose a class and subject, then enter marks for both sequences of the term (out of ${marksScale}).`}
      />

      <Card>
        <CardHeader
          title="Select Class & Subject"
          subtitle="Only classes and subjects assigned to you appear here."
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label htmlFor="className">Class</Label>
            <Select
              id="className"
              value={className}
              onChange={(e) => {
                setClassName(e.target.value);
                setSubjectName("");
                setRosterSearch("");
              }}
            >
              <option value="">-- Select a class --</option>
              {classOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            {classOptions.length === 0 && (
              <p className="mt-1 text-xs text-amber-600">
                You have not been assigned to any classes yet.
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="subjectName">Subject</Label>
            <Select
              id="subjectName"
              value={subjectName}
              onChange={(e) => setSubjectName(e.target.value)}
              disabled={!className}
            >
              <option value="">-- Select a subject --</option>
              {subjectOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="term">Term</Label>
            <Select
              id="term"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            >
              {terms.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </div>
        </div>
      </Card>

      <Card className="mt-6">
        <CardHeader
          title={
            className && subjectName
              ? `${subjectName} · ${className} · ${term}`
              : "No class/subject selected"
          }
          subtitle={
            className && subjectName
              ? `${roster.length} student${roster.length === 1 ? "" : "s"} offering this subject`
              : "Select a class and subject above to begin."
          }
          action={
            <div className="flex items-center gap-3">
              {className && subjectName && roster.length > 0 && (
                <div className="relative">
                  <Search
                    size={15}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    type="search"
                    value={rosterSearch}
                    onChange={(e) => setRosterSearch(e.target.value)}
                    placeholder="Filter students…"
                    className="w-44 rounded-full border border-[#e2e8f0] bg-[#f1f5f9] py-1.5 pl-8 pr-3 text-sm text-slate-600 placeholder:text-slate-400 focus:border-[#0ea5e9] focus:bg-white focus:outline-none"
                  />
                </div>
              )}
              {saved && (
                <span className="flex items-center gap-1 text-sm font-medium text-[#10b981]">
                  <CheckCircle2 size={16} /> Saved
                </span>
              )}
            </div>
          }
        />

        {error && <p className="mb-4 text-sm text-rose-500">{error}</p>}

        {!className || !subjectName ? (
          <div className="rounded-xl border border-dashed border-[#e2e8f0] py-10 text-center text-sm text-slate-400">
            Choose a class and subject to see the student list.
          </div>
        ) : loadingRoster ? (
          <p className="py-10 text-center text-sm text-slate-400">
            Loading roster…
          </p>
        ) : roster.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#e2e8f0] py-10 text-center text-sm text-slate-400">
            No students in {className} currently offer {subjectName}.
          </div>
        ) : visibleRoster.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#e2e8f0] py-10 text-center text-sm text-slate-400">
            No students match “{rosterSearch.trim()}”.
          </div>
        ) : (
          <form onSubmit={handleSave}>
            <Table columns={["Student ID", "Student Name", ...sequences]}>
              {visibleRoster.map((s) => (
                <tr
                  key={s.id}
                  className="transition-colors hover:bg-[#f1f5f9]/60"
                >
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">
                    {s.id}
                  </td>
                  <td className="px-4 py-3 font-medium text-[#1e3a8a]">
                    {s.name}
                  </td>
                  {sequences.map((seq) => (
                    <td key={seq} className="px-4 py-3">
                      <input
                        type="number"
                        min={0}
                        max={marksScale}
                        step={0.5}
                        value={marksBySequence[seq]?.[s.id] ?? ""}
                        onChange={(e) => updateMark(s.id, seq, e.target.value)}
                        onBlur={(e) =>
                          updateMark(s.id, seq, clampMark(e.target.value))
                        }
                        className="w-24 rounded-lg border border-[#e2e8f0] px-3 py-1.5 text-sm focus:border-[#0ea5e9] focus:outline-none focus:ring-2 focus:ring-[#0ea5e9]/15"
                        placeholder="—"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </Table>

            <div className="mt-4 flex gap-3">
              <Button
                type="submit"
                icon={Save}
                className="flex-1"
                disabled={saving}
              >
                {saving ? "Saving…" : "Save Marks"}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </>
  );
}
