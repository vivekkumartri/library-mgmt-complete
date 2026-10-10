/**
 * All money math funnels through here so every screen (dashboard, billing,
 * receipts, reports) agrees on the same numbers. Internally works in
 * integer paise (1 rupee = 100 paise) to avoid floating point drift, and
 * only converts to a decimal rupee amount at the boundary.
 */

function toPaise(amount) {
  return Math.round(Number(amount || 0) * 100);
}

function toRupees(paise) {
  return Math.round(paise) / 100;
}

/**
 * Calendar-day-only Date at UTC midnight, read from a Date's UTC fields.
 * `new Date('YYYY-MM-DD')` parses as UTC midnight, but `Date.prototype
 * .getFullYear()`/`getDate()` read the LOCAL calendar day — on any host
 * west of UTC that silently reads back the day before. Every "which
 * calendar day is this" comparison in this file goes through here so the
 * result doesn't depend on the server's timezone.
 */
function dateOnlyUTC(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Fixed or percentage late fee, applied against the (base - discount) amount. */
function computeLateFee({ baseFee, discount, lateFeeConfig, daysLate }) {
  if (!lateFeeConfig || daysLate <= (lateFeeConfig.gracePeriodDays || 0)) return 0;
  const netPaise = toPaise(baseFee) - toPaise(discount);
  if (lateFeeConfig.type === 'percentage') {
    return toRupees(Math.round((netPaise * Number(lateFeeConfig.value || 0)) / 100));
  }
  if (lateFeeConfig.type === 'fixed') {
    return Number(lateFeeConfig.value || 0);
  }
  return 0;
}

function computePayable({ baseFee, discount = 0, lateFee = 0 }) {
  const paise = toPaise(baseFee) - toPaise(discount) + toPaise(lateFee);
  return toRupees(Math.max(0, paise));
}

function computeBalance({ payable, paid = 0 }) {
  const paise = toPaise(payable) - toPaise(paid);
  return toRupees(paise);
}

function billingStatus({ payable, paid, dueDate, today = new Date() }) {
  const balance = computeBalance({ payable, paid });
  if (balance <= 0) return 'paid';
  if (paid > 0) return 'partially_paid';
  if (dueDate && new Date(dueDate) < today) return 'overdue';
  return 'pending';
}

/**
 * Buckets an unpaid-balance billing record by how urgent its due date is —
 * used to color-code the seat map (a seat's color should surface payment
 * risk, not just occupancy) rather than to drive any billing math itself.
 * 'overdue' outranks 'due_today' outranks 'due_soon' outranks 'ok', so a
 * caller comparing several records for one student can just keep whichever
 * urgency has the highest URGENCY_RANK.
 */
const URGENCY_RANK = { overdue: 3, due_today: 2, due_soon: 1, ok: 0 };

function paymentUrgency({ payable, paid, dueDate, today = new Date() }) {
  const balance = computeBalance({ payable, paid });
  if (balance <= 0 || !dueDate) return 'ok';
  const due = dateOnlyUTC(new Date(dueDate));
  const startOfToday = dateOnlyUTC(today);
  const daysUntilDue = Math.round((due - startOfToday) / (1000 * 60 * 60 * 24));
  if (daysUntilDue < 0) return 'overdue';
  if (daysUntilDue === 0) return 'due_today';
  if (daysUntilDue <= 7) return 'due_soon';
  return 'ok';
}

function sumAmounts(amounts) {
  const paise = amounts.reduce((acc, a) => acc + toPaise(a), 0);
  return toRupees(paise);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Advance a UTC date by exactly one calendar month (same day-of-month,
 * clamped to the last day if the target month is shorter — e.g. Jan 31
 * + 1 month = Feb 28/29).
 */
function addOneMonth(d) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0-based
  const day = d.getUTCDate();
  const lastDayOfNext = new Date(Date.UTC(y, m + 2, 0)).getUTCDate();
  return new Date(Date.UTC(y, m + 1, Math.min(day, lastDayOfNext)));
}

/**
 * Automatic, billing-record-free due calculation. Advances month by month
 * from the join date using real calendar months (31-day months cost the
 * same ₹fee as 28-day months), with the final partial month prorated by
 * the actual number of days in that month.
 */
function autoPaymentStatus({ joinDate, monthlyFee, totalPaid = 0, today = new Date() }) {
  const fee = Number(monthlyFee) || 0;
  const paid = Number(totalPaid) || 0;
  if (!joinDate || fee <= 0) {
    return { urgency: 'ok', paidThroughDate: null, owed: 0, paid, balance: 0 };
  }
  const join = dateOnlyUTC(new Date(`${joinDate}T00:00:00Z`));
  const startOfToday = dateOnlyUTC(today);

  // Walk forward month by month from join date, consuming `fee` paise per
  // full month, until the remaining balance runs out. The last partial month
  // is prorated by the actual number of days in that calendar month.
  let remaining = toPaise(paid);
  let cursor = join;
  while (remaining >= toPaise(fee)) {
    remaining -= toPaise(fee);
    cursor = addOneMonth(cursor);
  }
  // cursor is now the start of the month the student is partially into.
  // remaining paise buys a fraction of this calendar month.
  const nextMonth = addOneMonth(cursor);
  const daysInMonth = Math.round((nextMonth - cursor) / MS_PER_DAY);
  const extraDays = Math.floor((remaining / toPaise(fee)) * daysInMonth);
  const paidThrough = new Date(cursor.getTime() + extraDays * MS_PER_DAY);

  const daysUntilDue = Math.round((paidThrough - startOfToday) / MS_PER_DAY);
  let urgency = 'ok';
  if (daysUntilDue < 0) urgency = 'overdue';
  else if (daysUntilDue === 0) urgency = 'due_today';
  else if (daysUntilDue <= 7) urgency = 'due_soon';

  // Amount currently owed: walk forward from join to today counting real
  // calendar months, then prorate the current partial month.
  let owedPaise = 0;
  let owedCursor = join;
  while (true) {
    const owedNext = addOneMonth(owedCursor);
    if (owedNext <= startOfToday) {
      owedPaise += toPaise(fee);
      owedCursor = owedNext;
    } else {
      const daysInThisMonth = Math.round((owedNext - owedCursor) / MS_PER_DAY);
      const daysElapsed = Math.round((startOfToday - owedCursor) / MS_PER_DAY);
      owedPaise += Math.round((daysElapsed / daysInThisMonth) * toPaise(fee));
      break;
    }
  }
  const owed = toRupees(owedPaise);
  const balance = Math.max(0, toRupees(owedPaise - toPaise(paid)));

  return { urgency, paidThroughDate: paidThrough.toISOString().slice(0, 10), owed, paid, balance };
}

module.exports = {
  toPaise,
  toRupees,
  computeLateFee,
  computePayable,
  computeBalance,
  billingStatus,
  paymentUrgency,
  URGENCY_RANK,
  sumAmounts,
  autoPaymentStatus,
};
