/**
 * PATCH /floors/:id/resize — growing/shrinking a floor's seat grid after
 * creation. Growing adds new (or revives previously-removed) seats;
 * shrinking removes seats from the end, non-destructively (marked
 * 'removed', never deleted), and is blocked if any of those seats has an
 * active/scheduled allocation.
 */
process.env.JWT_SECRET = 'test-secret';

jest.mock('../src/repositories', () => {
  const store = {
    Floors: [],
    Seats: [],
    Seat_Allocations: [],
    Students: [],
    Payments: [],
  };
  let seatSeq = 0;
  return {
    __store: store,
    floors: {
      findById: jest.fn(async (id) => store.Floors.find((f) => f.floor_id === id) || null),
      update: jest.fn(async (id, patch) => {
        const f = store.Floors.find((x) => x.floor_id === id);
        Object.assign(f, patch);
        return f;
      }),
    },
    seats: {
      findAll: jest.fn(async (filterFn) => (filterFn ? store.Seats.filter(filterFn) : store.Seats)),
      create: jest.fn(async (rec) => {
        store.Seats.push(rec);
        return rec;
      }),
      update: jest.fn(async (id, patch) => {
        const s = store.Seats.find((x) => x.seat_id === id);
        Object.assign(s, patch);
        return s;
      }),
    },
    allocations: {
      findAll: jest.fn(async (filterFn) => (filterFn ? store.Seat_Allocations.filter(filterFn) : store.Seat_Allocations)),
    },
    students: { findById: jest.fn(async () => null), findAll: jest.fn(async () => []) },
    payments: { findAll: jest.fn(async () => []) },
    admins: { findAll: jest.fn(async () => []), findById: jest.fn(async () => null) },
    attendance: { findAll: jest.fn(async () => []) },
    notices: { findAll: jest.fn(async () => []) },
    settings: { findAll: jest.fn(async () => []) },
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

function seedFloor(rows, columns) {
  repos.__store.Floors.length = 0;
  repos.__store.Seats.length = 0;
  repos.__store.Seat_Allocations.length = 0;
  repos.__store.Floors.push({ floor_id: 'floor-1', floor_name: 'Floor 1', rows, columns });
  const total = rows * columns;
  for (let n = 1; n <= total; n++) {
    repos.__store.Seats.push({ seat_id: `seat-${n}`, floor_id: 'floor-1', seat_number: n, status: 'available' });
  }
}

describe('PATCH /floors/:id/resize', () => {
  test('growing the grid adds new seats numbered beyond the current total', async () => {
    seedFloor(2, 2); // 4 seats
    const token = adminToken();
    const res = await request(app)
      .patch('/api/floors/floor-1/resize')
      .set('Authorization', `Bearer ${token}`)
      .send({ rows: 2, columns: 3 }); // 6 seats

    expect(res.status).toBe(200);
    expect(res.body.seatsAdded).toBe(2);
    expect(res.body.seatsRemoved).toBe(0);
    expect(repos.__store.Seats.filter((s) => s.status !== 'removed')).toHaveLength(6);
    expect(res.body.floor.rows).toBe(2);
    expect(res.body.floor.columns).toBe(3);
  });

  test('shrinking removes seats from the end without hard-deleting them', async () => {
    seedFloor(2, 3); // 6 seats
    const token = adminToken();
    const res = await request(app)
      .patch('/api/floors/floor-1/resize')
      .set('Authorization', `Bearer ${token}`)
      .send({ rows: 2, columns: 2 }); // 4 seats

    expect(res.status).toBe(200);
    expect(res.body.seatsRemoved).toBe(2);
    // Still in the store (non-destructive), just marked removed.
    expect(repos.__store.Seats).toHaveLength(6);
    const removed = repos.__store.Seats.filter((s) => s.status === 'removed');
    expect(removed.map((s) => s.seat_number).sort()).toEqual([5, 6]);
  });

  test('refuses to shrink past a seat with an active allocation', async () => {
    seedFloor(2, 3); // 6 seats
    repos.__store.Seat_Allocations.push({
      allocation_id: 'a1', seat_id: 'seat-5', student_id: 'S-1', status: 'active',
    });
    const token = adminToken();
    const res = await request(app)
      .patch('/api/floors/floor-1/resize')
      .set('Authorization', `Bearer ${token}`)
      .send({ rows: 2, columns: 2 }); // would remove seat 5 and 6

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/seat.*5/i);
    // Nothing was removed.
    expect(repos.__store.Seats.filter((s) => s.status === 'removed')).toHaveLength(0);
  });

  test('re-growing after a shrink revives the previously-removed seat rather than duplicating it', async () => {
    seedFloor(2, 3); // 6 seats
    const token = adminToken();
    await request(app)
      .patch('/api/floors/floor-1/resize')
      .set('Authorization', `Bearer ${token}`)
      .send({ rows: 2, columns: 2 }); // shrink to 4, removes seat 5 & 6

    const res = await request(app)
      .patch('/api/floors/floor-1/resize')
      .set('Authorization', `Bearer ${token}`)
      .send({ rows: 2, columns: 3 }); // grow back to 6

    expect(res.status).toBe(200);
    expect(res.body.seatsAdded).toBe(2);
    // Still exactly 6 seat rows total — the old ones were revived, not duplicated.
    expect(repos.__store.Seats).toHaveLength(6);
    expect(repos.__store.Seats.filter((s) => s.status === 'available')).toHaveLength(6);
  });
});
