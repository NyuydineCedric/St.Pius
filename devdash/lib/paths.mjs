import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "../..");
export const KEY_DIR = path.join(REPO_ROOT, "license-keys");
export const PRIVATE_KEY_PATH = path.join(KEY_DIR, "license-private.pem");
export const PUBLIC_KEY_PATH = path.join(KEY_DIR, "license-public.pem");
export const LEDGER_PATH = path.join(KEY_DIR, "issued.json");
export const SCHOOLS_CONFIG_PATH = path.join(REPO_ROOT, "devdash", ".schools-config.json");
export const SCHOOLS_CONFIG_EXAMPLE = path.join(REPO_ROOT, "devdash", ".schools-config.example.json");
