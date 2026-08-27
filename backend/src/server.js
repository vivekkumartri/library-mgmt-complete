const cron = require('node-cron');
const app = require('./app');
const env = require('./config/env');
const backupService = require('./services/backupService');
const attendanceRetentionService = require('./services/attendanceRetentionService');

// In-process scheduled backups (section 45). This is a convenience for
// deployments that keep the web process running continuously. For hosts
// where the web service can sleep or restart (e.g. Render's free tier),
// prefer a separate scheduler (Render Cron Job / system cron) calling
// `node scripts/runBackup.js` instead — see render.yaml.
if (env.backup.enabled) {
  if (!cron.validate(env.backup.cron)) {
    // eslint-disable-next-line no-console
    console.warn(`[startup] BACKUP_CRON "${env.backup.cron}" is not a valid cron expression; scheduled backups are disabled.`);
  } else {
    cron.schedule(env.backup.cron, () => {
      backupService.runBackup({ actor: { id: 'cron', name: 'Scheduled backup' } }).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[backup] scheduled run failed:', err.message);
      });
    });
    // eslint-disable-next-line no-console
    console.log(`[startup] Scheduled backups enabled (${env.backup.cron}).`);
  }
}

// Daily attendance retention purge (section: attendance data should flush
// automatically after the configured window). Unlike backups this is
// always on — it's a safe, non-destructive default (365 days unless an
// admin changes it in Settings) rather than an opt-in feature, and a
// no-op run costs nothing when there's nothing old enough to purge. Same
// "prefer a separate scheduler on hosts that sleep" caveat as backups
// applies — see render.yaml.
cron.schedule('0 3 * * *', () => {
  attendanceRetentionService.purgeOldAttendance({ id: 'cron', name: 'Scheduled attendance purge' }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[attendance-retention] scheduled purge failed:', err.message);
  });
});

if (!env.googleConfigured) {
  // eslint-disable-next-line no-console
  console.warn(
    '[startup] Google Sheets/Drive credentials are not fully configured. ' +
      'The server will start, but any request touching Sheets/Drive will fail ' +
      'with a clear GOOGLE_NOT_CONFIGURED error instead of silently succeeding.'
  );
}

app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Library Management API listening on port ${env.port} (${env.nodeEnv})`);
});
