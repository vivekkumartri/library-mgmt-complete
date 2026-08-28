/**
 * The receipt PDF was plain unstyled text — a header band, itemized table,
 * highlighted "amount paid" box, PAID/VOID stamp, and an amount-in-words
 * line were added to make it look like a standard printable receipt. These
 * tests don't parse PDF text (pdfkit's output isn't easily inspectable);
 * they cover the pure helpers directly and confirm buildReceiptPdf still
 * produces a well-formed PDF buffer for both billing-based and range
 * payments, and throws NOT_FOUND for a missing payment.
 */
jest.mock('../src/repositories', () => ({
  payments: { findById: jest.fn() },
  billing: { findById: jest.fn() },
  students: { findById: jest.fn() },
  settings: { findAll: jest.fn(async () => []) },
  allocations: { findById: jest.fn() },
  seats: { findById: jest.fn() },
  floors: { findById: jest.fn() },
}));
jest.mock('../src/services/googleDriveService', () => ({ getFileBuffer: jest.fn() }));

const repos = require('../src/repositories');
const { buildReceiptPdf, amountToWords, formatMoney } = require('../src/services/receiptService');

describe('receiptService.amountToWords', () => {
  test('zero', () => {
    expect(amountToWords(0)).toBe('Zero Rupees Only');
  });
  test('whole rupees', () => {
    expect(amountToWords(700)).toBe('Seven Hundred Rupees Only');
  });
  test('with paise', () => {
    expect(amountToWords(1234.5)).toBe('One Thousand Two Hundred Thirty Four Rupees and Fifty Paise Only');
  });
  test('lakhs', () => {
    expect(amountToWords(105000)).toBe('One Lakh Five Thousand Rupees Only');
  });
});

describe('receiptService — payment period on the bill', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repos.students.findById.mockResolvedValue({ student_id: 'LIB-2026-0002', full_name: 'Amit Singh', mobile: '8807768900' });
    repos.settings.findAll.mockResolvedValue([{ key: 'library_name', value: 'Sunrise Library' }]);
    repos.allocations.findById.mockResolvedValue(null);
  });

  // These don't parse the PDF's rendered text; they just make sure the
  // date-range fields feeding the "which date to which date" line on the
  // receipt don't throw for the shapes payments/billing can actually have,
  // for both the billing_month-derived range and the explicit range-payment
  // fields.
  test('billing-based payment (billing_month only) still renders', async () => {
    repos.payments.findById.mockResolvedValue({
      payment_id: 'p1', receipt_number: 'RCPT-1', student_id: 'S1', billing_id: 'B1',
      amount: 700, payment_method: 'cash', payment_date: '2026-08-27', received_by: 'Admin', status: 'active',
    });
    repos.billing.findById.mockResolvedValue({
      billing_id: 'B1', billing_month: '2026-08', base_fee: 700, discount: 0, late_fee: 0, payable: 700, paid: 700,
    });
    const buf = await buildReceiptPdf('p1');
    expect(buf.slice(0, 4).toString()).toBe('%PDF');
  });

  test('range payment with explicit period_start/period_end still renders', async () => {
    repos.payments.findById.mockResolvedValue({
      payment_id: 'p2', receipt_number: 'RCPT-2', student_id: 'S1', billing_id: '',
      amount: 1400, payment_method: 'upi', payment_date: '2026-08-27', received_by: 'Admin', status: 'active',
      period_start: '2026-07-01', period_end: '2026-08-30',
    });
    const buf = await buildReceiptPdf('p2');
    expect(buf.slice(0, 4).toString()).toBe('%PDF');
  });

  test('payment with neither a billing record nor period fields still renders (no period line)', async () => {
    repos.payments.findById.mockResolvedValue({
      payment_id: 'p3', receipt_number: 'RCPT-3', student_id: 'S1', billing_id: '',
      amount: 700, payment_method: 'cash', payment_date: '2026-08-27', received_by: 'Admin', status: 'active',
    });
    const buf = await buildReceiptPdf('p3');
    expect(buf.slice(0, 4).toString()).toBe('%PDF');
  });
});

describe('receiptService.formatMoney', () => {
  test('formats with two decimal places and Indian grouping', () => {
    expect(formatMoney(700)).toBe('Rs. 700.00');
    expect(formatMoney(150000)).toBe('Rs. 1,50,000.00');
  });
});

describe('receiptService.buildReceiptPdf', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repos.students.findById.mockResolvedValue({ student_id: 'LIB-2026-0002', full_name: 'Amit Singh', mobile: '8807768900' });
    repos.settings.findAll.mockResolvedValue([{ key: 'library_name', value: 'Sunrise Library' }]);
    repos.allocations.findById.mockResolvedValue(null);
  });

  test('throws NOT_FOUND for a missing payment', async () => {
    repos.payments.findById.mockResolvedValue(null);
    await expect(buildReceiptPdf('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('renders a valid PDF for a billing-based payment', async () => {
    repos.payments.findById.mockResolvedValue({
      payment_id: 'p1', receipt_number: 'RCPT-2026-0001', student_id: 'S1', billing_id: 'B1',
      amount: 700, payment_method: 'cash', payment_date: '2026-08-27', received_by: 'Admin', status: 'active',
    });
    repos.billing.findById.mockResolvedValue({
      billing_id: 'B1', billing_month: '2026-08', base_fee: 700, discount: 0, late_fee: 0, payable: 700, paid: 700,
    });
    const buf = await buildReceiptPdf('p1');
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.slice(0, 4).toString()).toBe('%PDF');
    expect(buf.length).toBeGreaterThan(500);
  });

  test('renders a valid PDF for a range payment with no billing record', async () => {
    repos.payments.findById.mockResolvedValue({
      payment_id: 'p2', receipt_number: 'RCPT-2026-0002', student_id: 'S1', billing_id: '',
      amount: 1400, payment_method: 'upi', payment_date: '2026-08-27', received_by: 'Admin', status: 'active',
      period_start: '2026-07-01', period_end: '2026-08-30',
    });
    const buf = await buildReceiptPdf('p2');
    expect(buf.slice(0, 4).toString()).toBe('%PDF');
  });

  test('renders a valid PDF for a voided payment', async () => {
    repos.payments.findById.mockResolvedValue({
      payment_id: 'p3', receipt_number: 'RCPT-2026-0003', student_id: 'S1', billing_id: '',
      amount: 700, payment_method: 'cash', payment_date: '2026-08-27', received_by: 'Admin', status: 'void',
      void_reason: 'Entered by mistake',
    });
    const buf = await buildReceiptPdf('p3');
    expect(buf.slice(0, 4).toString()).toBe('%PDF');
  });
});
