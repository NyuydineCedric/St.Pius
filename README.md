# Report Card Management System

Desktop and web app for Anglophone secondary-school report cards (Forms 1–5, Lower/Upper Sixth): students, marks, teachers, and printable report cards.

**Stack:** React (Vite) + Java HTTP API + optional Electron shell. Storage is a local file (desktop) or PostgreSQL when `DATABASE_URL` is set (cloud).

---

## Quick start (web UI + API)

Needs **Node 20+** and **JDK 21+** (`java` / `javac` on PATH).

```bash
# 1. Install frontend deps
npm install

# 2. Compile & run the backend (listens on 127.0.0.1:8080 by default)
./scripts/start-backend.sh

# 3. In another terminal — Vite proxies /api → :8080
npm run dev
```

Open the Vite URL (usually `http://localhost:5173`).

**First account:** register once — it becomes the **admin**. Later public signups are teachers only.

### Demo data (recommended for walkthroughs)

With the backend running:

```bash
npm run seed:demo
```

This **replaces** students, classes, teachers, and marks with a GBHS Bamenda sample set (Sequences 1–4 filled). Login accounts:

| Role | Email | Password |
| ---- | ----- | -------- |
| Admin | `admin@gbhs-demo.cm` | `DemoAdmin123!` |
| Teacher | `teacher@gbhs-demo.cm` | `DemoTeacher123!` |

Try **Report Cards → Form 4A** after seeding. Re-run anytime to reset the demo.

---

## Electron (desktop)

```bash
# Build the UI, stage backend classes + public assets, then run Electron
npm run build
./scripts/stage-backend.sh
npm run electron
```

Packaged Windows installer:

```bash
./scripts/stage-backend.sh
npm run dist
```

Output lands in `release/`.

### Bundled JRE note

The `jre/` folder in this repo is a **Windows** jlink image (`java.exe`). Electron resolves:

| Platform | Packaged binary |
| -------- | --------------- |
| Windows  | `resources/jre/bin/java.exe` |
| Linux/mac | `resources/jre/bin/java`, else system `java` on PATH |

For offline Linux/mac installers, replace `jre/` with a matching jlink runtime before `npm run dist`.

---

## Docker (API / cloud)

```bash
docker build -t report-card-api .
docker run --rm -p 8080:8080 \
  -e DATABASE_URL="jdbc:postgresql://…" \
  -e ALLOWED_ORIGIN="https://your-frontend.example" \
  -v report-card-data:/app/data \
  report-card-api
```

- Runs as non-root user `app`
- `HEALTHCHECK` hits `/api/health`
- Binds `0.0.0.0` via `BIND_HOST`
- Persist `/app/data` if using file storage (no `DATABASE_URL`)

For a separate SPA host, set `VITE_API_BASE_URL` at frontend build time and `ALLOWED_ORIGIN` on the API.

---

## Environment variables

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `PORT` | `8080` | HTTP port |
| `BIND_HOST` | `127.0.0.1` (desktop) / `0.0.0.0` if `DATABASE_URL` or set explicitly | Listen address |
| `DATABASE_URL` | unset | Postgres URL → `PostgresDataStore`; else file store |
| `DATA_DIR` | `.` | Directory for `backend-data.ser` (+ `.bak`) |
| `ALLOWED_ORIGIN` | localhost origins only | CORS allowlist for cross-origin web |
| `VITE_API_BASE_URL` | `http://localhost:8080` (prod build) | Frontend API base when not same-origin |

---

## Auth model (shipping)

- Passwords: PBKDF2-HMAC-SHA256 (legacy plaintext upgraded on login)
- Session: Bearer token from `POST /api/login` (stored client-side)
- Data APIs require `Authorization: Bearer …`
- Teachers may **write** marks only for assigned class/subject (staff email must match login)
- Admins manage students, teachers, settings, class masters

Public: `/api/health`, `/api/auth/status`, `/api/login`, `/api/register`.

---

## Project layout

```
src/                 React app
electron/main.cjs    Desktop shell (spawns Java)
backend/.../Main.java  HTTP API + file/Postgres storage
jre/                 Bundled runtime (currently Windows)
scripts/             Dev helpers
Dockerfile           API image
shipping-readiness.md  Gate checklist
```

---

## Scripts

| Command | What it does |
| ------- | ------------ |
| `npm run dev` | Vite frontend |
| `npm run build` | Production frontend → `dist/` |
| `npm run electron` | Launch Electron (expects staged backend) |
| `npm run dist` | electron-builder package |
| `npm run backend` | Compile + run Java API |
| `npm run seed:demo` | Load GBHS Bamenda demo students/marks (backend must be up) |
| `./scripts/start-backend.sh` | Same as `npm run backend` |
| `./scripts/stage-backend.sh` | Build UI into staging for Electron |

---

## Security notes

- Desktop binds **localhost** so the LAN cannot hit the API by default.
- Do not deploy publicly without `ALLOWED_ORIGIN` and TLS at the reverse proxy.
- See `shipping-readiness.md` for the remaining packaging / ops checklist.

## Demo credentials 
 Admin    admin@gbhs-demo.cm  /  DemoAdmin123!
 Teacher  teacher@gbhs-demo.cm  /  DemoTeacher123!