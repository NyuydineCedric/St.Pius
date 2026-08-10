#!/usr/bin/env node
// License key tooling.
//
//   node scripts/license.mjs keygen
//   node scripts/license.mjs issue --school "St. Pius College" --days 120
//   node scripts/license.mjs inspect <key>
//
// Licenses are Ed25519-signed so the app can verify one offline, with no
// license server reachable. The PRIVATE key never ships — it stays with
// whoever issues licenses. Only the public key is compiled into the app.

import { randomUUID, generateKeyPairSync, sign, verify, createPublicKey, createPrivateKey } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";

const KEY_DIR = "license-keys";
const PRIVATE_KEY_PATH = path.join(KEY_DIR, "license-private.pem");
const PUBLIC_KEY_PATH = path.join(KEY_DIR, "license-public.pem");
// Record of every licence handed out. Signed licences are self-contained, so
// nothing needs this to verify — it exists so you can answer "who has what,
// and when does it lapse?" without digging through sent mail.
const LEDGER_PATH = path.join(KEY_DIR, "issued.json");

function readLedger() {
  if (!existsSync(LEDGER_PATH)) return [];
  try {
    return JSON.parse(readFileSync(LEDGER_PATH, "utf8"));
  } catch {
    die(`${LEDGER_PATH} is corrupt — fix or delete it before issuing more licences.`);
  }
}

function writeLedger(rows) {
  mkdirSync(KEY_DIR, { recursive: true });
  writeFileSync(LEDGER_PATH, JSON.stringify(rows, null, 2) + "\n");
}

function daysUntil(dateStr) {
  return Math.ceil((new Date(dateStr + "T23:59:59Z") - Date.now()) / 86400_000);
}

function stateOf(row) {
  if (row.revokedAt) return "REVOKED";
  return daysUntil(row.expires) > 0 ? "ACTIVE" : "EXPIRED";
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");

function die(msg) {
  console.error("error: " + msg);
  process.exit(1);
}

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf("--" + name);
  if (i === -1 || i === process.argv.length - 1) {
    if (fallback === undefined) die(`missing --${name}`);
    return fallback;
  }
  return process.argv[i + 1];
}

// ---------------------------------------------------------------- keygen

