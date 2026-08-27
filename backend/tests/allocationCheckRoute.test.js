/**
 * Covers a bug where the add-student wizard's overlap-preview step called
 * plain POST /allocations with a fake studentId to "just check" for
 * conflicts — but that endpoint only skips persisting when there IS an
 * overlap warning (by design, for the real allocate flow); when there's no
 * conflict it silently creates a real, permanent allocation row for the
 * made-up student, leaving a ghost entry on the seat forever. POST
 * /allocations/check is a true dry-run: it must NEVER create an allocation,
 * warning or not.
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
      findAll: jest.fn(async (filterFn) => (filterFn ? store.Seat_Allocations.filter(filterFn) : store.Seat_Allocations)),
      create: jest.fn(async (rec) => {
        store.Seat_Allocations.push(rec);
        return rec;
      }),
    },
    students: { findById: jest.fn(async () => null), findAll: jest.fn(async () => []) },
    payments: { findAll: jest.fn(async () => []) },
    admins: { findAll: jest.fn(async () => []), findById: jest.fn(async () => null) },
    floors: { findAll: jest.fn(async () => []) },
    attendance: { findAll: jest.fn(async () => []) },
    notices: { findAll: jest.fn(async () => []) },
    settings: { findAll: jest.fn(async () => []) },
  };
});

jest.mock('../src/services/auditService', () => ({ log: jest.fn(async () => {}) }));
jest.mock('../src/services/feePlanService', () => ({ setFee: jest.fn(async () => {}) }));

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

describe('POST /allocations/check — dry-run overlap preview', () => {
  beforeEach(() => {
    resetStore();
  });

  test('never creates an allocation when there is no overlap', async () => {
    const token = adminToken();
    const res = await request(app)
      .post('/api/allocations/check')
      .set('Authorization', `Bearer ${token}`)
      .send({ seatId: 'seat-1', startTime: '06:00', endTime: '12:00' });

    expect(res.status).toBe(200);
    expect(res.body.warning).toBeFalsy();
    expect(repos.__store.Seat_Allocations).toHaveLength(0);
  });

  test('reports a warning but still never creates an allocation when times overlap', async () => {
    repos.__store.Seat_Allocations.push({
      allocation_id: 'a1', seat_id: 'seat-1', student_id: 'S-existing', status: 'active',
      start_time: '06:00', end_time: '14:00',
    });
    const token = adminToken();
    const res = await request(app)
      .post('/api/allocations/check')
      .set('Authorization', `Bearer ${token}`)
      .send({ seatId: 'seat-1', startTime: '10:00', endTime: '18:00' });

    expect(res.status).toBe(200);
    expect(res.body.warning).toMatch(/overlaps/i);
    // Still just the one pre-existing allocation — the check itself created nothing.
    expect(repos.__store.Seat_Allocations).toHaveLength(1);
  });

  test('works without a studentId at all (the add-student wizard has no student yet)', async () => {
    const token = adminToken();
    const res = await request(app)
      .post('/api/allocations/check')
      .set('Authorization', `Bearer ${token}`)
      .send({ seatId: 'seat-1', startTime: '06:00', endTime: '12:00' });
    expect(res.status).toBe(200);
    expect(repos.__store.Seat_Allocations).toHaveLength(0);
  });

  test('requires auth', async () => {
    const res = await request(app).post('/api/allocations/check').send({ seatId: 'seat-1', startTime: '06:00', endTime: '12:00' });
    expect(res.status).toBe(401);
  });
});
