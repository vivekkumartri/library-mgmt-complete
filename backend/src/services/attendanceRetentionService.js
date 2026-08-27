const repos = require('../repositories');
const sheetsService = require('./googleSheetsService');
const auditService = require('./auditService');

const DEFAULT_RETENTION_DAYS = 365;
const SETTINGS_KEY = 'attendance_retention_days';

/**
 * Attendance is a daily time-series log — one row per student per day — so
 * left unchecked it grows forever. This purges rows older than a retention
 * window instead of keeping them indefinitely. The window itself is
 * "dynamic": it's read from Settings (attendance_retention_days) on every
 * run rather than hardcoded, so an admin can change it (via the Settings
 * page) without a redeploy; it defaults to 365 days when nothing has been
 * set. Unlike every other sheet in this app, Attendance rows are safe to
 * actually delete once they age out — they're a log, not a financial or
 * audit record — so this uses overwriteSheet (the same mechanism restore
 * uses) rather than soft-deleting with a status flag.
 */
class AttendanceRetentionService {
  async getRetentionDays() {
    const setting = await repos.settings.findById(SETTINGS_KEY);
    const parsed = setting ? parseInt(setting.value, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RETENTION_DAYS;
  }

  async purgeOldAttendance(actor) {
    const retentionDays = await this.getRetentionDays();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const cutoffDate = cutoff.toISOString().slice(0, 10);

    const all = await repos.attendance.findAll();
    const keep = all.filter((a) => a.date >= cutoffDate);
    const purgedCount = all.length - keep.length;

    if (purgedCount > 0) {
      await sheetsService.overwriteSheet('Attendance', keep);
      await auditService.log({
        actor: actor || { id: 'system', name: 'Attendance retention' },
        action: 'attendance_purged',
        entity: 'Attendance',
        entityId: 'bulk',
        newValue: { purgedCount, retentionDays, cutoffDate },
      });
    }

    return { purgedCount, retentionDays, cutoffDate, remaining: keep.length };
  }
}

module.exports = new AttendanceRetentionService();
