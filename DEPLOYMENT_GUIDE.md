# Deployment Guide — Library Management System

This guide assumes you know nothing about Google Cloud, APIs, or Render.
Follow it top to bottom in order — each part depends on the one before it.
It has four parts:

1. Create a Google Cloud project and a "service account" (a robot account
   your app uses to read/write Google Sheets and Drive)
2. Create a Google Sheet and a Google Drive folder, and share them with
   that robot account
3. Deploy the backend and frontend on Render
4. Create your first admin login

Total time: 30–45 minutes the first time.

---

## Part 1 — Google Cloud: create a project and a service account

Your app doesn't log in as *you* on Google — it uses a separate robot
account (a "service account") with its own email address and private key.
You create that here.

### 1.1 Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) and
   sign in with any Google account.
2. At the top of the page, click the project dropdown (it may say "Select a
   project") → **New Project**.
3. Name it something like `library-mgmt` → click **Create**.
4. Wait a few seconds, then make sure the new project is selected in that
   same dropdown at the top (this matters — everything below happens
   "inside" whichever project is currently selected).

### 1.2 Turn on the two APIs the app needs

1. In the left sidebar, go to **APIs & Services → Library** (or use the
   search bar at the top and type "Library").
2. Search for **Google Sheets API** → click it → click **Enable**.
3. Go back to the Library, search for **Google Drive API** → click it →
   click **Enable**.

### 1.3 Create the service account

1. Go to **APIs & Services → Credentials** (left sidebar).
2. Click **+ Create Credentials** at the top → choose **Service account**.
3. Give it a name, e.g. `library-mgmt-app` → click **Create and Continue**.
4. On the "Grant this service account access to project" step, you can
   just click **Continue** without picking a role — permissions are handled
   later by sharing the Sheet/Drive folder directly with this account, not
   by project-level roles.
5. Click **Done**.

### 1.4 Create a key for the service account (the part that logs in)

1. You're now back on the **Credentials** page. Under "Service Accounts",
   click the one you just created.
2. Go to the **Keys** tab → **Add Key** → **Create new key**.
3. Choose **JSON** → **Create**.
4. A `.json` file downloads automatically to your computer. **Keep this
   file safe and never share it publicly** — it's the password to your
   Google Sheet and Drive folder. Don't commit it to GitHub.

Open that JSON file in a text editor. It looks like this (shortened):

```json
{
  "type": "service_account",
  "project_id": "library-mgmt-123456",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQ...\n-----END PRIVATE KEY-----\n",
  "client_email": "library-mgmt-app@library-mgmt-123456.iam.gserviceaccount.com",
  ...
}
```

You'll need exactly three values from this file later:

| From the JSON file | Used as env var |
|---|---|
| `project_id` | `GOOGLE_PROJECT_ID` |
| `client_email` | `GOOGLE_CLIENT_EMAIL` |
| `private_key` | `GOOGLE_PRIVATE_KEY` |

Keep this file open — you'll copy from it in Part 3.

---

## Part 2 — Create the Google Sheet and Drive folder

### 2.1 Create the spreadsheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a
   **Blank spreadsheet**.
2. Rename it (top-left) to something like `Library Management Data`.
3. Look at the URL in your browser. It looks like:
   ```
   https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlmNoPQRstuVWxyz1234567890/edit
   ```
   The long string between `/d/` and `/edit` is your **Spreadsheet ID**
   (`GOOGLE_SPREADSHEET_ID`). Copy it somewhere safe.
4. Click **Share** (top-right) → paste in the `client_email` address from
   your service account JSON file (ends in
   `...iam.gserviceaccount.com`) → give it **Editor** access → click
   **Share** (you can ignore the "notify people" option, since it's a
   robot account with no inbox).

You don't need to create any tabs/columns yourself — a script does that
automatically in Part 4.

### 2.2 Create the Drive folder

1. Go to [drive.google.com](https://drive.google.com) and create a new
   folder, e.g. `Library Management Files`.
2. Open the folder. The URL looks like:
   ```
   https://drive.google.com/drive/folders/1XyzAbc9876ZzTop_LevelFolder
   ```
   The part after `/folders/` is your **Drive Folder ID**
   (`GOOGLE_DRIVE_ROOT_FOLDER_ID`). Copy it.
3. Right-click the folder → **Share** → paste the same service account
   email → give it **Editor** access → **Share**.

This is where the app stores student photos, signatures, receipts, and
backups.

---

## Part 3 — Deploy on Render

[Render](https://render.com) hosts both the backend (API) and frontend
(website) for you. The repo already includes a `render.yaml` "blueprint"
file describing both services plus a scheduled backup job, so most of the
setup is automatic.

### 3.1 Push the code to GitHub

Render deploys from a GitHub repository.

1. If you don't already have one, create a new **private** repository on
   [github.com](https://github.com/new).
2. Push this project's code to it (from your project folder):
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```
   (If it's already a git repo with a remote, just `git push`.)

### 3.2 Create a Render account and connect GitHub

1. Go to [render.com](https://render.com) → **Sign up** (you can sign up
   directly with your GitHub account, which makes the next step easier).
2. If asked, authorize Render to access your GitHub repositories (you can
   limit it to just this one repo).

### 3.3 Deploy the blueprint

1. In the Render dashboard, click **New +** → **Blueprint**.
2. Pick the GitHub repository you pushed in 3.1.
3. Render reads `render.yaml` from the repo root and shows you three
   services it's about to create:
   - `library-mgmt-backend` (the API)
   - `library-mgmt-frontend` (the website)
   - `library-mgmt-backup` (a daily scheduled job — takes automatic backups)
4. Click **Apply** — Render creates all three, but the backend and cron
   job won't work yet because some environment variables are marked
   "sync: false" in `render.yaml`, meaning Render leaves them blank for you
   to fill in by hand (these are the secret values it shouldn't guess).

### 3.4 Fill in the backend's environment variables

1. In the Render dashboard, open the **library-mgmt-backend** service.
2. Go to its **Environment** tab.
3. Fill in each of these (some may already be listed as empty — click each
   to add a value):

   | Key | Value |
   |---|---|
   | `GOOGLE_PROJECT_ID` | `project_id` from your service account JSON |
   | `GOOGLE_CLIENT_EMAIL` | `client_email` from the JSON |
   | `GOOGLE_PRIVATE_KEY` | `private_key` from the JSON — see note below |
   | `GOOGLE_SPREADSHEET_ID` | the Spreadsheet ID from step 2.1 |
   | `GOOGLE_DRIVE_ROOT_FOLDER_ID` | the Drive Folder ID from step 2.2 |
   | `FRONTEND_URL` | leave blank for now — come back after step 3.6 |

   **About `GOOGLE_PRIVATE_KEY`:** copy the whole value from the JSON file
   exactly as it appears, including the quotes and every `\n` — it should
   look like one long single-line string starting with
   `-----BEGIN PRIVATE KEY-----\n` and ending `\n-----END PRIVATE KEY-----\n`.
   Paste it in as-is; the app converts the `\n` sequences back into real
   line breaks itself, so don't manually add line breaks.

4. `JWT_SECRET` and `SESSION_SECRET` are already auto-generated by Render
   (`generateValue: true` in the blueprint) — you don't need to touch
   those.
5. Click **Save Changes** — this triggers a redeploy of the backend.

### 3.5 Fill in the backup job's environment variables

Repeat the same `GOOGLE_*` values (project ID, client email, private key,
spreadsheet ID, drive folder ID) on the **library-mgmt-backup** cron job's
**Environment** tab — it runs independently of the web service and needs
its own copy of these.

### 3.6 Fill in the frontend's environment variable

1. Open the **library-mgmt-backend** service's page and copy its URL from
   the top (looks like `https://library-mgmt-backend-xxxx.onrender.com`).
2. Open the **library-mgmt-frontend** service → **Environment** tab.
3. Set `VITE_API_BASE_URL` to that backend URL **with `/api` on the end**,
   e.g. `https://library-mgmt-backend-xxxx.onrender.com/api`.
4. Save — this triggers a rebuild of the frontend (static sites need a
   rebuild, not just a restart, to pick up a changed env var).

### 3.7 Finish linking backend ↔ frontend

1. Copy the frontend's URL (e.g.
   `https://library-mgmt-frontend-xxxx.onrender.com`).
2. Go back to the backend's **Environment** tab → set `FRONTEND_URL` to
   that address → **Save Changes** (used for CORS, so the backend accepts
   requests from your actual frontend).

### 3.8 Wait for both deploys to finish

Each service's page shows live deploy logs. Wait until both say **Live**
(green). If the backend fails, the most common cause is a mistyped
`GOOGLE_PRIVATE_KEY` — recheck it was pasted in full, including the
`\n` sequences.

---

## Part 4 — First-time setup: create the sheet tabs and your admin login

These two commands only need to run **once**, from your own computer (not
on Render) — they connect directly to your Google Sheet using the same
credentials to lay out the tabs and create your login.

1. On your computer, open the `backend` folder in a terminal.
2. Create a file named `.env` in that folder (copy `.env.example` and fill
   in the same `GOOGLE_*` values you used on Render).
3. Install dependencies and run the setup script:
   ```bash
   npm install
   node scripts/setupSheets.js
   ```
   This creates all the required tabs in your spreadsheet automatically
   (Students, Floors, Seats, Payments, and so on) with their header rows.
   It's safe to re-run — it never deletes existing data.
4. Create your first Super Admin login:
   ```bash
   node scripts/createSuperAdmin.js "Your Name" you@example.com "A-Strong-Password123"
   ```
   Replace the name, email, and password with your own. This is the
   account you'll use to log in as an administrator for the first time.

---

## You're done

Open your frontend URL (from step 3.6) in a browser and log in with the
email and password from step 4.4. From there you can add floors, add
students, and everything else through the app itself.

## Troubleshooting

- **Backend won't start / "Missing Google credentials"** — double-check
  all five `GOOGLE_*` env vars are filled in on Render exactly as they
  appear in your service account JSON file.
- **Frontend loads but nothing works / network errors** — check
  `VITE_API_BASE_URL` on the frontend ends in `/api`, and that
  `FRONTEND_URL` on the backend exactly matches your frontend's URL (no
  trailing slash).
- **"The caller does not have permission" from Google** — you likely
  forgot to share the Sheet and/or Drive folder with the service account's
  `client_email` address (steps 2.1.4 and 2.2.3).
- **Free Render plans sleep after inactivity** — the first request after
  a period of no traffic can take 30–60 seconds to wake the backend up.
  This is normal on Render's free/starter tier, not a bug.
