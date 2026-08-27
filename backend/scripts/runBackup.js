/**
 * One-shot backup runner, meant to be invoked by an external scheduler
 * (Render Cron Job, a system cron, GitHub Actions schedule, etc.) rather
 * than relying on the web service's own uptime — a free/low-tier web
 * service can sleep, but a dedicated cron job always fires.
 *
 * Usage: node scripts/runBackup.js
 * Exit code 0 on success, 1 on failure (so the scheduler's own failure
 * alerting works without any extra parsing).
 */
const backupService = require('../src/services/backupService');

(async () => {
  try {
    const result = await backupService.runBackup({ actor: { id: 'cron', name: 'Scheduled backup' } });
    // eslint-disable-next-line no-console
    console.log(`[backup] done — ${result.totalRows ?? Object.values(result.sheetCounts).reduce((a, b) => a + b, 0)} rows across ${Object.keys(result.sheetCounts).length} sheets, saved to ${result.folder}`);
    process.exit(0);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[backup] failed:', err.message);
    process.exit(1);
  }
})();
