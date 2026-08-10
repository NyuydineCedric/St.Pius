#!/usr/bin/env node
// Licence status server.
//
//   node scripts/license-server.mjs [--port 9000]
//
// Serves the `revoked` flag from license-keys/issued.json so a licence can be
// pulled back before its expiry date. Schools point at it with
// LICENSE_SERVER_URL; the client treats an unreachable server as "fine, carry
// on", so this being down never locks a school out.
//
// Runs as ONE service for all schools — a school's own backend must not be the
// authority on its own licence. Host it anywhere reachable; it holds no
// secrets (the signing key is not needed to answer "is this revoked?"), and
// exposes only licence ids and revocation state, never keys.

import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const LEDGER_PATH = path.join("license-keys", "issued.json");
const portArgIndex = process.argv.indexOf("--port");
const PORT = portArgIndex !== -1 ? Number(process.argv[portArgIndex + 1]) : Number(process.env.PORT || 9000);

// Cached, but re-read when the file changes, so `license.mjs revoke` takes
// effect without restarting this process.
let cache = { mtimeMs: 0, byId: new Map() };

function ledger() {
  if (!existsSync(LEDGER_PATH)) return new Map();
  const { mtimeMs } = statSync(LEDGER_PATH);
  if (mtimeMs !== cache.mtimeMs) {
    try {
      const rows = JSON.parse(readFileSync(LEDGER_PATH, "utf8"));
      cache = { mtimeMs, byId: new Map(rows.map((r) => [r.id, r])) };
      console.log(`[license-server] loaded ${rows.length} licence(s)`);
    } catch (err) {
      // Keep serving the last good copy rather than failing every school
      // because the file is briefly mid-write.
      console.error(`[license-server] could not reload ledger: ${err.message}`);
    }
  }
  return cache.byId;
}

function json(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/api/health") {
    return json(res, 200, { status: "UP", service: "license-server", licences: ledger().size });
  }

  if (url.pathname === "/api/license/status") {
    const id = url.searchParams.get("id");
    if (!id) return json(res, 400, { error: "missing id" });

    const row = ledger().get(id);
    // An unknown id is reported as active, not revoked. Licences are valid by
    // signature; this service only ever *subtracts* trust. Treating "I don't
    // recognise this" as revoked would brick any school whose row went missing
    // from the ledger — a bookkeeping slip must not disable a paying customer.
    if (!row) return json(res, 200, { id, status: "active", known: false });

    return json(res, 200, {
      id,
      status: row.revokedAt ? "revoked" : "active",
      known: true,
      school: row.school,
      expires: row.expires,
      ...(row.revokedAt ? { revokedAt: row.revokedAt } : {}),
    });
  }

  json(res, 404, { error: "not found" });
}).listen(PORT, () => {
  console.log(`[license-server] listening on :${PORT}`);
  console.log(`[license-server] ledger: ${path.resolve(LEDGER_PATH)}`);
  console.log(`[license-server] schools set LICENSE_SERVER_URL to this origin`);
});
