#!/usr/bin/env node
/**
 * Local developer dashboard — binds 127.0.0.1 only.
 * Dev: API + Vite UI on :7000. Prod: API + static dist on :7000.
 */

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  listLicenses,
  issueLicense,
  renewLicense,
  revokeLicense,
  showLicense,
  updateLicenseMeta,
  readLedger,
} from "./lib/license.mjs";
import {
  readSchoolsConfig,
  writeSchoolsConfig,
  getSchoolConfig,
  upsertSchoolConfig,
} from "./lib/schools-config.mjs";
import {
  pingSchoolLicense,
  loginSchool,
  activateSchoolLicense,
} from "./lib/school-api.mjs";
import { pushEnvToRender, triggerRenderDeploy } from "./lib/render-api.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DEVDASH_PORT || 7000);
const HOST = "127.0.0.1";
const isProd = process.env.NODE_ENV === "production";

const app = express();
app.use(express.json({ limit: "1mb" }));

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function errorJson(res, status, message) {
  return res.status(status).json({ error: message });
}

app.get(
  "/api/licenses",
  asyncHandler(async (_req, res) => {
    res.json(listLicenses());
  }),
);

app.get(
  "/api/licenses/:id",
  asyncHandler(async (req, res) => {
    res.json(showLicense(req.params.id));
  }),
);

app.post(
  "/api/licenses/issue",
  asyncHandler(async (req, res) => {
    const { school, days, plan, id, renderServiceUrl } = req.body ?? {};
    const row = issueLicense({ school, days, plan, id, renderServiceUrl });
    if (renderServiceUrl) upsertSchoolConfig(row.id, { renderServiceUrl });
    res.status(201).json(row);
  }),
);

app.post(
  "/api/licenses/:id/renew",
  asyncHandler(async (req, res) => {
    const days = Number(req.body?.days ?? 365);
    const { previous, current } = renewLicense(req.params.id, { days });
    let pushed = null;
    if (req.body?.push) {
      const cfg = getSchoolConfig(current.id) || getSchoolConfig(previous.id);
      const url = current.renderServiceUrl || cfg?.renderServiceUrl;
      if (url && cfg?.adminEmail && cfg?.adminPassword) {
        const token = await loginSchool(url, cfg.adminEmail, cfg.adminPassword);
        pushed = await activateSchoolLicense(url, token, current.key);
      }
    }
    res.json({ previous: { id: previous.id, expires: previous.expires }, current, pushed });
  }),
);

app.post(
  "/api/licenses/:id/revoke",
  asyncHandler(async (req, res) => {
    res.json(revokeLicense(req.params.id));
  }),
);

app.patch(
  "/api/licenses/:id",
  asyncHandler(async (req, res) => {
    const row = updateLicenseMeta(req.params.id, req.body ?? {});
    if (req.body?.renderServiceUrl !== undefined) {
      upsertSchoolConfig(req.params.id, { renderServiceUrl: req.body.renderServiceUrl });
    }
    res.json(row);
  }),
);

app.get(
  "/api/schools",
  asyncHandler(async (_req, res) => {
    const config = readSchoolsConfig();
    const ledger = readLedger();
    res.json(
      ledger.map((row) => ({
        licenseId: row.id,
        school: row.school,
        plan: row.plan,
        expires: row.expires,
        revokedAt: row.revokedAt,
        renderServiceUrl: row.renderServiceUrl || config.schools[row.id]?.renderServiceUrl || "",
        config: config.schools[row.id] ?? null,
      })),
    );
  }),
);

app.get(
  "/api/schools/ping",
  asyncHandler(async (_req, res) => {
    const config = readSchoolsConfig();
    const ledger = readLedger();
    const results = await Promise.all(
      ledger.map(async (row) => {
        const cfg = config.schools[row.id] ?? {};
        const url = row.renderServiceUrl || cfg.renderServiceUrl || "";
        const ping = await pingSchoolLicense(url, cfg.adminEmail, cfg.adminPassword);
        return { licenseId: row.id, school: row.school, renderServiceUrl: url, ...ping };
      }),
    );
    res.json(results);
  }),
);

app.post(
  "/api/schools/:id/activate",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const row = showLicense(id);
    const cfg = getSchoolConfig(id) ?? {};
    const url = row.renderServiceUrl || cfg.renderServiceUrl;
    if (!url) return errorJson(res, 400, "renderServiceUrl is not configured for this school");
    if (!cfg.adminEmail || !cfg.adminPassword) {
      return errorJson(res, 400, "Admin credentials are not configured in devdash/.schools-config.json");
    }
    const token = await loginSchool(url, cfg.adminEmail, cfg.adminPassword);
    res.json(await activateSchoolLicense(url, token, row.key));
  }),
);

app.get(
  "/api/config",
  asyncHandler(async (_req, res) => {
    res.json(readSchoolsConfig());
  }),
);

app.post(
  "/api/config",
  asyncHandler(async (req, res) => {
    const current = readSchoolsConfig();
    const next = {
      renderApiKey: req.body?.renderApiKey ?? current.renderApiKey,
      schools: req.body?.schools ?? current.schools,
    };
    writeSchoolsConfig(next);
    res.json(next);
  }),
);

app.post(
  "/api/config/push",
  asyncHandler(async (req, res) => {
    const { licenseId, redeploy = true } = req.body ?? {};
    if (!licenseId) return errorJson(res, 400, "licenseId is required");

    const config = readSchoolsConfig();
    const apiKey = config.renderApiKey || process.env.RENDER_API_KEY;
    const schoolCfg = config.schools[licenseId];
    if (!schoolCfg) return errorJson(res, 404, `No config for licence ${licenseId}`);
    if (!schoolCfg.renderServiceId) {
      return errorJson(res, 400, "renderServiceId is not set for this school");
    }
    const pushed = await pushEnvToRender({
      apiKey,
      serviceId: schoolCfg.renderServiceId,
      envVars: schoolCfg.env ?? {},
    });
    let deploy = null;
    if (redeploy) {
      deploy = await triggerRenderDeploy({ apiKey, serviceId: schoolCfg.renderServiceId });
    }
    res.json({ pushed, deploy });
  }),
);

app.use((err, _req, res, _next) => {
  console.error("[devdash]", err.message);
  res.status(500).json({ error: err.message || "Internal error" });
});

async function start() {
  if (isProd) {
    const dist = path.join(__dirname, "dist");
    app.use(express.static(dist));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(dist, "index.html"));
    });
  } else {
    const { createServer } = await import("vite");
    const vite = await createServer({
      configFile: path.join(__dirname, "vite.config.js"),
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, HOST, () => {
    console.log(`Developer dashboard  http://${HOST}:${PORT}`);
    console.log("  Local only — do not expose this port to the network.");
  });
}

start();
