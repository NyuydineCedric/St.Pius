const { app, BrowserWindow } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

let javaProcess = null;
let mainWindow = null;

const isPackaged = app.isPackaged;

// Per-user, writable location for the backend's data file. This works the
// same way across OSes (Windows: %APPDATA%, macOS: ~/Library/Application
// Support, Linux: ~/.config) and is NOT inside the installed app folder,
// since installed apps generally can't (and shouldn't) write next to
// themselves.
const USER_DATA_DIR = app.getPath("userData");

// Where the backend's compiled .class files live.
//  - Dev: straight from the project source tree.
//  - Packaged: from the extraResources folder electron-builder copies in
//    at build time (configured as "backend" under resources/).
const BACKEND_DIR = isPackaged
  ? path.join(process.resourcesPath, "backend")
  : path.join(__dirname, "..", "backend", "src", "main", "java");

// The built frontend (STATIC_DIR in Main.java defaults to "public"
// relative to the working directory, which we set to BACKEND_DIR below —
// so this just needs to exist at BACKEND_DIR/public in both dev and
// packaged layouts, matching Main.java's default).
const PUBLIC_DIR = path.join(BACKEND_DIR, "public");

// Path to the Java executable.
//  - Dev: system `java` on PATH.
//  - Packaged: prefer the OS-matched binary under resources/jre/bin/.
//    The repo currently ships a Windows jlink image (java.exe). Linux/mac
//    packages should replace `jre/` with a platform jlink output, or we
//    fall back to system Java.
function resolveJavaBinary() {
  if (!isPackaged) return "java";

  const binDir = path.join(process.resourcesPath, "jre", "bin");
  const candidates =
    process.platform === "win32"
      ? ["java.exe", "java"]
      : ["java", "java.exe"];

  for (const name of candidates) {
    const candidate = path.join(binDir, name);
    if (fs.existsSync(candidate)) return candidate;
  }

  console.warn(
    "[electron] Bundled JRE binary not found for",
    process.platform,
    "— falling back to system java on PATH. Bundle a matching jlink JRE under jre/ for offline installs.",
  );
  return "java";
}

// Optional cloud-sync config: if the admin fills in a Postgres connection
// string here, the desktop app connects directly to that shared database
// instead of its local file — so marks teachers enter online (on the
// hosted web app) show up here whenever this PC is online. Left blank,
// nothing changes: the app works exactly as before, fully offline.
const CLOUD_CONFIG_PATH = path.join(USER_DATA_DIR, "cloud-config.json");
const CLOUD_CONFIG_README_PATH = path.join(
  USER_DATA_DIR,
  "CLOUD-SYNC-README.txt",
);

function ensureCloudConfig() {
  try {
    if (!fs.existsSync(USER_DATA_DIR)) {
      fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(CLOUD_CONFIG_PATH)) {
      fs.writeFileSync(
        CLOUD_CONFIG_PATH,
        JSON.stringify(
          { syncServerUrl: "", syncEmail: "", syncPassword: "", databaseUrl: "" },
          null,
          2,
        ),
        "utf8",
      );
    }
    if (!fs.existsSync(CLOUD_CONFIG_README_PATH)) {
      fs.writeFileSync(
        CLOUD_CONFIG_README_PATH,
        [
          "Cloud Sync — Report Card Management System",
          "===========================================",
          "",
          "This app always stores its data on this PC, so it keeps working",
          "when the internet is down. To also share that data with the",
          "teachers' online system, fill in cloud-config.json in this folder:",
          "",
          "  {",
          '    "syncServerUrl": "https://your-backend.onrender.com",',
          '    "syncEmail": "admin@yourschool.cm",',
          '    "syncPassword": "your admin password"',
          "  }",
          "",
          "Then fully close and reopen the app. Whenever this PC is online it",
          "sends up what you have entered and pulls down what the teachers",
          "have entered. When it is offline you carry on as normal and it",
          "catches up later — Settings shows what is waiting to be sent.",
          "",
          "Leave syncServerUrl empty for a standalone, local-only install.",
          "",
          "NOTE: an older setting, \"databaseUrl\", made this PC talk straight",
          "to the database instead. That is no longer recommended: it stops",
          "working entirely without internet, and it puts the database",
          "password on this computer. Use the sync settings above.",
        ].join("\n"),
        "utf8",
      );
    }
  } catch (err) {
    console.error("[electron] Could not set up cloud-config.json:", err.message);
  }
}

function readCloudConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CLOUD_CONFIG_PATH, "utf8"));
    const str = (v) => (typeof v === "string" ? v.trim() : "");
    return {
      syncServerUrl: str(parsed.syncServerUrl),
      syncEmail: str(parsed.syncEmail),
      syncPassword: str(parsed.syncPassword),
      databaseUrl: str(parsed.databaseUrl),
    };
  } catch {
    return { syncServerUrl: "", syncEmail: "", syncPassword: "", databaseUrl: "" };
  }
}

function readCloudDatabaseUrl() {
  return readCloudConfig().databaseUrl;
}

