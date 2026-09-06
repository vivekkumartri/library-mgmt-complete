/**
 * PATCH /floors/:id/resize — growing/shrinking a floor's seat grid after
 * creation, row by row. Rows can have different widths; growing a row adds
 * new (or revives previously-removed) seats at its end, shrinking removes
 * seats from its end non-destructively (marked 'removed', never deleted),
 * and is blocked if any of those seats has an active/scheduled allocation.
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

/** Seeds a floor with a uniform grid — rowConfig = Array(rows).fill(columns). */
function seedFloor(rowConfig) {
  repos.__store.Floors.length = 0;
  repos.__store.Seats.length = 0;
  repos.__store.Seat_Allocations.length = 0;
  repos.__store.Floors.push({
    floor_id: 'floor-1',
    floor_name: 'Floor 1',
    rows: rowConfig.length,
    columns: Math.max(...rowConfig),
    row_config_json: JSON.stringify(rowConfig),
  });
  let seatNumber = 1;
  rowConfig.forEach((width, rowIdx) => {
    for (let col = 1; col <= width; col++) {
      repos.__store.Seats.push({
        seat_id: `seat-${seatNumber}`,
        floor_id: 'floor-1',
        seat_number: seatNumber,
        status: 'available',
        row_number: rowIdx + 1,
        col_number: col,
      });
      seatNumber++;
    }
  });
}

describe('PATCH /floors/:id/resize', () => {
  test('growing a row adds new seats numbered beyond the current total', async () => {
    seedFloor([2, 2]); // 4 seats
    const token = adminToken();
    const res = await request(app)
      .patch('/api/floors/floor-1/resize')
      .set('Authorization', `Bearer ${token}`)
      .send({ rowConfig: [2, 3] }); // 5 seats — row 2 grows

    expect(res.status).toBe(200);
    expect(res.body.seatsAdded).toBe(1);
    expect(res.body.seatsRemoved).toBe(0);
    expect(repos.__store.Seats.filter((s) => s.status !== 'removed')).toHaveLength(5);
    expect(res.body.floor.rows).toBe(2);
    expect(res.body.floor.columns).toBe(3);
  });

  test('rows can end up with different widths', async () => {
    seedFloor([3]); // 1 row, 3 seats
    const token = adminToken();
    const res = await request(app)
      .patch('/api/floors/floor-1/resize')
      .set('Authorization', `Bearer ${token}`)
      .send({ rowConfig: [14, 13] }); // 2 rows, uneven widths

    expect(res.status).toBe(200);
    expect(res.body.seatsAdded).toBe(24); // (14-3) + 13
    const available = repos.__store.Seats.filter((s) => s.status !== 'removed');
    expect(available).toHaveLength(27);
    expect(available.filter((s) => Number(s.row_number) === 1)).toHaveLength(14);
    expect(available.filter((s) => Number(s.row_number) === 2)).toHaveLength(13);
  });

  test('shrinking a row removes seats from its end without hard-deleting them', async () => {
    seedFloor([3, 3]); // 6 seats
    const token = adminToken();
    const res = await request(app)
      .patch('/api/floors/floor-1/resize')
      .set('Authorization', `Bearer ${token}`)
      .send({ rowConfig: [3, 2] }); // row 2 shrinks to 2

    expect(res.status).toBe(200);
    expect(res.body.seatsRemoved).toBe(1);
    // Still in the store (non-destructive), just marked removed.
    expect(repos.__store.Seats).toHaveLength(6);
    const removed = repos.__store.Seats.filter((s) => s.status === 'removed');
    expect(removed.map((s) => s.seat_number)).toEqual([6]);
  });

  test('refuses to shrink past a seat with an active allocation', async () => {
    seedFloor([3, 3]); // 6 seats
    repos.__store.Seat_Allocations.push({
      allocation_id: 'a1', seat_id: 'seat-5', student_id: 'S-1', status: 'active',
    });
    const token = adminToken();
    const res = await request(app)
      .patch('/api/floors/floor-1/resize')
      .set('Authorization', `Bearer ${token}`)
      .send({ rowConfig: [3, 1] }); // would remove seat 5 and 6

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/seat.*5/i);
    // Nothing was removed.
    expect(repos.__store.Seats.filter((s) => s.status === 'removed')).toHaveLength(0);
  });

  test('re-growing after a shrink revives the previously-removed seat rather than duplicating it', async () => {
    seedFloor([3, 3]); // 6 seats
    const token = adminToken();
    await request(app)
      .patch('/api/floors/floor-1/resize')
      .set('Authorization', `Bearer ${token}`)
      .send({ rowConfig: [3, 1] }); // shrink row 2 to 1, removes seat 5 & 6

    const res = await request(app)
      .patch('/api/floors/floor-1/resize')
      .set('Authorization', `Bearer ${token}`)
      .send({ rowConfig: [3, 3] }); // grow row 2 back to 3

    expect(res.status).toBe(200);
    expect(res.body.seatsAdded).toBe(2);
    // Still exactly 6 seat rows total — the old ones were revived, not duplicated.
    expect(repos.__store.Seats).toHaveLength(6);
    expect(repos.__store.Seats.filter((s) => s.status === 'available')).toHaveLength(6);
  });

  test('dropping a row entirely removes all of its seats', async () => {
    seedFloor([2, 2]); // 4 seats
    const token = adminToken();
    const res = await request(app)
      .patch('/api/floors/floor-1/resize')
      .set('Authorization', `Bearer ${token}`)
      .send({ rowConfig: [2] }); // row 2 dropped

    expect(res.status).toBe(200);
    expect(res.body.seatsRemoved).toBe(2);
    expect(repos.__store.Seats.filter((s) => s.status !== 'removed')).toHaveLength(2);
    expect(res.body.floor.rows).toBe(1);
  });
});
