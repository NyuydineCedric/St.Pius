# Shipping architecture plan

School Report Card System · pilot distribution to schools · Aug 2026

Companion to [`shipping-readiness.md`](../shipping-readiness.md), which tracks the
gate checklist. This document covers the five areas raised before the school
pilot: licensing, remote Supabase database, Supabase Storage for images,
backup/restore, and general production readiness.

## Decisions taken

| Area | Decision |
| ---- | -------- |
| Tenancy | One Supabase project per school |
| Desktop | Offline-first, local store is source of truth, syncs when online |
| Licensing | Online activation + periodic revalidation |
| Supabase plan | Free tier |

---

## 0. Reconciling with the `cloud-sync` branch

Commit `b10d82c` ("Add cloud sync support") landed while this plan was being
written. It ships a working cloud mode, but its design differs from the
decisions above in three ways that need settling between both developers before
more is built on top.

**a. It takes the direct-DB approach that was ruled out.** The admin's desktop
pastes a Supabase connection string into `cloud-config.json`
([electron/main.cjs:66](../electron/main.cjs#L66)) and the local Java process
connects straight to Postgres. That puts full database credentials in plaintext
on a school secretary's PC — anything running as that user can read or drop the
entire school's data, and there is no revocation short of rotating the password
on every installed machine. The chosen design routes the desktop through the
hosted API instead, so credentials never leave the server.

**b. It is live-shared, not offline-first.** In cloud mode the desktop reads and
writes the remote DB directly, so it stops working entirely when the internet
does — the opposite of the offline-first decision. There is no local cache, no
queue, and no sync engine; "sync" here means "both sides use the same database".

**c. `CLOUD-SYNC-SETUP.md` step 6 depends on the removed admin backdoor.** It
states the admin login is "created automatically the first time either side
connects". That auto-seeding is gone (section 6.1). The doc needs updating to
either the register-first-account flow or a one-time `BOOTSTRAP_ADMIN_*` env var.

### Two defects in the new backup feature

**Remote code execution in `/api/backup/restore`.** The handler calls
`ObjectInputStream.readObject()` on uploaded bytes
([Main.java:1201-1202](../backend/src/main/java/com/reportcard/Main.java#L1201-L1202)).
Java deserialization of untrusted input is a well-known RCE vector, and the
"validation" *is* the dangerous call — the `instanceof Map` check happens after
the object graph has already been constructed. Being admin-gated reduces the
blast radius but does not close it: an admin tricked into restoring a mailed
"backup" file executes arbitrary code on the machine. Fix by moving backups to a
plain data format (JSON), not Java serialization.

**Backup silently does nothing in cloud mode — the mode that needs it most.**
`PostgresDataStore.getBackupFile()` returns `null`, so `/api/backup` returns HTTP
400. The Settings card renders the button unconditionally
([Settings.jsx:763](../src/pages/admin/Settings.jsx#L763)), so the admin sees
"Download Backup", clicks it, and gets an error saying backups "aren't needed
here — this server stores data in a managed database". On the free tier that
database has **no automated backups and no PITR**, so the reassurance is exactly
backwards: cloud mode is the configuration with no backup at all.
`CLOUD-SYNC-SETUP.md` also promises this path works ("downloads a live snapshot
pulled from the shared database"). It does not.

Section 4 below is the intended replacement.

---

## 0b. Measured latency to Supabase (eu-central-1)

Taken from the actual pilot project, on the connection this was developed over:

| Operation | Cost |
| --------- | ---- |
| Opening a new database connection | **6–11 s** |
| A trivial query on a warm connection | ~700–800 ms |
| `isValid()` liveness check | ~700 ms (a full round trip) |

These numbers drive several decisions above and should be re-checked from a
school's actual connection before the pilot:

- **Pooling is not an optimisation here, it is the difference between usable
  and unusable.** Per-request connections cost 3s+ each; pooled warm requests
  land at 0.7–0.9s.
- **The per-request account re-check had to be cached.** At ~700ms it was the
  single largest cost on every authenticated call.
- **This is the strongest argument for offline-first.** Even with everything
  tuned, a live-shared cloud mode gives a teacher roughly one second per
  interaction on a good connection, and no app at all on a bad one. Marks entry
  is a rapid, repetitive task — that is exactly the workload a remote round trip
  per keystroke-batch serves worst.

---

## 1. Two conflicts to resolve before building

### 1.1 "One project per school" does not fit the free tier

Supabase's free plan allows **two active projects per organization**, and free
projects **pause after 7 days of inactivity**. Both limits hit this plan directly:

- A pilot with more than two schools cannot run on free-tier projects at all.
- A paused project takes a school's web access down mid-term. The `keep_alive`
  table already in the schema suggests this has been fought before.

Realistic options:

1. **Pilot at 2 schools on free tier.** Works today, no schema change. Costs
   nothing. Does not extend past two schools.
2. **Pro plan per project** (~$25/project/month). Adds daily backups and 7-day
   PITR, which removes most of section 4's work. Cost scales linearly per school.
3. **Revisit tenancy** — schema-per-school, or `school_id` on every table, on a
   single project.

**Recommendation:** run the pilot on option 1, but build the tenant indirection
described in 1.3 now. That keeps the door open to option 3 without rewriting
handlers later.

### 1.2 Sequential IDs make offline-first sync unsafe

Both stores generate primary keys as `max + 1`:

- `FileDataStore` produces `SPXCC0042` ([Main.java:1654](../backend/src/main/java/com/reportcard/Main.java#L1654))
- `PostgresDataStore` produces `SPXCC-0042` ([Main.java:2341](../backend/src/main/java/com/reportcard/Main.java#L2341))

Three consequences:

- Two devices working offline both mint `SPXCC0042` for **different** students.
  On sync they collide, and because marks are keyed by student ID, one student's
  marks silently land on another's report card. This is a data-corruption bug,
  not a merge inconvenience.
- The same logical record gets a different ID depending on which store created
  it, so local and remote records cannot be matched.
- `nextPrefixedId` runs `SELECT id FROM students` — a full table scan on every
  single insert.

**Offline-first sync cannot ship on sequential IDs.** UUID primary keys are a
prerequisite, covered in section 5.

### 1.3 Tenant registry

Even with one project per school, run **one** backend deployment rather than one
per school. A small control-plane database (its own Supabase project) holds:

```
schools(id, name, license_key, database_url_encrypted,
        storage_bucket, status, expires_at, created_at)
```

The backend resolves session → school → a pooled `DataStore` for that school's
project. This unifies licensing, provisioning, and tenancy behind one mechanism,
and it is the seam that makes a future move to schema-per-school cheap.

Onboarding a school becomes: provision project → run schema → insert registry
row → issue license key. Worth a `scripts/provision-school.mjs` once the shape
settles.

---

## 2. Licensing

**Model:** online activation, server-authoritative, with an offline grace period.

- Control plane issues a license key per school (expiry, seat/feature limits).
- `POST /api/license/activate {key, deviceId, schoolName}` validates the key and
  returns an **Ed25519-signed token** carrying school ID, expiry, and features.
- The desktop app stores the token and revalidates every 7 days. If it cannot
  reach the server, it keeps working for a **30-day grace window** — schools with
  unreliable internet must not be locked out by a failed check.
- The server independently checks license status on every API request. A
  client-side check alone is trivially bypassed; the server check is the one that
  counts.

**On expiry, degrade to read-only rather than locking out.** A hard lockout
mid-term means a school cannot print the report cards it has already entered —
that turns a billing problem into a crisis for them and a support crisis for you.
Read-only plus a prominent banner keeps the pressure without the hostage-taking.

Verification must be against a bundled **public** key. Never ship the signing key
in the installer.

---

## 3. Supabase Storage for images

Today photos are base64 data URLs in a TEXT column ([Main.java:1126](../backend/src/main/java/com/reportcard/Main.java#L1126)),
and the same applies to `principal_stamp` and `principal_signature` in `settings`.

**Target layout** — private bucket, since student photos are minors' PII:

```
students/{studentId}.jpg
school/stamp.png
school/signature.png
```

- The DB stores the object **path**, not the bytes.
- Web clients get short-lived **signed URLs** minted by the Java backend using the
  service-role key. The service key never reaches the browser or the installer.
- Offline: the photo is written to a local cache directory first and uploaded on
  the next sync, so photo capture works with no connection.
- A one-time migration walks existing data-URL photos into Storage. It must be
  idempotent and must not delete the source column until the migration is
  verified.

This is also what fixes the payload problem in 6.2.

---

## 4. Backup and restore

Free tier has **no automated backups and no point-in-time recovery**. Everything
here is ours to build.

- **Nightly logical export** of all tables to compressed JSON, per school.
- **Store backups outside the project they back up.** A backup living only in the
  same Supabase project dies with it — project deletion or an account issue takes
  both. Send them to the control-plane project's storage or an unrelated object
  store.
- **Retention:** 30 daily + 12 monthly.
- **Admin UI:** "Download backup" gives the school a file they own and can keep
  themselves — the most valuable single feature here for a pilot. "Restore from
  backup" is admin-only, destructive, and should require typing the school name
  to confirm.
- The desktop `.ser` file is already a natural offline backup; expose it as
  Export / Import.

**Test the restore path on real data before the pilot.** An untested backup is
not a backup, and this is the area where a failure costs a school a full term of
marks.

---

## 5. Offline-first sync

The most expensive item here. Sequence it last, after sections 1–4 and 6 are done.

**Prerequisite — identity split. DONE (students).**

Implemented more surgically than originally written here. Rather than re-keying
existing rows — which would mean rewriting every mark that points at them, on
live data, for no safety gain — the split is:

- `students.id` is a **UUID for every record created from now on**. Rows that
  predate the change keep their old id: they are already unique within their own
  store, and the collision risk only ever applied to *newly created* records,
  which is exactly what this fixes.
- `students.code` is the human-readable `SPXCC0042`, still sequential,
  backfilled from the old id for existing rows. This is what appears on rosters,
  report cards and student cards; nothing references a student by it.

Numbering continues uninterrupted because the code generator scans the `code`
column and accepts both historic shapes (`SPXCC-0042` and `SPXCC0042`).

Verified end to end against the live database: three new students got three
distinct UUIDs and codes `SPXCC-0001..0003`, marks keyed correctly on the UUID,
and a backup round-tripped both fields.

**Still outstanding for `teachers`** — teacher ids are still sequential
(`TCH-0001`), so two devices creating staff offline would collide. Users are
matched by email during a restore, so they need no change.

**Per-row sync metadata:** `updated_at` (server-authoritative), `deleted_at`
tombstone, `origin_device`.

**Protocol:** `POST /api/sync {since, changes[]}` → server merges, returns
`{serverTime, changes[]}`. The client stores `serverTime` as its next cursor —
**never** its own clock, or device skew silently drops changes.

**Conflict resolution — last-write-wins per record**, with two refinements:

- `settings` merges **per field**, so two admins editing different settings do not
  clobber each other.
- `marks` merge per `(year, class, subject, sequence, student)` cell. Real
  conflicts are rare because teachers are already partitioned by class and
  subject — which is why full CRDTs are not worth their complexity here.

Tombstones are retained for at least the maximum offline window (90 days) before
vacuuming, or a delete that happened while a laptop was offline will resurrect on
reconnect.

**Sync status UI:** last synced, pending change count, manual "Sync now", and a
visible conflict log. Silent sync is how schools lose trust in the tool.

---

## 6. Production readiness

Independent of every decision above.

### 6.1 Blockers

- **Hardcoded admin backdoor.** [Main.java:131](../backend/src/main/java/com/reportcard/Main.java#L131)
  re-seeds `stpius@gmail.com` / `stpius123@` as admin on *every* boot. Every
  school gets the same credentials, they are published in the README, and a
  school that changes the password has it reset on next restart. Must become an
  env-driven, first-boot-only bootstrap.
- **No connection pooling.** `DriverManager.getConnection()` per operation across
  32 call sites. Against remote Supabase this is a TLS handshake per request and
  will exhaust connection limits under a handful of users. Needs a pool plus
  Supabase's transaction pooler — and with that pooler, pgjdbc requires
  `prepareThreshold=0`.
- **In-memory sessions** ([Main.java:254](../backend/src/main/java/com/reportcard/Main.java#L254)).
  Any restart logs everyone out, and a second instance cannot share them — this
  is the hard cap on horizontal scaling.
- **`GET /api/students` returns every student with photo inline**
  ([Main.java:598](../backend/src/main/java/com/reportcard/Main.java#L598)).
  1,000 students ≈ 50MB per page load, and about the same in the DB against free
  tier's 500MB limit.
- **Demo seed endpoint** must be compiled out or hard-disabled in production
  builds, not merely key-guarded.

### 6.2 Should fix before the pilot

- No indexes beyond primary keys — none on `students(class_name)` or the marks
  lookup path.
- No rate limiting on `/api/login`; brute force is unimpeded.
- No structured logging or request IDs, which makes supporting a remote school
  hard.
- Security headers and HTTPS enforcement at the edge.
- Schema is one large idempotent DDL string; move to versioned migration files
  before multiple schools are on different versions.

### 6.3 Testing

There is one 25-line test file. Before schools depend on this for end-of-term
report cards, the marks → average → rank → report card path needs real coverage.
That calculation chain is the part where a silent bug is both most likely and
most damaging.

---

## Suggested sequence

1. **P0 blockers** (6.1) — decision-independent, needed under every option.
2. **Tenant registry + licensing** (1.3, 2) — unblocks distribution.
3. **Storage migration** (3) — also fixes the payload blocker.
4. **Backup/restore** (4) — before real student data exists, not after.
5. **UUID migration** (5 prerequisite) — breaking change, do it before schools
   accumulate data.
6. **Offline-first sync** (5).

Steps 1–4 make a supervised pilot safe. Step 6 is what makes the desktop app
genuinely offline, and it is the largest single piece of work in this document.