// Locates the bundled Postgres JDBC driver (only needed when cloud-config's
// databaseUrl is set). Checked in both packaged and dev layouts.
function resolvePostgresJar() {
  const candidates = [
    isPackaged
      ? path.join(process.resourcesPath, "backend", "lib", "postgresql.jar")
      : null,
    path.join(__dirname, "..", "staging", "backend", "lib", "postgresql.jar"),
    path.join(BACKEND_DIR, "lib", "postgresql.jar"),
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function startJavaBackend() {
  const javaBin = resolveJavaBinary();
  const cloud = readCloudConfig();
  const databaseUrl = cloud.databaseUrl;
  const syncConfigured = Boolean(cloud.syncServerUrl && cloud.syncEmail && cloud.syncPassword);

  console.log("DEBUG USER_DATA_DIR:", USER_DATA_DIR);
  console.log("DEBUG PUBLIC_DIR:", PUBLIC_DIR);
  console.log("DEBUG BACKEND_DIR:", BACKEND_DIR);
  console.log("DEBUG javaBin:", javaBin);
  console.log(
    "DEBUG mode:",
    syncConfigured
      ? "local storage + sync to " + cloud.syncServerUrl
      : databaseUrl
        ? "direct database (legacy — no offline support)"
        : "local storage only",
  );
  if (syncConfigured && databaseUrl) {
    console.warn(
      "[electron] cloud-config.json has BOTH syncServerUrl and the legacy databaseUrl. Using sync and ignoring databaseUrl — talking straight to the database would give up offline support.",
    );
  }

  // Sync mode keeps this PC on its own local file store, so the Postgres
  // driver is only needed for the legacy direct-database mode.
  const pgJar = !syncConfigured && databaseUrl ? resolvePostgresJar() : null;
  if (databaseUrl && !pgJar) {
    console.warn(
      "[electron] cloud-config.json has a databaseUrl set, but the bundled Postgres driver was not found — falling back to local file storage.",
    );
  }

  const spawnArgs = [];
  if (pgJar) {
    spawnArgs.push("-cp", `.${path.delimiter}${pgJar}`);
  }
  spawnArgs.push("com.reportcard.Main", USER_DATA_DIR, PUBLIC_DIR);

  // Always keep this process bound to localhost only — cloud sync means
  // *this PC* reads/writes the shared database as a client, not that other
  // devices on the network can reach this PC's copy of the app.
  const spawnEnv = { ...process.env, BIND_HOST: "127.0.0.1" };
  if (syncConfigured) {
    // Local file store stays the source of truth; the backend syncs it up
    // and down in the background. This is what lets the app keep working
    // through an outage instead of stopping dead.
    spawnEnv.SYNC_SERVER_URL = cloud.syncServerUrl;
    spawnEnv.SYNC_EMAIL = cloud.syncEmail;
    spawnEnv.SYNC_PASSWORD = cloud.syncPassword;
    delete spawnEnv.DATABASE_URL;
  } else if (pgJar) {
    spawnEnv.DATABASE_URL = databaseUrl;
  }

  // No "shell: true" here — critical. With a shell, arguments are joined
  // into one string without escaping, so any path containing a space
  // (e.g. "C:\\Users\\Nyuydine Cedric\\...") silently splits into multiple
  // arguments. Passing the args array directly to spawn keeps each
  // argument intact regardless of spaces.
  javaProcess = spawn(javaBin, spawnArgs, { cwd: BACKEND_DIR, env: spawnEnv });

  javaProcess.stdout.on("data", (data) => {
    console.log(`[backend] ${data}`);
  });
  javaProcess.stderr.on("data", (data) => {
    console.error(`[backend] ${data}`);
  });
  javaProcess.on("error", (err) => {
    console.error("Failed to start Java backend:", err.message);
  });
}

// Poll the backend's health endpoint until it responds, then resolve.
function waitForBackend(retries = 30) {
  return new Promise((resolve, reject) => {
    const attempt = (remaining) => {
      http
        .get("http://127.0.0.1:8080/api/health", (res) => {
          if (res.statusCode === 200) resolve();
          else retryOrFail(remaining);
        })
        .on("error", () => retryOrFail(remaining));
    };
    const retryOrFail = (remaining) => {
      if (remaining <= 0) {
        reject(new Error("Backend did not start in time."));
        return;
      }
      setTimeout(() => attempt(remaining - 1), 500);
    };
    attempt(retries);
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1080,
    minHeight: 700,
    icon: path.join(__dirname, "..", "build", "icon.ico"),
    title: "Report Card Management System",
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  try {
    await waitForBackend();
    // Load through the backend itself (same origin as /api/*), not as a
    // file:// page — otherwise relative API calls won't resolve correctly.
    mainWindow.loadURL("http://127.0.0.1:8080");
  } catch (err) {
    console.error(err.message);
    mainWindow.loadURL(
      "data:text/html,<h2 style='font-family:sans-serif;padding:2rem'>Could not start the backend. Please try again.</h2>",
    );
  }
}

app.whenReady().then(() => {
  ensureCloudConfig();
  startJavaBackend();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (javaProcess) javaProcess.kill();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (javaProcess) javaProcess.kill();
});
