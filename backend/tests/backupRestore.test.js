jest.mock('../src/services/googleSheetsService', () => ({
  getMany: jest.fn(),
  overwriteSheet: jest.fn(async () => ({ count: 1 })),
  findById: jest.fn(),
  updateById: jest.fn(async (sheet, idCol, id, patch) => ({ [idCol]: id, ...patch })),
  append: jest.fn(async (sheet, obj) => obj),
}));
jest.mock('../src/services/googleDriveService', () => ({
  uploadBuffer: jest.fn(async () => ({ fileId: 'file-1' })),
  resolvePath: jest.fn(),
  listFiles: jest.fn(),
  getFileBuffer: jest.fn(),
}));
jest.mock('../src/services/auditService', () => ({ log: jest.fn(async () => {}) }));

const sheetsService = require('../src/services/googleSheetsService');
const driveService = require('../src/services/googleDriveService');
const auditService = require('../src/services/auditService');
const backupService = require('../src/services/backupService');

beforeEach(() => {
  jest.clearAllMocks();
});

function csvOf(rows) {
  return Buffer.from(rows.map((r) => r.join(',')).join('\n'), 'utf8');
}

describe('backupService.listBackups', () => {
  test('returns [] when no Backups folder exists yet', async () => {
    driveService.resolvePath.mockResolvedValueOnce(null);
    const backups = await backupService.listBackups();
    expect(backups).toEqual([]);
    expect(driveService.listFiles).not.toHaveBeenCalled();
  });

  test('lists every date/time folder pair, oldest first', async () => {
    driveService.resolvePath.mockResolvedValueOnce('backups-folder-id');
    driveService.listFiles.mockImplementation(async (folderId) => {
      if (folderId === 'backups-folder-id') {
        return [
          { id: 'd2', name: '2026-08-21', mimeType: 'application/vnd.google-apps.folder' },
          { id: 'd1', name: '2026-08-20', mimeType: 'application/vnd.google-apps.folder' },
        ];
      }
      if (folderId === 'd1') return [{ id: 't1', name: '0200', mimeType: 'application/vnd.google-apps.folder' }];
      if (folderId === 'd2') return [{ id: 't2', name: '0200', mimeType: 'application/vnd.google-apps.folder' }];
      return [];
    });

    const backups = await backupService.listBackups();
    expect(backups).toEqual([
      { date: '2026-08-20', time: '0200' },
      { date: '2026-08-21', time: '0200' },
    ]);
  });
});

describe('backupService.restoreBackup', () => {
  test('requires date and time', async () => {
    await expect(backupService.restoreBackup({})).rejects.toThrow(/date and time are required/);
  });

  test('throws NOT_FOUND when the backup folder does not exist', async () => {
    driveService.resolvePath.mockResolvedValueOnce(null);
    await expect(backupService.restoreBackup({ date: '2026-08-20', time: '0200' })).rejects.toThrow(
      /No backup found/
    );
  });

  test('overwrites each sheet from its CSV and skips sheets with no CSV in the backup', async () => {
    driveService.resolvePath.mockResolvedValueOnce('folder-1');
    driveService.listFiles.mockResolvedValueOnce([
      { id: 'f-students', name: 'Students.csv' },
      { id: 'f-manifest', name: 'manifest.json' },
    ]);
    driveService.getFileBuffer.mockImplementation(async (fileId) => {
      if (fileId === 'f-students') {
        return csvOf([['student_id', 'full_name'], ['LIB-2026-0001', 'Rahul']]);
      }
      if (fileId === 'f-manifest') {
        return Buffer.from(JSON.stringify({ generatedAt: '2026-08-20T02:00:00.000Z' }), 'utf8');
      }
      throw new Error('unexpected file');
    });

    const result = await backupService.restoreBackup({
      date: '2026-08-20',
      time: '0200',
      sheets: ['Students', 'Payments'],
      actor: { id: 'admin-1', name: 'Owner' },
    });

    expect(sheetsService.overwriteSheet).toHaveBeenCalledTimes(1);
    expect(sheetsService.overwriteSheet).toHaveBeenCalledWith('Students', [
      { student_id: 'LIB-2026-0001', full_name: 'Rahul' },
    ]);
    expect(result.restoredCounts).toEqual({ Students: 1 });
    expect(result.skippedSheets).toEqual(['Payments']);
    expect(result.manifest.generatedAt).toBe('2026-08-20T02:00:00.000Z');
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'BACKUP_RESTORE' }));
  });

  test('parses CSV fields with embedded commas, quotes, and newlines correctly', async () => {
    driveService.resolvePath.mockResolvedValueOnce('folder-1');
    driveService.listFiles.mockResolvedValueOnce([{ id: 'f-notices', name: 'Notices.csv' }]);
    driveService.getFileBuffer.mockResolvedValueOnce(
      Buffer.from('notice_id,title_en\nn1,"Hello, ""world""\nnext line"', 'utf8')
    );

    const result = await backupService.restoreBackup({ date: '2026-08-20', time: '0200', sheets: ['Notices'] });

    expect(sheetsService.overwriteSheet).toHaveBeenCalledWith('Notices', [
      { notice_id: 'n1', title_en: 'Hello, "world"\nnext line' },
    ]);
    expect(result.restoredCounts.Notices).toBe(1);
  });

  test('logs a failure and rethrows if overwriting a sheet errors partway through', async () => {
    driveService.resolvePath.mockResolvedValueOnce('folder-1');
    driveService.listFiles.mockResolvedValueOnce([{ id: 'f-students', name: 'Students.csv' }]);
    driveService.getFileBuffer.mockResolvedValueOnce(csvOf([['student_id'], ['LIB-2026-0001']]));
    sheetsService.overwriteSheet.mockRejectedValueOnce(new Error('Sheets outage'));

    await expect(
      backupService.restoreBackup({ date: '2026-08-20', time: '0200', sheets: ['Students'] })
    ).rejects.toThrow(/Restore failed/);

    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'BACKUP_RESTORE_FAILED' }));
  });
});

