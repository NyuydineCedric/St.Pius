const API_BASE = import.meta.env.DEV
  ? ""
  : import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";

const TOKEN_KEY = "authToken";
export const AUTH_EXPIRED_EVENT = "reportcard:auth-expired";

/** Absolute URL for an API path. Needed when the SPA is on a different host
 *  (Vercel) than the backend (Render) — relative `/api/...` would hit Vercel. */
export function apiUrl(path) {
  if (!path) return path;
  if (
    path.startsWith("http://") ||
    path.startsWith("https://") ||
    path.startsWith("data:") ||
    path.startsWith("blob:")
  ) {
    return path;
  }
  if (path.startsWith("/")) return `${API_BASE}${path}`;
  return path;
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

function clearClientSession() {
  setToken(null);
  localStorage.removeItem("userData");
  localStorage.removeItem("userRole");
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }
}

export function authHeaders(extra = {}) {
  const headers = { ...extra };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function parseError(res) {
  const body = await res.text();
  try {
    const json = JSON.parse(body);
    if (json.error) return json.error;
  } catch {
    /* plain text */
  }
  return body || `Request failed (${res.status})`;
}

function handleUnauthorized(res) {
  if (res.status === 401) clearClientSession();
}

export async function getJson(path) {
  const res = await fetch(API_BASE + path, { headers: authHeaders() });
  handleUnauthorized(res);
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  return await res.json();
}

export async function postJson(path, data) {
  const res = await fetch(API_BASE + path, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(data),
  });
  handleUnauthorized(res);
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  return await res.json();
}

export async function deleteJson(path) {
  const res = await fetch(API_BASE + path, {
    method: "DELETE",
    headers: authHeaders(),
  });
  handleUnauthorized(res);
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  return await res.json();
}

