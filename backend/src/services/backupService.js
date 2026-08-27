const sheetsService = require('./googleSheetsService');
const driveService = require('./googleDriveService');
const { SHEETS } = require('../config/sheetsSchema');
const auditService = require('./auditService');
const { AppError } = require('../utils/AppError');

/** Escapes a single CSV field per RFC 4180. */
function csvField(value) {
  const s = value === undefined || value === null ? '' : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(columns, rows) {
  const lines = [columns.map(csvField).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => csvField(row[c])).join(','));
  }
  return lines.join('\n');
}

/**
 * Full RFC 4180 parse of CSV text into rows of raw string fields — a plain
 * line-split would break on the embedded newlines toCsv() itself produces
 * for quoted fields, so this scans character-by-character instead.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r') {
      // ignore — CRLF handled by the following \n
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Turns parsed CSV rows (first row = header) into objects keyed by header name. */
function csvRowsToObjects(rows) {
  if (rows.length === 0) return [];
  const [header, ...dataRows] = rows;
  return dataRows.map((r) => {
    const obj = {};
    header.forEach((h, idx) => {
      obj[h] = r[idx] ?? '';
    });
    return obj;
  });
}

class BackupService {
  constructor() {
    this._lastRun = null; // { startedAt, finishedAt, ok, sheetCounts, error, folderId }
  }

  lastRun() {
    return this._lastRun;
  }

  /**
   * Snapshots every configured sheet to a CSV file plus a manifest.json,
   * and uploads them all to Drive under Backups/<date>/<time>/. This is a
   * point-in-time export for disaster recovery (section 45) — it never
   * modifies the source sheets and never deletes older backups (Drive
   * retention/cleanup is left to the library's own Drive storage policy).
   */
  async runBackup({ actor } = {}) {
    const startedAt = new Date();
    const dateSeg = startedAt.toISOString().slice(0, 10);
    const timeSeg = startedAt.toISOString().slice(11, 16).replace(':', '');
    const sheetNames = Object.keys(SHEETS);
    const sheetCounts = {};

    try {
      // Fresh reads (bypass cache) so a scheduled backup always reflects the
      // true current state, not a value still inside its read-cache TTL.
      const bySheet = await sheetsService.getMany(sheetNames, { fresh: true });

      for (const name of sheetNames) {
        const columns = SHEETS[name];
        const rows = bySheet[name]?.rows || [];
        sheetCounts[name] = rows.length;
        const csv = toCsv(columns, rows);
        await driveService.uploadBuffer({
          pathSegments: ['Backups', dateSeg, timeSeg],
          fileName: `${name}.csv`,
          mimeType: 'text/csv',
          buffer: Buffer.from(csv, 'utf8'),
        });
      }

      const manifest = {
        generatedAt: startedAt.toISOString(),
        sheetCounts,
        totalRows: Object.values(sheetCounts).reduce((a, b) => a + b, 0),
      };
      await driveService.uploadBuffer({
        pathSegments: ['Backups', dateSeg, timeSeg],
        fileName: 'manifest.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
      });

      const finishedAt = new Date();
      this._lastRun = { startedAt, finishedAt, ok: true, sheetCounts, folder: `Backups/${dateSeg}/${timeSeg}` };

      await auditService.log({
        actor,
        action: 'BACKUP_RUN',
        entity: 'Backup',
        entityId: `${dateSeg}/${timeSeg}`,
        newValue: manifest,
      });

      return this._lastRun;
    } catch (err) {
      const finishedAt = new Date();
      const wrapped = err instanceof AppError ? err : new AppError('BACKUP_FAILED', `Backup failed: ${err.message}`, 502);
      this._lastRun = { startedAt, finishedAt, ok: false, error: wrapped.message, sheetCounts };
      throw wrapped;
    }
  }

  /** Lists every Backups/<date>/<time>/ folder pair that exists in Drive, oldest first. */
  async listBackups() {
    const rootId = await driveService.resolvePath(['Backups']);
    if (!rootId) return [];
    const dateFolders = (await driveService.listFiles(rootId)).filter(
      (f) => f.mimeType === 'application/vnd.google-apps.folder'
    );
    const out = [];
    for (const dateFolder of dateFolders) {
      const timeFolders = (await driveService.listFiles(dateFolder.id)).filter(
        (f) => f.mimeType === 'application/vnd.google-apps.folder'
      );
      for (const timeFolder of timeFolders) {
        out.push({ date: dateFolder.name, time: timeFolder.name });
      }
    }
    out.sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
    return out;
  }

  /**
   * Replays a previously-uploaded Backups/<date>/<time>/ folder back into
   * the live spreadsheet — the companion the README called out as
   * missing: a backup that can only be inspected, never restored, isn't
   * really disaster recovery.
   *
   * Defaults to every sheet found in the backup folder; pass `sheets` to
   * restore a subset (e.g. recovering just Payments after a bad import).
   * Every targeted sheet is fully overwritten, not merged — that's what
   * makes it a restore rather than an import, which is why callers should
   * treat this as destructive and always require an explicit confirmation
   * before invoking it.
   */
  async restoreBackup({ date, time, sheets, actor } = {}) {
    if (!date || !time) {
      throw new AppError('VALIDATION_ERROR', 'date and time are required to restore a backup.', 400);
    }
    const folderId = await driveService.resolvePath(['Backups', date, time]);
    if (!folderId) {
      throw new AppError('NOT_FOUND', `No backup found at Backups/${date}/${time}.`, 404);
    }

    const files = await driveService.listFiles(folderId);
    const manifestFile = files.find((f) => f.name === 'manifest.json');
    let manifest = null;
    if (manifestFile) {
      try {
        manifest = JSON.parse((await driveService.getFileBuffer(manifestFile.id)).toString('utf8'));
      } catch {
        manifest = null; // A corrupt/missing manifest shouldn't block restoring the CSVs themselves.
      }
    }

    const allSheetNames = Object.keys(SHEETS);
    const targetNames = sheets && sheets.length > 0 ? sheets.filter((n) => allSheetNames.includes(n)) : allSheetNames;
    if (targetNames.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'No valid sheet names to restore.', 400);
    }

