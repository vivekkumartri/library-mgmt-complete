/**
 * Section 63 calls out student auth-isolation as a critical rule that must
 * be tested explicitly: a logged-in student may only ever see their own
 * records, never another student's, even when they guess a valid ID or
 * query for it. This exercises the real Express routes end-to-end
 * (supertest) rather than the underlying services, since the isolation
 * check lives in the route handlers themselves (see studentRoutes.js and
 * financeRoutes.js).
 */
process.env.JWT_SECRET = 'test-secret';

jest.mock('../src/repositories', () => {
  const store = {
    Students: [
      { student_id: 'LIB-2026-0001', full_name: 'Asha Rao', status: 'active', password_hash: 'x' },
      { student_id: 'LIB-2026-0002', full_name: 'Neha Iyer', status: 'active', password_hash: 'x' },
    ],
    Monthly_Billing: [
      { billing_id: 'bill-1', student_id: 'LIB-2026-0001', payable: 1000, paid: 0, status: 'pending' },
      { billing_id: 'bill-2', student_id: 'LIB-2026-0002', payable: 1200, paid: 0, status: 'pending' },
    ],
    Payments: [
      { payment_id: 'pay-1', student_id: 'LIB-2026-0001', billing_id: 'bill-1', amount: 500 },
      { payment_id: 'pay-2', student_id: 'LIB-2026-0002', billing_id: 'bill-2', amount: 600 },
    ],
  };
  return {
    __store: store,
    students: {
      findById: jest.fn(async (id) => store.Students.find((s) => s.student_id === id) || null),
      findAll: jest.fn(async (filterFn) => (filterFn ? store.Students.filter(filterFn) : store.Students)),
    },
    billing: {
      findAll: jest.fn(async (filterFn) => (filterFn ? store.Monthly_Billing.filter(filterFn) : store.Monthly_Billing)),
      findById: jest.fn(async (id) => store.Monthly_Billing.find((b) => b.billing_id === id) || null),
    },
    payments: {
      findAll: jest.fn(async (filterFn) => (filterFn ? store.Payments.filter(filterFn) : store.Payments)),
      findById: jest.fn(async (id) => store.Payments.find((p) => p.payment_id === id) || null),
    },
    admins: { findAll: jest.fn(async () => []), findById: jest.fn(async () => null) },
    floors: { findAll: jest.fn(async () => []) },
    seats: { findAll: jest.fn(async () => []) },
    allocations: { findAll: jest.fn(async () => []) },
    attendance: { findAll: jest.fn(async () => []) },
    notices: { findAll: jest.fn(async () => []) },
    settings: { findAll: jest.fn(async () => []), get: jest.fn(async () => ({})) },
    auditLog: { create: jest.fn(async () => {}) },
  };
});

const request = require('supertest');
const authService = require('../src/services/authService');
const app = require('../src/app');

function tokenFor(studentId, name) {
  return authService.issueToken({ sub: studentId, type: 'student', name });
}

describe('student auth isolation', () => {
  test('a student can fetch their own profile', async () => {
    const token = tokenFor('LIB-2026-0001', 'Asha Rao');
    const res = await request(app).get('/api/students/LIB-2026-0001').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.student.student_id).toBe('LIB-2026-0001');
  });

  test('a student is forbidden from fetching another student\'s profile', async () => {
    const token = tokenFor('LIB-2026-0001', 'Asha Rao');
    const res = await request(app).get('/api/students/LIB-2026-0002').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  test('GET /billing for a student only returns their own billing records, even without a studentId filter', async () => {
    const token = tokenFor('LIB-2026-0001', 'Asha Rao');
    const res = await request(app).get('/api/billing').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.billing).toHaveLength(1);
    expect(res.body.billing[0].student_id).toBe('LIB-2026-0001');
  });

  test('GET /billing for a student ignores an attempt to query another student\'s ID', async () => {
    const token = tokenFor('LIB-2026-0001', 'Asha Rao');
    const res = await request(app).get('/api/billing').query({ studentId: 'LIB-2026-0002' }).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    // The student-type filter is applied first and unconditionally, so the
    // spoofed studentId query param can only narrow within their own rows —
    // it can never widen access to someone else's.
    expect(res.body.billing).toHaveLength(0);
  });

  test('GET /payments for a student only returns their own payments', async () => {
    const token = tokenFor('LIB-2026-0002', 'Neha Iyer');
    const res = await request(app).get('/api/payments').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.payments).toHaveLength(1);
    expect(res.body.payments[0].student_id).toBe('LIB-2026-0002');
  });

  test('requests without a token are rejected', async () => {
    const res = await request(app).get('/api/students/LIB-2026-0001');
    expect(res.status).toBe(401);
  });

  test('a tampered/invalid token is rejected', async () => {
    const res = await request(app).get('/api/students/LIB-2026-0001').set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });
});
