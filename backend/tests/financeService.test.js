const finance = require('../src/services/financeService');

describe('financeService', () => {
  test('computePayable subtracts discount and adds late fee', () => {
    expect(finance.computePayable({ baseFee: 1000, discount: 100, lateFee: 0 })).toBe(900);
    expect(finance.computePayable({ baseFee: 1000, discount: 0, lateFee: 50 })).toBe(1050);
  });

  test('computePayable never goes negative', () => {
    expect(finance.computePayable({ baseFee: 100, discount: 500 })).toBe(0);
  });

  test('computeBalance is payable minus paid', () => {
    expect(finance.computeBalance({ payable: 900, paid: 500 })).toBe(400);
  });

  test('avoids floating point drift over many additions', () => {
    const amounts = Array(10).fill(0.1);
    expect(finance.sumAmounts(amounts)).toBe(1);
  });

  test('billingStatus: fully paid', () => {
    expect(finance.billingStatus({ payable: 900, paid: 900 })).toBe('paid');
  });

  test('billingStatus: partially paid', () => {
    expect(finance.billingStatus({ payable: 900, paid: 400 })).toBe('partially_paid');
  });

  test('billingStatus: overdue when past due date and unpaid', () => {
    const status = finance.billingStatus({ payable: 900, paid: 0, dueDate: '2020-01-01', today: new Date('2020-02-01') });
    expect(status).toBe('overdue');
  });

  test('billingStatus: pending when not yet due', () => {
    const status = finance.billingStatus({ payable: 900, paid: 0, dueDate: '2099-01-01', today: new Date('2020-01-01') });
    expect(status).toBe('pending');
  });

  test('computeLateFee: percentage type applied to (base - discount)', () => {
    const fee = finance.computeLateFee({
      baseFee: 1000, discount: 0, daysLate: 5,
      lateFeeConfig: { type: 'percentage', value: 10, gracePeriodDays: 2 },
    });
    expect(fee).toBe(100);
  });

  test('computeLateFee: within grace period is zero', () => {
    const fee = finance.computeLateFee({
      baseFee: 1000, discount: 0, daysLate: 1,
      lateFeeConfig: { type: 'fixed', value: 50, gracePeriodDays: 3 },
    });
    expect(fee).toBe(0);
  });
});

describe('financeService.autoPaymentStatus — billing-record-free due calculation', () => {
  const TODAY = new Date('2026-08-27');

  test('no join date or fee yet — reads as ok', () => {
    const status = finance.autoPaymentStatus({ joinDate: null, monthlyFee: 1000, totalPaid: 0, today: TODAY });
    expect(status).toEqual({ urgency: 'ok', paidThroughDate: null, owed: 0, paid: 0, balance: 0 });
  });

  test('joined today with nothing paid yet — payment is due starting the join date itself', () => {
    // Rent is due from the day a student joins (per spec), so an unpaid
    // brand-new allocation reads as due_today rather than a silent 'ok' —
    // this is what lets staff see "still needs to collect today's payment"
    // on the seat map right after allocating a seat.
    const status = finance.autoPaymentStatus({ joinDate: '2026-08-27', monthlyFee: 1000, totalPaid: 0, today: TODAY });
    expect(status.urgency).toBe('due_today');
    expect(status.balance).toBe(0); // nothing "overdue" yet — no time has actually elapsed
  });

  test('joined 2 months ago, never paid — overdue, two months owed', () => {
    const status = finance.autoPaymentStatus({ joinDate: '2026-06-28', monthlyFee: 1000, totalPaid: 0, today: TODAY });
    expect(status.urgency).toBe('overdue');
    expect(status.balance).toBe(2000);
  });

  test('one month paid, coverage runs out exactly today — due_today, balance settled', () => {
    const status = finance.autoPaymentStatus({ joinDate: '2026-07-28', monthlyFee: 1000, totalPaid: 1000, today: TODAY });
    expect(status.urgency).toBe('due_today');
    expect(status.paidThroughDate).toBe('2026-08-27');
    expect(status.balance).toBe(0);
  });

  test('one month paid with 6 days of coverage left — due_soon', () => {
    const status = finance.autoPaymentStatus({ joinDate: '2026-08-03', monthlyFee: 1000, totalPaid: 1000, today: TODAY });
    expect(status.urgency).toBe('due_soon');
  });

  test('paid ahead of the elapsed period — ok, balance never goes negative', () => {
    const status = finance.autoPaymentStatus({ joinDate: '2026-08-17', monthlyFee: 1000, totalPaid: 1000, today: TODAY });
    expect(status.urgency).toBe('ok');
    expect(status.balance).toBe(0);
  });

  test('a date-range payment (no billing record) still counts toward coverage the same way', () => {
    // Two 500 range payments summed = the same as one 1000 payment.
    const status = finance.autoPaymentStatus({ joinDate: '2026-08-02', monthlyFee: 1000, totalPaid: 1000, today: TODAY });
    expect(status.urgency).toBe('due_soon');
  });
});
