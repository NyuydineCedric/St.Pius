import { useEffect, useState } from "react";
import StatusBadge from "../components/StatusBadge.jsx";
import {
  getLicenses,
  getLicense,
  issueLicense,
  renewLicense,
  revokeLicense,
  copyText,
} from "../api.js";

export default function LicensePage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [issuedKey, setIssuedKey] = useState(null);
  const [form, setForm] = useState({ school: "", days: "365", plan: "pilot", renderServiceUrl: "" });

  function prefillFromRow(row) {
    setForm({
      school: row.school,
      days: "365",
      plan: row.plan,
      renderServiceUrl: row.renderServiceUrl || "",
    });
    setError("");
    setSuccess("");
    setIssuedKey(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      setRows(await getLicenses());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleIssue(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setIssuedKey(null);
    try {
      const row = await issueLicense({
        school: form.school,
        days: Number(form.days),
        plan: form.plan,
        renderServiceUrl: form.renderServiceUrl || undefined,
      });
      setIssuedKey(row);
      setSuccess(`Issued ${row.id} for ${row.school}`);
      setForm({ school: "", days: "365", plan: "pilot", renderServiceUrl: "" });
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleCopy(id) {
    try {
      const row = await getLicense(id);
      await copyText(row.key);
      setSuccess(`Copied key for ${id}`);
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleRenew(id) {
    const days = window.prompt("Renew for how many days?", "365");
    if (!days) return;
    const push = window.confirm("Also push the new key to the school's Render backend?");
    setError("");
    setSuccess("");
    try {
      const result = await renewLicense(id, { days: Number(days), push });
      setIssuedKey(result.current);
      setSuccess(
        push && result.pushed
          ? `Renewed ${result.current.id} and pushed to backend`
          : `Renewed ${result.current.id}`,
      );
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleRevoke(id) {
    if (!window.confirm(`Revoke ${id}? This marks it in the ledger.`)) return;
    setError("");
    try {
      await revokeLicense(id);
      setSuccess(`Revoked ${id}`);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <>
      <h1 className="page-title">Licences</h1>
      <p className="page-sub">Issue, renew, and revoke school subscription keys.</p>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="card">
        <h2>Issue new licence</h2>
        <form onSubmit={handleIssue}>
          <div className="grid-2">
            <div>
              <label>School name</label>
              <input
                value={form.school}
                onChange={(e) => setForm({ ...form, school: e.target.value })}
                required
                placeholder="St. Pius College"
              />
            </div>
            <div>
              <label>Days</label>
              <input
                type="number"
                min="1"
                value={form.days}
                onChange={(e) => setForm({ ...form, days: e.target.value })}
              />
            </div>
            <div>
              <label>Plan</label>
              <select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}>
                <option value="pilot">pilot</option>
                <option value="standard">standard</option>
                <option value="enterprise">enterprise</option>
              </select>
            </div>
            <div>
              <label>Render URL (optional)</label>
              <input
                value={form.renderServiceUrl}
                onChange={(e) => setForm({ ...form, renderServiceUrl: e.target.value })}
                placeholder="https://st-pius-backend.onrender.com"
              />
            </div>
          </div>
          <div style={{ marginTop: "1rem" }}>
            <button type="submit" className="btn btn-primary">
              Issue licence
            </button>
          </div>
        </form>
        {issuedKey && (
          <div className="key-box">
            <div className="mono">{issuedKey.key}</div>
            <div className="actions" style={{ marginTop: "0.5rem" }}>
              <button type="button" className="btn btn-sm" onClick={() => copyText(issuedKey.key)}>
                Copy key
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Issued licences</h2>
        {loading ? (
          <p>Loading…</p>
        ) : rows.length === 0 ? (
          <p>No licences issued yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>School</th>
                <th>Plan</th>
                <th>Expires</th>
                <th>Days</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="mono">{row.id}</td>
                  <td>{row.school}</td>
                  <td>{row.plan}</td>
                  <td>{row.expires}</td>
                  <td>{row.daysRemaining ?? "—"}</td>
                  <td>
                    <StatusBadge state={row.state} />
                  </td>
                  <td>
                    <div className="actions">
                      {row.state !== "REVOKED" && (
                        <button type="button" className="btn btn-sm" onClick={() => handleCopy(row.id)}>
                          Copy
                        </button>
                      )}
                      {row.state !== "REVOKED" && (
                        <button type="button" className="btn btn-sm" onClick={() => handleRenew(row.id)}>
                          Renew
                        </button>
                      )}
                      {row.state === "REVOKED" && (
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          title="Pre-fill the issue form with this school's details"
                          onClick={() => prefillFromRow(row)}
                        >
                          Re-issue
                        </button>
                      )}
                      {row.state !== "REVOKED" && (
                        <button type="button" className="btn btn-sm btn-danger" onClick={() => handleRevoke(row.id)}>
                          Revoke
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
