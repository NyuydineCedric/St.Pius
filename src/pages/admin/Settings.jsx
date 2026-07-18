import { useEffect, useState } from "react";
import {
  Save,
  UserCog,
  School,
  CalendarRange,
  SlidersHorizontal,
  UserPlus,
  X,
  Plus,
  GraduationCap,
} from "lucide-react";
import {
  Card,
  CardHeader,
  PageHeading,
  Button,
  Label,
  Input,
  Select,
  Badge,
} from "../../components/ui";
import {
  getSettings,
  saveSettings,
  getTeachers,
  addTeacher,
  addTeacherAssignment,
  removeTeacherAssignment,
  deleteTeacher,
  getClasses,
  assignClassMaster,
} from "../../utils/api";
import { CLASS_NAMES, ALL_SUBJECTS } from "../../utils/subjects";

function Toggle({ checked, onChange, label }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-2">
      <span className="text-sm text-slate-600">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
          checked ? "bg-[#10b981]" : "bg-slate-300"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </label>
  );
}

function initials(name) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function Settings() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savedMsg, setSavedMsg] = useState("");

  const [schoolInfo, setSchoolInfo] = useState({
    schoolName: "",
    schoolCode: "",
    region: "",
    schoolTown: "",
    regionalDelegation: "",
    subDivision: "",
    motto: "",
  });

  const [structure, setStructure] = useState({
    currentTerm: "Term 2",
    currentSequence: "Sequence 4",
    academicYear: "",
    marksScale: "20",
  });
  const [emailNotif, setEmailNotif] = useState(true);
  const [autoLock, setAutoLock] = useState(false);
  const [publicResults, setPublicResults] = useState(false);

  const [teachers, setTeachers] = useState([]);
  const [teacherForm, setTeacherForm] = useState({
    name: "",
    email: "",
    phone: "",
  });
  const [savingTeacher, setSavingTeacher] = useState(false);
  const [assignDraft, setAssignDraft] = useState({}); // { [teacherId]: { class, subject } }

  const [classes, setClasses] = useState([]);

  useEffect(() => {
    Promise.all([getSettings(), getTeachers(), getClasses()])
      .then(([settings, teacherList, classList]) => {
        setSchoolInfo({
          schoolName: settings.schoolName,
          schoolCode: settings.schoolCode,
          region: settings.region,
          schoolTown: settings.schoolTown,
          regionalDelegation: settings.regionalDelegation,
          subDivision: settings.subDivision,
          motto: settings.motto,
        });

        setStructure({
          currentTerm: settings.currentTerm,
          currentSequence: settings.currentSequence,
          academicYear: settings.academicYear,
          marksScale: settings.marksScale,
        });
        setEmailNotif(settings.emailNotif);
        setAutoLock(settings.autoLock);
        setPublicResults(settings.publicResults);
        setTeachers(teacherList);
        setClasses(classList);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  function flashSaved(msg) {
    setSavedMsg(msg);
    setTimeout(() => setSavedMsg(""), 2000);
  }

  async function handleSaveSchoolInfo() {
    try {
      await saveSettings(schoolInfo);
      flashSaved("School information saved.");
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSaveStructure() {
    try {
      await saveSettings(structure);
      flashSaved("Academic structure saved.");
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleToggle(key, value, setter) {
    setter(value);
    try {
      await saveSettings({ [key]: value });
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleAddTeacher(e) {
    e.preventDefault();
    if (!teacherForm.name.trim()) return;
    setSavingTeacher(true);
    setError("");
    try {
      const teacher = await addTeacher({
        name: teacherForm.name.trim(),
        email: teacherForm.email.trim() || "—",
        phone: teacherForm.phone.trim() || "—",
      });
      setTeachers((prev) => [...prev, teacher]);
      setTeacherForm({ name: "", email: "", phone: "" });
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingTeacher(false);
    }
  }

  function updateDraft(teacherId, field, value) {
    setAssignDraft((prev) => ({
      ...prev,
      [teacherId]: { ...prev[teacherId], [field]: value },
    }));
  }

  async function handleAddAssignment(teacherId) {
    const draft = assignDraft[teacherId];
    if (!draft?.class || !draft?.subject) return;
    try {
      await addTeacherAssignment(teacherId, draft.class, draft.subject);
      setTeachers((prev) =>
        prev.map((t) =>
          t.id === teacherId
            ? {
                ...t,
                assignments: [
                  ...t.assignments.filter(
                    (a) =>
                      !(a.class === draft.class && a.subject === draft.subject),
                  ),
                  { class: draft.class, subject: draft.subject },
                ],
              }
            : t,
        ),
      );
      setAssignDraft((prev) => ({
        ...prev,
        [teacherId]: { class: "", subject: "" },
      }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRemoveAssignment(teacherId, className, subject) {
    try {
      await removeTeacherAssignment(teacherId, className, subject);
      setTeachers((prev) =>
        prev.map((t) =>
          t.id === teacherId
            ? {
                ...t,
                assignments: t.assignments.filter(
                  (a) => !(a.class === className && a.subject === subject),
                ),
              }
            : t,
        ),
      );
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteTeacher(teacherId) {
    try {
      await deleteTeacher(teacherId);
      setTeachers((prev) => prev.filter((t) => t.id !== teacherId));
      setClasses((prev) =>
        prev.map((c) =>
          c.classMasterId === teacherId
            ? { ...c, classMasterId: null, teacher: "Unassigned" }
            : c,
        ),
      );
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleAssignClassMaster(className, teacherId) {
    if (!teacherId) return;
    try {
      const updated = await assignClassMaster(className, teacherId);
      setClasses((prev) =>
        prev.map((c) => (c.name === className ? updated : c)),
      );
    } catch (err) {
      setError(err.message);
    }
  }

  const usersList = [
    { name: "Admin User", email: "admin@sch.edu", role: "Administrator" },
    ...teachers.map((t) => ({ name: t.name, email: t.email, role: "Teacher" })),
  ];

  return (
    <>
      <PageHeading
        title="Settings"
        subtitle="Manage school information, academic structure, and system preferences."
        action={
          savedMsg && (
            <span className="text-sm font-medium text-[#10b981]">
              {savedMsg}
            </span>
          )
        }
      />

      {error && <p className="mb-4 text-sm text-rose-500">{error}</p>}
      {loading && (
        <p className="mb-4 text-sm text-slate-400">Loading settings…</p>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* School info */}
        <Card>
          <CardHeader
            title="School Information"
            subtitle="Shown on report cards and headers"
            action={<School size={18} className="text-slate-300" />}
          />
          <div className="flex flex-col gap-4">
            <div>
              <Label htmlFor="schoolName">School Name</Label>
              <Input
                id="schoolName"
                value={schoolInfo.schoolName}
                onChange={(e) =>
                  setSchoolInfo((s) => ({ ...s, schoolName: e.target.value }))
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="code">School Code</Label>
                <Input
                  id="code"
                  value={schoolInfo.schoolCode}
                  onChange={(e) =>
                    setSchoolInfo((s) => ({ ...s, schoolCode: e.target.value }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="region">Region</Label>
                <Input
                  id="region"
                  value={schoolInfo.region}
                  onChange={(e) =>
                    setSchoolInfo((s) => ({ ...s, region: e.target.value }))
                  }
                />
              </div>
            </div>
            <div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="schoolTown">School Town</Label>
                  <Input
                    id="schoolTown"
                    placeholder="e.g. Bamenda"
                    value={schoolInfo.schoolTown}
                    onChange={(e) =>
                      setSchoolInfo((s) => ({
                        ...s,
                        schoolTown: e.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="regionalDelegation">
                    Regional Delegation
                  </Label>
                  <Input
                    id="regionalDelegation"
                    placeholder="e.g. Regional Delegation for North West"
                    value={schoolInfo.regionalDelegation}
                    onChange={(e) =>
                      setSchoolInfo((s) => ({
                        ...s,
                        regionalDelegation: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="subDivision">
                  Sub-Division / Sub-Inspectorate
                </Label>
                <Input
                  id="subDivision"
                  placeholder="e.g. Sub-Inspectorate for Bamenda"
                  value={schoolInfo.subDivision}
                  onChange={(e) =>
                    setSchoolInfo((s) => ({
                      ...s,
                      subDivision: e.target.value,
                    }))
                  }
                />
              </div>

              <Label htmlFor="motto">Motto</Label>
              <Input
                id="motto"
                placeholder="e.g. Faith, Discipline, Excellence"
                value={schoolInfo.motto}
                onChange={(e) =>
                  setSchoolInfo((s) => ({ ...s, motto: e.target.value }))
                }
              />
            </div>
            <Button
              icon={Save}
              className="mt-1 self-start"
              onClick={handleSaveSchoolInfo}
            >
              Save Changes
            </Button>
          </div>
        </Card>

        {/* Academic structure */}
        <Card>
          <CardHeader
            title="Academic Structure"
            subtitle="Current term and sequence configuration"
            action={<CalendarRange size={18} className="text-slate-300" />}
          />
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="term">Current Term</Label>
                <Select
                  id="term"
                  value={structure.currentTerm}
                  onChange={(e) =>
                    setStructure((s) => ({ ...s, currentTerm: e.target.value }))
                  }
                >
                  <option>Term 1</option>
                  <option>Term 2</option>
                  <option>Term 3</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="seq">Current Sequence</Label>
                <Select
                  id="seq"
                  value={structure.currentSequence}
                  onChange={(e) =>
                    setStructure((s) => ({
                      ...s,
                      currentSequence: e.target.value,
                    }))
                  }
                >
                  {Array.from({ length: 6 }, (_, i) => (
                    <option key={i}>{`Sequence ${i + 1}`}</option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="year">Academic Year</Label>
                <Input
                  id="year"
                  value={structure.academicYear}
                  onChange={(e) =>
                    setStructure((s) => ({
                      ...s,
                      academicYear: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="marksOutOf">Marks Scale</Label>
                <Select
                  id="marksOutOf"
                  value={structure.marksScale}
                  onChange={(e) =>
                    setStructure((s) => ({ ...s, marksScale: e.target.value }))
                  }
                >
                  <option>20</option>
                  <option>100</option>
                </Select>
              </div>
            </div>
            <Button
              icon={Save}
              className="mt-1 self-start"
              onClick={handleSaveStructure}
            >
              Save Structure
            </Button>
          </div>
        </Card>

        {/* Preferences */}
        <Card>
          <CardHeader
            title="System Preferences"
            subtitle="Notifications and access behavior"
            action={<SlidersHorizontal size={18} className="text-slate-300" />}
          />
          <div className="divide-y divide-dashed divide-[#e2e8f0]">
            <Toggle
              checked={emailNotif}
              onChange={(v) => handleToggle("emailNotif", v, setEmailNotif)}
              label="Email me when report cards are generated"
            />
            <Toggle
              checked={autoLock}
              onChange={(v) => handleToggle("autoLock", v, setAutoLock)}
              label="Auto-lock marks entry after sequence closes"
            />
            <Toggle
              checked={publicResults}
              onChange={(v) =>
                handleToggle("publicResults", v, setPublicResults)
              }
              label="Allow guardians to view results online"
            />
          </div>
        </Card>

        {/* Users & Roles */}
        <Card>
          <CardHeader
            title="Users & Roles"
            subtitle="People with access to this system"
            action={<UserCog size={18} className="text-slate-300" />}
          />
          <div className="flex flex-col gap-2">
            {usersList.map((u) => (
              <div
                key={u.email + u.name}
                className="flex items-center justify-between rounded-lg border border-[#e2e8f0] px-4 py-3 transition-colors hover:bg-[#f1f5f9]/60"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1e3a8a] font-mono text-xs font-semibold text-[#0ea5e9]">
                    {initials(u.name)}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-[#1e3a8a]">
                      {u.name}
                    </div>
                    <div className="text-xs text-slate-400">{u.email}</div>
                  </div>
                </div>
                <Badge tone={u.role === "Administrator" ? "navy" : "sky"}>
                  {u.role}
                </Badge>
              </div>
            ))}
            {usersList.length === 1 && (
              <p className="py-4 text-center text-xs text-slate-400">
                Add teachers below to see them listed here.
              </p>
            )}
          </div>
        </Card>
      </div>

      {/* Staff Management */}
      <Card className="mt-6">
        <CardHeader
          title="Staff Management"
          subtitle="Add teachers and assign them to classes and subjects."
          action={<UserPlus size={18} className="text-slate-300" />}
        />

        <form
          onSubmit={handleAddTeacher}
          className="mb-5 grid grid-cols-1 gap-3 rounded-xl border border-dashed border-[#e2e8f0] p-4 sm:grid-cols-4"
        >
          <div>
            <Label htmlFor="teacherName">Full Name</Label>
            <Input
              id="teacherName"
              required
              placeholder="e.g. Mrs. Ekema Grace"
              value={teacherForm.name}
              onChange={(e) =>
                setTeacherForm((f) => ({ ...f, name: e.target.value }))
              }
            />
          </div>
          <div>
            <Label htmlFor="teacherEmail">Email</Label>
            <Input
              id="teacherEmail"
              type="email"
              placeholder="ekema.g@sch.edu"
              value={teacherForm.email}
              onChange={(e) =>
                setTeacherForm((f) => ({ ...f, email: e.target.value }))
              }
            />
          </div>
          <div>
            <Label htmlFor="teacherPhone">Phone</Label>
            <Input
              id="teacherPhone"
              type="tel"
              placeholder="+237 6•• ••• •••"
              value={teacherForm.phone}
              onChange={(e) =>
                setTeacherForm((f) => ({ ...f, phone: e.target.value }))
              }
            />
          </div>
          <div className="flex items-end">
            <Button
              type="submit"
              icon={UserPlus}
              className="w-full"
              disabled={savingTeacher}
            >
              {savingTeacher ? "Adding…" : "Add Teacher"}
            </Button>
          </div>
        </form>

        {teachers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#e2e8f0] py-10 text-center text-sm text-slate-400">
            No teachers added yet.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {teachers.map((t) => {
              const draft = assignDraft[t.id] || { class: "", subject: "" };
              return (
                <div
                  key={t.id}
                  className="rounded-xl border border-[#e2e8f0] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1e3a8a] font-mono text-xs font-semibold text-[#0ea5e9]">
                        {initials(t.name)}
                      </div>
                      <div>
                        <div className="font-medium text-[#1e3a8a]">
                          {t.name}
                        </div>
                        <div className="text-xs text-slate-400">
                          {t.id} · {t.email} · {t.phone}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteTeacher(t.id)}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-500"
                      aria-label="Remove teacher"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {t.assignments.length === 0 ? (
                      <span className="text-xs text-slate-400">
                        No classes/subjects assigned yet.
                      </span>
                    ) : (
                      t.assignments.map((a) => (
                        <span
                          key={`${a.class}-${a.subject}`}
                          className="flex items-center gap-1.5 rounded-full bg-[#0ea5e9]/10 px-3 py-1 text-xs font-medium text-[#0b61a6]"
                        >
                          {a.subject} · {a.class}
                          <button
                            onClick={() =>
                              handleRemoveAssignment(t.id, a.class, a.subject)
                            }
                            className="text-[#0b61a6]/60 hover:text-rose-500"
                            aria-label="Remove assignment"
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))
                    )}
                  </div>

                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Select
                      value={draft.class}
                      onChange={(e) =>
                        updateDraft(t.id, "class", e.target.value)
                      }
                      className="sm:max-w-[160px]"
                    >
                      <option value="">Class…</option>
                      {CLASS_NAMES.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </Select>
                    <Select
                      value={draft.subject}
                      onChange={(e) =>
                        updateDraft(t.id, "subject", e.target.value)
                      }
                      className="sm:max-w-[200px]"
                    >
                      <option value="">Subject…</option>
                      {ALL_SUBJECTS.map((s) => (
                        <option key={s.name}>{s.name}</option>
                      ))}
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      icon={Plus}
                      onClick={() => handleAddAssignment(t.id)}
                      disabled={!draft.class || !draft.subject}
                    >
                      Assign
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Class Masters */}
      <Card className="mt-6">
        <CardHeader
          title="Class Masters"
          subtitle="Assign a Class Master to each class — shown on that class's report cards."
          action={<GraduationCap size={18} className="text-slate-300" />}
        />
        {classes.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">
            No classes found yet.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {classes.map((c) => (
              <div
                key={c.name}
                className="flex flex-col gap-2 rounded-lg border border-[#e2e8f0] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="text-sm font-medium text-[#1e3a8a]">
                    {c.name}
                  </div>
                  <div className="text-xs text-slate-400">
                    Current: {c.teacher || "Unassigned"}
                  </div>
                </div>
                <Select
                  value={c.classMasterId || ""}
                  onChange={(e) =>
                    handleAssignClassMaster(c.name, e.target.value)
                  }
                  className="sm:max-w-[220px]"
                >
                  <option value="">-- Select a teacher --</option>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
