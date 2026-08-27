/**
 * GET /students now enriches each row with its automatic payment status
 * (dueDate/urgency) — the same billing-record-free calculation the seat
 * map uses — so the student list can show "due date" at a glance without
 * a separate round trip per student.
 */
process.env.JWT_SECRET = 'test-secret';

jest.mock('../src/repositories', () => {
  const store = {
    Students: [
      { student_id: 'LIB-2026-0001', full_name: 'Asha Rao', mobile: '9999900001', status: 'active', password_hash: 'x' },
    ],
    Seat_Allocations: [
      {
        allocation_id: 'a1', student_id: 'LIB-2026-0001', status: 'active',
        start_date: '2020-01-01', start_time: '06:00', end_time: '12:00', monthly_fee: 1000,
      },
    ],
    Payments: [],
    Admins: [],
  };
  return {
    __store: store,
    students: {
      findAll: jest.fn(async (filterFn) => (filterFn ? store.Students.filter(filterFn) : store.Students)),
      findById: jest.fn(async (id) => store.Students.find((s) => s.student_id === id) || null),
    },
    allocations: {
      findAll: jest.fn(async (filterFn) => (filterFn ? store.Seat_Allocations.filter(filterFn) : store.Seat_Allocations)),
    },
    payments: {
      findAll: jest.fn(async (filterFn) => (filterFn ? store.Payments.filter(filterFn) : store.Payments)),
    },
    admins: { findAll: jest.fn(async () => []), findById: jest.fn(async () => null) },
  };
});

jest.mock('../src/services/auditService', () => ({ log: jest.fn(async () => {}) }));

const request = require('supertest');
const authService = require('../src/services/authService');
const app = require('../src/app');

function adminToken() {
  return authService.issueToken({ sub: 'admin-1', type: 'admin', role: 'super_admin', name: 'Test Admin' });
}

describe('GET /students — automatic payment status enrichment', () => {
  test('includes paymentDueDate and paymentUrgency for a student with a long-overdue allocation', async () => {
    const token = adminToken();
    const res = await request(app).get('/api/students').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.students).toHaveLength(1);
    expect(res.body.students[0].paymentUrgency).toBe('overdue');
    expect(res.body.students[0].paymentDueDate).toBe('2020-01-01');
    // Still strips sensitive fields as before.
    expect(res.body.students[0].password_hash).toBeUndefined();
  });
});
