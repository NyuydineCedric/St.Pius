import AuthImage from "../../components/AuthImage";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  UserPlus,
  Search,
  Pencil,
  Trash2,
  GraduationCap,
  Upload,
  Download,
  X,
  CheckCircle2,
  AlertCircle,
  Camera,
  User,
} from "lucide-react";
import {
  Card,
  CardHeader,
  PageHeading,
  Button,
  Label,
  Input,
  Select,
  Table,
  Badge,
  focusRing,
} from "../../components/ui";
import {
  addStudent,
  updateStudent,
  deleteStudent,
  getClasses,
  getStudents,
  logActivity,
} from "../../utils/api";
import {
  CLASS_LEVELS,
  compareClassNames,
  requiresStream,
  isSixthForm,
  getCoreSubjects,
  getSixthFormElectivePool,
  ELECTIVE_SUBJECTS,
  SIXTH_FORM_MAX_SUBJECTS,
} from "../../utils/subjects";
import { parseStudentsExcel, downloadTemplate } from "../../utils/excelImport";
import { fileToCompressedDataUrl } from "../../utils/image";

export default function StudentEntry() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [students, setStudents] = useState([]);
  const [classes, setClasses] = useState([]);
  const [search, setSearch] = useState(searchParams.get("q") || "");
  const [form, setForm] = useState({
    name: "",
    dob: "",
    gender: "Male",
    class: "",
    guardian: "",
    phone: "",
    option: "",
    electives: [],
    photo: "",
    admittedOn: "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [photoError, setPhotoError] = useState("");
  const [photoLoading, setPhotoLoading] = useState(false);
  const photoInputRef = useRef(null);
  const formCardRef = useRef(null);

  // Bulk import state
  const fileInputRef = useRef(null);
  const [importRows, setImportRows] = useState(null); // null = no import in progress
  const [importError, setImportError] = useState("");
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);

  useEffect(() => {
    const q = searchParams.get("q") || "";
    setSearch(q);
  }, [searchParams]);

  useEffect(() => {
    // Photos are needed here: this screen both previews them and loads the
    // edit form from these records, so without them saving a student would
    // overwrite their stored photo with an empty one.
    getStudents({ includePhotos: true })
      .then(setStudents)
      .catch((err) => setError(err.message));
    getClasses()
      .then((data) => {
        const names = data
          .map((c) => c.name)
          .sort(compareClassNames);
        // Prefer configured classes; fall back to bare levels only if none yet.
        const list = names.length > 0 ? names : [...CLASS_LEVELS];
        setClasses(list);
        setForm((f) => ({
          ...f,
          class: f.class && list.includes(f.class) ? f.class : list[0] || "",
        }));
      })
      .catch((err) => setError(err.message));
  }, []);

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) =>
      `${s.name} ${s.code || s.id} ${s.class} ${s.guardian || ""} ${s.phone || ""}`
        .toLowerCase()
        .includes(q),
    );
  }, [students, search]);

  function onSearchChange(value) {
    setSearch(value);
    if (value.trim()) setSearchParams({ q: value });
    else setSearchParams({});
  }

  const streamRequired = requiresStream(form.class);
  const sixthForm = isSixthForm(form.class);

  // Sixth form: pick freely from the stream's pool, capped so that
  // anchor (1) + chosen extras never exceed SIXTH_FORM_MAX_SUBJECTS.
  const sixthFormPool = sixthForm ? getSixthFormElectivePool(form.option) : [];
  const sixthFormMaxExtra = SIXTH_FORM_MAX_SUBJECTS - 1; // slot reserved for the anchor
  const sixthFormAtLimit = form.electives.length >= sixthFormMaxExtra;

  // Form 4/5: fixed core subjects + optional bonus electives, uncapped.
  const coreSubjects =
    streamRequired && !sixthForm
      ? getCoreSubjects(form.class, form.option)
      : [];

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function toggleElective(name) {
    setForm((f) => {
      const has = f.electives.includes(name);
      if (has) {
        return { ...f, electives: f.electives.filter((e) => e !== name) };
      }
      if (sixthForm && f.electives.length >= sixthFormMaxExtra) {
        return f; // at the cap, ignore further additions
      }
      return { ...f, electives: [...f.electives, name] };
    });
  }

  function resetForm(classList = classes) {
    setEditingId(null);
    setPhotoError("");
    setForm({
      name: "",
      dob: "",
      gender: "Male",
      class: classList[0] || "Form 1",
      guardian: "",
      phone: "",
      option: "",
      electives: [],
      photo: "",
      admittedOn: "",
    });
  }

  function startEdit(student) {
    setEditingId(student.id);
    setError("");
    setPhotoError("");
    setForm({
      name: student.name || "",
      dob: student.dob && student.dob !== "—" ? student.dob : "",
      gender: student.gender || "Male",
      class: student.class || classes[0] || "Form 1",
      guardian: student.guardian && student.guardian !== "—" ? student.guardian : "",
      phone: student.phone && student.phone !== "—" ? student.phone : "",
      option: student.option || "",
      electives: student.electives
        ? student.electives.split(",").map((s) => s.trim()).filter(Boolean)
        : [],
      photo: student.photo || "",
      admittedOn:
        student.admittedOn && student.admittedOn !== "—" ? student.admittedOn : "",
    });
    // The page's only scroll container is <main> in Layout.jsx, not the
    // window — window.scrollTo is a no-op there. scrollIntoView finds
    // whichever ancestor actually scrolls, so this reliably brings the
    // form into view even when editing a student far down the list.
    formCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function triggerPhotoPicker() {
    photoInputRef.current?.click();
  }

  async function handlePhotoSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;

    setPhotoError("");
    setPhotoLoading(true);
    try {
      const dataUrl = await fileToCompressedDataUrl(file);
      update("photo", dataUrl);
    } catch (err) {
      setPhotoError(err.message || "Could not process that image.");
    } finally {
      setPhotoLoading(false);
    }
  }

  function removePhoto() {
    update("photo", "");
    setPhotoError("");
  }

  async function handleDelete(student) {
    if (
      !window.confirm(
        `Remove ${student.name} (${student.code || student.id})? Their marks will also be deleted.`,
      )
    ) {
      return;
    }
    setError("");
    try {
      await deleteStudent(student.id);
      setStudents((list) => list.filter((x) => x.id !== student.id));
      if (editingId === student.id) resetForm();
      await logActivity("Student", `Student removed — ${student.name}`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (streamRequired && !form.option) {
      setError("Please select Science or Arts for this class.");
      return;
    }
    if (sixthForm && form.option && form.electives.length === 0) {
      setError(
        "Please select at least one additional subject alongside the compulsory one.",
      );
      return;
    }
    setSaving(true);
    setError("");
    const payload = {
      name: form.name.trim(),
      class: form.class || classes[0] || "Form 1",
      gender: form.gender,
      guardian: form.guardian.trim() || "—",
      phone: form.phone.trim() || "—",
      dob: form.dob || "—",
      option: streamRequired ? form.option : "",
      electives: streamRequired ? form.electives.join(",") : "",
      photo: form.photo || "",
      admittedOn: form.admittedOn || "",
    };
    try {
      if (editingId) {
        const student = await updateStudent(editingId, payload);
        setStudents((prev) =>
          prev.map((s) => (s.id === editingId ? student : s)),
        );
        resetForm();
      } else {
        const student = await addStudent(payload);
        setStudents((prev) => [...prev, student]);
        resetForm();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function triggerFilePicker() {
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;

    setImportError("");
    setImportProgress(0);
    try {
      const rows = await parseStudentsExcel(file, classes);
      if (rows.length === 0) {
        setImportError("No rows found in that file.");
        return;
      }
      setImportRows(rows);
    } catch (err) {
      setImportError(
        "Could not read that file. Make sure it's a valid .xlsx or .csv file.",
      );
    }
  }

  function closeImportPreview() {
    setImportRows(null);
    setImportError("");
    setImportProgress(0);
  }

  async function handleConfirmImport() {
    if (!importRows) return;
    const validRows = importRows.filter((r) => r.valid);
    if (validRows.length === 0) return;

    setImporting(true);
    setImportProgress(0);
    const added = [];
    const failed = [];

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      try {
        const student = await addStudent({
          name: row.name,
          class: row.class,
          gender: row.gender,
          guardian: row.guardian,
          phone: row.phone,
          dob: row.dob,
          option: requiresStream(row.class) ? row.option : "",
          electives: requiresStream(row.class) ? row.electives : "",
        });
        added.push(student);
      } catch (err) {
        failed.push({ ...row, error: err.message });
      }
      setImportProgress(i + 1);
    }

    if (added.length > 0) {
      setStudents((prev) => [...prev, ...added]);
      logActivity(
        "Student",
        `Bulk imported ${added.length} student${added.length === 1 ? "" : "s"} via Excel`,
      ).catch(() => {});
    }

    setImporting(false);
    if (failed.length > 0) {
      setImportRows(
        failed.map((f, i) => ({ ...f, rowNumber: f.rowNumber, valid: false })),
      );
      setImportError(
        `${added.length} student${added.length === 1 ? "" : "s"} imported. ${failed.length} failed — see details below.`,
      );
    } else {
      closeImportPreview();
    }
  }

  const validCount = importRows ? importRows.filter((r) => r.valid).length : 0;
  const invalidCount = importRows ? importRows.length - validCount : 0;

  return (
    <>
      <PageHeading
        title="Student Entry"
        subtitle="Register new students and manage existing student records."
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              icon={Download}
              onClick={downloadTemplate}
            >
              Download Template
            </Button>
            <Button icon={Upload} onClick={triggerFilePicker}>
              Import from Excel
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleFileSelected}
            />
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[380px_1fr]">
        {/* New student form */}
        <div ref={formCardRef}>
        <Card>
          <CardHeader
            title={editingId ? "Edit Student" : "Add New Student"}
            subtitle={
              editingId
                ? `Updating ${editingId}. Save to apply changes.`
                : "Fill in the details below to enroll a student."
            }
          />
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <Label>Photo</Label>
              <div className="flex items-center gap-4">
                <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#e2e8f0] bg-[#f8fafc]">
                  <AuthImage
                    src={form.photo}
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
                    onClick={triggerPhotoPicker}
                    disabled={photoLoading}
                  >
                    {photoLoading
                      ? "Processing…"
                      : form.photo
                        ? "Change photo"
                        : "Upload photo"}
                  </Button>
                  {form.photo && (
                    <button
                      type="button"
                      onClick={removePhoto}
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
              <Label htmlFor="name">Full Name</Label>
              <Input
                id="name"
                required
                placeholder="e.g. Ama Nkeng"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="dob">Date of Birth</Label>
                <Input
                  id="dob"
                  type="date"
                  value={form.dob}
                  onChange={(e) => update("dob", e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="gender">Gender</Label>
                <Select
                  id="gender"
                  value={form.gender}
                  onChange={(e) => update("gender", e.target.value)}
                >
                  <option>Male</option>
                  <option>Female</option>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="class">Class</Label>
              <Select
                id="class"
                value={form.class}
                onChange={(e) => {
                  update("class", e.target.value);
                  update("option", "");
                  update("electives", []);
                }}
              >
                {classes.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="admittedOn">Admission Date</Label>
              <Input
                id="admittedOn"
                type="date"
                value={form.admittedOn}
                onChange={(e) => update("admittedOn", e.target.value)}
              />
            </div>

            {streamRequired && (
              <div>
                <Label htmlFor="option">Option (Science / Arts)</Label>
                <Select
                  id="option"
                  value={form.option}
                  onChange={(e) => {
                    update("option", e.target.value);
                    update("electives", []);
                  }}
                >
                  <option value="">-- Select an option --</option>
                  <option value="Science">Science</option>
                  <option value="Arts">Arts</option>
                </Select>
              </div>
            )}

            {/* Form 4 / Form 5: fixed core, plus optional bonus subjects */}
            {streamRequired && !sixthForm && form.option && (
              <>
                <div className="rounded-lg border border-dashed border-[#e2e8f0] bg-[#f8fafc] p-3 text-xs text-slate-500">
                  <span className="font-semibold text-slate-600">
                    Compulsory subjects ({form.option}):
                  </span>{" "}
                  {coreSubjects.map((s) => s.name).join(", ")}
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
                          checked={form.electives.includes(subject.name)}
                          onChange={() => toggleElective(subject.name)}
                        />
                        {subject.name}
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Lower / Upper Sixth: one compulsory anchor + free choice, capped at 5 total */}
            {sixthForm && form.option && (
              <>
                <div className="rounded-lg border border-dashed border-[#e2e8f0] bg-[#f8fafc] p-3 text-xs text-slate-500">
                  <span className="font-semibold text-slate-600">
                    Compulsory subject ({form.option}):
                  </span>{" "}
                  {form.option === "Science" ? "Chemistry" : "History"}
                </div>

                <div>
                  <Label>
                    Choose Subjects ({form.electives.length + 1} /{" "}
                    {SIXTH_FORM_MAX_SUBJECTS})
                  </Label>
                  <div className="flex flex-col gap-1.5 rounded-lg border border-[#e2e8f0] p-3">
                    {sixthFormPool.map((subject) => {
                      const checked = form.electives.includes(subject.name);
                      const disabled = !checked && sixthFormAtLimit;
                      return (
                        <label
                          key={subject.name}
                          className={`flex items-center gap-2 text-sm ${
                            disabled ? "text-slate-300" : "text-slate-600"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={disabled}
                            onChange={() => toggleElective(subject.name)}
                          />
                          {subject.name}
                        </label>
                      );
                    })}
                  </div>
                  {sixthFormAtLimit && (
                    <p className="mt-1 text-xs text-amber-600">
                      Maximum of {SIXTH_FORM_MAX_SUBJECTS} subjects reached.
                    </p>
                  )}
                </div>
              </>
            )}

            <div>
              <Label htmlFor="guardian">Guardian Name</Label>
              <Input
                id="guardian"
                placeholder="e.g. Mr. Nkeng Paul"
                value={form.guardian}
                onChange={(e) => update("guardian", e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="phone">Guardian Phone</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="+237 6•• ••• •••"
                value={form.phone}
                onChange={(e) => update("phone", e.target.value)}
              />
            </div>

            <div className="mt-2 flex flex-col gap-2">
              <Button
                type="submit"
                icon={UserPlus}
                className="w-full"
                disabled={saving}
              >
                {saving
                  ? "Saving…"
                  : editingId
                    ? "Update Student"
                    : "Save Student"}
              </Button>
              {editingId && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => resetForm()}
                >
                  Cancel edit
                </Button>
              )}
            </div>
            {error && <p className="text-sm text-rose-500">{error}</p>}
          </form>
        </Card>
        </div>

        {/* Student list */}
        <Card>
          <CardHeader
            title={`All Students (${filteredStudents.length}${
              search.trim() ? ` of ${students.length}` : ""
            })`}
            subtitle="Search, edit, or remove student records."
            action={
              <div className="relative">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={search}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder="Search name, ID, class…"
                  className={`w-52 rounded-full border border-[#e2e8f0] bg-[#f1f5f9] py-1.5 pl-8 pr-3 text-sm text-slate-600 placeholder:text-slate-400 focus:border-[#0ea5e9] focus:bg-white focus:outline-none ${focusRing}`}
                />
              </div>
            }
          />

          {students.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center text-slate-400">
              <GraduationCap size={28} className="mb-2" />
              No students yet — add your first one.
            </div>
          ) : filteredStudents.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center text-slate-400">
              No students match “{search.trim()}”.
            </div>
          ) : (
            <Table
              columns={[
                "Student ID",
                "Name",
                "Class",
                "Option",
                "Gender",
                "Guardian",
                "Phone",
                "Status",
                "",
              ]}
            >
              {filteredStudents.map((s) => (
                <tr
                  key={s.code || s.id}
                  className="transition-colors hover:bg-[#f1f5f9]/60"
                >
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">
                    {s.code || s.id}
                  </td>
                  <td className="px-4 py-3 font-medium text-[#1e3a8a]">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#e2e8f0] bg-[#f1f5f9]">
                        <AuthImage
                          src={s.photo}
                          alt=""
                          className="h-full w-full object-cover"
                          fallback={<User size={14} className="text-slate-300" />}
                        />
                      </div>
                      {s.name}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{s.class}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {s.option || "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{s.gender}</td>
                  <td className="px-4 py-3 text-slate-600">{s.guardian}</td>
                  <td className="px-4 py-3 text-slate-600">{s.phone || "—"}</td>
                  <td className="px-4 py-3">
                    <Badge tone="emerald">{s.status}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-label="Edit student"
                        onClick={() => startEdit(s)}
                        className={`rounded-md p-1.5 text-slate-400 hover:bg-[#0ea5e9]/10 hover:text-[#0ea5e9] ${focusRing}`}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label="Remove student"
                        onClick={() => handleDelete(s)}
                        className={`rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-500 ${focusRing}`}
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

      {/* Bulk import preview modal */}
      {importRows && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden p-0">
            <div className="flex items-start justify-between gap-4 border-b border-[#e2e8f0] p-5">
              <div>
                <h3 className="text-lg font-bold tracking-tight text-[#1e3a8a]">
                  Import Preview
                </h3>
                <p className="mt-0.5 text-sm text-slate-500">
                  {importRows.length} row{importRows.length === 1 ? "" : "s"}{" "}
                  found —{" "}
                  <span className="font-medium text-emerald-600">
                    {validCount} ready
                  </span>
                  {invalidCount > 0 && (
                    <>
                      {" "}
                      ·{" "}
                      <span className="font-medium text-rose-500">
                        {invalidCount} need fixing
                      </span>
                    </>
                  )}
                </p>
              </div>
              <button
                onClick={closeImportPreview}
                className="rounded-md p-1.5 text-slate-400 hover:bg-[#f1f5f9] hover:text-[#1e3a8a]"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {importError && (
              <p className="border-b border-[#e2e8f0] bg-amber-50 px-5 py-2.5 text-sm text-amber-700">
                {importError}
              </p>
            )}

            <div className="flex-1 overflow-auto p-5">
              <Table
                columns={[
                  "Row",
                  "",
                  "Full Name",
                  "Class",
                  "Option",
                  "Gender",
                  "Guardian",
                  "Phone",
                  "Issues",
                ]}
              >
                {importRows.map((row) => (
                  <tr
                    key={row.rowNumber}
                    className={row.valid ? "" : "bg-rose-50/60"}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {row.rowNumber}
                    </td>
                    <td className="px-4 py-3">
                      {row.valid ? (
                        <CheckCircle2 size={16} className="text-emerald-500" />
                      ) : (
                        <AlertCircle size={16} className="text-rose-500" />
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-[#1e3a8a]">
                      {row.name || "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {row.class || "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {row.option || "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{row.gender}</td>
                    <td className="px-4 py-3 text-slate-600">{row.guardian}</td>
                    <td className="px-4 py-3 text-slate-600">{row.phone}</td>
                    <td className="px-4 py-3 text-xs text-rose-500">
                      {row.errors && row.errors.length > 0
                        ? row.errors.join("; ")
                        : row.error || ""}
                    </td>
                  </tr>
                ))}
              </Table>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-[#e2e8f0] p-5">
              <p className="text-xs text-slate-400">
                Rows with issues will be skipped — fix your file and re-upload
                if you need them included.
              </p>
              <div className="flex flex-shrink-0 items-center gap-3">
                {importing && (
                  <span className="text-xs text-slate-400">
                    Importing {importProgress}/{validCount}…
                  </span>
                )}
                <Button variant="outline" onClick={closeImportPreview}>
                  Cancel
                </Button>
                <Button
                  icon={Upload}
                  onClick={handleConfirmImport}
                  disabled={validCount === 0 || importing}
                >
                  {importing
                    ? "Importing…"
                    : `Import ${validCount} Student${validCount === 1 ? "" : "s"}`}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
