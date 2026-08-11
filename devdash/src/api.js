const BASE = "";

async function parseError(res) {
  const body = await res.json().catch(() => ({}));
  throw new Error(body.error || `Request failed (${res.status})`);
}

export async function getLicenses() {
  const res = await fetch(`${BASE}/api/licenses`);
  if (!res.ok) await parseError(res);
  return res.json();
}

export async function getLicense(id) {
  const res = await fetch(`${BASE}/api/licenses/${encodeURIComponent(id)}`);
  if (!res.ok) await parseError(res);
  return res.json();
}

export async function issueLicense(body) {
  const res = await fetch(`${BASE}/api/licenses/issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await parseError(res);
  return res.json();
}

export async function renewLicense(id, body) {
  const res = await fetch(`${BASE}/api/licenses/${encodeURIComponent(id)}/renew`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await parseError(res);
  return res.json();
}

export async function revokeLicense(id) {
  const res = await fetch(`${BASE}/api/licenses/${encodeURIComponent(id)}/revoke`, {
    method: "POST",
  });
  if (!res.ok) await parseError(res);
  return res.json();
}

export async function patchLicense(id, body) {
  const res = await fetch(`${BASE}/api/licenses/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await parseError(res);
  return res.json();
}

export async function getSchools() {
  const res = await fetch(`${BASE}/api/schools`);
  if (!res.ok) await parseError(res);
  return res.json();
}

export async function pingSchools() {
  const res = await fetch(`${BASE}/api/schools/ping`);
  if (!res.ok) await parseError(res);
  return res.json();
}

export async function activateSchool(id) {
  const res = await fetch(`${BASE}/api/schools/${encodeURIComponent(id)}/activate`, {
    method: "POST",
  });
  if (!res.ok) await parseError(res);
  return res.json();
}

export async function getConfig() {
  const res = await fetch(`${BASE}/api/config`);
  if (!res.ok) await parseError(res);
  return res.json();
}

export async function saveConfig(config) {
  const res = await fetch(`${BASE}/api/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) await parseError(res);
  return res.json();
}

export async function pushConfig(licenseId, redeploy = true) {
  const res = await fetch(`${BASE}/api/config/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ licenseId, redeploy }),
  });
  if (!res.ok) await parseError(res);
  return res.json();
}

export function copyText(text) {
  return navigator.clipboard.writeText(text);
}
