# Google Sheets setup

The app uses a single Google Spreadsheet as its primary data store — every
"table" (Students, Floors, Seats, Monthly_Billing, and so on) is one tab,
with columns defined centrally in `backend/src/config/sheetsSchema.js`.
This is the one-time setup to get from an empty Google account to a
spreadsheet the backend can read and write.

## 1. Create a Google Cloud project and service account

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and
   create a new project (or reuse an existing one).
2. Enable the **Google Sheets API** and **Google Drive API** for that
   project (APIs & Services → Library → search each by name → Enable).
3. Create a service account: APIs & Services → Credentials → Create
   Credentials → Service account. Any name is fine (e.g.
   `library-mgmt-service`).
4. Open the service account, go to the **Keys** tab, Add Key → Create new
   key → JSON. This downloads a JSON file — you'll pull three fields out
   of it in step 3 below. Keep this file private; it's a credential, not
   something to commit.

## 2. Create the spreadsheet and share it with the service account

1. Create a new blank Google Sheet in your own Google Drive.
2. Copy its spreadsheet ID out of the URL:
   `https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`.
3. Click **Share** on the spreadsheet and share it with the service
   account's email address (the `client_email` field from the downloaded
   JSON, looks like `xxxx@xxxx.iam.gserviceaccount.com`) with **Editor**
   access. Without this share, every Sheets API call the backend makes
   will fail with a permissions error — this step is the one most often
   missed.

## 3. Fill in backend/.env

Copy `backend/.env.example` to `backend/.env` and fill in, from the
downloaded JSON key file:

```
GOOGLE_PROJECT_ID=<project_id field>
GOOGLE_CLIENT_EMAIL=<client_email field>
GOOGLE_PRIVATE_KEY="<private_key field, keep the \n escapes literal>"
GOOGLE_SPREADSHEET_ID=<the spreadsheet ID from step 2>
```

The private key in the JSON file already contains literal `\n` sequences
inside a real newline-containing string; when you paste it into a `.env`
file (a single-line format), keep those as the two-character sequence
`\n` — the app converts them back to real newlines at startup
(`env.js`: `GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')`). Wrap the whole
value in double quotes so the surrounding spaces and dashes survive.

## 4. Provision the sheet tabs

With `backend/.env` filled in, run once from `backend/`:

```
node scripts/setupSheets.js
```

This creates every tab the app needs (if missing) and writes each tab's
header row (if missing or empty). It's safe to re-run — it only adds
missing tabs/headers, never deletes or overwrites data rows. The full list
of tabs and their columns lives in `src/config/sheetsSchema.js`; if a
future change adds a column there, re-running this script will not
retroactively add it to an existing tab's header row (existing tabs are
left alone) — a new column in the schema only takes effect for rows going
forward, per the schema's own "append-only" convention.

## 5. Create the first Super Admin

Sheets alone don't get you a working login — you need at least one admin
account to sign in with. From `backend/`:

```
node scripts/createSuperAdmin.js "Your Name" you@example.com "a-strong-password"
```

This writes a row into the `Admins` tab with `role=super_admin` and full
permissions. Log in at `/login` (admin tab) with that email/password once
the backend is running.

## 6. Verify

Start the backend (`npm run dev` from `backend/`) and hit
`GET /api/health` — it should report `googleConfigured: true`. If it's
`false`, double-check the four `GOOGLE_*` variables are all set and
non-empty. A 502 with code `GOOGLE_AUTH_FAILED` on the first real read
usually means the spreadsheet wasn't shared with the service account
email (step 2.3).

## Common failure modes

- **`GOOGLE_NOT_CONFIGURED` (503)** — one or more of `GOOGLE_CLIENT_EMAIL`,
  `GOOGLE_PRIVATE_KEY`, `GOOGLE_SPREADSHEET_ID` is missing from the
  environment. Nothing has been attempted against the API yet.
- **`GOOGLE_AUTH_FAILED` (502)** — credentials are present but rejected by
  Google (wrong key, or the spreadsheet isn't shared with the service
  account).
- **`GOOGLE_RATE_LIMIT` (429)** — Sheets' per-minute quota was hit; the
  backend already retries transient rate limits with backoff before
  surfacing this, so seeing it means the quota is being hit repeatedly,
  not just once.
- **`UNKNOWN_SHEET`** — a tab name in `sheetsSchema.js` doesn't match a
  tab in the spreadsheet; re-run `setupSheets.js`, or check for a tab that
  was manually renamed.
