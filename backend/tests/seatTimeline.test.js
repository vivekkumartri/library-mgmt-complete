/**
 * Covers the seat map's payment-risk coloring feature: seatTimeline() now
 * enriches each allocation with the allocated student's name and their
 * payment urgency (overdue / due today / due within 7 days / ok), computed
 * automatically from the allocation's own start_date + monthly_fee plus the
 * student's total active payments — no Monthly_Billing record required.
 * This is what lets the seat map color a seat red before rent is actually
 * overdue, and what lets the seat detail drawer show who's sitting there
 * without a second round-trip per seat.
 */
jest.mock('../src/repositories', () => {
  const store = { Seats: [], Seat_Allocations: [], Students: [], Payments: [] };
  return {
    __store: store,
    seats: {
      findById: jest.fn(async (id) => store.Seats.find((s) => s.seat_id === id) || null),
    },
    allocations: {
      findAll: jest.fn(async (filterFn) => (filterFn ? store.Seat_Allocations.filter(filterFn) : store.Seat_Allocations)),
    },
    students: {
      findById: jest.fn(async (id) => store.Students.find((s) => s.student_id === id) || null),
    },
    payments: {
      findAll: jest.fn(async (filterFn) => (filterFn ? store.Payments.filter(filterFn) : store.Payments)),
    },
  };
});

jest.mock('../src/services/auditService', () => ({ log: jest.fn(async () => {}) }));

const repos = require('../src/repositories');
const { AllocationService } = require('../src/services/allocationService');

function resetStore() {
  repos.__store.Seats.length = 0;
  repos.__store.Seat_Allocations.length = 0;
  repos.__store.Students.length = 0;
  repos.__store.Payments.length = 0;
}

function isoDaysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function pay(studentId, amount) {
  repos.__store.Payments.push({
    payment_id: `p-${repos.__store.Payments.length + 1}`,
    student_id: studentId,
    amount,
    status: 'active',
  });
}

describe('AllocationService.seatTimeline — student + automatic payment enrichment', () => {
  beforeEach(() => {
    resetStore();
    repos.__store.Seats.push({ seat_id: 'seat-1', status: 'available' });
    repos.__store.Students.push({ student_id: 'S1', full_name: 'Asha Rao', mobile: '9999900001' });
    repos.__store.Seat_Allocations.push({
      allocation_id: 'a1', seat_id: 'seat-1', student_id: 'S1', status: 'active',
      start_date: isoDaysFromNow(0), start_time: '06:00', end_time: '12:00', monthly_fee: 1000,
    });
  });

  test('includes the allocated student\'s name and mobile', async () => {
    const [entry] = await AllocationService.seatTimeline('seat-1');
    expect(entry.studentName).toBe('Asha Rao');
    expect(entry.studentMobile).toBe('9999900001');
  });

  test('a student who joined today with no payment yet reads as "due_today" — rent is due from the join date', async () => {
    const [entry] = await AllocationService.seatTimeline('seat-1');
    expect(entry.paymentUrgency).toBe('due_today');
    expect(entry.paymentAmountDue).toBe(0); // due today, but no time has actually elapsed yet
  });

  test('a student who joined 2 months ago and never paid reads as "overdue"', async () => {
    repos.__store.Seat_Allocations[0].start_date = isoDaysFromNow(-60);
    const [entry] = await AllocationService.seatTimeline('seat-1');
    expect(entry.paymentUrgency).toBe('overdue');
    expect(entry.paymentAmountDue).toBe(2000);
  });

  test('a student whose one paid month runs out exactly today reads as "due_today"', async () => {
    // Joined 30 days ago, paid one month (30 days of coverage) — coverage
    // ends exactly today.
    repos.__store.Seat_Allocations[0].start_date = isoDaysFromNow(-30);
    pay('S1', 1000);
    const [entry] = await AllocationService.seatTimeline('seat-1');
    expect(entry.paymentUrgency).toBe('due_today');
  });

  test('a student due within the next 7 days reads as "due_soon"', async () => {
    // Joined 24 days ago, one month's fee paid (buys 30 days) — 6 days of coverage left.
    repos.__store.Seat_Allocations[0].start_date = isoDaysFromNow(-24);
    pay('S1', 1000);
    const [entry] = await AllocationService.seatTimeline('seat-1');
    expect(entry.paymentUrgency).toBe('due_soon');
  });

  test('fully covering the elapsed time never counts as urgent', async () => {
    repos.__store.Seat_Allocations[0].start_date = isoDaysFromNow(-10);
    pay('S1', 1000); // 30 days of coverage comfortably covers 10 elapsed days
    const [entry] = await AllocationService.seatTimeline('seat-1');
    expect(entry.paymentUrgency).toBe('ok');
    expect(entry.paymentAmountDue).toBe(0);
  });

  test('multiple active payments for the same student are summed together', async () => {
    repos.__store.Seat_Allocations[0].start_date = isoDaysFromNow(-20);
    pay('S1', 500);
    pay('S1', 500);
    const [entry] = await AllocationService.seatTimeline('seat-1');
    expect(entry.paymentAmountDue).toBe(0);
    expect(entry.paymentUrgency).toBe('ok');
  });

  test('a voided payment does not count toward coverage', async () => {
    repos.__store.Seat_Allocations[0].start_date = isoDaysFromNow(-60);
    repos.__store.Payments.push({ payment_id: 'p-void', student_id: 'S1', amount: 1000, status: 'void' });
    const [entry] = await AllocationService.seatTimeline('seat-1');
    expect(entry.paymentUrgency).toBe('overdue');
    expect(entry.paymentAmountDue).toBe(2000);
  });
});
