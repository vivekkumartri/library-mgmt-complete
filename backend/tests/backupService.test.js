jest.mock('../src/services/googleSheetsService', () => ({
  getMany: jest.fn(),
}));
jest.mock('../src/services/googleDriveService', () => ({
  uploadBuffer: jest.fn(async () => ({ fileId: 'file-1' })),
}));
jest.mock('../src/services/auditService', () => ({ log: jest.fn(async () => {}) }));

const sheetsService = require('../src/services/googleSheetsService');
const driveService = require('../src/services/googleDriveService');
const auditService = require('../src/services/auditService');
const backupService = require('../src/services/backupService');
const { SHEETS } = require('../src/config/sheetsSchema');

function fakeBySheet() {
  const out = {};
  for (const name of Object.keys(SHEETS)) {
    out[name] = { rows: name === 'Students' ? [{ student_id: 'LIB-2026-0001', full_name: 'Rahul' }] : [] };
  }
  return out;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('backupService.runBackup', () => {
  test('uploads one CSV per sheet plus a manifest, and records last run', async () => {
    sheetsService.getMany.mockResolvedValueOnce(fakeBySheet());

    const result = await backupService.runBackup({ actor: { id: 'admin-1', name: 'Owner' } });

    expect(result.ok).toBe(true);
    expect(result.sheetCounts.Students).toBe(1);
    expect(result.sheetCounts.Payments).toBe(0);

    // One upload per sheet + one manifest.
    expect(driveService.uploadBuffer).toHaveBeenCalledTimes(Object.keys(SHEETS).length + 1);

    const studentsCall = driveService.uploadBuffer.mock.calls.find((c) => c[0].fileName === 'Students.csv');
    expect(studentsCall).toBeTruthy();
    expect(studentsCall[0].pathSegments[0]).toBe('Backups');
    const csv = studentsCall[0].buffer.toString('utf8');
    expect(csv).toContain('student_id');
    expect(csv).toContain('LIB-2026-0001');

    const manifestCall = driveService.uploadBuffer.mock.calls.find((c) => c[0].fileName === 'manifest.json');
    expect(manifestCall).toBeTruthy();
    const manifest = JSON.parse(manifestCall[0].buffer.toString('utf8'));
    expect(manifest.totalRows).toBe(1);

    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'BACKUP_RUN' }));
    expect(backupService.lastRun().ok).toBe(true);

    // Fresh reads only — a backup must never serve stale cached rows.
    expect(sheetsService.getMany).toHaveBeenCalledWith(expect.any(Array), { fresh: true });
  });

  test('records a failed run and rethrows instead of pretending success', async () => {
    sheetsService.getMany.mockRejectedValueOnce(new Error('Sheets outage'));

    await expect(backupService.runBackup({ actor: { id: 'admin-1' } })).rejects.toThrow(/Backup failed/);
    expect(backupService.lastRun().ok).toBe(false);
    expect(backupService.lastRun().error).toMatch(/Sheets outage/);
  });

  test('CSV-escapes fields containing commas, quotes, or newlines', async () => {
    const bySheet = fakeBySheet();
    bySheet.Notices = { rows: [{ notice_id: 'n1', title_en: 'Hello, "world"\nnext line' }] };
    sheetsService.getMany.mockResolvedValueOnce(bySheet);

    await backupService.runBackup({});

    const noticesCall = driveService.uploadBuffer.mock.calls.find((c) => c[0].fileName === 'Notices.csv');
    const csv = noticesCall[0].buffer.toString('utf8');
    expect(csv).toContain('"Hello, ""world""\nnext line"');
  });
});
