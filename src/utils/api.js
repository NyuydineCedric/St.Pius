const API_BASE = import.meta.env.DEV
  ? ""
  : import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";

const TOKEN_KEY = "authToken";
export const AUTH_EXPIRED_EVENT = "reportcard:auth-expired";

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

function authHeaders(extra = {}) {
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

export function login(email, password) {
  return postAuthJson("/api/login", { email, password });
}

export function logout() {
  return postJson("/api/logout", {}).catch(() => ({ status: "ok" }));
}

export function register(name, email, password, role) {
  return postAuthJson("/api/register", { name, email, password, role }, true);
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

export function getStudents() {
  return getJson("/api/students");
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

export function getMarks(cls, subject, sequence) {
  return getJson(
    `/api/marks?class=${encodeURIComponent(cls)}&subject=${encodeURIComponent(subject)}&sequence=${encodeURIComponent(sequence)}`,
  );
}

export function saveMarks(cls, subject, sequence, marks) {
  return postJson("/api/marks", { class: cls, subject, sequence, marks });
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

export function getSettings() {
  return getJson("/api/settings");
}

export function saveSettings(partial) {
  return postJson("/api/settings", partial);
}

export function assignClassMaster(className, teacherId) {
  return postJson("/api/classes/master", { class: className, teacherId });
}
