/**
 * Talk to a deployed school backend (Render) using stored admin credentials.
 */

function baseUrl(raw) {
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

export async function loginSchool(base, email, password) {
  const url = baseUrl(base);
  if (!url) throw new Error("renderServiceUrl is not set");
  const res = await fetch(`${url}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Login failed (${res.status})`);
  if (!body.token) throw new Error("Login did not return a token");
  return body.token;
}

export async function fetchSchoolLicense(base, token) {
  const url = baseUrl(base);
  const res = await fetch(`${url}/api/license`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `License fetch failed (${res.status})`);
  return body;
}

export async function activateSchoolLicense(base, token, key) {
  const url = baseUrl(base);
  const res = await fetch(`${url}/api/license/activate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ key }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Activation failed (${res.status})`);
  return body;
}

export async function pingSchoolHealth(base) {
  const url = baseUrl(base);
  if (!url) return { ok: false, error: "No URL configured" };
  try {
    const res = await fetch(`${url}/api/health`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return { ok: false, error: e.message || "Unreachable" };
  }
}

export async function pingSchoolLicense(base, adminEmail, adminPassword) {
  const health = await pingSchoolHealth(base);
  if (!health.ok) return { reachable: false, health, license: null, error: health.error };

  if (!adminEmail || !adminPassword) {
    return {
      reachable: true,
      health,
      license: null,
      error: "Admin credentials not configured — health OK, licence status unknown",
    };
  }

  try {
    const token = await loginSchool(base, adminEmail, adminPassword);
    const license = await fetchSchoolLicense(base, token);
    return { reachable: true, health, license, error: null };
  } catch (e) {
    return { reachable: true, health, license: null, error: e.message };
  }
}
