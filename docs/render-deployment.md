# Render deployment

The repo's `render.yaml` (in the project root) is a Render
["Blueprint"](https://render.com/docs/blueprint-spec) that defines three
services in one file — the backend API, the static frontend build, and a
scheduled backup job — so a fresh deploy is one Blueprint apply rather than
three services configured by hand.

## Prerequisites

Complete [google-sheets-setup.md](./google-sheets-setup.md) and
[google-drive-setup.md](./google-drive-setup.md) first — Render deployment
only wires the same credentials into a hosted environment, it doesn't
replace that setup.

## 1. Deploy the Blueprint

1. Push this repo to a GitHub/GitLab repository Render can access.
2. In the Render dashboard: New → Blueprint → connect the repository.
   Render reads `render.yaml` and proposes three services:
   - `library-mgmt-backend` — Node web service (Express API)
   - `library-mgmt-frontend` — static site (Vite build)
   - `library-mgmt-backup` — cron job (daily backup at 02:00 UTC)
3. Render will prompt for every environment variable marked
   `sync: false` in `render.yaml` before the first deploy — this is where
   you paste in the same `GOOGLE_*` credentials, `FRONTEND_URL`, and
   `VITE_API_BASE_URL`. `JWT_SECRET` and `SESSION_SECRET` are generated
   automatically (`generateValue: true`) — you don't need to supply those.

## 2. The two-URL chicken-and-egg step

The backend needs `FRONTEND_URL` (for CORS) and the frontend needs
`VITE_API_BASE_URL` (to know where the API lives), but neither URL exists
until the other service has deployed once. The straightforward path:

1. Deploy both services once with placeholder values (or leave them
   blank if Render allows it) — they'll come up but CORS/API calls won't
   work yet.
2. Once both are live, copy each service's actual Render URL
   (`https://library-mgmt-backend-xxxx.onrender.com` and
   `https://library-mgmt-frontend-xxxx.onrender.com`).
3. Set `FRONTEND_URL` on the backend service to the frontend's URL, and
   `VITE_API_BASE_URL` on the frontend service to `<backend URL>/api`.
4. Trigger a manual redeploy of both (env var changes alone don't
   rebuild a static site's already-built `dist/`, since `VITE_API_BASE_URL`
   is baked in at build time, not read at runtime).

## 3. Post-deploy: create the first admin

Render's web service shell (or a one-off job) can run the same
provisioning scripts used locally:

```
node scripts/setupSheets.js
node scripts/createSuperAdmin.js "Your Name" you@example.com "a-strong-password"
```

These only need the `GOOGLE_*` env vars already configured on the backend
service — run them from Render's Shell tab on the backend service, or run
them locally against the same `GOOGLE_SPREADSHEET_ID` before deploying
(the spreadsheet itself is the shared state, not the running process).

## 4. Verify

- `GET https://<backend>.onrender.com/api/health` → `{"status":"ok",
  "googleConfigured":true}`.
- Load the frontend URL, log in as the super admin created above.
- Settings → Backups panel should show the cron job's `last_run` once it
  has fired at least once (or trigger it manually with "Run backup now").

## Notes on the starter plan

- The backend web service is on Render's `starter` plan in `render.yaml`
  by default, which sleeps after a period of inactivity on the free tier
  and cold-starts on the next request — this is why backups run as a
  **separate cron job** (`library-mgmt-backup`) rather than in-process
  (`BACKUP_ENABLED=false` on the web service): a cron job runs on its own
  schedule independent of whether the web service happens to be awake.
- `SHEETS_READ_CACHE_TTL_MS` (default 4000ms) trades a small staleness
  window for far fewer Sheets API calls — relevant on Render because
  Sheets' per-minute quota is shared across every request the deployed
  instance makes, not just per-user.