describe('backupService.restoreRecord', () => {
  test('requires date, time, sheet and recordId', async () => {
    await expect(backupService.restoreRecord({})).rejects.toThrow(/all required/);
    await expect(backupService.restoreRecord({ date: '2026-08-20', time: '0200', sheet: 'Students' })).rejects.toThrow(
      /all required/
    );
  });

  test('rejects an unknown sheet name', async () => {
    await expect(
      backupService.restoreRecord({ date: '2026-08-20', time: '0200', sheet: 'Not_A_Sheet', recordId: 'x' })
    ).rejects.toThrow(/Unknown sheet/);
  });

  test('throws NOT_FOUND when the backup folder does not exist', async () => {
    driveService.resolvePath.mockResolvedValueOnce(null);
    await expect(
      backupService.restoreRecord({ date: '2026-08-20', time: '0200', sheet: 'Students', recordId: 'LIB-2026-0001' })
    ).rejects.toThrow(/No backup found/);
  });

  test('throws NOT_FOUND when the sheet has no CSV in that backup', async () => {
    driveService.resolvePath.mockResolvedValueOnce('folder-1');
    driveService.listFiles.mockResolvedValueOnce([{ id: 'f-payments', name: 'Payments.csv' }]);
    await expect(
      backupService.restoreRecord({ date: '2026-08-20', time: '0200', sheet: 'Students', recordId: 'LIB-2026-0001' })
    ).rejects.toThrow(/No Students.csv found/);
  });

  test('throws NOT_FOUND when the record id is not in the backup CSV', async () => {
    driveService.resolvePath.mockResolvedValueOnce('folder-1');
    driveService.listFiles.mockResolvedValueOnce([{ id: 'f-students', name: 'Students.csv' }]);
    driveService.getFileBuffer.mockResolvedValueOnce(csvOf([['student_id', 'full_name'], ['LIB-2026-0001', 'Rahul']]));
    await expect(
      backupService.restoreRecord({ date: '2026-08-20', time: '0200', sheet: 'Students', recordId: 'LIB-2026-9999' })
    ).rejects.toThrow(/was not found in Backups/);
  });

  test('updates the live row in place when it still exists', async () => {
    driveService.resolvePath.mockResolvedValueOnce('folder-1');
    driveService.listFiles.mockResolvedValueOnce([{ id: 'f-students', name: 'Students.csv' }]);
    driveService.getFileBuffer.mockResolvedValueOnce(
      csvOf([['student_id', 'full_name'], ['LIB-2026-0001', 'Rahul Original']])
    );
    sheetsService.findById.mockResolvedValueOnce({ row: { student_id: 'LIB-2026-0001', full_name: 'Rahul Edited' }, rowNumber: 5 });

    const result = await backupService.restoreRecord({
      date: '2026-08-20',
      time: '0200',
      sheet: 'Students',
      recordId: 'LIB-2026-0001',
      actor: { id: 'admin-1', name: 'Owner' },
    });

    expect(sheetsService.updateById).toHaveBeenCalledWith('Students', 'student_id', 'LIB-2026-0001', {
      student_id: 'LIB-2026-0001',
      full_name: 'Rahul Original',
    });
    expect(sheetsService.append).not.toHaveBeenCalled();
    expect(result.action).toBe('updated');
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'BACKUP_RESTORE_RECORD' }));
  });

  test('re-appends the record when it was deleted from the live sheet', async () => {
    driveService.resolvePath.mockResolvedValueOnce('folder-1');
    driveService.listFiles.mockResolvedValueOnce([{ id: 'f-students', name: 'Students.csv' }]);
    driveService.getFileBuffer.mockResolvedValueOnce(
      csvOf([['student_id', 'full_name'], ['LIB-2026-0001', 'Rahul']])
    );
    sheetsService.findById.mockResolvedValueOnce(null);

    const result = await backupService.restoreRecord({
      date: '2026-08-20',
      time: '0200',
      sheet: 'Students',
      recordId: 'LIB-2026-0001',
    });

    expect(sheetsService.append).toHaveBeenCalledWith('Students', { student_id: 'LIB-2026-0001', full_name: 'Rahul' });
    expect(sheetsService.updateById).not.toHaveBeenCalled();
    expect(result.action).toBe('recreated');
  });

  test('logs a failure and rethrows if the write fails', async () => {
    driveService.resolvePath.mockResolvedValueOnce('folder-1');
    driveService.listFiles.mockResolvedValueOnce([{ id: 'f-students', name: 'Students.csv' }]);
    driveService.getFileBuffer.mockResolvedValueOnce(csvOf([['student_id', 'full_name'], ['LIB-2026-0001', 'Rahul']]));
    sheetsService.findById.mockResolvedValueOnce(null);
    sheetsService.append.mockRejectedValueOnce(new Error('Sheets outage'));

    await expect(
      backupService.restoreRecord({ date: '2026-08-20', time: '0200', sheet: 'Students', recordId: 'LIB-2026-0001' })
    ).rejects.toThrow(/Restore failed/);

    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'BACKUP_RESTORE_RECORD_FAILED' }));
  });
});
