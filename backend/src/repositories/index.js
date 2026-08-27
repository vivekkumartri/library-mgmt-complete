const { BaseRepository } = require('./baseRepository');
const sheetsService = require('../services/googleSheetsService');

const repos = {
  admins: new BaseRepository('Admins', 'admin_id'),
  roles: new BaseRepository('Roles', 'role_id'),
  permissionsCatalog: new BaseRepository('Permissions', 'permission_key'),
  floors: new BaseRepository('Floors', 'floor_id'),
  seats: new BaseRepository('Seats', 'seat_id'),
  students: new BaseRepository('Students', 'student_id'),
  studentDocuments: new BaseRepository('Student_Documents', 'document_id'),
  studentVacations: new BaseRepository('Student_Vacations', 'vacation_id'),
  allocations: new BaseRepository('Seat_Allocations', 'allocation_id'),
  feePlans: new BaseRepository('Fee_Plans', 'fee_plan_id'),
  billing: new BaseRepository('Monthly_Billing', 'billing_id'),
  payments: new BaseRepository('Payments', 'payment_id'),
  expenses: new BaseRepository('Expenses', 'expense_id'),
  attendance: new BaseRepository('Attendance', 'attendance_id'),
  notices: new BaseRepository('Notices', 'notice_id'),
  receipts: new BaseRepository('Receipts', 'receipt_id'),
  auditLog: new BaseRepository('Audit_Log', 'log_id'),
  settings: new BaseRepository('Settings', 'key'),
};

/**
 * Reads several repositories' full sheets in a single Sheets API call
 * (via googleSheetsService.getMany) instead of one call per repository.
 * Pass an object mapping the key you want back to the repo key, and an
 * optional filter for that same result key, e.g.:
 *
 *   const { students, seats } = await readMany({
 *     students: 'students',
 *     seats: ['seats', (s) => s.status === 'available'],
 *   });
 *
 * Falls back gracefully — this is a perf optimization only; callers that
 * just want the old behavior can keep calling repo.findAll() directly.
 */
async function readMany(spec) {
  const entries = Object.entries(spec).map(([key, val]) => {
    const [repoKey, filterFn] = Array.isArray(val) ? val : [val, undefined];
    return { key, repoKey, filterFn };
  });
  const sheetNames = entries.map(({ repoKey }) => repos[repoKey].sheetName);
  const bySheet = await sheetsService.getMany(sheetNames);
  const out = {};
  for (const { key, repoKey, filterFn } of entries) {
    const rows = bySheet[repos[repoKey].sheetName]?.rows || [];
    out[key] = filterFn ? rows.filter(filterFn) : rows;
  }
  return out;
}

module.exports = { ...repos, readMany };
