/**
 * PATCH /allocations/:id — corrects an existing allocation's start date
 * (e.g. mis-entered at booking time). Reuses the same overlap-check the
 * create flow uses (excluding the allocation being edited), so moving a
 * date can't silently create an undetected seat double-booking — an
 * overlap is a warning the caller must explicitly confirm through, same
 * two-step flow as POST /allocations.
 */
process.env.JWT_SECRET = 'test-secret';

jest.mock('../src/repositories', () => {
  const store = {
    Seats: [{ seat_id: 'seat-1', status: 'available' }],
    Seat_Allocations: [],
    Students: [],
    Payments: [],
  };
  return {
    __store: store,
    seats: {
      findById: jest.fn(async (id) => store.Seats.find((s) => s.seat_id === id) || null),
    },
    allocations: {
      findById: jest.fn(async (id) => store.Seat_Allocations.find((a) => a.allocation_id === id) || null),
      findAll: jest.fn(async (filterFn) => (filterFn ? store.Seat_Allocations.filter(filterFn) : store.Seat_Allocations)),
      update: jest.fn(async (id, patch) => {
        const a = store.Seat_Allocations.find((x) => x.allocation_id === id);
        Object.assign(a, patch);
        return a;
      }),
    },
    students: { findById: jest.fn(async () => null), findAll: jest.fn(async () => []) },
    payments: { findAll: jest.fn(async () => []) },
    admins: { findAll: jest.fn(async () => []), findById: jest.fn(async () => null) },
  };
});

jest.mock('../src/services/auditService', () => ({ log: jest.fn(async () => {}) }));

const request = require('supertest');
const authService = require('../src/services/authService');
const repos = require('../src/repositories');
const app = require('../src/app');

function adminToken() {
  return authService.issueToken({ sub: 'admin-1', type: 'admin', role: 'super_admin', name: 'Test Admin' });
}

function resetStore() {
  repos.__store.Seat_Allocations.length = 0;
}

describe('PATCH /allocations/:id — edit start date', () => {
  beforeEach(() => resetStore());

  test('updates the start date when there is no overlap', async () => {
    repos.__store.Seat_Allocations.push({
      allocation_id: 'a1', seat_id: 'seat-1', student_id: 'S-1', status: 'active',
      start_time: '06:00', end_time: '12:00', start_date: '2026-01-01',
    });
    const token = adminToken();
    const res = await request(app)
      .patch('/api/allocations/a1')
      .set('Authorization', `Bearer ${token}`)
      .send({ startDate: '2026-01-05' });

    expect(res.status).toBe(200);
    expect(res.body.allocation.start_date).toBe('2026-01-05');
    expect(res.body.requiresConfirmation).toBeUndefined();
  });

  test('returns a warning without saving when the new date range overlaps another allocation on the seat', async () => {
    repos.__store.Seat_Allocations.push(
      { allocation_id: 'a1', seat_id: 'seat-1', student_id: 'S-1', status: 'active', start_time: '06:00', end_time: '12:00', start_date: '2026-01-01' },
      { allocation_id: 'a2', seat_id: 'seat-1', student_id: 'S-2', status: 'active', start_time: '10:00', end_time: '18:00', start_date: '2026-02-01' }
    );
    const token = adminToken();
    const res = await request(app)
      .patch('/api/allocations/a1')
      .set('Authorization', `Bearer ${token}`)
      .send({ startDate: '2026-01-10' });

    expect(res.status).toBe(200);
    expect(res.body.requiresConfirmation).toBe(true);
    expect(res.body.warning).toMatch(/overlaps/i);
    // Unchanged — the check-only call must not have saved anything.
    expect(repos.__store.Seat_Allocations.find((a) => a.allocation_id === 'a1').start_date).toBe('2026-01-01');
  });

  test('saves once the overlap warning is explicitly confirmed', async () => {
    repos.__store.Seat_Allocations.push(
      { allocation_id: 'a1', seat_id: 'seat-1', student_id: 'S-1', status: 'active', start_time: '06:00', end_time: '12:00', start_date: '2026-01-01' },
      { allocation_id: 'a2', seat_id: 'seat-1', student_id: 'S-2', status: 'active', start_time: '10:00', end_time: '18:00', start_date: '2026-02-01' }
    );
    const token = adminToken();
    const res = await request(app)
      .patch('/api/allocations/a1')
      .set('Authorization', `Bearer ${token}`)
      .send({ startDate: '2026-01-10', confirmOverlap: true });

    expect(res.status).toBe(200);
    expect(res.body.allocation.start_date).toBe('2026-01-10');
  });

  test('refuses to edit an ended allocation', async () => {
    repos.__store.Seat_Allocations.push({
      allocation_id: 'a1', seat_id: 'seat-1', student_id: 'S-1', status: 'ended',
      start_time: '06:00', end_time: '12:00', start_date: '2026-01-01', actual_end_date: '2026-02-01',
    });
    const token = adminToken();
    const res = await request(app)
      .patch('/api/allocations/a1')
      .set('Authorization', `Bearer ${token}`)
      .send({ startDate: '2026-01-05' });

    expect(res.status).toBe(400);
  });

  test('rejects a start date after the allocation\'s own end date', async () => {
    repos.__store.Seat_Allocations.push({
      allocation_id: 'a1', seat_id: 'seat-1', student_id: 'S-1', status: 'active',
      start_time: '06:00', end_time: '12:00', start_date: '2026-01-01', actual_end_date: '',
    });
    // Give it an end date via update to simulate an in-progress edit scenario.
    repos.__store.Seat_Allocations[0].actual_end_date = '2026-01-10';
    const token = adminToken();
    const res = await request(app)
      .patch('/api/allocations/a1')
      .set('Authorization', `Bearer ${token}`)
      .send({ startDate: '2026-02-01' });

    expect(res.status).toBe(400);
  });

  test('404s for a non-existent allocation', async () => {
    const token = adminToken();
    const res = await request(app)
      .patch('/api/allocations/does-not-exist')
      .set('Authorization', `Bearer ${token}`)
      .send({ startDate: '2026-01-05' });

    expect(res.status).toBe(404);
  });
});
