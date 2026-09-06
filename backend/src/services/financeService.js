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
 * Automatic, billing-record-free due calculation. Instead of requiring an
 * admin to create a Monthly_Billing row every month before the seat map (or
 * anything else) can tell whether a student is paid up, this works it out
 * directly from three things every allocated student already has: the date
 * they joined this seat (allocation start_date), their monthly fee, and the
 * total they've paid so far (summed across every active Payments row for
 * that student — both billing-linked and free-standing date-range
 * payments). One month of coverage = 30 days from the join date, which is a
 * simplification but keeps the math predictable and paise-exact; it is not
 * meant to replace Monthly_Billing for admins who still want itemized
 * monthly records, only to give a good default "are they due?" answer when
 * nobody has created one.
 */
function autoPaymentStatus({ joinDate, monthlyFee, totalPaid = 0, today = new Date() }) {
  const fee = Number(monthlyFee) || 0;
  const paid = Number(totalPaid) || 0;
  if (!joinDate || fee <= 0) {
    return { urgency: 'ok', paidThroughDate: null, owed: 0, paid, balance: 0 };
  }
  const join = dateOnlyUTC(new Date(`${joinDate}T00:00:00Z`));
  const startOfToday = dateOnlyUTC(today);

  // How many days of coverage the amount paid so far buys, laid out from
  // the join date — this is the date the student is "paid through", and
  // the single source of truth for urgency (day-precise, so "due today"
  // means coverage runs out today, not "some month rounded up").
  const coveredDays = (paid / fee) * 30;
  const paidThrough = new Date(join.getTime() + coveredDays * MS_PER_DAY);
  const daysUntilDue = Math.round((paidThrough - startOfToday) / MS_PER_DAY);

  let urgency = 'ok';
  if (daysUntilDue < 0) urgency = 'overdue';
  else if (daysUntilDue === 0) urgency = 'due_today';
  else if (daysUntilDue <= 7) urgency = 'due_soon';

  // Amount currently owed: the fee prorated over however many days have
  // actually elapsed since joining, minus what's been paid — floors at 0
  // rather than going negative once someone has paid ahead.
  const elapsedDays = Math.max(0, Math.round((startOfToday - join) / MS_PER_DAY));
  const owed = toRupees((elapsedDays / 30) * toPaise(fee));
  const balance = Math.max(0, toRupees(toPaise(owed) - toPaise(paid)));

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
