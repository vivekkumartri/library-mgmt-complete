// Shared display-date formatting. Backend sends dates as plain ISO strings
// (YYYY-MM-DD for dates, YYYY-MM for billing months) — this is the one place
// that turns them into the "4 May 2026" format used everywhere in the UI.
// Do NOT use these for <input type="date"/month"> values — those need to stay
// in raw ISO form for the input to bind correctly.

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * '2026-05-04' -> '4 May 2026'
 * Returns '' for null/undefined/empty input, and the original string
 * unchanged if it doesn't look like an ISO date (so we fail safe rather
 * than showing "Invalid Date").
 */
export function formatDate(isoDate) {
  if (!isoDate) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) return isoDate;
  const [, year, month, day] = match;
  const monthName = MONTH_NAMES[Number(month) - 1];
  if (!monthName) return isoDate;
  return `${Number(day)} ${monthName} ${year}`;
}

/**
 * '2026-05' -> 'May 2026'
 */
export function formatMonth(isoMonth) {
  if (!isoMonth) return '';
  const match = /^(\d{4})-(\d{2})$/.exec(isoMonth);
  if (!match) return isoMonth;
  const [, year, month] = match;
  const monthName = MONTH_NAMES[Number(month) - 1];
  if (!monthName) return isoMonth;
  return `${monthName} ${year}`;
}

/**
 * '2026-05-04' + '18:30' -> '4 May 2026, 18:30'. Leaves the time part as-is.
 */
export function formatDateTime(isoDate, time) {
  const d = formatDate(isoDate);
  if (!d) return '';
  return time ? `${d}, ${time}` : d;
}