// Auth endpoints return a structured { error: "..." } body on failure
// rather than plain text, so login/register parse that out to surface a
// clean message (e.g. "Invalid email or password") instead of a raw
// "API error 401: {...}" string.
async function postAuthJson(path, data, withAuth = false) {
  const res = await fetch(API_BASE + path, {
    method: "POST",
    headers: withAuth
      ? authHeaders({ "Content-Type": "application/json" })
      : { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return body;
}

export async function getAuthStatus() {
  const res = await fetch(API_BASE + "/api/auth/status");
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

// No auth required — used to show whether this instance is running on
// local file storage or a shared cloud database (see Settings > Cloud Sync).
export async function getHealth() {
  const res = await fetch(API_BASE + "/api/health");
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export function login(email, password) {
  return postAuthJson("/api/login", { email, password });
}

export function logout() {
  return postJson("/api/logout", {}).catch(() => ({ status: "ok" }));
}

export function register(name, email, password, role) {
  // Public signup — do not attach a leftover session token. Sending
  // Authorization on register triggers a CORS preflight and can confuse
  // debugging when a stale token is sitting in localStorage.
  return postAuthJson("/api/register", { name, email, password, role }, false);
}

export async function putJson(path, data) {
  const res = await fetch(API_BASE + path, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(data),
  });
  handleUnauthorized(res);
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  return await res.json();
}

// Returns every student WITHOUT their photo — each one is a ~40–80KB base64
// data URL, so a whole school's worth turns this into a multi-megabyte
// response, and this list is loaded on every page. Each student carries a
// `hasPhoto` boolean instead.
//
// Pass { includePhotos: true } only where the photos are really needed. In
// particular the student editor must, because it saves the form back and
// would otherwise write an empty photo over the stored one.
//
// Screens that display photos (student cards, report cards, history) should
// prefer getRoster(className), which is naturally limited to one class.
export function getStudents({ includePhotos = false } = {}) {
  return getJson(`/api/students${includePhotos ? "?includePhotos=1" : ""}`);
}

export function addStudent(student) {
  return postJson("/api/students", student);
}

export function updateStudent(id, student) {
  return putJson(`/api/students/${encodeURIComponent(id)}`, student);
}

export function deleteStudent(id) {
  return deleteJson(`/api/students/${encodeURIComponent(id)}`);
}

export function getClasses() {
  return getJson("/api/classes");
}

export function addClass(name) {
  return postJson("/api/classes", { name });
}

export function getRoster(className) {
  return getJson(`/api/roster?class=${encodeURIComponent(className)}`);
}

// academicYear is optional — omit it (or pass "") to read the currently
// configured year. Student History / Mastersheet pass an explicit year
// to look back at a prior one.
export function getMarks(cls, subject, sequence, academicYear = "") {
  const yearParam = academicYear
    ? `&academicYear=${encodeURIComponent(academicYear)}`
    : "";
  return getJson(
    `/api/marks?class=${encodeURIComponent(cls)}&subject=${encodeURIComponent(subject)}&sequence=${encodeURIComponent(sequence)}${yearParam}`,
  );
}

// Always writes to the current academic year — the backend ignores any
// year the client sends, so marks entry can never accidentally overwrite
// a prior year's scores.
export function saveMarks(cls, subject, sequence, marks) {
  return postJson("/api/marks", { class: cls, subject, sequence, marks });
}

export function getAcademicYears() {
  return getJson("/api/academic-years");
}

export function getActivities() {
  return getJson("/api/activities");
}

export function logActivity(type, text) {
  return postJson("/api/activities", { type, text });
}

export function getTeachers() {
  return getJson("/api/teachers");
}

export function addTeacher(teacher) {
  return postJson("/api/teachers", teacher);
}

export function addTeacherAssignment(teacherId, className, subject) {
  return postJson(`/api/teachers/${encodeURIComponent(teacherId)}/assignments`, {
    class: className,
    subject,
  });
}

export function removeTeacherAssignment(teacherId, className, subject) {
  return deleteJson(
    `/api/teachers/${encodeURIComponent(teacherId)}/assignments?class=${encodeURIComponent(className)}&subject=${encodeURIComponent(subject)}`,
  );
}

export function deleteTeacher(teacherId) {
  return deleteJson(`/api/teachers/${encodeURIComponent(teacherId)}`);
}

export function updateTeacher(teacherId, fields) {
  return putJson(`/api/teachers/${encodeURIComponent(teacherId)}`, fields);
}

export function getSettings() {
  return getJson("/api/settings");
}

export function saveSettings(partial) {
  return postJson("/api/settings", partial);
}

// Changes the signed-in user's own password. Not licence-gated — securing
// your account must work regardless of billing state.
export function changePassword(currentPassword, newPassword) {
  return postJson("/api/account/password", { currentPassword, newPassword });
}

// Desktop sync status: { configured, server, syncing, lastSyncedAt, pending,
// lastError }. `configured:false` on a standalone or cloud-hosted install.
export function getSyncStatus() {
  return getJson("/api/sync/status");
}

// Runs a sync immediately rather than waiting for the background timer.
export function syncNow() {
  return postJson("/api/sync/now", {});
}

// Current licence state: { status, school, expires, daysRemaining, readOnly,
// message }. When readOnly is true the backend refuses writes with HTTP 402,
// so the UI should say so up front rather than letting people fill in a form
// that cannot be saved.
export function getLicense() {
  return getJson("/api/license");
}

// Installs a licence key. Admin only. Takes effect immediately — no restart.
export function activateLicense(key) {
  return postJson("/api/license/activate", { key });
}

export function assignClassMaster(className, teacherId) {
  return postJson("/api/classes/master", { class: className, teacherId });
}

// Triggers a browser download of the current data backup file. Throws if
// this server doesn't support local-file backups (e.g. cloud/Postgres mode).
export async function downloadBackup() {
  const res = await fetch(API_BASE + "/api/backup", { headers: authHeaders() });
  handleUnauthorized(res);
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : `report-card-backup-${Date.now()}.json`;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// Uploads a previously downloaded backup file to replace the server's live
// data. The backend validates the file and keeps a safety copy before
// touching anything, then reloads in place — no restart needed.
export async function restoreBackup(file) {
  const res = await fetch(API_BASE + "/api/backup/restore", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/octet-stream" }),
    body: file,
  });
  handleUnauthorized(res);
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  return await res.json();
}
