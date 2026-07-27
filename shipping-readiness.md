# Shipping readiness

School Report Card System · senior gate review · Jul 2026

> **P0–P2 code work is in.** Verify locally before putting real student PII on a shared machine. Public web still needs TLS + `ALLOWED_ORIGIN` + managed Postgres.

| Target     | Status | Notes |
| ---------- | ------ | ----- |
| Local demo | OK     | `npm run backend` + `npm run dev` |
| Desktop    | OK*    | `*` Windows JRE bundled; Linux/mac need matching `jre/` or system Java |
| Public web | Careful | Set `ALLOWED_ORIGIN`, `DATABASE_URL`, reverse-proxy TLS |

---

## Ship plan

### P0 — done

- [x] PBKDF2 passwords; Bearer sessions; auth on data APIs
- [x] Registration lockdown (first admin bootstrap)
- [x] Localhost bind + tightened CORS
- [x] Server-side marks RBAC

### P1 — done

- [x] Atomic file save + `.bak`; max-based IDs; Postgres transactions
- [x] Clearable marks; missing ≠ 0 on reports
- [x] Student update/delete API + UI
- [x] Scale-aware council thresholds; `/dashboard` redirect

### P2 — done

- [x] Per-OS Electron Java resolution (+ system fallback)
- [x] Docker non-root user + `HEALTHCHECK` + data volume
- [x] Real `README.md`, `.env.example`, `scripts/start-backend.*`, `stage-backend.sh`

### Still verify before school pilot

- [ ] Smoke-test register → login → students → marks → report card end-to-end
- [ ] Package Windows installer on a Windows machine with the bundled JRE
- [ ] For Linux/mac installers: produce a platform jlink JRE under `jre/`
- [ ] Confirm teacher email matches staff Teacher record for marks write

### What already looks solid

- Admin/teacher domain model (Forms, streams, coefficients)
- Dual storage (file vs Postgres via `DATABASE_URL`)
- Static path traversal guard + SPA fallback
