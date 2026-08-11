import { randomUUID, sign, verify, createPublicKey, createPrivateKey } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import {
  KEY_DIR,
  PRIVATE_KEY_PATH,
  PUBLIC_KEY_PATH,
  LEDGER_PATH,
} from "./paths.mjs";

const b64url = (buf) => Buffer.from(buf).toString("base64url");

export function daysUntil(dateStr) {
  return Math.ceil((new Date(dateStr + "T23:59:59Z") - Date.now()) / 86400_000);
}

export function stateOf(row) {
  if (row.revokedAt) return "REVOKED";
  const days = daysUntil(row.expires);
  if (days <= 0) return "EXPIRED";
  if (days <= 30) return "EXPIRING";
  return "ACTIVE";
}

export function readLedger() {
  if (!existsSync(LEDGER_PATH)) return [];
  try {
    return JSON.parse(readFileSync(LEDGER_PATH, "utf8"));
  } catch {
    throw new Error(`${LEDGER_PATH} is corrupt — fix or delete it before issuing more licences.`);
  }
}

export function writeLedger(rows) {
  mkdirSync(KEY_DIR, { recursive: true });
  writeFileSync(LEDGER_PATH, JSON.stringify(rows, null, 2) + "\n");
}

export function signPayload(payload) {
  if (!existsSync(PRIVATE_KEY_PATH)) {
    throw new Error(`no signing key at ${PRIVATE_KEY_PATH}. Run: node scripts/license.mjs keygen`);
  }
  const privateKey = createPrivateKey(readFileSync(PRIVATE_KEY_PATH));
  const payloadB64 = b64url(JSON.stringify(payload));
  const signature = sign(null, Buffer.from(payloadB64, "utf8"), privateKey);
  return `${payloadB64}.${b64url(signature)}`;
}

/**
 * Issue a new licence and append to the ledger.
 * @param {{ school: string, days?: number, plan?: string, id?: string, renderServiceUrl?: string }} opts
 */
export function issueLicense(opts) {
  const school = opts.school?.trim();
  if (!school) throw new Error("school name is required");

  const days = Number(opts.days ?? 365);
  if (!Number.isFinite(days) || days <= 0) throw new Error("days must be a positive number");

  const now = new Date();
  const expiry = new Date(now.getTime() + days * 86400_000);
  const iso = (d) => d.toISOString().slice(0, 10);

  const payload = {
    v: 1,
    id: opts.id?.trim() || "LIC-" + randomUUID().slice(0, 8).toUpperCase(),
    school,
    issued: iso(now),
    expires: iso(expiry),
    plan: opts.plan?.trim() || "pilot",
  };

  const ledger = readLedger();
  if (ledger.some((r) => r.id === payload.id)) {
    throw new Error(`licence id ${payload.id} was already issued`);
  }

  const token = signPayload(payload);
  const row = {
    ...payload,
    key: token,
    revokedAt: null,
    ...(opts.renderServiceUrl ? { renderServiceUrl: opts.renderServiceUrl.trim() } : {}),
  };
  ledger.push(row);
  writeLedger(ledger);
  return row;
}

export function renewLicense(id, { days = 365, push = false } = {}) {
  const ledger = readLedger();
  const existing = ledger.find((r) => r.id === id);
  if (!existing) throw new Error(`no licence with id ${id}`);
  if (existing.revokedAt) throw new Error(`${id} is revoked — issue a new licence instead`);

  const row = issueLicense({
    school: existing.school,
    days,
    plan: existing.plan,
    renderServiceUrl: existing.renderServiceUrl,
  });
  return { previous: existing, current: row, push };
}

export function revokeLicense(id) {
  const ledger = readLedger();
  const row = ledger.find((r) => r.id === id);
  if (!row) throw new Error(`no licence with id ${id}`);
  if (row.revokedAt) throw new Error(`${id} was already revoked on ${row.revokedAt}`);
  row.revokedAt = new Date().toISOString().slice(0, 10);
  writeLedger(ledger);
  return row;
}

export function getLicenseById(id) {
  return readLedger().find((r) => r.id === id) ?? null;
}

export function listLicenses() {
  return readLedger()
    .map((row) => {
      const { key, ...rest } = row;
      return {
        ...rest,
        state: stateOf(row),
        daysRemaining: row.revokedAt ? null : daysUntil(row.expires),
        hasKey: Boolean(key),
      };
    })
    .sort((a, b) => a.expires.localeCompare(b.expires));
}

export function showLicense(id) {
  const row = getLicenseById(id);
  if (!row) throw new Error(`no licence with id ${id}`);
  return { ...row, state: stateOf(row), daysRemaining: daysUntil(row.expires) };
}

export function inspectToken(token) {
  const [payloadB64, sigB64] = token.split(".");
  if (!payloadB64 || !sigB64) throw new Error("malformed key (expected two dot-separated parts)");

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    throw new Error("payload is not valid JSON");
  }

  let signatureOk = "unknown (no public key on disk)";
  if (existsSync(PUBLIC_KEY_PATH)) {
    const publicKey = createPublicKey(readFileSync(PUBLIC_KEY_PATH));
    signatureOk = verify(null, Buffer.from(payloadB64, "utf8"), publicKey, Buffer.from(sigB64, "base64url"))
      ? "VALID"
      : "INVALID";
  }

  const daysLeft = daysUntil(payload.expires);
  return {
    payload,
    signature: signatureOk,
    daysRemaining: daysLeft,
    state: daysLeft > 0 ? "ACTIVE" : "EXPIRED",
  };
}

export function updateLicenseMeta(id, patch) {
  const ledger = readLedger();
  const row = ledger.find((r) => r.id === id);
  if (!row) throw new Error(`no licence with id ${id}`);
  if (patch.renderServiceUrl !== undefined) {
    row.renderServiceUrl = patch.renderServiceUrl.trim() || undefined;
  }
  writeLedger(ledger);
  return row;
}
