#!/usr/bin/env node
// License key tooling — CLI wrapper around devdash/lib/license.mjs
//
//   node scripts/license.mjs keygen
//   node scripts/license.mjs issue --school "St. Pius College" --days 120
//   node scripts/license.mjs inspect <key>

import { generateKeyPairSync, createPublicKey } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import {
  KEY_DIR,
  PRIVATE_KEY_PATH,
  PUBLIC_KEY_PATH,
} from "../devdash/lib/paths.mjs";
import {
  issueLicense,
  listLicenses,
  showLicense,
  revokeLicense,
  inspectToken,
  stateOf,
  daysUntil,
} from "../devdash/lib/license.mjs";

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

function issue() {
  const row = issueLicense({
    school: arg("school"),
    days: parseInt(arg("days", "365"), 10),
    plan: arg("plan", "pilot"),
    id: arg("id", undefined),
  });
  console.log(`school : ${row.school}`);
  console.log(`id     : ${row.id}`);
  console.log(`plan   : ${row.plan}`);
  console.log(`expires: ${row.expires}`);
  console.log(`\nLicense key — give this to the school:\n`);
  console.log(row.key);
}

function inspect() {
  const token = process.argv[3];
  if (!token) die("usage: license.mjs inspect <key>");
  const result = inspectToken(token);
  console.log(JSON.stringify(result.payload, null, 2));
  console.log(`signature: ${result.signature}`);
  console.log(
    `expiry   : ${result.daysRemaining > 0 ? result.daysRemaining + " days remaining" : "EXPIRED " + -result.daysRemaining + " days ago"}`,
  );
}

function list() {
  const ledger = listLicenses();
  if (!ledger.length) return console.log("No licences issued yet.");

  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad("ID", 16) + pad("SCHOOL", 30) + pad("STATE", 9) + pad("EXPIRES", 12) + "DAYS");
  console.log("-".repeat(74));
  for (const row of ledger) {
    const days = row.state === "REVOKED" ? "-" : row.daysRemaining;
    console.log(
      pad(row.id, 16) +
        pad(row.school.slice(0, 28), 30) +
        pad(row.state, 9) +
        pad(row.expires, 12) +
        days,
    );
  }
  const expiring = ledger.filter((r) => r.state === "EXPIRING" || r.state === "ACTIVE" && r.daysRemaining <= 30);
  if (expiring.length) console.log(`\n${expiring.length} licence(s) expire within 30 days.`);
}

function revoke() {
  const id = process.argv[3];
  if (!id) die("usage: license.mjs revoke <LIC-ID>");
  const row = revokeLicense(id);
  console.log(`${id} (${row.school}) marked revoked in the ledger.`);
  console.log(
    "\nNOTE: this does NOT disable the key yet. Licences verify offline by\n" +
      "signature, so revocation only takes effect once a licence server serves\n" +
      "this ledger and the school's install has LICENSE_SERVER_URL set.\n" +
      "Until then the key keeps working until " +
      row.expires +
      ".",
  );
}

function show() {
  const id = process.argv[3];
  if (!id) die("usage: license.mjs show <LIC-ID>");
  const row = showLicense(id);
  console.log(`school : ${row.school}`);
  console.log(`state  : ${row.state}`);
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
  console.log("  node scripts/license.mjs list");
  console.log("  node scripts/license.mjs show <LIC-ID>");
  console.log("  node scripts/license.mjs revoke <LIC-ID>");
  console.log("  node scripts/license.mjs inspect <key>");
  process.exit(command ? 1 : 0);
}
