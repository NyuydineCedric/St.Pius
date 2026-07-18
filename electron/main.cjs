const { app, BrowserWindow } = require("electron");
const { spawn } = require("child_process");
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
//  - Dev: rely on system Java already being on PATH.
//  - Packaged: use the JRE bundled inside the app (resources/jre/bin/java.exe,
//    matching the folder jlink actually produced).
function resolveJavaBinary() {
  if (!isPackaged) return "java";
  return path.join(process.resourcesPath, "jre", "bin", "java.exe");
}

function startJavaBackend() {
  const javaBin = resolveJavaBinary();

  console.log("DEBUG USER_DATA_DIR:", USER_DATA_DIR);
  console.log("DEBUG PUBLIC_DIR:", PUBLIC_DIR);
  console.log("DEBUG BACKEND_DIR:", BACKEND_DIR);
  console.log("DEBUG javaBin:", javaBin);

  // No "shell: true" here — critical. With a shell, arguments are joined
  // into one string without escaping, so any path containing a space
  // (e.g. "C:\Users\Nyuydine Cedric\...") silently splits into multiple
  // arguments. Passing the args array directly to spawn keeps each
  // argument intact regardless of spaces.
  javaProcess = spawn(
    javaBin,
    ["com.reportcard.Main", USER_DATA_DIR, PUBLIC_DIR],
    { cwd: BACKEND_DIR },
  );

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
        .get("http://localhost:8080/api/health", (res) => {
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
    },
  });

  try {
    await waitForBackend();
    // Load through the backend itself (same origin as /api/*), not as a
    // file:// page — otherwise relative API calls won't resolve correctly.
    mainWindow.loadURL("http://localhost:8080");
  } catch (err) {
    console.error(err.message);
    mainWindow.loadURL(
      "data:text/html,<h2 style='font-family:sans-serif;padding:2rem'>Could not start the backend. Please try again.</h2>",
    );
  }
}

app.whenReady().then(() => {
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