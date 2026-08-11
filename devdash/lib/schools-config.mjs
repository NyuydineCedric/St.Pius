import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { SCHOOLS_CONFIG_PATH } from "./paths.mjs";

const DEFAULT = {
  renderApiKey: "",
  schools: {},
};

export function readSchoolsConfig() {
  if (!existsSync(SCHOOLS_CONFIG_PATH)) return structuredClone(DEFAULT);
  try {
    const raw = JSON.parse(readFileSync(SCHOOLS_CONFIG_PATH, "utf8"));
    return {
      renderApiKey: raw.renderApiKey ?? "",
      schools: raw.schools ?? {},
    };
  } catch {
    throw new Error(`${SCHOOLS_CONFIG_PATH} is corrupt`);
  }
}

export function writeSchoolsConfig(config) {
  mkdirSync(path.dirname(SCHOOLS_CONFIG_PATH), { recursive: true });
  writeFileSync(SCHOOLS_CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  return config;
}

export function getSchoolConfig(licenseId) {
  const config = readSchoolsConfig();
  return config.schools[licenseId] ?? null;
}

export function upsertSchoolConfig(licenseId, patch) {
  const config = readSchoolsConfig();
  config.schools[licenseId] = {
    ...(config.schools[licenseId] ?? {}),
    ...patch,
  };
  writeSchoolsConfig(config);
  return config.schools[licenseId];
}
