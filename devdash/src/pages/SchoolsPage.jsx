import { useEffect, useState } from "react";
import { getSchools, pingSchools, activateSchool, patchLicense } from "../api.js";

export default function SchoolsPage() {
  const [schools, setSchools] = useState([]);
  const [pings, setPings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pinging, setPinging] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      setSchools(await getSchools());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handlePing() {
    setPinging(true);
    setError("");
    try {
      setPings(await pingSchools());
    } catch (e) {
      setError(e.message);
    } finally {
      setPinging(false);
    }
  }

  async function handleActivate(id) {
    setError("");
    setSuccess("");
    try {
      const result = await activateSchool(id);
      setSuccess(`Activated on backend — ${result.status || "OK"}`);
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleSaveUrl(id, url) {
    setError("");
    try {
      await patchLicense(id, { renderServiceUrl: url });
      setSuccess(`Saved URL for ${id}`);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  function pingFor(id) {
    return pings.find((p) => p.licenseId === id);
  }

  return (
    <>
      <h1 className="page-title">Schools</h1>
      <p className="page-sub">Live status of deployed school backends.</p>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="actions" style={{ marginBottom: "1rem" }}>
        <button type="button" className="btn btn-primary" onClick={handlePing} disabled={pinging}>
          {pinging ? "Pinging…" : "Ping all schools"}
        </button>
      </div>

      <div className="card">
        {loading ? (
          <p>Loading…</p>
        ) : schools.length === 0 ? (
          <p>No schools in the ledger yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>School</th>
                <th>Licence ID</th>
                <th>Backend URL</th>
                <th>Reachable</th>
                <th>Live licence</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {schools.map((s) => {
                const ping = pingFor(s.licenseId);
                return (
                  <SchoolRow
                    key={s.licenseId}
                    school={s}
                    ping={ping}
                    onSaveUrl={handleSaveUrl}
                    onActivate={handleActivate}
                  />
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function SchoolRow({ school, ping, onSaveUrl, onActivate }) {
  const [url, setUrl] = useState(school.renderServiceUrl || "");

  return (
    <tr>
      <td>{school.school}</td>
      <td className="mono">{school.licenseId}</td>
      <td>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…onrender.com"
          style={{ minWidth: "220px" }}
        />
        <button
          type="button"
          className="btn btn-sm"
          style={{ marginTop: "0.35rem" }}
          onClick={() => onSaveUrl(school.licenseId, url)}
        >
          Save URL
        </button>
      </td>
      <td>
        {!ping ? (
          "—"
        ) : ping.reachable ? (
          <span className="badge badge-active">Online</span>
        ) : (
          <span className="badge badge-expired">{ping.error || "Offline"}</span>
        )}
      </td>
      <td>
        {!ping ? (
          "—"
        ) : ping.license ? (
          <span>
            {ping.license.status}{" "}
            {ping.license.readOnly ? "(read-only)" : ""}
          </span>
        ) : (
          <span style={{ color: "#94a3b8" }}>{ping.error || "Unknown"}</span>
        )}
      </td>
      <td>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={() => onActivate(school.licenseId)}
          disabled={!url && !school.renderServiceUrl}
        >
          Push licence
        </button>
      </td>
    </tr>
  );
}
