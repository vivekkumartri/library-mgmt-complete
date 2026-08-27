# Library Seat & Management System

Mobile-first library management system — Admin/Staff portal + Student portal,
backed by Google Sheets (data) and Google Drive (files), deployable on Render.

**This build went through a 20-session roadmap in 5 phases** (data-model
integrity & access control → student-facing UX → reporting & analytics →
polish/i18n/mobile → hardening & production readiness). The section
history below is kept in its original per-session form for traceability;
see [Phase 2–5 summary](#phase-25-student-ux-reporting-i18n--hardening---completed)
near the bottom for what the later phases added. Below is exactly what
works today, what is stubbed, and what is not started — so nothing here
pretends to be finished when it isn't.

**Current test status:** backend 79/79 (Jest), frontend 32/32 (Vitest),
production build clean on both apps.

---

## What's working end-to-end today

**Backend** (`/backend`) — fully implemented, unit-tested:
- Auth: admin login, student login, JWT, bcrypt password hashing, rate-limited
  login, role/permission middleware (super_admin vs staff with per-module
  permissions), student ID auto-generation (`LIB-2026-0042`), one-time
  password reveal on create/reset.
- Google Sheets access layer (17 tabs, schema in `src/config/sheetsSchema.js`)
  with retry-on-rate-limit and **honest failure** — a Sheets/Drive outage
  returns a clear error, never a silent fake-success.
- Google Drive folder automation (`Students/<id>/Photo`, `.../Signature`,
  `Receipts/<year>/<month>`) — admins never touch Drive paths.
- Floors & seats: floor creation auto-generates numbered seats; seat
  disable/enable with reason; historical data is never deleted, only
  archived via status.
- **Seat allocation business rules — the trickiest part of the spec — are
  implemented and covered by 20 passing tests**: one active allocation per
  student (hard block), seats can be shared with overlapping times (soft
  warning + explicit confirm, never blocked), disabled seats reject new
  allocations, ending an allocation frees the student up again and moves
  them to Past Students when they have no other active allocation.
- Monthly billing, payments (multiple partial payments, void with reason,
  audit trail — never silently deletes financial history), centralized
  paise-based finance math (`financeService.js`) so every screen agrees on
  the same numbers.
- PDF receipt generation (pdfkit) + optional archive to Drive.
- Attendance (present/absent, at most one mark/day, dashboard summary),
  expenses, notices (EN/HI fields), settings, audit log on every sensitive
  action.
- Centralized error handling: every response has a consistent
  `{ error: { code, message } }` shape; nothing fails silently.

**Frontend** (`/frontend`) — Vite + React, mobile-first (bottom nav on
mobile, sidebar on desktop), i18n (English/Hindi) wired through
`react-i18next`:
- Login (admin + student), Dashboard (today/payment-due), Seat Map (floor
  selector, live per-seat status grid, seat detail drawer with timeline),
  Allocate-seat flow with the overlap-warning confirm step, Student
  search/list/profile, Add Student wizard (3 steps → shows the one-time
  temporary password), Billing & Payments (create billing record, record
  payment, view receipt PDF), Attendance (daily present/absent grid +
  summary), Reports (financial/operational stats, CSV export, expenses),
  Settings (library info + floor management), full Student Portal (home,
  my seat, fees + receipts, profile).
- Every screen has loading / empty / error states — no blank screens on
  API calls.

**Added in Session 6:**
- **Single-record restore** — closes item 4 from Session 5's "Suggested next
  sessions" (today's restore is whole-sheet only). `backupService.restoreRecord()`
  finds one record by ID in a backup's CSV for a given sheet and either
  updates the live row in place (if it still exists — recovering from a bad
  edit) or re-appends it (if it's missing — recovering from an accidental
  delete), leaving every other row in that sheet untouched. Reachable three
  ways: `POST /api/backup/restore-record` (super-admin only, same
  `confirm: true` gate as whole-sheet restore), a third "Restore a single
  record" option in the Settings restore drawer (pick the sheet, enter the
  record ID, same acknowledgement checkbox), and
  `node scripts/restoreFromBackup.js <date> <time> --record <Sheet> <id> --yes`
  (dry-run by default, same as the whole-sheet CLI mode).
