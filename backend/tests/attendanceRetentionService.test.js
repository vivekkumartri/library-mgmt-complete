jest.mock('../src/repositories', () => {
  const store = { Attendance: [], Settings: [] };
  return {
    __store: store,
    attendance: {
      findAll: jest.fn(async (filterFn) => (filterFn ? store.Attendance.filter(filterFn) : store.Attendance)),
    },
    settings: {
      findById: jest.fn(async (key) => store.Settings.find((s) => s.key === key) || null),
    },
  };
});

jest.mock('../src/services/googleSheetsService', () => ({
  overwriteSheet: jest.fn(async () => ({})),
}));

jest.mock('../src/services/auditService', () => ({ log: jest.fn(async () => {}) }));

const repos = require('../src/repositories');
const sheetsService = require('../src/services/googleSheetsService');
const attendanceRetentionService = require('../src/services/attendanceRetentionService');

function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function resetStore() {
  repos.__store.Attendance.length = 0;
  repos.__store.Settings.length = 0;
  jest.clearAllMocks();
}

describe('attendanceRetentionService', () => {
  beforeEach(resetStore);

  test('defaults to a 365-day retention window when no setting exists', async () => {
    expect(await attendanceRetentionService.getRetentionDays()).toBe(365);
  });

  test('reads the retention window from Settings when set — this is what makes it "dynamic"', async () => {
    repos.__store.Settings.push({ key: 'attendance_retention_days', value: '30' });
    expect(await attendanceRetentionService.getRetentionDays()).toBe(30);
  });

  test('ignores a garbage/non-numeric setting and falls back to the default', async () => {
    repos.__store.Settings.push({ key: 'attendance_retention_days', value: 'not-a-number' });
    expect(await attendanceRetentionService.getRetentionDays()).toBe(365);
  });

  test('purges rows older than the retention window, keeps everything else', async () => {
    repos.__store.Attendance.push(
      { attendance_id: 'a1', student_id: 'S1', date: isoDaysAgo(400), status: 'present' }, // too old
      { attendance_id: 'a2', student_id: 'S1', date: isoDaysAgo(370), status: 'present' }, // too old
      { attendance_id: 'a3', student_id: 'S1', date: isoDaysAgo(100), status: 'present' }, // kept
      { attendance_id: 'a4', student_id: 'S1', date: isoDaysAgo(0), status: 'present' } // kept
    );
    const result = await attendanceRetentionService.purgeOldAttendance({ id: 'admin-1', name: 'Test Admin' });
    expect(result.purgedCount).toBe(2);
    expect(result.remaining).toBe(2);
    expect(sheetsService.overwriteSheet).toHaveBeenCalledWith(
      'Attendance',
      expect.arrayContaining([
        expect.objectContaining({ attendance_id: 'a3' }),
        expect.objectContaining({ attendance_id: 'a4' }),
      ])
    );
    const kept = sheetsService.overwriteSheet.mock.calls[0][1];
    expect(kept).toHaveLength(2);
  });

  test('a custom retention window changes what counts as too old', async () => {
    repos.__store.Settings.push({ key: 'attendance_retention_days', value: '30' });
    repos.__store.Attendance.push(
      { attendance_id: 'a1', student_id: 'S1', date: isoDaysAgo(60), status: 'present' }, // now too old
      { attendance_id: 'a2', student_id: 'S1', date: isoDaysAgo(10), status: 'present' } // kept
    );
    const result = await attendanceRetentionService.purgeOldAttendance();
    expect(result.retentionDays).toBe(30);
    expect(result.purgedCount).toBe(1);
  });

  test('is a no-op (never calls overwriteSheet) when nothing is old enough to purge', async () => {
    repos.__store.Attendance.push({ attendance_id: 'a1', student_id: 'S1', date: isoDaysAgo(5), status: 'present' });
    const result = await attendanceRetentionService.purgeOldAttendance();
    expect(result.purgedCount).toBe(0);
    expect(sheetsService.overwriteSheet).not.toHaveBeenCalled();
  });
});
