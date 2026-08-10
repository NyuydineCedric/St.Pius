# Cloud Sync setup — teachers online, admin on desktop

This lets teachers log in and enter marks from anywhere (home, phone,
mobile data), while the admin keeps using the familiar desktop app. Both
sides read and write the same live database, so nothing needs to be
manually synced or emailed around.

You'll set up three things (all free-tier friendly): a **Supabase**
database, the **backend** on Render (connected to that database), and the
**teacher website** on Vercel. Then you'll point the admin's desktop app at
the same Supabase database.

---

## 1. Push the latest code to GitHub

Render and Vercel both deploy straight from your GitHub repo, so make sure
everything is pushed first:

```
git add .
git commit -m "Add cloud sync support"
git push origin main
```

## 2. Create the database on Supabase

1. Go to [supabase.com](https://supabase.com) and sign in (GitHub login is easiest).
2. **New project** — give it a name (e.g. `st-pius`), set a database
   password (save this somewhere safe), pick the region closest to
   Cameroon, and create it. It takes a minute or two to provision.
3. Once it's ready, go to **Project Settings → Database → Connection
   string**. Choose the **URI** tab, and use the **Session pooler**
   connection string (recommended over the direct connection for a
   long-running backend like ours) — it looks like:
   ```
   postgresql://postgres.xxxxxxxx:[YOUR-PASSWORD]@aws-0-xxxx.pooler.supabase.com:5432/postgres
   ```
4. Replace `[YOUR-PASSWORD]` with the database password you set in step 2,
   and copy the full string. You'll paste this in two places below.

## 3. Deploy the backend to Render

1. Go to [render.com](https://render.com) and sign in (GitHub login is easiest).
2. Click **New +** → **Blueprint**, and pick your `St.Pius` repo. Render
   reads `render.yaml` and creates a web service (`st-pius-backend`) built
   from the `Dockerfile`. (This no longer creates its own database — you're
   using Supabase instead.)
3. Click **Apply** / **Create**, then open the new service's **Environment**
   tab and set:
   - `DATABASE_URL` = the Supabase connection string from step 2
   - `ALLOWED_ORIGIN` = your future Vercel URL (come back and fill this in
     after step 4 if you don't have it yet — just redeploy once you do)
4. Save, and let it redeploy. This takes a few minutes the first time.
5. Once deployed, open the service page and copy its public URL (something
   like `https://st-pius-backend.onrender.com`). Confirm it works by
   visiting `https://st-pius-backend.onrender.com/api/health` — you should
   see `{"status":"UP", ..., "storage":"postgres"}`.

## 4. Deploy the teacher website to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub.
2. **Add New** → **Project**, pick the same repo.
3. Vercel should auto-detect the Vite settings from `vercel.json`. Before
   deploying, add one environment variable:
   - `VITE_API_BASE_URL` = the Render backend URL from step 2 (e.g.
     `https://st-pius-backend.onrender.com`)
4. Click **Deploy**. Once done, copy the Vercel URL you're given (e.g.
   `https://st-pius.vercel.app`).
5. Go back to Render (step 3.3) and make sure `ALLOWED_ORIGIN` is set to
   this exact Vercel URL, then redeploy the backend service so the change
   takes effect.

Teachers now log in at your Vercel URL, from any device, anywhere.

## 5. Point the admin's desktop app at the same database

1. Rebuild the desktop app with the latest code:
   ```
   npm run dist
   ```
   Install/reinstall it as usual.
2. Open the app once (so it creates its config file), then close it.
3. Find `cloud-config.json` — the app also writes a
   `CLOUD-SYNC-README.txt` right next to it telling you exactly where that
   is on this PC. Open `cloud-config.json` in Notepad and paste in the same
   Supabase connection string from step 2:
   ```json
   { "databaseUrl": "postgresql://postgres.xxxxxxxx:yourpassword@aws-0-xxxx.pooler.supabase.com:5432/postgres" }
   ```
4. Restart the app. Go to **Settings** — the "Cloud Sync" card should now
   show **ON**. From now on, whenever this PC is online, it reads and
   writes the exact same data teachers submit through the website.

If you ever want the desktop app to go back to fully offline/local mode,
set `"databaseUrl"` back to `""` and restart.

## 6. Log in

**Create the admin account first, before anyone else signs up.** The backend
no longer seeds a built-in admin: it used to create the same well-known
`stpius@gmail.com` login on every startup, which meant every deployment
shipped with identical publicly-documented credentials, and a school that
changed the password had it silently reset on the next restart.

Two ways to create it:

- **Just register it.** Open your Vercel URL, click **Sign up**, and create
  the account. The first account ever created becomes the admin.
- **Or set it from Render**, useful if teachers might reach the site first.
  On the backend service's **Environment** tab add `BOOTSTRAP_ADMIN_EMAIL`
  and `BOOTSTRAP_ADMIN_PASSWORD`, then redeploy. These apply only when no
  admin exists yet and never overwrite an existing account, so it is safe to
  leave them set — though clearing them afterwards is tidier.

Once the admin exists, teachers register themselves at the Vercel URL
(**Sign up** on the login page) and come through as teachers.

> If a teacher registers before you create the admin, **that teacher's
> account becomes the admin.** Create yours first.

---

## Notes

- Render's free tier sleeps after inactivity — the first request after a
  while can take ~30–60 seconds to wake up. This is normal.
- The desktop app never opens itself up to the network in cloud mode — it
  only reads/writes the database as a client, so nothing else on the
  admin's network can reach it.
- Back up regularly: even in cloud mode, use **Settings → Data Backup** on
  the desktop app (this downloads a live snapshot pulled from the shared
  database), or use Supabase's own database backup features under
  **Database → Backups**.
