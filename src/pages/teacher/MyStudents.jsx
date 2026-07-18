import React, { useEffect, useState } from "react";
import {
  Users,
  ChevronLeft,
  GraduationCap,
  BookOpen,
  AlertCircle,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { getTeachers, getRoster } from "../../utils/api";

export default function MyStudents() {
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [myClasses, setMyClasses] = useState([]); // [{ className, subjects: [...] }]

  const [selectedClass, setSelectedClass] = useState(null);
  const [selectedSubject, setSelectedSubject] = useState(null);

  const [roster, setRoster] = useState([]);
  const [rosterLoading, setRosterLoading] = useState(false);

  // Step 1: find this teacher's assignments by matching email against the
  // Teacher staff list, then collapse assignments into unique classes.
  useEffect(() => {
    let cancelled = false;

    async function loadAssignments() {
      setLoading(true);
      setError(null);
      try {
        const teachers = await getTeachers();
        const mine = teachers.find(
          (t) =>
            t.email?.trim().toLowerCase() === user?.email?.trim().toLowerCase(),
        );

        if (cancelled) return;

        if (!mine || mine.assignments.length === 0) {
          setMyClasses([]);
          setError(
            "No class assignments found for your account. Contact your admin to be assigned to a class.",
          );
          return;
        }

        const byClass = new Map();
        for (const a of mine.assignments) {
          if (!byClass.has(a.class)) byClass.set(a.class, []);
          byClass.get(a.class).push(a.subject);
        }
        setMyClasses(
          Array.from(byClass.entries()).map(([className, subjects]) => ({
            className,
            subjects,
          })),
        );
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load your classes.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (user?.email) loadAssignments();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Once a class is picked: if it only has one subject for this teacher,
  // skip the subject step entirely.
  useEffect(() => {
    if (!selectedClass) return;
    const entry = myClasses.find((c) => c.className === selectedClass);
    if (entry && entry.subjects.length === 1) {
      setSelectedSubject(entry.subjects[0]);
    }
  }, [selectedClass, myClasses]);

  // Step 3: once class (and subject, if needed) are set, fetch the roster.
  // Note: the roster itself doesn't change by subject — every student in
  // the class is returned regardless. The subject is just page context.
  useEffect(() => {
    if (!selectedClass || !selectedSubject) return;
    let cancelled = false;

    async function loadRoster() {
      setRosterLoading(true);
      try {
        const data = await getRoster(selectedClass);
        if (!cancelled) setRoster(data);
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load roster.");
      } finally {
        if (!cancelled) setRosterLoading(false);
      }
    }

    loadRoster();
    return () => {
      cancelled = true;
    };
  }, [selectedClass, selectedSubject]);

  const goBack = () => {
    if (selectedSubject) {
      const entry = myClasses.find((c) => c.className === selectedClass);
      if (entry && entry.subjects.length === 1) {
        // Subject was auto-picked (only one option) — go straight to class list.
        setSelectedClass(null);
        setSelectedSubject(null);
      } else {
        setSelectedSubject(null);
        setRoster([]);
      }
    } else {
      setSelectedClass(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400">
        Loading your classes…
      </div>
    );
  }

  if (error && myClasses.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-[#e2e8f0] bg-white py-16 text-center">
        <AlertCircle size={32} className="text-amber-500" />
        <p className="max-w-sm text-sm text-slate-500">{error}</p>
      </div>
    );
  }

  // ---- Step: class picker ----
  if (!selectedClass) {
    return (
      <div>
        <h2 className="mb-4 text-lg font-semibold text-[#1e3a8a]">
          Select a class to view its students
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {myClasses.map(({ className, subjects }) => (
            <button
              key={className}
              onClick={() => setSelectedClass(className)}
              className="flex flex-col gap-2 rounded-xl border border-[#e2e8f0] bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[#0ea5e9]/50 hover:shadow-md"
            >
              <div className="flex items-center gap-2 text-[#1e3a8a]">
                <GraduationCap size={18} />
                <span className="text-base font-semibold">{className}</span>
              </div>
              <span className="text-xs text-slate-400">
                {subjects.join(", ")}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ---- Step: subject picker (only shown when a class has 2+ subjects) ----
  if (!selectedSubject) {
    const entry = myClasses.find((c) => c.className === selectedClass);
    return (
      <div>
        <button
          onClick={goBack}
          className="mb-4 flex items-center gap-1 text-sm font-medium text-[#0ea5e9] hover:underline"
        >
          <ChevronLeft size={16} />
          Back to classes
        </button>
        <h2 className="mb-4 text-lg font-semibold text-[#1e3a8a]">
          {selectedClass} — which subject are you viewing for?
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {entry.subjects.map((subject) => (
            <button
              key={subject}
              onClick={() => setSelectedSubject(subject)}
              className="flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[#0ea5e9]/50 hover:shadow-md"
            >
              <BookOpen size={18} className="text-[#1e3a8a]" />
              <span className="text-base font-semibold text-[#1e3a8a]">
                {subject}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ---- Step: roster (read-only) ----
  return (
    <div>
      <button
        onClick={goBack}
        className="mb-4 flex items-center gap-1 text-sm font-medium text-[#0ea5e9] hover:underline"
      >
        <ChevronLeft size={16} />
        Back
      </button>

      <div className="mb-4 flex items-center gap-2">
        <Users size={18} className="text-[#1e3a8a]" />
        <h2 className="text-lg font-semibold text-[#1e3a8a]">
          {selectedClass} · {selectedSubject} — {roster.length} student
          {roster.length !== 1 ? "s" : ""}
        </h2>
      </div>

      {rosterLoading ? (
        <div className="flex h-40 items-center justify-center text-slate-400">
          Loading roster…
        </div>
      ) : roster.length === 0 ? (
        <div className="rounded-xl border border-[#e2e8f0] bg-white py-12 text-center text-sm text-slate-400">
          No students enrolled in this class yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#e2e8f0] bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#f1f5f9] text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Gender</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e2e8f0]">
              {roster.map((s, index) => (
                <tr key={s.id} className="hover:bg-[#f1f5f9]">
                  <td className="px-4 py-3 text-slate-400">{index + 1}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">
                    {s.id}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-700">
                    {s.name}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{s.gender}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-600">
                      {s.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
