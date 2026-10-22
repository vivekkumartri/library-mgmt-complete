/**
 * One-shot payment-due push reminder runner, meant to be invoked by an
 * external scheduler (Render Cron Job, a system cron, GitHub Actions
 * schedule, etc.) rather than relying on the web service's own uptime —
 * a free/low-tier web service can sleep, but a dedicated cron job always
 * fires. See src/server.js for the in-process alternative.
 *
 * Usage: node scripts/runPaymentReminders.js
 * Exit code 0 on success, 1 on failure (so the scheduler's own failure
 * alerting works without any extra parsing).
 */
const pushService = require('../src/services/pushService');

(async () => {
  try {
    const result = await pushService.sendPaymentDueReminders();
    // eslint-disable-next-line no-console
    console.log(`[push] done — notified ${result.notified} device(s) across ${result.studentsChecked} active students (${result.skipped} not currently due).`);
    process.exit(0);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[push] failed:', err.message);
    process.exit(1);
  }
})();
