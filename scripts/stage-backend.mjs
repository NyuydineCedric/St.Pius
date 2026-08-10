#!/usr/bin/env node
// Stage compiled backend + Vite dist for Electron packaging (extraResources).
//
// Pure Node (no bash) so this runs the same way on Windows, macOS, and
// Linux — Windows users don't need Git Bash / WSL just to build the
// installer, only Node and a JDK (javac) on PATH.
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  rmSync,
  cpSync,
  writeFileSync,
  readdirSync,
  statSync,
  createWriteStream,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "backend", "src", "main", "java");
const STAGE = path.join(ROOT, "staging", "backend");

function findJavaFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      findJavaFiles(full, out);
    } else if (entry.endsWith(".java")) {
      out.push(full);
    }
  }
  return out;
}

mkdirSync(STAGE, { recursive: true });

const sources = findJavaFiles(SRC);
if (sources.length === 0) {
  console.error(`No .java files found under ${SRC}`);
  process.exit(1);
}

// Each path is quoted and forward-slashed: javac's @argfile parser treats
// backslash as an escape character (mangling ordinary Windows paths), and
// unquoted paths break the moment a folder name contains a space — e.g.
// "C:\Users\Nyuydine Cedric\...", which is a completely normal Windows path.
const sourcesFile = path.join(STAGE, "sources.txt");
writeFileSync(
  sourcesFile,
  sources.map((f) => `"${f.split(path.sep).join("/")}"`).join("\n"),
);

console.log("Compiling backend…");
execSync(`javac -d "${STAGE}" @"${sourcesFile}"`, {
  stdio: "inherit",
  cwd: ROOT,
});
rmSync(sourcesFile, { force: true });

// Always rebuild the frontend fresh for a packaged installer — shipping a
// stale UI bundle to real users is a much worse failure mode than the
// extra ~10s a full `vite build` costs here.
console.log("Building frontend…");
execSync("npm run build", { cwd: ROOT, stdio: "inherit" });

const distDir = path.join(ROOT, "dist");
if (!existsSync(distDir)) {
  console.error(`Frontend build did not produce ${distDir}`);
  process.exit(1);
}

const publicDir = path.join(STAGE, "public");
rmSync(publicDir, { recursive: true, force: true });
mkdirSync(publicDir, { recursive: true });
cpSync(distDir, publicDir, { recursive: true });

// Bundle the Postgres JDBC driver so the desktop app can optionally connect
// straight to a school's cloud database (see electron/main.cjs's
// cloud-config.json support) — same jar/version the Docker image downloads.
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          downloadFile(res.headers.location, dest).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed (${res.statusCode}): ${url}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", (err) => {
        file.close();
        reject(err);
      });
  });
}

const libDir = path.join(STAGE, "lib");
mkdirSync(libDir, { recursive: true });
const pgJar = path.join(libDir, "postgresql.jar");
if (!existsSync(pgJar)) {
  console.log("Downloading Postgres JDBC driver…");
  try {
    await downloadFile(
      "https://repo1.maven.org/maven2/org/postgresql/postgresql/42.7.5/postgresql-42.7.5.jar",
      pgJar,
    );
  } catch (err) {
    console.warn(
      `Could not download Postgres JDBC driver (${err.message}). Cloud-sync mode won't work in this build; local file storage is unaffected.`,
    );
  }
}

console.log(`Staged backend at ${STAGE}`);
console.log("  classes + public/ + lib/ ready for electron-builder extraResources");
