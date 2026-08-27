# Google Drive setup

Google Drive stores every file the app generates or accepts: student
photos, signatures, payment receipts (PDF), and the daily backup archives.
It uses the **same service account** as Google Sheets (see
[google-sheets-setup.md](./google-sheets-setup.md)) — there is nothing new
to create in Google Cloud, only a Drive folder to prepare and share.

## 1. Create a root folder

1. In your own Google Drive, create a folder — any name, e.g.
   `Library Management`.
2. Open it and copy its folder ID out of the URL:
   `https://drive.google.com/drive/folders/`**`THIS_PART`**.
3. Share that folder with the service account's email (same
   `client_email` from the Sheets setup) with **Editor** access. Without
   this, every upload (photo, signature, receipt, backup) fails with
   `GOOGLE_AUTH_FAILED` or a "missing folder" error.

## 2. Fill in backend/.env

```
GOOGLE_DRIVE_ROOT_FOLDER_ID=<the folder ID from step 1>
```

That's the only Drive-specific variable — everything else reuses the four
`GOOGLE_*` credential variables already set up for Sheets.

## 3. How the folder tree is managed

The app never asks an admin to pick a Drive location — it manages a fixed
folder structure automatically under the root folder, creating each
subfolder the first time it's needed:

```
<root folder>/
  Students/<student_id>/Photo/
  Students/<student_id>/Signature/
  Students/<student_id>/Documents/
  Receipts/<year>/<month>/
  Settings/                (library logo)
  Backups/<date>/<time>/   (daily CSV export of every sheet)
```

This is handled by `googleDriveService.ensurePath()` — it searches for
each folder segment by name and creates it only if missing, so re-running
the app (or several instances at once) never creates duplicate folder
trees; a duplicate is at worst harmless since the service always
searches-then-creates.

## 4. Verify

With `GOOGLE_DRIVE_ROOT_FOLDER_ID` set, try creating a student with a
captured photo through the app, or trigger a manual backup
(`POST /api/backup/run` as a super admin, or Settings → Backups → Run
backup now in the UI). Then check the shared Drive folder — you should
see the corresponding subfolder appear with the uploaded file inside.

## Common failure modes

- **`GOOGLE_NOT_CONFIGURED` (503)** — `GOOGLE_DRIVE_ROOT_FOLDER_ID` (or one
  of the shared `GOOGLE_*` credential vars) is missing.
- **`GOOGLE_DRIVE_MISSING_FOLDER` (502)** — the root folder ID doesn't
  exist, was deleted, or isn't shared with the service account.
- **A photo/signature/receipt "succeeds" in the app but never appears in
  Drive** — this shouldn't happen for photo/signature uploads (those calls
  fail loudly), but receipt archival after a payment is intentionally
  **best-effort and non-fatal**: `paymentService.recordPayment()` records
  the payment first, then tries to generate and archive the receipt PDF in
  a try/catch that only logs on failure — a Drive outage never blocks a
  payment from being recorded. If receipts aren't showing up in Drive,
  check the backend logs for `console.error` output around
  `recordPayment`, not the payment API response (which will look
  successful either way).
