import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Users,
  ArrowUpRight,
  Plus,
  X,
  GraduationCap,
  Pencil,
  Trash2,
  Camera,
  User,
  Save,
} from "lucide-react";
import AuthImage from "../../components/AuthImage";
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
import {
  getClasses,
  addClass,
  getRoster,
  updateStudent,
  deleteStudent,
  logActivity,
} from "../../utils/api";
import {
  CLASS_LEVELS,
  SECTION_SUGGESTIONS,
  buildClassName,
  parseClassName,
  compareClassNames,
  getClassLevel,
  requiresStream,
  isSixthForm,
  getCoreSubjects,
  getSixthFormElectivePool,
  ELECTIVE_SUBJECTS,
} from "../../utils/subjects";
import { fileToCompressedDataUrl } from "../../utils/image";

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

  // Edit-student pop-up
  const [editingStudent, setEditingStudent] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const photoInputRef = useRef(null);

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
    closeEdit();
  }

  function refreshClasses() {
    getClasses()
      .then(setClassList)
      .catch(() => {});
  }

  // ---- Edit pop-up ----
  function openEdit(student) {
    setEditingStudent(student);
    setEditError("");
    setPhotoError("");
    setEditForm({
      name: student.name || "",
      dob: student.dob && student.dob !== "—" ? student.dob : "",
      gender: student.gender || "Male",
      class: student.class || rosterClass || "",
      guardian:
        student.guardian && student.guardian !== "—" ? student.guardian : "",
      phone: student.phone && student.phone !== "—" ? student.phone : "",
      option: student.option || "",
      electives: student.electives
        ? student.electives
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
      photo: student.photo || "",
      admittedOn:
        student.admittedOn && student.admittedOn !== "—"
          ? student.admittedOn
          : "",
    });
  }

  function closeEdit() {
    setEditingStudent(null);
    setEditForm(null);
    setEditError("");
    setPhotoError("");
  }

  function setField(field, value) {
    setEditForm((f) => ({ ...f, [field]: value }));
  }

  function toggleElective(name) {
    setEditForm((f) => {
      const has = f.electives.includes(name);
      return {
        ...f,
        electives: has
          ? f.electives.filter((e) => e !== name)
          : [...f.electives, name],
      };
    });
  }

  async function handlePhotoSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPhotoError("");
    setPhotoLoading(true);
    try {
      const dataUrl = await fileToCompressedDataUrl(file);
      setField("photo", dataUrl);
    } catch (err) {
      setPhotoError(err.message || "Could not process that image.");
    } finally {
      setPhotoLoading(false);
    }
  }

  async function handleSaveEdit(e) {
    e.preventDefault();
    if (!editingStudent || !editForm) return;
    if (!editForm.name.trim()) return;

    const streamRequired = requiresStream(editForm.class);
    const sixthForm = isSixthForm(editForm.class);

    if (streamRequired && !editForm.option) {
      setEditError("Please select Science or Arts for this class.");
      return;
    }
    if (sixthForm && editForm.option && editForm.electives.length === 0) {
      setEditError(
        "Please select at least one additional subject alongside the compulsory one.",
      );
      return;
    }

    setEditSaving(true);
    setEditError("");

    const payload = {
      name: editForm.name.trim(),
      class: editForm.class,
      gender: editForm.gender,
      guardian: editForm.guardian.trim() || "—",
      phone: editForm.phone.trim() || "—",
      dob: editForm.dob || "—",
      option: streamRequired ? editForm.option : "",
      electives: streamRequired ? editForm.electives.join(",") : "",
      admittedOn: editForm.admittedOn || "",
    };
    // Only send the photo when it actually changed (a new upload, or cleared).
    // The roster shows it as "/api/students/{id}/photo"; writing that alias
    // back would overwrite the real stored photo.
    if (!editForm.photo || editForm.photo.startsWith("data:")) {
      payload.photo = editForm.photo || "";
    }

    try {
      const updated = await updateStudent(editingStudent.id, payload);
      setRoster((list) =>
        updated.class === rosterClass
          ? list.map((s) => (s.id === updated.id ? updated : s))
          : list.filter((s) => s.id !== updated.id),
      );
      refreshClasses();
      closeEdit();
    } catch (err) {
      setEditError(err.message || "Could not save changes");
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDeleteStudent(student) {
    if (
      !window.confirm(
        `Remove ${student.name} (${student.code || student.id})? Their marks will also be deleted.`,
      )
    ) {
      return;
    }
    setRosterError("");
    try {
      await deleteStudent(student.id);
      setRoster((list) => list.filter((x) => x.id !== student.id));
      refreshClasses();
      logActivity("Student", `Student removed — ${student.name}`).catch(
        () => {},
      );
    } catch (err) {
      setRosterError(err.message || "Could not remove student");
    }
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

  // Derived values for the edit form
  const editStreamRequired = editForm ? requiresStream(editForm.class) : false;
  const editSixthForm = editForm ? isSixthForm(editForm.class) : false;
  const editSixthPool =
    editForm && editSixthForm ? getSixthFormElectivePool(editForm.option) : [];
  const editCoreSubjects =
    editForm && editStreamRequired && !editSixthForm
      ? getCoreSubjects(editForm.class, editForm.option)
      : [];

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
                <Button
                  type="submit"
                  icon={Plus}
                  disabled={adding || !previewName}
                >
                  {adding ? "Adding…" : "Add Class"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {rosterClass && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="max-h-[80vh] w-full max-w-3xl overflow-y-auto">
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
              <p className="py-3 text-center text-sm text-rose-500">
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

            {!rosterLoading && roster.length > 0 && (
              <Table
                columns={[
                  "Student ID",
                  "Name",
                  "Gender",
                  "Guardian",
                  "Phone",
                  "",
                ]}
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
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          aria-label={`Edit ${s.name}`}
                          title="Edit"
                          onClick={() => openEdit(s)}
                          className="rounded-md p-1.5 text-slate-400 hover:bg-[#0ea5e9]/10 hover:text-[#0ea5e9]"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove ${s.name}`}
                          title="Delete"
                          onClick={() => handleDeleteStudent(s)}
                          className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-500"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>
      )}

      {/* Edit student pop-up — sits on top of the roster */}
      {editingStudent && editForm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <Card className="max-h-[90vh] w-full max-w-lg overflow-y-auto">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold tracking-tight text-[#1e3a8a]">
                  Edit Student
                </h3>
                <p className="mt-0.5 text-sm text-slate-500">
                  {editingStudent.code || editingStudent.id}
                </p>
              </div>
              <button
                type="button"
                onClick={closeEdit}
                className="rounded-md p-1.5 text-slate-400 hover:bg-[#f1f5f9] hover:text-[#1e3a8a]"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="flex flex-col gap-4">
              <div>
                <Label>Photo</Label>
                <div className="flex items-center gap-4">
                  <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#e2e8f0] bg-[#f8fafc]">
                    <AuthImage
                      src={editForm.photo}
                      alt="Student preview"
                      className="h-full w-full object-cover"
                      fallback={<User size={28} className="text-slate-300" />}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      icon={Camera}
                      onClick={() => photoInputRef.current?.click()}
                      disabled={photoLoading}
                    >
                      {photoLoading
                        ? "Processing…"
                        : editForm.photo
                          ? "Change photo"
                          : "Upload photo"}
                    </Button>
                    {editForm.photo && (
                      <button
                        type="button"
                        onClick={() => setField("photo", "")}
                        className="text-left text-xs font-medium text-slate-400 hover:text-rose-500"
                      >
                        Remove photo
                      </button>
                    )}
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handlePhotoSelected}
                    />
                  </div>
                </div>
                {photoError && (
                  <p className="mt-1.5 text-xs text-rose-500">{photoError}</p>
                )}
              </div>

              <div>
                <Label htmlFor="editStudentName">Full Name</Label>
                <Input
                  id="editStudentName"
                  required
                  value={editForm.name}
                  onChange={(e) => setField("name", e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="editStudentDob">Date of Birth</Label>
                  <Input
                    id="editStudentDob"
                    type="date"
                    value={editForm.dob}
                    onChange={(e) => setField("dob", e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="editStudentGender">Gender</Label>
                  <Select
                    id="editStudentGender"
                    value={editForm.gender}
                    onChange={(e) => setField("gender", e.target.value)}
                  >
                    <option>Male</option>
                    <option>Female</option>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="editStudentClass">Class</Label>
                  <Select
                    id="editStudentClass"
                    value={editForm.class}
                    onChange={(e) => {
                      setField("class", e.target.value);
                      setField("option", "");
                      setField("electives", []);
                    }}
                  >
                    {sortedClasses.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="editStudentAdmitted">Admission Date</Label>
                  <Input
                    id="editStudentAdmitted"
                    type="date"
                    value={editForm.admittedOn}
                    onChange={(e) => setField("admittedOn", e.target.value)}
                  />
                </div>
              </div>

              {editStreamRequired && (
                <div>
                  <Label htmlFor="editStudentOption">
                    Option (Science / Arts)
                  </Label>
                  <Select
                    id="editStudentOption"
                    value={editForm.option}
                    onChange={(e) => {
                      setField("option", e.target.value);
                      setField("electives", []);
                    }}
                  >
                    <option value="">-- Select an option --</option>
                    <option value="Science">Science</option>
                    <option value="Arts">Arts</option>
                  </Select>
                </div>
              )}

              {editStreamRequired && !editSixthForm && editForm.option && (
                <>
                  <div className="rounded-lg border border-dashed border-[#e2e8f0] bg-[#f8fafc] p-3 text-xs text-slate-500">
                    <span className="font-semibold text-slate-600">
                      Compulsory subjects ({editForm.option}):
                    </span>{" "}
                    {editCoreSubjects.map((s) => s.name).join(", ")}
                  </div>
                  <div>
                    <Label>Optional Subjects (choose any extra)</Label>
                    <div className="flex flex-col gap-1.5 rounded-lg border border-[#e2e8f0] p-3">
                      {ELECTIVE_SUBJECTS.map((subject) => (
                        <label
                          key={subject.name}
                          className="flex items-center gap-2 text-sm text-slate-600"
                        >
                          <input
                            type="checkbox"
                            checked={editForm.electives.includes(subject.name)}
                            onChange={() => toggleElective(subject.name)}
                          />
                          {subject.name}
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {editSixthForm && editForm.option && (
                <>
                  <div className="rounded-lg border border-dashed border-[#e2e8f0] bg-[#f8fafc] p-3 text-xs text-slate-500">
                    <span className="font-semibold text-slate-600">
                      Compulsory subject ({editForm.option}):
                    </span>{" "}
                    {editForm.option === "Science" ? "Chemistry" : "History"}
                  </div>
                  <div>
                    <Label>
                      Choose Subjects ({editForm.electives.length + 1} selected)
                    </Label>
                    <div className="flex flex-col gap-1.5 rounded-lg border border-[#e2e8f0] p-3">
                      {editSixthPool.map((subject) => (
                        <label
                          key={subject.name}
                          className="flex items-center gap-2 text-sm text-slate-600"
                        >
                          <input
                            type="checkbox"
                            checked={editForm.electives.includes(subject.name)}
                            onChange={() => toggleElective(subject.name)}
                          />
                          {subject.name}
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="editStudentGuardian">Guardian Name</Label>
                  <Input
                    id="editStudentGuardian"
                    value={editForm.guardian}
                    onChange={(e) => setField("guardian", e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="editStudentPhone">Guardian Phone</Label>
                  <Input
                    id="editStudentPhone"
                    type="tel"
                    value={editForm.phone}
                    onChange={(e) => setField("phone", e.target.value)}
                  />
                </div>
              </div>

              {editError && (
                <p className="text-sm text-rose-500">{editError}</p>
              )}

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeEdit}
                  disabled={editSaving}
                >
                  Cancel
                </Button>
                <Button type="submit" icon={Save} disabled={editSaving}>
                  {editSaving ? "Saving…" : "Save Changes"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}
