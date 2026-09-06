/**
 * DELETE /students/:id — a genuine hard delete, but only allowed for a
 * student with zero real activity (no allocation, payment, or attendance
 * record ever created). Anyone with history must go through
 * /:id/deactivate instead — this endpoint refuses rather than silently
 * orphaning historical records.
 */
process.env.JWT_SECRET = 'test-secret';

jest.mock('../src/repositories', () => {
  const store = {
    Students: [],
    Seat_Allocations: [],
    Payments: [],
    Attendance: [],
    Student_Documents: [],
    Student_Vacations: [],
    Fee_Plans: [],
    Admins: [],
  };
  function makeRepo(sheetKey, idField) {
    return {
      findAll: jest.fn(async (filterFn) => (filterFn ? store[sheetKey].filter(filterFn) : store[sheetKey])),
      findById: jest.fn(async (id) => store[sheetKey].find((r) => r[idField] === id) || null),
      delete: jest.fn(async (id) => {
        store[sheetKey] = store[sheetKey].filter((r) => r[idField] !== id);
      }),
    };
  }
  return {
    __store: store,
    students: makeRepo('Students', 'student_id'),
    allocations: makeRepo('Seat_Allocations', 'allocation_id'),
    payments: makeRepo('Payments', 'payment_id'),
    attendance: makeRepo('Attendance', 'attendance_id'),
    studentDocuments: makeRepo('Student_Documents', 'document_id'),
    studentVacations: makeRepo('Student_Vacations', 'vacation_id'),
    feePlans: makeRepo('Fee_Plans', 'fee_plan_id'),
    admins: { findAll: jest.fn(async () => []), findById: jest.fn(async () => null) },
  };
});

jest.mock('../src/services/auditService', () => ({ log: jest.fn(async () => {}) }));
jest.mock('../src/services/googleDriveService', () => ({
  deleteFile: jest.fn(async () => {}),
}));

const request = require('supertest');
const authService = require('../src/services/authService');
const repos = require('../src/repositories');
const driveService = require('../src/services/googleDriveService');
const app = require('../src/app');

function adminToken() {
  return authService.issueToken({ sub: 'admin-1', type: 'admin', role: 'super_admin', name: 'Test Admin' });
}

function resetStore() {
  repos.__store.Students.length = 0;
  repos.__store.Seat_Allocations.length = 0;
  repos.__store.Payments.length = 0;
  repos.__store.Attendance.length = 0;
  repos.__store.Student_Documents.length = 0;
  repos.__store.Student_Vacations.length = 0;
  repos.__store.Fee_Plans.length = 0;
}

describe('DELETE /students/:id', () => {
  beforeEach(() => {
    resetStore();
    jest.clearAllMocks();
  });

  test('deletes a student with no history at all', async () => {
    repos.__store.Students.push({
      student_id: 'LIB-2026-0001', full_name: 'Test Student', status: 'active', password_hash: 'x',
    });
    const token = adminToken();
    const res = await request(app)
      .delete('/api/students/LIB-2026-0001')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(204);
    expect(repos.__store.Students).toHaveLength(0);
  });

  test('cleans up profile-only data (documents, vacations, fee plans) and their Drive files', async () => {
    repos.__store.Students.push({
      student_id: 'LIB-2026-0002', full_name: 'Test Student 2', status: 'active', password_hash: 'x',
      photo_drive_file_id: 'file-photo', signature_drive_file_id: 'file-sig',
    });
    repos.__store.Student_Documents.push({ document_id: 'doc-1', student_id: 'LIB-2026-0002', drive_file_id: 'file-doc' });
    repos.__store.Student_Vacations.push({ vacation_id: 'vac-1', student_id: 'LIB-2026-0002' });
    repos.__store.Fee_Plans.push({ fee_plan_id: 'fp-1', student_id: 'LIB-2026-0002' });

    const token = adminToken();
    const res = await request(app)
      .delete('/api/students/LIB-2026-0002')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(204);
    expect(repos.__store.Students).toHaveLength(0);
    expect(repos.__store.Student_Documents).toHaveLength(0);
    expect(repos.__store.Student_Vacations).toHaveLength(0);
    expect(repos.__store.Fee_Plans).toHaveLength(0);
    expect(driveService.deleteFile).toHaveBeenCalledWith('file-photo');
    expect(driveService.deleteFile).toHaveBeenCalledWith('file-sig');
    expect(driveService.deleteFile).toHaveBeenCalledWith('file-doc');
  });

  test('refuses to delete a student with an allocation', async () => {
    repos.__store.Students.push({ student_id: 'LIB-2026-0003', full_name: 'Has Allocation', status: 'active' });
    repos.__store.Seat_Allocations.push({ allocation_id: 'a1', student_id: 'LIB-2026-0003', status: 'active' });

    const token = adminToken();
    const res = await request(app)
      .delete('/api/students/LIB-2026-0003')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STUDENT_HAS_HISTORY');
    expect(repos.__store.Students).toHaveLength(1);
  });

  test('refuses to delete a student with a payment', async () => {
    repos.__store.Students.push({ student_id: 'LIB-2026-0004', full_name: 'Has Payment', status: 'active' });
    repos.__store.Payments.push({ payment_id: 'p1', student_id: 'LIB-2026-0004' });

    const token = adminToken();
    const res = await request(app)
      .delete('/api/students/LIB-2026-0004')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(409);
    expect(repos.__store.Students).toHaveLength(1);
  });

  test('refuses to delete a student with an attendance record', async () => {
    repos.__store.Students.push({ student_id: 'LIB-2026-0005', full_name: 'Has Attendance', status: 'active' });
    repos.__store.Attendance.push({ attendance_id: 'att1', student_id: 'LIB-2026-0005' });

    const token = adminToken();
    const res = await request(app)
      .delete('/api/students/LIB-2026-0005')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(409);
    expect(repos.__store.Students).toHaveLength(1);
  });

  test('404s for a student that does not exist', async () => {
    const token = adminToken();
    const res = await request(app)
      .delete('/api/students/does-not-exist')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});
