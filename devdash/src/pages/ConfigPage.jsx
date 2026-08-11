import { useEffect, useState } from "react";
import { getConfig, saveConfig, pushConfig, getSchools } from "../api.js";

const ENV_KEYS = ["ALLOWED_ORIGIN", "LICENSE_SERVER_URL", "LICENSE_KEY", "DATABASE_URL"];

export default function ConfigPage() {
  const [config, setConfig] = useState({ renderApiKey: "", schools: {} });
  const [schoolOptions, setSchoolOptions] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [cfg, schools] = await Promise.all([getConfig(), getSchools()]);
      setConfig(cfg);
      setSchoolOptions(schools);
      if (!selectedId && schools.length > 0) {
        setSelectedId(schools[0].licenseId);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const schoolCfg = selectedId ? config.schools[selectedId] ?? emptySchool() : emptySchool();

  function emptySchool() {
    return {
      renderServiceUrl: "",
      renderServiceId: "",
      adminEmail: "",
      adminPassword: "",
      env: {},
    };
  }

  function updateSchool(patch) {
    if (!selectedId) return;
    setConfig((c) => ({
      ...c,
      schools: {
        ...c.schools,
        [selectedId]: { ...emptySchool(), ...c.schools[selectedId], ...patch },
      },
    }));
  }

  function updateEnv(key, value) {
    updateSchool({
      env: { ...(schoolCfg.env ?? {}), [key]: value },
    });
  }

  async function handleSave() {
    setError("");
    setSuccess("");
    try {
      await saveConfig(config);
      setSuccess("Configuration saved locally.");
    } catch (e) {
      setError(e.message);
    }
  }

  async function handlePush(redeploy) {
    if (!selectedId) return;
    setError("");
    setSuccess("");
    try {
      await saveConfig(config);
      const result = await pushConfig(selectedId, redeploy);
      setSuccess(
        redeploy
          ? `Pushed env vars and triggered deploy for ${selectedId}.`
          : `Pushed env vars for ${selectedId}.`,
      );
      console.log(result);
    } catch (e) {
      setError(e.message);
    }
  }

  if (loading) return <p>Loading…</p>;

  return (
    <>
      <h1 className="page-title">Config</h1>
      <p className="page-sub">
        Per-school deployment settings stored in{" "}
        <code className="mono">devdash/.schools-config.json</code> (gitignored).
      </p>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="alert alert-info">
        Copy <code className="mono">devdash/.schools-config.example.json</code> to{" "}
        <code className="mono">devdash/.schools-config.json</code> and fill in admin credentials
        and Render service IDs before pushing.
      </div>

      <div className="card">
        <h2>Global</h2>
        <label>Render API key</label>
        <input
          type="password"
          value={config.renderApiKey ?? ""}
          onChange={(e) => setConfig({ ...config, renderApiKey: e.target.value })}
          placeholder="rnd_…"
        />
      </div>

      <div className="card">
        <h2>School</h2>
        <label>Licence / school</label>
        <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
          {schoolOptions.map((s) => (
            <option key={s.licenseId} value={s.licenseId}>
              {s.school} ({s.licenseId})
            </option>
          ))}
        </select>

        {selectedId && (
          <>
            <div className="grid-2" style={{ marginTop: "1rem" }}>
              <div>
                <label>Render service URL</label>
                <input
                  value={schoolCfg.renderServiceUrl ?? ""}
                  onChange={(e) => updateSchool({ renderServiceUrl: e.target.value })}
                />
              </div>
              <div>
                <label>Render service ID</label>
                <input
                  value={schoolCfg.renderServiceId ?? ""}
                  onChange={(e) => updateSchool({ renderServiceId: e.target.value })}
                  placeholder="srv-…"
                />
              </div>
              <div>
                <label>Admin email (for remote activate)</label>
                <input
                  value={schoolCfg.adminEmail ?? ""}
                  onChange={(e) => updateSchool({ adminEmail: e.target.value })}
                />
              </div>
              <div>
                <label>Admin password</label>
                <input
                  type="password"
                  value={schoolCfg.adminPassword ?? ""}
                  onChange={(e) => updateSchool({ adminPassword: e.target.value })}
                />
              </div>
            </div>

            <h2 style={{ marginTop: "1.25rem" }}>Environment variables</h2>
            {ENV_KEYS.map((key) => (
              <div key={key} style={{ marginBottom: "0.75rem" }}>
                <label>{key}</label>
                <input
                  value={schoolCfg.env?.[key] ?? ""}
                  onChange={(e) => updateEnv(key, e.target.value)}
                />
              </div>
            ))}

            <div className="actions" style={{ marginTop: "1rem" }}>
              <button type="button" className="btn btn-primary" onClick={handleSave}>
                Save locally
              </button>
              <button type="button" className="btn" onClick={() => handlePush(false)}>
                Push env to Render
              </button>
              <button type="button" className="btn btn-primary" onClick={() => handlePush(true)}>
                Push env + redeploy
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
