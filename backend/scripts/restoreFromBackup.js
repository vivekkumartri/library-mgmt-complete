/**
 * Companion to scripts/runBackup.js — replays a Backups/<date>/<time>/
 * folder (as produced by runBackup.js) back into the live spreadsheet.
 *
 * Usage:
 *   node scripts/restoreFromBackup.js                          # list available backups
 *   node scripts/restoreFromBackup.js <date> <time> --yes       # restore all sheets
 *   node scripts/restoreFromBackup.js <date> <time> Payments,Monthly_Billing --yes
 *   node scripts/restoreFromBackup.js <date> <time> --record Students LIB-2026-0042 --yes
 *
 * Example:
 *   node scripts/restoreFromBackup.js 2026-08-20 0200 --yes
 *   node scripts/restoreFromBackup.js 2026-08-20 0200 --record Payments pay-abc123 --yes
 *
 * Restoring is destructive: whole-sheet mode fully overwrites every
 * targeted sheet (not merged), and --record mode overwrites/re-creates
 * just the one matching row. Either way, running without --yes always
 * just prints what *would* happen instead of touching the spreadsheet.
 */
const backupService = require('../src/services/backupService');

async function listMode() {
  const backups = await backupService.listBackups();
  if (backups.length === 0) {
    console.log('[restore] no backups found under Backups/ in Drive.');
    return;
  }
  console.log('[restore] available backups (oldest first):');
  for (const b of backups) {
    console.log(`  ${b.date} ${b.time}`);
  }
  console.log('\nRun: node scripts/restoreFromBackup.js <date> <time> --yes');
}

(async () => {
  const confirmed = process.argv.includes('--yes');
  const recordIdx = process.argv.indexOf('--record');
  const rawArgs = process.argv.slice(2).filter((a) => a !== '--yes' && a !== '--record');

  try {
    if (recordIdx !== -1) {
      // --record mode: <date> <time> --record <Sheet> <recordId> [--yes]
      const [date, time, sheet, recordId] = rawArgs;
      if (!date || !time || !sheet || !recordId) {
        console.log('[restore] --record needs: <date> <time> --record <Sheet> <recordId> [--yes]');
        process.exit(1);
      }
      if (!confirmed) {
        console.log(`[restore] DRY RUN — would restore ${sheet} record ${recordId} from Backups/${date}/${time}.`);
        console.log('[restore] This overwrites/re-creates that one row. Re-run with --yes to actually do it.');
        process.exit(0);
      }
      const result = await backupService.restoreRecord({
        date,
        time,
        sheet,
        recordId,
        actor: { id: 'cli', name: 'Manual restore (restoreFromBackup.js)' },
      });
      console.log(`[restore] done — ${result.action} ${result.sheet} record ${result.recordId}.`);
      process.exit(0);
    }

    const [date, time, sheetsArg] = rawArgs;

    if (!date || !time) {
      await listMode();
      process.exit(0);
    }

    const sheets = sheetsArg ? sheetsArg.split(',').map((s) => s.trim()).filter(Boolean) : undefined;

    if (!confirmed) {
      const scope = sheets ? `sheets: ${sheets.join(', ')}` : 'all sheets';
      console.log(`[restore] DRY RUN — would restore Backups/${date}/${time} (${scope}).`);
      console.log('[restore] This overwrites the live spreadsheet. Re-run with --yes to actually do it.');
      process.exit(0);
    }

    const result = await backupService.restoreBackup({
      date,
      time,
      sheets,
      actor: { id: 'cli', name: 'Manual restore (restoreFromBackup.js)' },
    });

    console.log(`[restore] done — restored ${result.restoredSheets.length} sheet(s) from ${result.folder}.`);
    for (const [name, count] of Object.entries(result.restoredCounts)) {
      console.log(`  ${name}: ${count} rows`);
    }
    if (result.skippedSheets.length > 0) {
      console.log(`[restore] skipped (no CSV found in this backup): ${result.skippedSheets.join(', ')}`);
    }
    process.exit(0);
  } catch (err) {
    console.error('[restore] failed:', err.message);
    process.exit(1);
  }
})();
