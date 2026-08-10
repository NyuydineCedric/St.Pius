import React, { useEffect, useMemo, useState } from "react";
import { Users, ArrowUpRight, Plus, X, GraduationCap } from "lucide-react";
import {
  Card,
  PageHeading,
  Button,
  Badge,
  Table,
  EmptyState,
  Label,
  Select,
  Input,
} from "../../components/ui";
import { getClasses, addClass, getRoster } from "../../utils/api";
import {
  CLASS_LEVELS,
  SECTION_SUGGESTIONS,
  buildClassName,
  parseClassName,
  compareClassNames,
  getClassLevel,
} from "../../utils/subjects";

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

  const [showAdd, setShowAdd] = useState(false);
  const [level, setLevel] = useState(CLASS_LEVELS[0]);
  const [section, setSection] = useState("");
  const [customSection, setCustomSection] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");

  useEffect(() => {
    getClasses()
      .then(setClassList)
      .catch((err) => setError(err.message));
  }, []);

  const sortedClasses = useMemo(
    () => [...classList].sort((a, b) => compareClassNames(a.name, b.name)),
    [classList],
  );

  const grouped = useMemo(() => {
    const map = new Map();
    for (const c of sortedClasses) {
      const lvl = getClassLevel(c.name) || c.name;
      if (!map.has(lvl)) map.set(lvl, []);
      map.get(lvl).push(c);
    }
    return map;
  }, [sortedClasses]);

  const previewName = useMemo(() => {
    const sec =
      section === "__custom__" ? customSection.trim().slice(0, 1) : section;
    return buildClassName(level, sec);
  }, [level, section, customSection]);

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

  function openAdd() {
    setLevel(CLASS_LEVELS[0]);
    setSection("");
    setCustomSection("");
    setAddError("");
    setShowAdd(true);
  }

  async function handleAddClass(e) {
    e.preventDefault();
    setAddError("");
    if (!previewName) {
      setAddError("Choose a level (and optional section).");
      return;
    }
    setAdding(true);
    try {
      const created = await addClass(previewName);
      setClassList((prev) => [...prev, created]);
      setShowAdd(false);
    } catch (err) {
      setAddError(err.message || "Could not add class");
    } finally {
      setAdding(false);
    }
  }

  return (
    <>
      <PageHeading
        title="Classes"
        subtitle={`${classList.length} class${classList.length === 1 ? "" : "es"} configured this academic year.`}
        action={
          <Button icon={Plus} onClick={openAdd}>
            Add Class
          </Button>
        }
      />
      {error && <p className="mt-4 text-sm text-rose-500">{error}</p>}

      {sortedClasses.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="No classes yet"
          subtitle="Add Form 1A, Form 1B, etc. to match how your school is organised."
        />
      ) : (
        <div className="flex flex-col gap-8">
          {[...grouped.entries()].map(([lvl, items]) => (
            <div key={lvl}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
                {lvl}
                <span className="ml-2 font-normal normal-case tracking-normal text-slate-400">
                  ({items.length} arm{items.length === 1 ? "" : "s"})
                </span>
              </h2>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((c) => {
                  const { section: sec } = parseClassName(c.name);
                  return (
                    <Card key={c.name} className="flex flex-col gap-4">
                      <div className="flex items-start justify-between">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#1e3a8a]/10 text-[#1e3a8a]">
                          <Users size={20} />
                        </div>
                        <div className="flex items-center gap-2">
                          {sec && <Badge tone="sky">Arm {sec}</Badge>}
                          <Badge tone={averageTone(c.average)}>
                            {c.average !== null
                              ? `Avg ${c.average.toFixed(2)}`
                              : "No data"}
                          </Badge>
                        </div>
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
                          type="button"
                          onClick={() => openRoster(c.name)}
                          className="flex items-center gap-1 font-medium text-[#0ea5e9] hover:underline"
                        >
                          View roster <ArrowUpRight size={14} />
                        </button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-md">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold tracking-tight text-[#1e3a8a]">
                  Add Class
                </h3>
                <p className="mt-0.5 text-sm text-slate-500">
                  Pick a level and optional arm (A, B, C…) for your school.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="rounded-md p-1.5 text-slate-400 hover:bg-[#f1f5f9] hover:text-[#1e3a8a]"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddClass} className="flex flex-col gap-4">
              <div>
                <Label htmlFor="level">Level</Label>
                <Select
                  id="level"
                  value={level}
                  onChange={(e) => setLevel(e.target.value)}
                >
                  {CLASS_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="section">Section / arm</Label>
                <Select
                  id="section"
                  value={section}
                  onChange={(e) => setSection(e.target.value)}
                >
                  <option value="">None (e.g. Form 1)</option>
                  {SECTION_SUGGESTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                  <option value="__custom__">Other letter…</option>
                </Select>
              </div>

              {section === "__custom__" && (
                <div>
                  <Label htmlFor="customSection">Letter</Label>
                  <Input
                    id="customSection"
                    maxLength={1}
                    placeholder="e.g. G"
                    value={customSection}
                    onChange={(e) =>
                      setCustomSection(e.target.value.replace(/[^A-Za-z]/g, ""))
                    }
                  />
                </div>
              )}

              <div className="rounded-lg border border-dashed border-[#e2e8f0] bg-[#f8fafc] px-4 py-3 text-sm">
                <span className="text-slate-500">Will create: </span>
                <span className="font-semibold text-[#1e3a8a]">
                  {previewName || "—"}
                </span>
              </div>

              {addError && <p className="text-sm text-rose-500">{addError}</p>}

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowAdd(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" icon={Plus} disabled={adding || !previewName}>
                  {adding ? "Adding…" : "Add Class"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

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
                type="button"
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
                  <tr key={s.code || s.id}>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {s.code || s.id}
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
