/**
 * Push env vars to a Render web service via the Render API.
 * Requires RENDER_API_KEY in schools config or process.env.
 */

const RENDER_API = "https://api.render.com/v1";

export async function pushEnvToRender({ apiKey, serviceId, envVars }) {
  if (!apiKey) throw new Error("Render API key is not configured");
  if (!serviceId) throw new Error("Render service ID is not configured");

  const results = [];
  for (const [key, value] of Object.entries(envVars)) {
    if (value === undefined || value === null) continue;
    const res = await fetch(`${RENDER_API}/services/${serviceId}/env-vars`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ envVar: { key, value: String(value) } }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok && res.status !== 409) {
      throw new Error(body.message || body.error || `Render API failed for ${key} (${res.status})`);
    }
    results.push({ key, ok: res.ok || res.status === 409 });
  }
  return results;
}

export async function triggerRenderDeploy({ apiKey, serviceId }) {
  if (!apiKey || !serviceId) throw new Error("Render API key and service ID are required");
  const res = await fetch(`${RENDER_API}/services/${serviceId}/deploys`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ clearCache: "do_not_clear" }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || body.error || `Deploy trigger failed (${res.status})`);
  return body;
}
