import React, { useEffect, useState } from "react";
import { Users, ArrowUpRight, Plus, X, GraduationCap } from "lucide-react";
import {
  Card,
  PageHeading,
  Button,
  Badge,
  Table,
  EmptyState,
} from "../../components/ui";
import { getClasses, getRoster } from "../../utils/api";

function averageTone(avg) {
  if (avg === null) return "slate";
  if (avg >= 16) return "emerald";
  if (avg >= 10) return "sky";
  return "rose";
}

export default function Classes() {
  const [classList, setClassList] = useState([]);
  const [error, setError] = useState("");

  const [rosterClass, setRosterClass] = useState(null);
  const [roster, setRoster] = useState([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState("");

  useEffect(() => {
    getClasses()
      .then(setClassList)
      .catch((err) => setError(err.message));
  }, []);

  function openRoster(className) {
    setRosterClass(className);
    setRoster([]);
    setRosterError("");
    setRosterLoading(true);
    getRoster(className)
      .then(setRoster)
      .catch((err) => setRosterError(err.message))
      .finally(() => setRosterLoading(false));
  }

  function closeRoster() {
    setRosterClass(null);
  }

  return (
    <>
      <PageHeading
        title="Classes"
        subtitle={`${classList.length} classes configured this academic year.`}
        action={<Button icon={Plus}>Add Class</Button>}
      />
      {error && <p className="mt-4 text-sm text-rose-500">{error}</p>}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {classList.map((c) => (
          <Card key={c.name} className="flex flex-col gap-4">
            <div className="flex items-start justify-between">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#1e3a8a]/10 text-[#1e3a8a]">
                <Users size={20} />
              </div>
              <Badge tone={averageTone(c.average)}>
                {c.average !== null ? `Avg ${c.average.toFixed(2)}` : "No data"}
              </Badge>
            </div>

            <div>
              <h3 className="text-lg font-bold tracking-tight text-[#1e3a8a]">
                {c.name}
              </h3>
              <p className="text-sm text-slate-500">{c.teacher}</p>
            </div>

            <div className="flex items-center justify-between border-t border-dashed border-[#e2e8f0] pt-3 text-sm">
              <span className="text-slate-500">
                {c.students} student{c.students === 1 ? "" : "s"}
              </span>
              <button
                onClick={() => openRoster(c.name)}
                className="flex items-center gap-1 font-medium text-[#0ea5e9] hover:underline"
              >
                View roster <ArrowUpRight size={14} />
              </button>
            </div>
          </Card>
        ))}
      </div>

      {rosterClass && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="max-h-[80vh] w-full max-w-2xl overflow-y-auto">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold tracking-tight text-[#1e3a8a]">
                  {rosterClass} Roster
                </h3>
                <p className="mt-0.5 text-sm text-slate-500">
                  {roster.length} student{roster.length === 1 ? "" : "s"}
                </p>
              </div>
              <button
                onClick={closeRoster}
                className="rounded-md p-1.5 text-slate-400 hover:bg-[#f1f5f9] hover:text-[#1e3a8a]"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {rosterLoading && (
              <p className="py-6 text-center text-sm text-slate-400">
                Loading…
              </p>
            )}

            {rosterError && (
              <p className="py-6 text-center text-sm text-rose-500">
                {rosterError}
              </p>
            )}

            {!rosterLoading && !rosterError && roster.length === 0 && (
              <EmptyState
                icon={GraduationCap}
                title="No students yet"
                subtitle={`${rosterClass} has no students enrolled.`}
              />
            )}

            {!rosterLoading && !rosterError && roster.length > 0 && (
              <Table
                columns={["Student ID", "Name", "Gender", "Guardian", "Phone"]}
              >
                {roster.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {s.id}
                    </td>
                    <td className="px-4 py-3 font-medium text-[#1e3a8a]">
                      {s.name}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{s.gender}</td>
                    <td className="px-4 py-3 text-slate-600">{s.guardian}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {s.phone || "—"}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