    const restoredCounts = {};
    const skippedSheets = [];
    try {
      for (const name of targetNames) {
        const file = files.find((f) => f.name === `${name}.csv`);
        if (!file) {
          skippedSheets.push(name);
          continue;
        }
        const buffer = await driveService.getFileBuffer(file.id);
        const objects = csvRowsToObjects(parseCsv(buffer.toString('utf8')));
        await sheetsService.overwriteSheet(name, objects);
        restoredCounts[name] = objects.length;
      }
    } catch (err) {
      const wrapped = err instanceof AppError ? err : new AppError('RESTORE_FAILED', `Restore failed: ${err.message}`, 502);
      await auditService.log({
        actor,
        action: 'BACKUP_RESTORE_FAILED',
        entity: 'Backup',
        entityId: `${date}/${time}`,
        newValue: { error: wrapped.message, restoredBeforeFailure: restoredCounts },
      });
      throw wrapped;
    }

    const result = {
      folder: `Backups/${date}/${time}`,
      manifest,
      restoredCounts,
      restoredSheets: Object.keys(restoredCounts),
      skippedSheets,
    };

    await auditService.log({
      actor,
      action: 'BACKUP_RESTORE',
      entity: 'Backup',
      entityId: `${date}/${time}`,
      newValue: result,
    });

    return result;
  }

  /**
   * Restores exactly one record from a backup instead of overwriting a
   * whole sheet — the gap the README has flagged since Session 4/5:
   * today's restore is "replace every row in this sheet" only, with no
   * way to pull back one accidentally-deleted or accidentally-edited row
   * without touching everything else currently in that sheet.
   *
   * Looks up `recordId` in the backup's CSV for `sheet`, matched against
   * that sheet's primary-key column (always its first column per
   * sheetsSchema.js), then either:
   *  - updates the live row in place, if a row with that id still exists
   *    (recovering from a bad edit), or
   *  - re-appends it, if no row with that id currently exists
   *    (recovering from an accidental delete).
   * Every other row in the live sheet is left untouched — the whole point
   * of this being narrower than restoreBackup().
   */
  async restoreRecord({ date, time, sheet, recordId, actor } = {}) {
    if (!date || !time || !sheet || !recordId) {
      throw new AppError(
        'VALIDATION_ERROR',
        'date, time, sheet and recordId are all required to restore a single record.',
        400
      );
    }
    const columns = SHEETS[sheet];
    if (!columns) {
      throw new AppError('VALIDATION_ERROR', `Unknown sheet: ${sheet}.`, 400);
    }
    const idColumn = columns[0];

    const folderId = await driveService.resolvePath(['Backups', date, time]);
    if (!folderId) {
      throw new AppError('NOT_FOUND', `No backup found at Backups/${date}/${time}.`, 404);
    }

    const files = await driveService.listFiles(folderId);
    const file = files.find((f) => f.name === `${sheet}.csv`);
    if (!file) {
      throw new AppError('NOT_FOUND', `No ${sheet}.csv found in Backups/${date}/${time}.`, 404);
    }

    const buffer = await driveService.getFileBuffer(file.id);
    const objects = csvRowsToObjects(parseCsv(buffer.toString('utf8')));
    const record = objects.find((r) => r[idColumn] === recordId);
    if (!record) {
      throw new AppError(
        'NOT_FOUND',
        `${sheet} record ${recordId} was not found in Backups/${date}/${time}.`,
        404
      );
    }

    try {
      // Fresh read so a record deleted/edited moments ago is never mistaken
      // for still being in its old state.
      const existing = await sheetsService.findById(sheet, idColumn, recordId, { fresh: true });
      let action;
      if (existing) {
        await sheetsService.updateById(sheet, idColumn, recordId, record);
        action = 'updated';
      } else {
        await sheetsService.append(sheet, record);
        action = 'recreated';
      }

      const result = { sheet, recordId, action, record };
      await auditService.log({
        actor,
        action: 'BACKUP_RESTORE_RECORD',
        entity: sheet,
        entityId: recordId,
        newValue: { ...result, backupFolder: `Backups/${date}/${time}` },
      });
      return result;
    } catch (err) {
      const wrapped = err instanceof AppError ? err : new AppError('RESTORE_FAILED', `Restore failed: ${err.message}`, 502);
      await auditService.log({
        actor,
        action: 'BACKUP_RESTORE_RECORD_FAILED',
        entity: sheet,
        entityId: recordId,
        newValue: { error: wrapped.message, backupFolder: `Backups/${date}/${time}` },
      });
      throw wrapped;
    }
  }
}

module.exports = new BackupService();