- **8 new backend tests** (`backupRestore.test.js`) covering validation,
  unknown-sheet rejection, missing-backup/missing-CSV/missing-record 404s,
  the update-in-place path, the re-create-after-delete path, and the
  audit-log-on-failure path.
- **2 new frontend tests** (`Settings.backups.test.jsx`) covering the
  record-ID-required validation and a confirmed single-record restore
  calling the API with the right payload.

Verified this session: `npm ci` + `npm run lint` + `npm test` pass clean on
both apps (backend 43/43, frontend 24/24), and `vite build` still produces
a clean production bundle. No new backend routes needed auth changes —
`restore-record` reuses the existing `requireSuperAdmin` middleware.

**Added in Session 5:**
- **Restore UI in Settings** (super-admin only) — the backup/restore API has
  existed since Session 3, but the only way to use it was
  `scripts/restoreFromBackup.js` or a raw API call. The Settings screen now
  has a "Backups & restore" panel: lists every `Backups/<date>/<time>/`
  folder (newest first), shows the last scheduled/manual run's status, and
  a "Run backup now" button. Restoring a backup opens a confirm drawer —
  choose all sheets or a specific subset, tick an explicit "I understand
  this overwrites live data" acknowledgement, then the destructive
  `POST /api/backup/restore` call fires with `confirm: true`. Closes the
  Session 4 gap called out below (was item 4 in "Suggested next sessions").
- **5 new frontend tests** covering the panel: backup list ordering, the
  confirm checkbox gating the restore button, a successful restore calling
  the API with the right payload and showing the result, the subset-restore
  validation error, and that non-super-admin users never see the panel.

Verified this session: `npm ci` + `npm run lint` + `npm test` pass clean on
both apps (backend 35/35, frontend 22/22), and `vite build` still produces
a clean production bundle. No backend changes this session — the API
already existed.

