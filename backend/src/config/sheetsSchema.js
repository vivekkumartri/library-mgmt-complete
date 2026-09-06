/**
 * Central schema definition for every Google Sheets tab used as the data
 * store. Each sheet lists its columns in order — this order MUST match the
 * header row created by `scripts/setupSheets.js`. Row 1 is always headers.
 *
 * IMPORTANT: never treat the spreadsheet row number as a record id. Every
 * sheet has an explicit `*_id` column which is the real primary key
 * (uuid). Row numbers only matter internally to googleSheetsService for
 * locating a row to update/delete, and are re-resolved by id on every
 * write to avoid stale-row bugs.
 */

const SHEETS = {
  Settings: ['key', 'value', 'updated_at', 'updated_by'],

  Admins: [
    'admin_id', 'name', 'email', 'password_hash', 'role', // 'super_admin' | 'staff'
    'role_id', 'permissions_json', 'status', 'created_at', 'created_by', 'last_login_at',
  ],

  // Named, reusable permission bundles (section 2/38/66 — "build the
  // authorization system so permissions can easily be expanded later").
  // Assigning a role to a staff admin fills in a starting permissions_json;
  // the per-admin permissions_json remains the actual value the auth
  // middleware checks, so an admin's permissions can still be fine-tuned
  // individually after a role is applied.
  Roles: [
    'role_id', 'role_name', 'description', 'permissions_json', 'is_system',
    'created_at', 'created_by', 'updated_at',
  ],

  // Catalog of permission keys the app understands, so the list staff
  // permissions/roles are built from lives in data, not scattered literal
  // strings across route files and frontend components.
  Permissions: [
    'permission_key', 'label', 'category', 'sort_order',
  ],

  Floors: [
    'floor_id', 'floor_name', 'floor_number', 'rows', 'columns',
    'opening_time', 'closing_time', 'status', 'notes', 'created_at', 'updated_at',
    // Per-row seat counts, e.g. "[14,13,12]" — rows can have different
    // widths. `rows` (row count) and `columns` (max row width) above are
    // kept in sync from this for old code paths that still read a single
    // grid size (CSS grid width, summaries), but row_config_json is the
    // source of truth for seat generation and layout.
    'row_config_json',
  ],

  Seats: [
    'seat_id', 'floor_id', 'seat_number', 'status', // available|disabled
    'disabled_reason', 'notes', 'created_at', 'updated_at',
    // Position within the floor's variable-width grid — needed because
    // seat_number alone no longer implies a row when rows differ in length.
    'row_number', 'col_number',
  ],

  Students: [
    'student_id', 'full_name', 'father_name', 'mother_name', 'mobile',
    'alternate_mobile', 'email', 'address', 'date_of_birth',
    'photo_drive_file_id', 'id_proof_details', 'emergency_contact',
    'joining_date', 'leaving_date', 'signature_drive_file_id', 'notes',
    'status', // active | past | deactivated
    'password_hash', 'must_reset_password', 'created_at', 'created_by', 'updated_at',
  ],

  Student_Documents: [
    'document_id', 'student_id', 'doc_type', 'drive_file_id', 'file_name',
    'uploaded_at', 'uploaded_by',
  ],

  Student_Vacations: [
    'vacation_id', 'student_id', 'start_date', 'end_date', 'reason',
    'notes', 'created_at', 'created_by',
  ],

  Seat_Allocations: [
    'allocation_id', 'student_id', 'floor_id', 'seat_id', 'start_date',
    'actual_end_date', 'start_time', 'end_time', 'monthly_fee', 'discount',
    'late_fee_config_json', 'status', // scheduled|active|ended|cancelled
    'notes', 'created_by', 'created_at', 'updated_by', 'updated_at',
  ],

  Fee_Plans: [
    'fee_plan_id', 'student_id', 'monthly_fee', 'discount', 'effective_from',
    'effective_to', 'created_at', 'created_by',
  ],

  Monthly_Billing: [
    'billing_id', 'student_id', 'allocation_id', 'billing_month', // YYYY-MM
    'base_fee', 'discount', 'late_fee', 'payable', 'paid', 'status',
    // pending|partially_paid|paid|overdue|waived
    'due_date', 'notes', 'created_at', 'updated_at',
  ],

  Payments: [
    'payment_id', 'receipt_number', 'student_id', 'billing_id', 'amount',
    'payment_method', // cash | upi
    'reference_number', 'payment_date', 'received_by', 'status', // active|void
    'void_reason', 'notes', 'created_at',
    // Range payments (section: date-range payment recording) — set only
    // when this payment was recorded WITHOUT a Monthly_Billing record,
    // covering an arbitrary date range instead of one billing month.
    // billing_id stays '' for these so Monthly_Billing/report totals are
    // never polluted by non-month-shaped data.
    'period_start', 'period_end',
  ],

  Expenses: [
    'expense_id', 'date', 'category', 'description', 'amount',
    'payment_mode', 'added_by', 'notes', 'created_at',
    'status', // active | void — never hard-deleted, see section 26/43
    'void_reason', 'updated_at', 'updated_by',
  ],

  Attendance: [
    'attendance_id', 'student_id', 'date', 'status', // present|absent
    'marked_by', 'marked_at', 'updated_by', 'updated_at',
  ],

  Notices: [
    'notice_id', 'title_en', 'description_en', 'title_hi', 'description_hi',
    'publish_date', 'expiry_date', 'priority', 'status', 'created_by', 'created_at',
  ],

  Receipts: [
    'receipt_id', 'receipt_number', 'payment_id', 'student_id', 'pdf_drive_file_id',
    'generated_at',
  ],

  Audit_Log: [
    'log_id', 'actor_id', 'actor_name', 'action', 'entity', 'entity_id',
    'previous_value_json', 'new_value_json', 'timestamp', 'ip', 'device',
  ],
};

module.exports = { SHEETS };
