/**
 * DESTRUCTIVE one-off: clears all data rows (keeps header rows) from every
 * sheet tab, and permanently deletes every file/folder under the Drive
 * root folder. Not reversible. Run once, then delete or leave unused.
 *
 * Usage: node scripts/wipeAllData.js
 */
const { google } = require('googleapis');
const env = require('../src/config/env');
const { SHEETS } = require('../src/config/sheetsSchema');

function colLetter(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function wipeSheets(sheets, spreadsheetId) {
  for (const [name, columns] of Object.entries(SHEETS)) {
    const range = `${name}!A2:${colLetter(columns.length)}`;
    await sheets.spreadsheets.values.clear({ spreadsheetId, range });
    console.log(`Cleared data rows in ${name}`);
  }
}

async function wipeDriveRecursive(drive, folderId, depth = 0) {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType)',
    pageSize: 1000,
  });
  for (const file of res.data.files || []) {
    if (file.mimeType === 'application/vnd.google-apps.folder') {
      await wipeDriveRecursive(drive, file.id, depth + 1);
    }
    await drive.files.delete({ fileId: file.id });
    console.log(`${'  '.repeat(depth)}Deleted: ${file.name}`);
  }
}

async function main() {
  if (!env.googleConfigured) {
    console.error('Missing Google credentials. Fill in .env first.');
    process.exit(1);
  }

  const auth = new google.auth.JWT({
    email: env.google.clientEmail,
    key: env.google.privateKey,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const drive = google.drive({ version: 'v3', auth });

  console.log('Wiping spreadsheet data rows...');
  await wipeSheets(sheets, env.google.spreadsheetId);

  console.log('Wiping Drive files under root folder...');
  await wipeDriveRecursive(drive, env.google.driveRootFolderId);

  console.log('Done.');
}

main().catch((err) => {
  console.error('Wipe failed:', err.message);
  process.exit(1);
});