**Added in Session 4:**
- **Sheets batching extended to the rest of the dashboard (section 57, cont'd)**: `/dashboard/financial`, `/dashboard/operational`, and `/dashboard/payment-due` now go through `repos.readMany()` the same way `/dashboard/today` already did — each endpoint that reads several tabs (billing+payments+expenses, students+seats+allocations, billing+students) now costs one batched Sheets call instead of one call per tab. `readMany()` itself was unchanged; this just finished applying it everywhere the README's Session 3 notes flagged as not-yet-done.
- **`scripts/restoreFromBackup.js`** — the restore companion to `runBackup.js` that Session 3 called out as missing. Given a `Backups/<date>/<time>/` folder (run with no args to list what's available), it downloads each sheet's CSV from Drive, parses it, and fully overwrites that sheet in the live spreadsheet — so a backup is now something you can actually recover from, not just inspect. Restoring is destructive (each targeted sheet is replaced wholesale, not merged), so the script always does a dry-run print unless invoked with `--yes`, and it can restore a subset of sheets (`Payments,Monthly_Billing`) instead of everything. Two new `backupService` methods back it: `listBackups()` (walks the Drive `Backups/` folder tree) and `restoreBackup()` (downloads, parses, and calls the new `googleSheetsService.overwriteSheet()` / `googleDriveService.resolvePath()` + `listFiles()`). Also reachable as a super-admin API: `GET /api/backup/list` and `POST /api/backup/restore` (requires `{ confirm: true }` in the body on top of the auth check). Both the restore path and its CSV parser (handling embedded commas/quotes/newlines, the inverse of the existing `toCsv`) are covered by new tests.

Verified this session: `npm ci` + `npm run lint` + `npm test` pass clean on both apps (backend 35/35, frontend 17/17), and `vite build` still produces a clean production bundle.

**Added in Session 3:**
- **Sheets read-caching + batching (section 57 perf notes)**: `googleSheetsService` now caches each sheet's rows for a short TTL (`SHEETS_READ_CACHE_TTL_MS`, default 4s) and dedupes concurrent reads of the same sheet into one in-flight request; a new `getMany()` reads several sheets in a single `batchGet` call. Every write still invalidates its sheet's cache immediately, so nothing ever reads stale data past its own request. Wired into the dashboard's busiest endpoint (`/dashboard/today`) as the flagship example — 5 sequential Sheets reads collapsed into 1 batched call.
- **Scheduled backups (section 45)**: `backupService.js` snapshots all 17 sheets to CSV + a `manifest.json` and uploads them to Drive under `Backups/<date>/<time>/`. Runs three ways: an in-process `node-cron` schedule (`BACKUP_ENABLED`/`BACKUP_CRON`), a standalone `scripts/runBackup.js` for an external scheduler, and a manual super-admin-only trigger (`POST /api/backup/run`, `GET /api/backup/status`).
- **`render.yaml`** — backend web service, frontend static site, and a separate Render Cron Job running `scripts/runBackup.js` daily (so backups aren't lost if the web dyno is asleep).
- **CI** (`.github/workflows/ci.yml`) — lint + test for both apps on every push/PR, plus a production build check for the frontend. ESLint configs added to both apps (existing code passes with 0 errors, 6 pre-existing unused-var warnings in the backend left as-is).
- **Frontend test coverage extended**: Billing & Payments (creating a billing record, recording a payment, empty/error states), Attendance (marking present/absent, optimistic-update rollback on failure, search filter), and the Add Student wizard (step validation, full submit flow, the post-create signature step, error handling) — 14 new tests, mirroring the existing allocation-flow tests.
- **Two real bugs found and fixed while writing those tests**: the Add Student wizard's step-1 validation required a mobile number before the mobile field even existed on screen (the wizard could never be completed); and a failed attendance mark's error message was being wiped by the very reload it triggered before it could ever be seen. Both are now covered by regression tests.

Verified this session: `npm ci` + `npm run lint` + `npm test` pass clean on both apps (backend 28/28, frontend 20/20), and `vite build` still produces a clean production bundle.

**Added in Session 2:**
- **Signature capture canvas** (`components/SignaturePad.jsx`) — touch,
  mouse, and stylus support, device-pixel-ratio-aware for crisp lines,
  clear/redraw, uploads through the existing signature endpoint. Wired
  into the Add Student wizard's success screen and into the admin
  Student Profile ("Capture/Retake signature").
- **Admins & Roles screen** (`/admins`, super-admin only): create staff
  or super admin accounts, toggle per-module permissions (students,
  seats, allocations, attendance, payments, expenses, reports), activate/
  deactivate admin accounts.
- **Notices management screen** (`/notices`): create/edit notices in
  English and Hindi, set publish/expiry dates and priority, activate/
  deactivate — closing the gap where only viewing existed before.
- **Past Students detail view**: `StudentProfile` now also shows vacation
  history and receipts (previously admin-only for active students), plus
  a working "Reactivate student" button for past students — closing the
  section 15 gap called out below.
- **Frontend test coverage started** (Vitest + Testing Library): 3 tests
  covering the seat-allocation overlap-warning confirm flow end-to-end
  through the UI (blocked without a student, saves directly with no
  overlap, requires an explicit "Confirm anyway" click when one exists)
  — mirroring the backend's business-rule tests for the same logic.

Verified this session: `npm install` succeeds for both apps, backend
`npm test` passes 20/20, frontend `npm test` (vitest) passes 3/3, `vite
build` produces a clean production bundle, and the server boots and
answers `/api/health` correctly.

## What's stubbed or missing (be aware before demoing)

- Late-fee auto-calculation exists in `financeService.js` but isn't wired
  into a scheduled job — billing records are created manually per the
  spec's "admin decides the payable amount" rule (section 19), so this is
  actually spec-compliant, not a gap, but worth knowing.
- Backups export to Drive as CSV snapshots, not a restorable single archive
  — restoring after data loss means re-importing the CSVs by hand (or
  writing a companion `restoreFromBackup.js`, which doesn't exist yet).
- Sheets batching/caching now covers every `/dashboard/*` endpoint; other
  multi-sheet reads outside the dashboard (e.g. individual page loads that
  each call one repo method) still issue one call per sheet where they
  don't share a single request — same idea, just not the current bottleneck.
- Whole-sheet restore (API, UI, and CLI) is still all-or-nothing per sheet —
  unchanged from Session 5. **Session 6 added a separate single-record
  restore path** (API, UI, and CLI) for the common case of pulling back
  just one row.
- No CI deploy step (CI runs lint/test/build, not an automatic Render
  deploy) — deploys are still manual via Render's dashboard/CLI.
- Single-record restore matches by the sheet's primary-key column only —
  there's no way to preview a record's backed-up values before restoring
  it (no diff view), so it's a blind overwrite of that one row, not
  "compare then decide."

None of the above are placeholder screens pretending to work — they are
either backend-only (documented in the API section) or simply not started.

---

## Project layout

```
library-mgmt/
  backend/        Express API, Google Sheets/Drive integration
    src/
      config/       env loading, Sheets schema (single source of truth)
      services/     business logic (allocation rules, finance, auth, ...)
      repositories/ generic CRUD over a Sheets tab — swap for a DB later
      routes/       Express routers (thin — validation + service calls)
      middleware/   auth, rate limiting, error handling
    scripts/
      setupSheets.js       provisions all 17 tabs + header rows (idempotent)
      createSuperAdmin.js  creates the first super admin account
    tests/          Jest — allocation rules + finance math
  frontend/       Vite + React, mobile-first, i18n (EN/HI)
    src/
      pages/        one file per screen
      components/   shared UI (seat drawer, allocate form, search picker)
      context/       auth state
      services/      axios client
      styles/        design tokens + component CSS
```

---

## Local setup

### 1. Google Cloud service account

1. Create a GCP project → enable **Google Sheets API** and **Google Drive
   API**.
2. Create a service account, download its JSON key.
3. Create a Google Sheet and a Google Drive folder; share **both** with
   the service account's email (`...@...iam.gserviceaccount.com`) as
   Editor.
4. Note the Sheet ID (from its URL) and the Drive folder ID.

Full step-by-step walkthroughs, including the most common failure modes,
are in [`docs/google-sheets-setup.md`](./docs/google-sheets-setup.md) and
[`docs/google-drive-setup.md`](./docs/google-drive-setup.md).

### 2. Backend

```bash
cd backend
cp .env.example .env
# Fill in GOOGLE_PROJECT_ID, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY,
# GOOGLE_SPREADSHEET_ID, GOOGLE_DRIVE_ROOT_FOLDER_ID, JWT_SECRET, SESSION_SECRET
npm install
node scripts/setupSheets.js
node scripts/createSuperAdmin.js "Owner Name" owner@example.com "StrongPassword123"
npm run dev        # http://localhost:4000
npm test           # runs the business-rule test suite
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env   # VITE_API_BASE_URL=http://localhost:4000/api
npm install
npm run dev             # http://localhost:5173
```

Log in as the super admin you just created, or switch to the student tab
and log in with a Student ID + password once you've created a student.

---

## Deploying to Render

The repo includes a `render.yaml` Blueprint (backend web service + frontend
static site + a daily backup Cron Job) — in Render, "New +" → "Blueprint"
and point it at this repo to provision all three at once. A full walkthrough
(including the FRONTEND_URL/VITE_API_BASE_URL chicken-and-egg step) is in
[`docs/render-deployment.md`](./docs/render-deployment.md). Manual setup
(if not using the Blueprint):

**Backend (Web Service)**
- Root directory: `backend`
- Build command: `npm install`
- Start command: `npm start`
- Environment variables: everything in `backend/.env.example`
  (`GOOGLE_PRIVATE_KEY` — paste with literal `\n`s, the app converts them)
- After first deploy, run `node scripts/setupSheets.js` and
  `node scripts/createSuperAdmin.js ...` once, either via Render's Shell
  tab or locally against the same spreadsheet.

**Frontend (Static Site)**
- Root directory: `frontend`
- Build command: `npm install && npm run build`
- Publish directory: `dist`
- Environment variable: `VITE_API_BASE_URL=https://<your-backend>.onrender.com/api`

Update the backend's `FRONTEND_URL` env var to the deployed frontend URL
so CORS allows it.

**Scheduled backups (Cron Job)** — a fourth Render resource, separate from
the web service so it isn't affected by the web dyno sleeping:
- Root directory: `backend`
- Build command: `npm install`
- Command: `node scripts/runBackup.js`
- Schedule: e.g. `0 2 * * *` (daily at 02:00 UTC)
- Environment variables: the same `GOOGLE_*` variables as the backend

---

## Phase 2–5 (student UX, reporting, i18n & hardening) — completed

Phases 2 through 5 of the 20-session roadmap, delivered after Phase 1:

**Phase 2 — student-facing UX**: camera-based photo capture (with a
graceful file-input fallback when `getUserMedia` isn't available), the Add
Student flow rebuilt as an 8-step guided wizard with a post-creation
success screen and printable credentials, an "End allocation" flow with an
explicit confirm step (replacing a native `window.prompt`), and vacation
management on the student profile.

**Phase 3 — reporting & analytics**: expense editing/voiding with
required reasons, a library logo setting that appears on generated
receipts, automatic receipt PDF generation and Drive archival on every
payment (best-effort — see
[`docs/google-drive-setup.md`](./docs/google-drive-setup.md)), a Reports
page with financial/students/seats/payments/attendance/expenses tabs each
exporting to CSV and Excel, and a dashboard with dependency-free SVG
charts built from live report data.

**Phase 4 — polish, i18n & mobile**: English/Hindi translations wired
into every major screen (headers, navigation, tab labels, primary
actions — not yet every validation message or placeholder string), and a
mobile pass on the seat map (seat-number lookup, status filters, zoom
controls, confirmed bottom-sheet behavior for the seat detail drawer,
touch-target sizing throughout via the shared `--touch-target` CSS token).

**Phase 5 — hardening & production readiness**:
- **21 new backend tests** filling the critical-rule gaps called out for
  this phase: `fee-change-preserves-old-billing` and the mid-month-joining
  `payableOverride` path (`tests/billingService.test.js`), student
  auth-isolation across the real Express routes rather than just service
  logic (`tests/studentAuthIsolation.test.js`, using supertest), and
  simulated Google Sheets/Drive API failure paths — transient vs.
  permanent errors, rate limiting, network failures, missing config
  (`tests/googleApiFailures.test.js`).
- **One real bug found and fixed while writing those tests**:
  `googleSheetsService._wrapError()` and `googleDriveService._wrapError()`
  were re-wrapping an already-specific `AppError` (like the
  `GOOGLE_NOT_CONFIGURED` thrown by `_client()` before any API call is
  even attempted) into a generic `GOOGLE_SHEETS_ERROR`/`GOOGLE_DRIVE_ERROR`
  502 — hiding the actual, more actionable cause from whoever hits it.
  Fixed by passing an existing `AppError` through unchanged; both fixes
  are covered by the new failure-path tests.
- **Docs**: three new setup/deployment guides
  (`docs/google-sheets-setup.md`, `docs/google-drive-setup.md`,
  `docs/render-deployment.md`) covering the parts that were previously
  only summarized inline in this README, including common failure modes
  for each. `.env.example` on both apps was reviewed against every env
  var actually read in code (`config/env.js`, `services/api.js`) and found
  complete — no missing variables.
- **Note on scope**: this phase's checklist was walked statically against
  the codebase (config completeness, error-path coverage, docs, deploy
  config) — it was not run end-to-end against a live Google Sheets/Drive
  project, since this environment has no real Google credentials to test
  against. If you have a live project, running through
  `docs/google-sheets-setup.md` end to end once is worth doing as a final
  check before considering this "verified in production," not just
  "verified statically."

---

## Suggested next steps

1. CI currently stops at lint/test/build — add an automatic Render deploy
   step (or a manual "deploy on green" gate) if that's desired.
2. Broaden frontend test coverage further: Seat Map zoom/filter UI,
   Admins & Roles permission toggles, and Notices create/edit don't have
   dedicated tests yet (Billing, Attendance, Reports, and the Add Student
   wizard do).
3. Extend i18n coverage from headers/labels/primary actions down to every
   validation message and placeholder string, per the Phase 4 scope note
   above.
4. Rate-limit-aware request queuing for very large libraries — the current
   retry-on-429 backoff in `googleSheetsService` handles occasional bursts
   fine, but a library with thousands of historical records doing frequent
   concurrent writes would benefit from an actual write queue.
5. A preview/diff step for single-record restore — show the backed-up
   record's values next to the live row's current values (when it still
   exists) before the destructive call fires, instead of today's blind
   "restore now" once the ID is typed in.
6. Run the Phase 5 production-readiness checklist end-to-end against a
   real Google Sheets/Drive project (see the Phase 5 scope note above) —
   this build's Phase 5 pass was static/code-level only.

---

## Phase 1 (data-model integrity & access control) — completed

Closes the five gaps identified in the post-session6 audit:

- **Fee history** (`Fee_Plans`): a `feePlanService` now actually reads and
  writes this sheet. Allocating a seat seeds an initial fee plan; the
  student profile has a "Change fee" action that starts a new plan from an
  effective date and closes the previous one the day before — never
  editing its stored amount. New billing records prefill from the
  student's *current* fee plan but still let the admin override the
  amount, and once a billing record is created it keeps its own
  `base_fee`/`discount` forever regardless of later fee changes.
- **Roles & Permissions**: added `Roles` and `Permissions` sheets (seeded
  with a starter catalog and three example roles — Front Desk,
  Accountant, Full Staff — by `scripts/setupSheets.js`). `GET
  /api/roles` / `GET /api/roles/permissions` expose them; the Admins
  screen can create roles and apply one to a staff member as a starting
  permission set, still fine-tunable per admin afterward. The actual
  authorization check is unchanged (`permissions_json` on the Admins row)
  so this is additive, not a breaking migration.
- **Late fee config**: Settings now has a real fixed/percentage + grace
  period + default due day structure (`default_late_fee_config`,
  replacing the old free-text field), and seat allocations can override it
  per student from the Allocate form.
- **Holidays & operating hours**: Settings gained weekly-holiday
  checkboxes and a special-holidays list; students see them (plus
  library name/address/contact/hours) on a new "Library Info" page.
- **Notices permission + login audit**: notices create/edit now checks its
  own `notices` permission instead of piggybacking on `reports`; admin and
  student login attempts (success and failure) are written to the audit
  log.

New/changed backend files: `services/feePlanService.js`,
`services/roleService.js`, `routes/roleRoutes.js`,
`config/sheetsSchema.js` (Roles/Permissions sheets, `role_id` on Admins),
`routes/studentRoutes.js` (fee-plan endpoints), `routes/authRoutes.js`
(login audit), `routes/miscRoutes.js` (notices permission fix, role
support on admin create/patch), `services/allocationService.js` (seeds fee
plan on allocation), `scripts/setupSheets.js` (seeds default permissions +
roles). New tests: `tests/feePlanService.test.js`,
`tests/roleService.test.js`. Frontend: `Billing.jsx` (fee-plan prefill),
`StudentProfile.jsx` (fee plan card + change-fee drawer), `Settings.jsx`
(late fee + holidays UI), `AllocateForm.jsx` (late fee override),
`Admins.jsx` (roles UI), `StudentPortal.jsx` (Library Info page).

If you're running against an existing spreadsheet from before this phase,
re-run `node scripts/setupSheets.js` — it only ever adds missing sheets/
headers and seeds `Roles`/`Permissions` if those sheets are empty, it
never touches existing data rows.
