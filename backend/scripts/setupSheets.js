/**
 * One-time provisioning script: creates every required tab in the target
 * spreadsheet (if missing) and writes its header row (if missing/empty).
 * Safe to re-run — it never deletes or overwrites existing data rows.
 *
 * Usage:  node scripts/setupSheets.js
 * Requires the same GOOGLE_* env vars as the running server.
 */
const { google } = require('googleapis');
const env = require('../src/config/env');
const { SHEETS } = require('../src/config/sheetsSchema');

async function main() {
  if (!env.googleConfigured) {
    console.error('Missing Google credentials. Fill in .env first (see .env.example).');
    process.exit(1);
  }

  const auth = new google.auth.JWT({
    email: env.google.clientEmail,
    key: env.google.privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = env.google.spreadsheetId;

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existingTitles = new Set(meta.data.sheets.map((s) => s.properties.title));

  const toCreate = Object.keys(SHEETS).filter((name) => !existingTitles.has(name));
  if (toCreate.length > 0) {
    console.log('Creating sheets:', toCreate.join(', '));
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: toCreate.map((title) => ({ addSheet: { properties: { title } } })),
      },
    });
  }

  for (const [name, columns] of Object.entries(SHEETS)) {
    const range = `${name}!A1:${colLetter(columns.length)}1`;
    const existing = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const hasHeader = existing.data.values && existing.data.values.length > 0;
    if (!hasHeader) {
      console.log(`Writing header row for ${name}`);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'RAW',
        requestBody: { values: [columns] },
      });
    } else {
      console.log(`${name} already has a header row — leaving it untouched.`);
    }
  }

  await seedPermissionsCatalog(sheets, spreadsheetId);
  await seedDefaultRoles(sheets, spreadsheetId);

  console.log('Sheets setup complete.');
}

const DEFAULT_PERMISSIONS = [
  ['students', 'Student management', 'core', 1],
  ['seats', 'Seat management', 'core', 2],
  ['allocations', 'Allocation management', 'core', 3],
  ['attendance', 'Attendance', 'core', 4],
  ['payments', 'Payments & billing', 'finance', 5],
  ['expenses', 'Expenses', 'finance', 6],
  ['reports', 'Reports', 'core', 7],
  ['notices', 'Notices & announcements', 'core', 8],
];

const DEFAULT_ROLES = [
  {
    role_name: 'Front Desk',
    description: 'Day-to-day student and seat operations.',
    permissions: { students: true, seats: true, allocations: true, attendance: true },
  },
  {
    role_name: 'Accountant',
    description: 'Billing, payments and expense tracking.',
    permissions: { payments: true, expenses: true, reports: true },
  },
  {
    role_name: 'Full Staff',
    description: 'Every staff permission except admin/settings management.',
    permissions: { students: true, seats: true, allocations: true, attendance: true, payments: true, expenses: true, reports: true, notices: true },
  },
];

/** Only inserts rows if the Permissions sheet has no data rows yet — never overwrites an admin's own edits. */
async function seedPermissionsCatalog(sheets, spreadsheetId) {
  const existing = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Permissions!A2:D' });
  if (existing.data.values && existing.data.values.length > 0) {
    console.log('Permissions catalog already has rows — leaving it untouched.');
    return;
  }
  console.log('Seeding default permissions catalog.');
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Permissions!A2',
    valueInputOption: 'RAW',
    requestBody: { values: DEFAULT_PERMISSIONS },
  });
}

async function seedDefaultRoles(sheets, spreadsheetId) {
  const existing = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Roles!A2:H' });
  if (existing.data.values && existing.data.values.length > 0) {
    console.log('Roles sheet already has rows — leaving it untouched.');
    return;
  }
  console.log('Seeding default roles: Front Desk, Accountant, Full Staff.');
  const { v4: uuidv4 } = require('uuid');
  const now = new Date().toISOString();
  const rows = DEFAULT_ROLES.map((r) => [
    uuidv4(), r.role_name, r.description, JSON.stringify(r.permissions), 'true', now, 'system', now,
  ]);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Roles!A2',
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  });
}

function colLetter(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - m) / 26);
  }
  return s;
}

main().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
