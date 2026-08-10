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
| Admin | `stpius@gmail.com` | `stpius123@` |
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
| `BOOTSTRAP_ADMIN_EMAIL` | unset | First-boot admin email. Applied **only** if no admin exists |
| `BOOTSTRAP_ADMIN_PASSWORD` | unset | First-boot admin password (required alongside the email) |
| `BOOTSTRAP_ADMIN_NAME` | `Admin` | Display name for the bootstrap admin |
| `DB_POOL_SIZE` | `8` | Max pooled Postgres connections. Keep low on Supabase free tier |
| `HTTP_THREADS` | `16` | Concurrent request handlers |
| `LICENSE_KEY` | unset | Licence key. Falls back to `license.key` in the data dir |
| `LICENSE_SERVER_URL` | unset | Optional revocation check. Unset = offline verification only |
| `ALLOW_DEMO_SEED` | unset | Enables `/api/demo/seed`, which **erases all academic data** |

> Leave the `BOOTSTRAP_ADMIN_*` vars unset for a school deployment — the first
> account registered through the UI becomes the admin. They exist for automated
> and demo deploys, are ignored once an admin account exists, and never
> overwrite an existing password.

---

## Auth model (shipping)

- Passwords: PBKDF2-HMAC-SHA256 (legacy plaintext upgraded on login)
- Session: Bearer token from `POST /api/login` (stored client-side)
- Data APIs require `Authorization: Bearer …`
- Teachers may **write** marks only for assigned class/subject (staff email must match login)
- Admins manage students, teachers, settings, class masters

Public: `/api/health`, `/api/auth/status`, `/api/login`, `/api/register`.

---

## Licensing

Licences are **Ed25519-signed tokens**, so a school's copy verifies without
reaching any server — their term's report cards must not depend on the internet
being up.

### Managing licences (you, not the school)

```bash
node scripts/license.mjs keygen                                  # once, ever
node scripts/license.mjs issue --school "St. Pius College" --days 365
node scripts/license.mjs list            # every licence issued, state, expiry
node scripts/license.mjs show <LIC-ID>   # re-print a key you already issued
node scripts/license.mjs revoke <LIC-ID> # mark revoked (see caveat below)
node scripts/license.mjs inspect <key>   # decode any key
```

Everything lives in `license-keys/` (gitignored):

| File | What it is |
| ---- | ---------- |
| `license-private.pem` | Signing key. **Back this up.** Lose it and you can never issue another licence that existing installs accept |
| `license-public.pem` | Public half, compiled into `License.java` |
| `issued.json` | Ledger of every licence handed out — who, when, expiry, revoked |

The ledger is bookkeeping only; licences are self-contained and verify without
it. It exists so you can answer "who has what, and when does it lapse?".

`list` flags anything expiring within 30 days — worth running before each term.

**Revocation is not live yet.** Because licences verify offline by signature,
`revoke` only marks the ledger. It takes effect once something serves that
ledger at `/api/license/status` and the school's install sets
`LICENSE_SERVER_URL`. Until then a key works until its expiry date, so keep
pilot licences short rather than relying on being able to pull one back.

A school installs the key by pasting it into Settings (`POST /api/license/activate`),
or via `LICENSE_KEY` / a `license.key` file in the data directory. Activation
takes effect immediately, no restart.

**Unlicensed and expired installs go read-only, not dark.** Reads, report-card
printing and `GET /api/backup` all keep working; only writes return `402`. A
school that lapses mid-term can still get at — and export — its own records.
Withholding a school's data is never the lever.

If `LICENSE_SERVER_URL` is set, licences are also checked for revocation. That
check fails *open*: an unreachable server leaves the licence alone, since "we
couldn't ask" must not mean "denied".

## Offline-first sync (desktop)

The desktop app always reads and writes **its own local file**, so a school
whose internet is out keeps working normally. When a connection is available it
syncs that data with the shared server.

Configure it in `cloud-config.json` (the app writes one next to its data and
tells you where):

```json
{
  "syncServerUrl": "https://your-backend.onrender.com",
  "syncEmail": "admin@yourschool.cm",
  "syncPassword": "…"
}
```

Equivalent env vars for a non-Electron run: `SYNC_SERVER_URL`, `SYNC_EMAIL`,
`SYNC_PASSWORD`.

- Syncs every 5 minutes, plus **Settings → Sync → Sync Now**
- Settings shows last-synced time and how many changes are waiting
- Being offline is not an error — changes queue and go up later

**Conflicts** resolve last-write-wins per record, and marks merge per
`(year, class, subject, sequence, student)` cell, so two teachers entering
different subjects never collide. Client timestamps are honoured for ordering
but clamped to the server's clock: a PC with a fast clock would otherwise stamp
changes into the future and re-sync them forever.

**Deletes travel as tombstones** (`deleted_at`) kept for 180 days. A row that
simply vanished would be re-created by any device that was offline when it
happened.

> The older `databaseUrl` setting, which pointed the desktop straight at
> Postgres, is superseded. It stops working entirely without internet and puts
> database credentials on the school's PC. Sync mode replaces it; if both are
> set, sync wins.

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

Created **only** by `npm run seed:demo` (or a `BOOTSTRAP_ADMIN_*` bootstrap on an
empty store) — never seeded automatically into a real deployment.

 Admin    stpius@gmail.com  /  stpius123@
 Teacher  teacher@gbhs-demo.cm  /  DemoTeacher123!

**Do not ship a build to a school with these accounts present.**