function keygen() {
  if (existsSync(PRIVATE_KEY_PATH)) {
    die(
      `${PRIVATE_KEY_PATH} already exists. Delete it deliberately if you really want new keys — ` +
        `every license already issued stops verifying.`,
    );
  }
  mkdirSync(KEY_DIR, { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");

  writeFileSync(PRIVATE_KEY_PATH, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  writeFileSync(PUBLIC_KEY_PATH, publicKey.export({ type: "spki", format: "pem" }));

  const spkiB64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");

  console.log(`private key -> ${PRIVATE_KEY_PATH}  (gitignored, never distribute)`);
  console.log(`public key  -> ${PUBLIC_KEY_PATH}`);
  console.log("\nPaste this into LICENSE_PUBLIC_KEY_B64 in backend/src/main/java/com/reportcard/License.java:\n");
  console.log(spkiB64);
}

// ----------------------------------------------------------------- issue

function issue() {
  if (!existsSync(PRIVATE_KEY_PATH)) die(`no signing key. Run: node scripts/license.mjs keygen`);
  const privateKey = createPrivateKey(readFileSync(PRIVATE_KEY_PATH));

  const school = arg("school");
  const days = parseInt(arg("days", "365"), 10);
  if (!Number.isFinite(days) || days <= 0) die("--days must be a positive number");

  // Dates only — no clock-skew games over hours, and it reads plainly on an
  // invoice or in an email to the school.
  const now = new Date();
  const expiry = new Date(now.getTime() + days * 86400_000);
  const iso = (d) => d.toISOString().slice(0, 10);

  const payload = {
    v: 1,
    id: arg("id", "LIC-" + randomUUID().slice(0, 8).toUpperCase()),
    school,
    issued: iso(now),
    expires: iso(expiry),
    plan: arg("plan", "pilot"),
  };

  const payloadB64 = b64url(JSON.stringify(payload));
  const signature = sign(null, Buffer.from(payloadB64, "utf8"), privateKey);
  const token = `${payloadB64}.${b64url(signature)}`;

  const ledger = readLedger();
  if (ledger.some((r) => r.id === payload.id)) die(`licence id ${payload.id} was already issued`);
  ledger.push({ ...payload, key: token, revokedAt: null });
  writeLedger(ledger);

  console.log(`school : ${payload.school}`);
  console.log(`id     : ${payload.id}`);
  console.log(`plan   : ${payload.plan}`);
  console.log(`expires: ${payload.expires}  (${days} days)`);
  console.log(`\nLicense key — give this to the school:\n`);
  console.log(token);
}

// --------------------------------------------------------------- inspect

function inspect() {
  const token = process.argv[3];
  if (!token) die("usage: license.mjs inspect <key>");
  const [payloadB64, sigB64] = token.split(".");
  if (!payloadB64 || !sigB64) die("malformed key (expected two dot-separated parts)");

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    die("payload is not valid JSON");
  }

  let signatureOk = "unknown (no public key on disk)";
  if (existsSync(PUBLIC_KEY_PATH)) {
    const publicKey = createPublicKey(readFileSync(PUBLIC_KEY_PATH));
    signatureOk = verify(null, Buffer.from(payloadB64, "utf8"), publicKey,
      Buffer.from(sigB64, "base64url")) ? "VALID" : "INVALID — key was tampered with";
  }

  const daysLeft = Math.ceil((new Date(payload.expires + "T23:59:59Z") - Date.now()) / 86400_000);
  console.log(JSON.stringify(payload, null, 2));
  console.log(`signature: ${signatureOk}`);
  console.log(`expiry   : ${daysLeft > 0 ? daysLeft + " days remaining" : "EXPIRED " + -daysLeft + " days ago"}`);
}

// ------------------------------------------------------------------ list

function list() {
  const ledger = readLedger();
  if (!ledger.length) return console.log("No licences issued yet.");

  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad("ID", 16) + pad("SCHOOL", 30) + pad("STATE", 9) + pad("EXPIRES", 12) + "DAYS");
  console.log("-".repeat(74));
  for (const row of ledger.sort((a, b) => a.expires.localeCompare(b.expires))) {
    const state = stateOf(row);
    const days = state === "REVOKED" ? "-" : daysUntil(row.expires);
    console.log(pad(row.id, 16) + pad(row.school.slice(0, 28), 30) + pad(state, 9)
      + pad(row.expires, 12) + days);
  }
  const expiring = ledger.filter((r) => stateOf(r) === "ACTIVE" && daysUntil(r.expires) <= 30);
  if (expiring.length)
    console.log(`\n${expiring.length} licence(s) expire within 30 days.`);
}

// ---------------------------------------------------------------- revoke

function revoke() {
  const id = process.argv[3];
  if (!id) die("usage: license.mjs revoke <LIC-ID>");
  const ledger = readLedger();
  const row = ledger.find((r) => r.id === id);
  if (!row) die(`no licence with id ${id}`);
  if (row.revokedAt) die(`${id} was already revoked on ${row.revokedAt}`);

  row.revokedAt = new Date().toISOString().slice(0, 10);
  writeLedger(ledger);
  console.log(`${id} (${row.school}) marked revoked in the ledger.`);
  console.log(
    "\nNOTE: this does NOT disable the key yet. Licences verify offline by\n" +
      "signature, so revocation only takes effect once a licence server serves\n" +
      "this ledger and the school's install has LICENSE_SERVER_URL set.\n" +
      "Until then the key keeps working until " + row.expires + ".",
  );
}

// ---------------------------------------------------------------- reissue

function show() {
  const id = process.argv[3];
  if (!id) die("usage: license.mjs show <LIC-ID>");
  const row = readLedger().find((r) => r.id === id);
  if (!row) die(`no licence with id ${id}`);
  console.log(`school : ${row.school}`);
  console.log(`state  : ${stateOf(row)}`);
  console.log(`expires: ${row.expires}`);
  console.log(`\nKey:\n${row.key}`);
}

const command = process.argv[2];
if (command === "keygen") keygen();
else if (command === "issue") issue();
else if (command === "inspect") inspect();
else if (command === "list") list();
else if (command === "revoke") revoke();
else if (command === "show") show();
else {
  console.log("usage:");
  console.log("  node scripts/license.mjs keygen");
  console.log('  node scripts/license.mjs issue --school "Name" [--days 365] [--plan pilot] [--id LIC-XXXX]');
  console.log("  node scripts/license.mjs list                 # every licence issued, with expiry");
  console.log("  node scripts/license.mjs show <LIC-ID>        # re-print a key you already issued");
  console.log("  node scripts/license.mjs revoke <LIC-ID>      # mark revoked (needs a licence server)");
  console.log("  node scripts/license.mjs inspect <key>");
  process.exit(command ? 1 : 0);
}
