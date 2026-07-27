#!/usr/bin/env node
/**
 * Load the GBHS Bamenda demo dataset into a running backend.
 *
 * Usage:
 *   npm run seed:demo
 *   node scripts/seed-demo.mjs
 *   API_BASE=http://127.0.0.1:8080 node scripts/seed-demo.mjs
 *
 * Auth: from localhost, sends X-Demo-Seed-Key: demo (override with DEMO_SEED_KEY).
 * Or set ADMIN_EMAIL / ADMIN_PASSWORD to seed as an authenticated admin.
 */
const API_BASE = (process.env.API_BASE || "http://127.0.0.1:8080").replace(/\/$/, "");
const SEED_KEY = process.env.DEMO_SEED_KEY || "demo";

async function main() {
  const headers = { "Content-Type": "application/json" };

  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const loginRes = await fetch(`${API_BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_PASSWORD,
      }),
    });
    const loginBody = await loginRes.json().catch(() => ({}));
    if (!loginRes.ok) {
      throw new Error(loginBody.error || `Login failed (${loginRes.status})`);
    }
    headers.Authorization = `Bearer ${loginBody.token}`;
    console.log(`Authenticated as ${loginBody.email}`);
  } else {
    headers["X-Demo-Seed-Key"] = SEED_KEY;
  }

  console.log(`Seeding demo data via ${API_BASE}/api/demo/seed …`);
  const res = await fetch(`${API_BASE}/api/demo/seed`, {
    method: "POST",
    headers,
    body: "{}",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `Seed failed (${res.status})`);
  }

  console.log("\nDemo data ready.\n");
  console.log(`  School:   ${body.school}`);
  console.log(`  Classes:  ${body.classes}`);
  console.log(`  Teachers: ${body.teachers}`);
  console.log(`  Students: ${body.students}`);
  console.log("\nLog in with:\n");
  console.log(`  Admin    ${body.adminEmail}  /  ${body.adminPassword}`);
  console.log(`  Teacher  ${body.teacherEmail}  /  ${body.teacherPassword}`);
  console.log("\nTry Report Cards → Form 4A for a full printable card.\n");
}

main().catch((err) => {
  console.error("\nSeed failed:", err.message);
  console.error("Is the backend running? Try: npm run backend\n");
  process.exit(1);
});
