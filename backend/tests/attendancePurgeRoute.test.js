process.env.JWT_SECRET = 'test-secret';

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
    admins: { findAll: jest.fn(async () => []), findById: jest.fn(async () => null) },
    students: { findAll: jest.fn(async () => []) },
  };
});

jest.mock('../src/services/googleSheetsService', () => ({
  overwriteSheet: jest.fn(async () => ({})),
}));

jest.mock('../src/services/auditService', () => ({ log: jest.fn(async () => {}) }));

const request = require('supertest');
const authService = require('../src/services/authService');
const repos = require('../src/repositories');
const app = require('../src/app');

function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function tokenFor(type, role) {
  return authService.issueToken({ sub: 'u1', type, role, name: 'Test User' });
}

describe('POST /attendance/purge', () => {
  beforeEach(() => {
    repos.__store.Attendance.length = 0;
    repos.__store.Settings.length = 0;
  });

  test('super admin can trigger a purge on demand', async () => {
    repos.__store.Attendance.push({ attendance_id: 'a1', student_id: 'S1', date: isoDaysAgo(400), status: 'present' });
    const res = await request(app)
      .post('/api/attendance/purge')
      .set('Authorization', `Bearer ${tokenFor('admin', 'super_admin')}`);
    expect(res.status).toBe(200);
    expect(res.body.purgedCount).toBe(1);
  });

  test('a regular staff admin (not super admin) is forbidden', async () => {
    const res = await request(app)
      .post('/api/attendance/purge')
      .set('Authorization', `Bearer ${tokenFor('admin', 'staff')}`);
    expect(res.status).toBe(403);
  });

  test('a student is forbidden', async () => {
    const res = await request(app)
      .post('/api/attendance/purge')
      .set('Authorization', `Bearer ${tokenFor('student')}`);
    expect(res.status).toBe(403);
  });
});
