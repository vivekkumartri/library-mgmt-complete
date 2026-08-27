jest.mock('../src/repositories', () => {
  const store = { Seats: [], Seat_Allocations: [] };
  return {
    __store: store,
    seats: {
      findById: jest.fn(async (id) => store.Seats.find((s) => s.seat_id === id) || null),
    },
    allocations: {
      findAll: jest.fn(async (filterFn) => {
        const rows = store.Seat_Allocations;
        return filterFn ? rows.filter(filterFn) : rows;
      }),
      findById: jest.fn(async (id) => store.Seat_Allocations.find((a) => a.allocation_id === id) || null),
      create: jest.fn(async (rec) => {
        store.Seat_Allocations.push(rec);
        return rec;
      }),
      update: jest.fn(async (id, patch) => {
        const idx = store.Seat_Allocations.findIndex((a) => a.allocation_id === id);
        store.Seat_Allocations[idx] = { ...store.Seat_Allocations[idx], ...patch };
        return store.Seat_Allocations[idx];
      }),
    },
  };
});

jest.mock('../src/services/auditService', () => ({ log: jest.fn(async () => {}) }));

const repos = require('../src/repositories');
const { AllocationService, timesOverlap } = require('../src/services/allocationService');

function resetStore() {
  repos.__store.Seats.length = 0;
  repos.__store.Seat_Allocations.length = 0;
}

describe('timesOverlap', () => {
  test('detects overlapping ranges', () => {
    expect(timesOverlap('06:00', '12:00', '11:00', '17:00')).toBe(true);
  });
  test('detects non-overlapping ranges', () => {
    expect(timesOverlap('06:00', '11:00', '11:00', '17:00')).toBe(false);
  });
  test('fully nested overlap', () => {
    expect(timesOverlap('06:00', '20:00', '10:00', '12:00')).toBe(true);
  });
});

describe('AllocationService business rules', () => {
  beforeEach(() => {
    resetStore();
    repos.__store.Seats.push({ seat_id: 'seat-1', status: 'available' });
    repos.__store.Seats.push({ seat_id: 'seat-2', status: 'disabled' });
  });

  test('same seat + different (non-overlapping) times: allowed, no warning', async () => {
    await AllocationService.createAllocation(
      { studentId: 'S1', floorId: 'F1', seatId: 'seat-1', startDate: '2026-01-01', startTime: '06:00', endTime: '11:00', monthlyFee: 1000 },
      { id: 'admin1' }
    );
    const result = await AllocationService.createAllocation(
      { studentId: 'S2', floorId: 'F1', seatId: 'seat-1', startDate: '2026-01-01', startTime: '11:00', endTime: '17:00', monthlyFee: 1000 },
      { id: 'admin1' }
    );
    expect(result.warning).toBeNull();
  });

  test('same seat + overlapping times: allowed but returns a warning', async () => {
    await AllocationService.createAllocation(
      { studentId: 'S1', floorId: 'F1', seatId: 'seat-1', startDate: '2026-01-01', startTime: '06:00', endTime: '12:00', monthlyFee: 1000 },
      { id: 'admin1' }
    );
    const result = await AllocationService.createAllocation(
      { studentId: 'S2', floorId: 'F1', seatId: 'seat-1', startDate: '2026-01-01', startTime: '11:00', endTime: '17:00', monthlyFee: 1000 },
      { id: 'admin1' }
    );
    expect(result.warning).toMatch(/overlaps/i);
    expect(result.allocation.status).toBe('active');
  });

  test('same student + different seat while already active: blocked', async () => {
    await AllocationService.createAllocation(
      { studentId: 'S1', floorId: 'F1', seatId: 'seat-1', startDate: '2026-01-01', startTime: '06:00', endTime: '12:00', monthlyFee: 1000 },
      { id: 'admin1' }
    );
    repos.__store.Seats.push({ seat_id: 'seat-3', status: 'available' });
    await expect(
      AllocationService.createAllocation(
        { studentId: 'S1', floorId: 'F1', seatId: 'seat-3', startDate: '2026-01-01', startTime: '13:00', endTime: '18:00', monthlyFee: 1000 },
        { id: 'admin1' }
      )
    ).rejects.toMatchObject({ code: 'STUDENT_ALREADY_ALLOCATED' });
  });

  test('same student + same seat while already active: blocked', async () => {
    await AllocationService.createAllocation(
      { studentId: 'S1', floorId: 'F1', seatId: 'seat-1', startDate: '2026-01-01', startTime: '06:00', endTime: '12:00', monthlyFee: 1000 },
      { id: 'admin1' }
    );
    await expect(
      AllocationService.createAllocation(
        { studentId: 'S1', floorId: 'F1', seatId: 'seat-1', startDate: '2026-01-01', startTime: '13:00', endTime: '18:00', monthlyFee: 1000 },
        { id: 'admin1' }
      )
    ).rejects.toMatchObject({ code: 'STUDENT_ALREADY_ALLOCATED' });
  });

  test('ended allocation frees the student up for a new one', async () => {
    const { allocation } = await AllocationService.createAllocation(
      { studentId: 'S1', floorId: 'F1', seatId: 'seat-1', startDate: '2026-01-01', startTime: '06:00', endTime: '12:00', monthlyFee: 1000 },
      { id: 'admin1' }
    );
    await AllocationService.endAllocation(allocation.allocation_id, { actualEndDate: '2026-01-15' }, { id: 'admin1' });
    const result = await AllocationService.createAllocation(
      { studentId: 'S1', floorId: 'F1', seatId: 'seat-1', startDate: '2026-01-16', startTime: '06:00', endTime: '12:00', monthlyFee: 1000 },
      { id: 'admin1' }
    );
    expect(result.allocation.status).toBe('active');
  });

  test('disabled seat cannot receive a new allocation', async () => {
    await expect(
      AllocationService.createAllocation(
        { studentId: 'S1', floorId: 'F1', seatId: 'seat-2', startDate: '2026-01-01', startTime: '06:00', endTime: '12:00', monthlyFee: 1000 },
        { id: 'admin1' }
      )
    ).rejects.toMatchObject({ code: 'SEAT_DISABLED' });
  });

  test('start time must be before end time', async () => {
    await expect(
      AllocationService.createAllocation(
        { studentId: 'S1', floorId: 'F1', seatId: 'seat-1', startDate: '2026-01-01', startTime: '18:00', endTime: '06:00', monthlyFee: 1000 },
        { id: 'admin1' }
      )
    ).rejects.toMatchObject({ code: 'INVALID_TIME_RANGE' });
  });
});
