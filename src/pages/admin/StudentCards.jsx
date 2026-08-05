import { useEffect, useMemo, useState } from "react";
import { Search, ChevronRight, User, GraduationCap } from "lucide-react";
import {
  Card,
  CardHeader,
  PageHeading,
  Badge,
  EmptyState,
} from "../../components/ui";
import { getClasses, getRoster } from "../../utils/api";
import { compareClassNames } from "../../utils/subjects";

function StudentCardTile({ student }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start gap-3 border-b border-[#e2e8f0] bg-[#f8fafc] p-4">
        <div className="flex h-16 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-md border border-[#e2e8f0] bg-white">
          {student.photo ? (
            <img
              src={student.photo}
              alt={`${student.name} — photo`}
              className="h-full w-full object-cover"
            />
          ) : (
            <User size={22} className="text-slate-300" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-[#1e3a8a]">
            {student.name}
          </p>
          <p className="font-mono text-xs text-slate-400">{student.id}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone="navy">{student.class}</Badge>
            {student.option && <Badge tone="sky">{student.option}</Badge>}
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 p-4 text-xs">
        <div>
          <dt className="text-slate-400">Gender</dt>
          <dd className="font-medium text-slate-700">
            {student.gender || "—"}
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">Date of Birth</dt>
          <dd className="font-medium text-slate-700">
            {student.dob && student.dob !== "—" ? student.dob : "—"}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-slate-400">Guardian</dt>
          <dd className="truncate font-medium text-slate-700">
            {student.guardian && student.guardian !== "—"
              ? student.guardian
              : "—"}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-slate-400">Guardian Phone</dt>
          <dd className="font-medium text-slate-700">
            {student.phone && student.phone !== "—" ? student.phone : "—"}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export default function StudentCards() {
  const [classes, setClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState("");
  const [roster, setRoster] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getClasses()
      .then((data) => {
        const names = data.map((c) => c.name).sort(compareClassNames);
        setClasses(names);
        if (names.length > 0) setSelectedClass(names[0]);
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!selectedClass) return;
    setLoading(true);
    setError("");
    getRoster(selectedClass)
      .then(setRoster)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [selectedClass]);

  const filteredRoster = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter((s) =>
      `${s.name} ${s.id}`.toLowerCase().includes(q),
    );
  }, [roster, search]);

  return (
    <>
      <PageHeading
        title="Student Cards"
        subtitle="Pick a class to see every student's profile card, photo included."
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[280px_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Classes"
              subtitle="Choose a class to view its students."
            />
            {classes.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-400">
                No classes yet.
              </p>
            ) : (
              <div className="space-y-2">
                {classes.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
                      selectedClass === name
                        ? "border-[#0ea5e9] bg-[#0ea5e9]/10 text-[#0b61a6]"
                        : "border-[#e2e8f0] bg-white text-slate-700 hover:border-[#0ea5e9] hover:bg-[#f1f5f9]"
                    }`}
                    onClick={() => setSelectedClass(name)}
                  >
                    <span>{name}</span>
                    <ChevronRight size={18} />
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>

        <Card>
          <CardHeader
            title={selectedClass || "Select a class"}
            subtitle={
              selectedClass
                ? `${filteredRoster.length}${
                    search.trim() ? ` of ${roster.length}` : ""
                  } student${roster.length === 1 ? "" : "s"}`
                : "Pick a class from the left to view student cards."
            }
            action={
              selectedClass && (
                <div className="relative">
                  <Search
                    size={15}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search name or ID…"
                    className="w-52 rounded-full border border-[#e2e8f0] bg-[#f1f5f9] py-1.5 pl-8 pr-3 text-sm text-slate-600 placeholder:text-slate-400 focus:border-[#0ea5e9] focus:bg-white focus:outline-none"
                  />
                </div>
              )
            }
          />

          {error && <p className="mb-4 text-sm text-rose-500">{error}</p>}

          {loading ? (
            <p className="py-12 text-center text-sm text-slate-400">
              Loading…
            </p>
          ) : !selectedClass ? (
            <EmptyState
              icon={GraduationCap}
              title="No class selected"
              subtitle="Choose a class on the left to browse its students."
            />
          ) : filteredRoster.length === 0 ? (
            <EmptyState
              icon={GraduationCap}
              title="No students found"
              subtitle={
                search.trim()
                  ? `No students match "${search.trim()}".`
                  : `${selectedClass} has no students enrolled yet.`
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredRoster.map((student) => (
                <StudentCardTile key={student.id} student={student} />
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
