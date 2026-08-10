import { useEffect, useMemo, useRef, useState } from "react";
import {
  Save,
  UserCog,
  School,
  CalendarRange,
  Stamp,
  Camera,
  PenTool,
  UserPlus,
  X,
  Plus,
  GraduationCap,
  Search,
  Download,
  Upload,
  Database,
  Cloud,
  CloudOff,
  KeyRound,
  RefreshCw,
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
  downloadBackup,
  restoreBackup,
  getHealth,
  getLicense,
  activateLicense,
  changePassword,
  getSyncStatus,
  syncNow,
} from "../../utils/api";
import { ALL_SUBJECTS, compareClassNames } from "../../utils/subjects";
import { catLabel } from "../../utils/grading";
import { fileToCompressedDataUrl } from "../../utils/image";
import {
  SCHOOL_NAME,
  SCHOOL_CODE,
  SCHOOL_REGION,
  SCHOOL_TOWN,
  SCHOOL_DIVISION,
  SCHOOL_MOTTO,
  SCHOOL_AGENCY,
} from "../../utils/schoolInfo";

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

  const [structure, setStructure] = useState({
    currentTerm: "Second Term",
    currentSequence: "Sequence 4",
    academicYear: "",
    marksScale: "20",
    passAverage: "50",
    nextTermBegins: "",
  });

  // Principal's stamp/signature — uploaded once here, printed on every
  // report card. Stored as compressed data URLs, same approach as student
  // photos.
  const [principalStamp, setPrincipalStamp] = useState("");
  const [principalSignature, setPrincipalSignature] = useState("");
  const [stampError, setStampError] = useState("");
  const [signatureError, setSignatureError] = useState("");
  const [stampLoading, setStampLoading] = useState(false);
  const [signatureLoading, setSignatureLoading] = useState(false);
  const stampInputRef = useRef(null);
  const signatureInputRef = useRef(null);

  const [teachers, setTeachers] = useState([]);
  const [teacherForm, setTeacherForm] = useState({
    name: "",
    email: "",
    phone: "",
  });
  const [savingTeacher, setSavingTeacher] = useState(false);
  const [assignDraft, setAssignDraft] = useState({}); // { [teacherId]: { class, subject } }

  const [classes, setClasses] = useState([]);
  const [teacherSearch, setTeacherSearch] = useState("");

  // Cloud sync status — whether this instance is reading/writing the
  // shared cloud database (so it receives marks teachers enter online) or
  // just its own local file.
  const [storageMode, setStorageMode] = useState(null); // "postgres" | "file" | null (unknown)

  useEffect(() => {
    getHealth()
      .then((h) => setStorageMode(h.storage || "file"))
      .catch(() => setStorageMode(null));
  }, []);

  // Password change
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState("");

  async function handleChangePassword() {
    setPwError("");
    if (pw.next !== pw.confirm) {
      setPwError("The two new passwords don't match.");
      return;
    }
    if (pw.next.length < 8) {
      setPwError("New password must be at least 8 characters.");
      return;
    }
    setPwBusy(true);
    try {
      await changePassword(pw.current, pw.next);
      setPw({ current: "", next: "", confirm: "" });
      flashSaved("Password changed.");
    } catch (err) {
      setPwError(err.message || "Could not change password");
    } finally {
      setPwBusy(false);
    }
  }

  // Desktop sync
  const [sync, setSync] = useState(null);
  const [syncBusy, setSyncBusy] = useState(false);

  useEffect(() => {
    getSyncStatus()
      .then(setSync)
      .catch(() => setSync(null));
  }, []);

  async function handleSyncNow() {
    setSyncBusy(true);
    try {
      setSync(await syncNow());
      flashSaved("Sync complete.");
    } catch (err) {
      // The endpoint returns the status even on failure, so show why.
      setSync((prev) => ({ ...(prev || {}), lastError: err.message }));
    } finally {
      setSyncBusy(false);
    }
  }

  // Licence
  const [license, setLicense] = useState(null);
  const [licenseKey, setLicenseKey] = useState("");
  const [licenseBusy, setLicenseBusy] = useState(false);
  const [licenseError, setLicenseError] = useState("");

  useEffect(() => {
    getLicense()
      .then(setLicense)
      .catch(() => setLicense(null));
  }, []);

  async function handleActivateLicense() {
    const key = licenseKey.trim();
    if (!key) return;
    setLicenseBusy(true);
    setLicenseError("");
    try {
      const updated = await activateLicense(key);
      setLicense(updated);
      setLicenseKey("");
      flashSaved("Licence activated.");
      // The read-only banner lives in the layout above this page, so reload
      // to clear it rather than leaving a stale warning on screen.
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      setLicenseError(err.message || "Could not activate that licence key");
    } finally {
      setLicenseBusy(false);
    }
  }

  // Data backup / restore
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMsg, setBackupMsg] = useState("");
  const [backupError, setBackupError] = useState("");
  const restoreInputRef = useRef(null);

  async function handleDownloadBackup() {
    setBackupBusy(true);
    setBackupError("");
    setBackupMsg("");
    try {
      await downloadBackup();
      setBackupMsg("Backup downloaded.");
    } catch (err) {
      setBackupError(err.message || "Could not download backup");
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleRestoreFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const confirmed = window.confirm(
      "This will replace ALL current data — students, classes, marks, and staff — with the contents of this backup file. This cannot be undone unless you have another backup. Continue?",
    );
    if (!confirmed) return;
    setBackupBusy(true);
    setBackupError("");
    setBackupMsg("");
    try {
      await restoreBackup(file);
      setBackupMsg("Data restored successfully. Reloading…");
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      setBackupError(err.message || "Could not restore backup");
      setBackupBusy(false);
    }
  }

  useEffect(() => {
    Promise.all([getSettings(), getTeachers(), getClasses()])
      .then(([settings, teacherList, classList]) => {
        setStructure({
          currentTerm: settings.currentTerm,
          currentSequence: settings.currentSequence,
          academicYear: settings.academicYear,
          marksScale: settings.marksScale,
          passAverage: settings.passAverage || "50",
          nextTermBegins: settings.nextTermBegins || "",
        });
        setPrincipalStamp(settings.principalStamp || "");
        setPrincipalSignature(settings.principalSignature || "");
        setTeachers(teacherList);
        setClasses(
          [...classList].sort((a, b) => compareClassNames(a.name, b.name)),
        );
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filteredTeachers = useMemo(() => {
    const q = teacherSearch.trim().toLowerCase();
    if (!q) return teachers;
    return teachers.filter((t) =>
      `${t.name} ${t.id} ${t.email} ${t.phone} ${t.assignments
        .map((a) => `${a.class} ${a.subject}`)
        .join(" ")}`
        .toLowerCase()
        .includes(q),
    );
  }, [teachers, teacherSearch]);

  function flashSaved(msg) {
    setSavedMsg(msg);
    setTimeout(() => setSavedMsg(""), 2000);
  }

  async function handleSaveStructure() {
    try {
      await saveSettings(structure);
      flashSaved("Academic structure saved.");
    } catch (err) {
      setError(err.message);
    }
  }

  function triggerStampPicker() {
    stampInputRef.current?.click();
  }

  function triggerSignaturePicker() {
    signatureInputRef.current?.click();
  }

  async function handleStampSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setStampError("");
    setStampLoading(true);
    try {
      const dataUrl = await fileToCompressedDataUrl(file, { maxDimension: 300 });
      setPrincipalStamp(dataUrl);
      await saveSettings({ principalStamp: dataUrl });
      flashSaved("Stamp saved.");
    } catch (err) {
      setStampError(err.message || "Could not save that image.");
    } finally {
      setStampLoading(false);
    }
  }

  async function handleSignatureSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setSignatureError("");
    setSignatureLoading(true);
    try {
      const dataUrl = await fileToCompressedDataUrl(file, { maxDimension: 300 });
      setPrincipalSignature(dataUrl);
      await saveSettings({ principalSignature: dataUrl });
      flashSaved("Signature saved.");
    } catch (err) {
      setSignatureError(err.message || "Could not save that image.");
    } finally {
      setSignatureLoading(false);
    }
  }

  async function removeStamp() {
    setPrincipalStamp("");
    setStampError("");
    try {
      await saveSettings({ principalStamp: "" });
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeSignature() {
    setPrincipalSignature("");
    setSignatureError("");
    try {
      await saveSettings({ principalSignature: "" });
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
        subtitle="Academic structure, staff, and the principal's stamp & signature."
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
        {/* School info — fixed, not editable from the UI. Only a developer
            changing src/utils/schoolInfo.js can update these. */}
        <Card>
          <CardHeader
            title="School Information"
            subtitle="Shown on report cards and headers — set by the developer, not editable here"
            action={<School size={18} className="text-slate-300" />}
          />
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-dashed border-[#e2e8f0] bg-[#f8fafc] p-4 text-sm">
            <div className="col-span-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Agency
              </p>
              <p className="font-medium text-[#1e3a8a]">{SCHOOL_AGENCY}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                School Name
              </p>
              <p className="font-medium text-[#1e3a8a]">{SCHOOL_NAME}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                School Code
              </p>
              <p className="font-medium text-[#1e3a8a]">{SCHOOL_CODE}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Region
              </p>
              <p className="font-medium text-[#1e3a8a]">{SCHOOL_REGION}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                School Town
              </p>
              <p className="font-medium text-[#1e3a8a]">{SCHOOL_TOWN}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Division
              </p>
              <p className="font-medium text-[#1e3a8a]">{SCHOOL_DIVISION}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Motto
              </p>
              <p className="font-medium text-[#1e3a8a]">{SCHOOL_MOTTO}</p>
            </div>
          </div>
        </Card>

        {/* Academic structure */}
        <Card>
          <CardHeader
            title="Academic Structure"
            subtitle="Current term and CAT configuration"
            action={<CalendarRange size={18} className="text-slate-300" />}
          />
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="term">Current Term</Label>
                <Select
                  id="term"
                  value={structure.currentTerm}
                  onChange={(e) =>
                    setStructure((s) => ({ ...s, currentTerm: e.target.value }))
                  }
                >
                  <option>First Term</option>
                  <option>Second Term</option>
                  <option>Third Term</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="seq">Current CAT</Label>
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
                    <option key={i} value={`Sequence ${i + 1}`}>
                      {catLabel(`Sequence ${i + 1}`)}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            <div>
              <Label htmlFor="passAverage">Pass Average (%)</Label>
              <Input
                id="passAverage"
                type="number"
                min="0"
                max="100"
                placeholder="e.g. 50"
                value={structure.passAverage}
                onChange={(e) =>
                  setStructure((s) => ({ ...s, passAverage: e.target.value }))
                }
              />
              <p className="mt-1 text-xs text-slate-400">
                The minimum percentage of the marks scale a student needs to
                pass a subject or the term — used on report cards school-wide.
              </p>
            </div>
            <div>
              <Label htmlFor="nextTermBegins">Next Term Begins</Label>
              <Input
                id="nextTermBegins"
                type="date"
                value={structure.nextTermBegins}
                onChange={(e) =>
                  setStructure((s) => ({
                    ...s,
                    nextTermBegins: e.target.value,
                  }))
                }
              />
              <p className="mt-1 text-xs text-slate-400">
                Printed on report cards as "Next Term: …" once the current
                term is closed.
              </p>
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

        {/* Principal's stamp & signature */}
        <Card>
          <CardHeader
            title="Principal's Stamp & Signature"
            subtitle="Printed on every report card's signature line"
            action={<Stamp size={18} className="text-slate-300" />}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label>Stamp</Label>
              <div className="flex items-center gap-3">
                <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#e2e8f0] bg-[#f8fafc]">
                  {principalStamp ? (
                    <img
                      src={principalStamp}
                      alt="Stamp preview"
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <Stamp size={22} className="text-slate-300" />
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    icon={Camera}
                    onClick={triggerStampPicker}
                    disabled={stampLoading}
                  >
                    {stampLoading
                      ? "Saving…"
                      : principalStamp
                        ? "Change"
                        : "Upload"}
                  </Button>
                  {principalStamp && (
                    <button
                      type="button"
                      onClick={removeStamp}
                      className="text-left text-xs font-medium text-slate-400 hover:text-rose-500"
                    >
                      Remove
                    </button>
                  )}
                  <input
                    ref={stampInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleStampSelected}
                  />
                </div>
              </div>
              {stampError && (
                <p className="mt-1.5 text-xs text-rose-500">{stampError}</p>
              )}
            </div>

            <div>
              <Label>Signature</Label>
              <div className="flex items-center gap-3">
                <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#e2e8f0] bg-[#f8fafc]">
                  {principalSignature ? (
                    <img
                      src={principalSignature}
                      alt="Signature preview"
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <PenTool size={22} className="text-slate-300" />
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    icon={Camera}
                    onClick={triggerSignaturePicker}
                    disabled={signatureLoading}
                  >
                    {signatureLoading
                      ? "Saving…"
                      : principalSignature
                        ? "Change"
                        : "Upload"}
                  </Button>
                  {principalSignature && (
                    <button
                      type="button"
                      onClick={removeSignature}
                      className="text-left text-xs font-medium text-slate-400 hover:text-rose-500"
                    >
                      Remove
                    </button>
                  )}
                  <input
                    ref={signatureInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleSignatureSelected}
                  />
                </div>
              </div>
              {signatureError && (
                <p className="mt-1.5 text-xs text-rose-500">
                  {signatureError}
                </p>
              )}
            </div>
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

      {/* Cloud Sync */}
      <Card className="mt-6">
        <CardHeader
          title="Cloud Sync"
          subtitle="Receive marks that teachers enter online, from anywhere"
          action={
            storageMode === "postgres" ? (
              <Cloud size={18} className="text-emerald-500" />
            ) : (
              <CloudOff size={18} className="text-slate-300" />
            )
          }
        />
        <div className="rounded-lg border border-[#e2e8f0] px-4 py-3">
          {storageMode === "postgres" && (
            <p className="text-sm font-medium text-[#10b981]">
              Cloud Sync is ON — this computer is connected to the shared
              online database. Marks teachers enter from home or their
              phones will show up here automatically whenever you're online.
            </p>
          )}
          {storageMode === "file" && (
            <>
              <p className="text-sm font-medium text-slate-500">
                Cloud Sync is OFF — this computer only stores data locally.
              </p>
              <p className="mt-2 text-xs text-slate-400">
                To let teachers submit marks online and have them appear
                here, deploy the online version (see your setup guide),
                then open the <code>cloud-config.json</code> file next to
                this app's data folder, paste in the database connection
                string, and restart the app.
              </p>
            </>
          )}
          {storageMode === null && (
            <p className="text-sm text-slate-400">Checking connection…</p>
          )}
        </div>
      </Card>

      {/* Sync — only meaningful on a desktop install that has a server */}
      {sync?.configured && (
        <Card className="mt-6">
          <CardHeader
            title="Sync"
            subtitle="Shares this computer's data with the school's online system"
            action={<RefreshCw size={18} className="text-slate-300" />}
          />
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <span>
                <span className="text-slate-400">Last synced: </span>
                <span className="font-medium text-[#1e3a8a]">
                  {sync.lastSyncedAt
                    ? new Date(sync.lastSyncedAt).toLocaleString()
                    : "never"}
                </span>
              </span>
              <span>
                <span className="text-slate-400">Waiting to send: </span>
                <span className="font-medium text-[#1e3a8a]">
                  {sync.pending} change{sync.pending === 1 ? "" : "s"}
                </span>
              </span>
            </div>
            <p className="text-xs text-slate-400">
              You can keep working with no internet — changes are saved here and
              sent up automatically the next time this computer is online.
            </p>
            {sync.lastError ? (
              <p className="text-sm font-medium text-amber-600">
                Last attempt didn't complete: {sync.lastError}
              </p>
            ) : null}
            <div>
              <Button
                icon={RefreshCw}
                onClick={handleSyncNow}
                disabled={syncBusy || sync.syncing}
              >
                {syncBusy || sync.syncing ? "Syncing…" : "Sync Now"}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Account security */}
      <Card className="mt-6">
        <CardHeader
          title="Your Password"
          subtitle="Change the password for the account you're signed in as"
          action={<UserCog size={18} className="text-slate-300" />}
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="pwCurrent">Current password</Label>
            <Input
              id="pwCurrent"
              type="password"
              autoComplete="current-password"
              value={pw.current}
              onChange={(e) => setPw({ ...pw, current: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="pwNew">New password</Label>
            <Input
              id="pwNew"
              type="password"
              autoComplete="new-password"
              value={pw.next}
              onChange={(e) => setPw({ ...pw, next: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="pwConfirm">Confirm new password</Label>
            <Input
              id="pwConfirm"
              type="password"
              autoComplete="new-password"
              value={pw.confirm}
              onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          At least 8 characters. Anyone who has used this account before will
          still be signed in on their own device until they log out.
        </p>
        {pwError && (
          <p className="mt-2 text-sm font-medium text-red-500">{pwError}</p>
        )}
        <div className="mt-4">
          <Button
            icon={Save}
            onClick={handleChangePassword}
            disabled={pwBusy || !pw.current || !pw.next}
          >
            {pwBusy ? "Saving…" : "Change Password"}
          </Button>
        </div>
      </Card>

      {/* Licence */}
      <Card className="mt-6">
        <CardHeader
          title="Licence"
          subtitle="Your subscription status and licence key"
          action={<KeyRound size={18} className="text-slate-300" />}
        />
        <div className="flex flex-col gap-4">
          {license && (
            <div
              className={`rounded-lg border px-4 py-3 ${
                license.readOnly
                  ? "border-amber-300 bg-amber-50"
                  : "border-emerald-200 bg-emerald-50"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{license.status}</Badge>
                {license.school && (
                  <span className="text-sm font-medium text-[#1e3a8a]">
                    {license.school}
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-slate-600">{license.message}</p>
              {!license.readOnly && license.expires && (
                <p className="mt-1 text-xs text-slate-500">
                  Expires {license.expires} — {license.daysRemaining} day
                  {license.daysRemaining === 1 ? "" : "s"} remaining.
                </p>
              )}
              {license.readOnly && (
                <p className="mt-2 text-xs text-amber-900">
                  Records can still be viewed, printed and backed up. Saving
                  changes is paused until a valid licence is entered.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="licenseKey">
              {license?.readOnly ? "Enter licence key" : "Replace licence key"}
            </Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="licenseKey"
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value)}
                placeholder="Paste the licence key supplied with your subscription"
                spellCheck={false}
                autoComplete="off"
              />
              <Button
                icon={KeyRound}
                onClick={handleActivateLicense}
                disabled={licenseBusy || !licenseKey.trim()}
              >
                {licenseBusy ? "Checking…" : "Activate"}
              </Button>
            </div>
            {licenseError && (
              <p className="text-sm font-medium text-red-500">{licenseError}</p>
            )}
          </div>
        </div>
      </Card>

      {/* Data Backup */}
      <Card className="mt-6">
        <CardHeader
          title="Data Backup"
          subtitle="Save a copy of all your data, or restore from a previous backup"
          action={<Database size={18} className="text-slate-300" />}
        />
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-[#e2e8f0] px-4 py-3">
            <div>
              <div className="text-sm font-medium text-[#1e3a8a]">
                Download a backup
              </div>
              <p className="text-xs text-slate-400">
                Saves every student, class, mark, and staff record to a file.
                Keep it somewhere safe — a USB drive, cloud folder, or email
                to yourself.
              </p>
            </div>
            <Button
              icon={Download}
              onClick={handleDownloadBackup}
              disabled={backupBusy}
            >
              {backupBusy ? "Working…" : "Download Backup"}
            </Button>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-[#e2e8f0] px-4 py-3">
            <div>
              <div className="text-sm font-medium text-[#1e3a8a]">
                Restore from a backup
              </div>
              <p className="text-xs text-slate-400">
                Replaces all current data with a previously downloaded
                backup file. Use this only if you need to recover lost data.
              </p>
            </div>
            <Button
              icon={Upload}
              onClick={() => restoreInputRef.current?.click()}
              disabled={backupBusy}
            >
              {backupBusy ? "Working…" : "Restore from Backup"}
            </Button>
            <input
              ref={restoreInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleRestoreFile}
            />
          </div>

          {backupMsg && (
            <p className="text-sm font-medium text-[#10b981]">{backupMsg}</p>
          )}
          {backupError && (
            <p className="text-sm font-medium text-red-500">{backupError}</p>
          )}
        </div>
      </Card>

      {/* Staff Management */}
      <Card className="mt-6">
        <CardHeader
          title="Staff Management"
          subtitle="Add teachers and assign them to classes and subjects."
          action={
            teachers.length > 0 ? (
              <div className="relative">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="search"
                  value={teacherSearch}
                  onChange={(e) => setTeacherSearch(e.target.value)}
                  placeholder="Search teachers…"
                  className="w-52 rounded-full border border-[#e2e8f0] bg-[#f1f5f9] py-1.5 pl-8 pr-3 text-sm text-slate-600 placeholder:text-slate-400 focus:border-[#0ea5e9] focus:bg-white focus:outline-none"
                />
              </div>
            ) : (
              <UserPlus size={18} className="text-slate-300" />
            )
          }
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
        ) : filteredTeachers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#e2e8f0] py-10 text-center text-sm text-slate-400">
            No teachers match “{teacherSearch.trim()}”.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {filteredTeachers.map((t) => {
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
                      {classes.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
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
