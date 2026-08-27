jest.mock('../src/repositories', () => {
  const store = {
    Monthly_Billing: [{ billing_id: 'b1', student_id: 'LIB-2026-0001', payable: 1000, paid: 0, status: 'pending', due_date: '' }],
    Payments: [],
    Receipts: [],
  };
  return {
    __store: store,
    billing: {
      findById: jest.fn(async (id) => store.Monthly_Billing.find((b) => b.billing_id === id) || null),
      update: jest.fn(async (id, patch) => {
        const idx = store.Monthly_Billing.findIndex((b) => b.billing_id === id);
        store.Monthly_Billing[idx] = { ...store.Monthly_Billing[idx], ...patch };
        return store.Monthly_Billing[idx];
      }),
    },
    payments: {
      findAll: jest.fn(async (filterFn) => (filterFn ? store.Payments.filter(filterFn) : store.Payments)),
      findById: jest.fn(async (id) => store.Payments.find((p) => p.payment_id === id) || null),
      create: jest.fn(async (rec) => {
        store.Payments.push(rec);
        return rec;
      }),
      update: jest.fn(async (id, patch) => {
        const idx = store.Payments.findIndex((p) => p.payment_id === id);
        store.Payments[idx] = { ...store.Payments[idx], ...patch };
        return store.Payments[idx];
      }),
    },
    receipts: {
      create: jest.fn(async (rec) => {
        store.Receipts.push(rec);
        return rec;
      }),
    },
  };
});

jest.mock('../src/services/auditService', () => ({ log: jest.fn(async () => {}) }));
jest.mock('../src/services/billingService', () => ({ recalculateStatus: jest.fn(async () => {}) }));
jest.mock('../src/services/googleDriveService', () => ({
  uploadBuffer: jest.fn(async () => ({ fileId: 'drive-file-1' })),
}));
jest.mock('../src/services/receiptService', () => ({
  buildReceiptPdf: jest.fn(async () => Buffer.from('pdf-bytes')),
}));

const repos = require('../src/repositories');
const driveService = require('../src/services/googleDriveService');
const paymentService = require('../src/services/paymentService');

const ACTOR = { id: 'admin-1', name: 'Test Admin' };

function resetStore() {
  repos.__store.Payments.length = 0;
  repos.__store.Receipts.length = 0;
  repos.__store.Monthly_Billing[0].paid = 0;
  repos.__store.Monthly_Billing[0].status = 'pending';
}

describe('paymentService.recordPayment', () => {
  beforeEach(() => {
    resetStore();
    jest.clearAllMocks();
  });

  test('rejects an unsupported payment method', async () => {
    await expect(
      paymentService.recordPayment({ studentId: 'LIB-2026-0001', billingId: 'b1', amount: 500, paymentMethod: 'card' }, ACTOR)
    ).rejects.toThrow(/cash.*upi/i);
  });

  test('rejects a billing record that belongs to a different student', async () => {
    await expect(
      paymentService.recordPayment({ studentId: 'LIB-2026-9999', billingId: 'b1', amount: 500, paymentMethod: 'cash' }, ACTOR)
    ).rejects.toThrow(/does not belong/i);
  });

  test('records a payment, updates the billing paid total, and auto-archives a receipt', async () => {
    const payment = await paymentService.recordPayment({ studentId: 'LIB-2026-0001', billingId: 'b1', amount: 500, paymentMethod: 'cash' }, ACTOR);
    expect(payment.receipt_number).toMatch(/^RCPT-\d{4}-\d{4}$/);
    expect(repos.__store.Monthly_Billing[0].paid).toBe(500);
    expect(repos.__store.Receipts).toHaveLength(1);
    expect(repos.__store.Receipts[0].payment_id).toBe(payment.payment_id);
  });

  test('multiple partial payments sum to the billing paid total (section 21)', async () => {
    await paymentService.recordPayment({ studentId: 'LIB-2026-0001', billingId: 'b1', amount: 500, paymentMethod: 'cash' }, ACTOR);
    await paymentService.recordPayment({ studentId: 'LIB-2026-0001', billingId: 'b1', amount: 400, paymentMethod: 'upi' }, ACTOR);
    expect(repos.__store.Monthly_Billing[0].paid).toBe(900);
  });

  test('a Drive failure during receipt archiving does not fail the payment itself', async () => {
    driveService.uploadBuffer.mockRejectedValueOnce(new Error('Drive unavailable'));
    const payment = await paymentService.recordPayment({ studentId: 'LIB-2026-0001', billingId: 'b1', amount: 500, paymentMethod: 'cash' }, ACTOR);
    expect(payment.payment_id).toBeTruthy();
    expect(repos.__store.Payments).toHaveLength(1);
    expect(repos.__store.Receipts).toHaveLength(0); // archive failed silently, payment still recorded
  });
});

describe('paymentService.recordPayment — date-range payments (no billingId)', () => {
  beforeEach(() => {
    resetStore();
    jest.clearAllMocks();
  });

  test('requires both periodStart and periodEnd when billingId is omitted', async () => {
    await expect(
      paymentService.recordPayment({ studentId: 'LIB-2026-0001', periodStart: '2026-08-01', amount: 500, paymentMethod: 'cash' }, ACTOR)
    ).rejects.toThrow(/periodStart.*periodEnd/i);
  });

  test('rejects an end date before the start date', async () => {
    await expect(
      paymentService.recordPayment(
        { studentId: 'LIB-2026-0001', periodStart: '2026-08-15', periodEnd: '2026-08-01', amount: 500, paymentMethod: 'cash' },
        ACTOR
      )
    ).rejects.toThrow(/periodEnd/i);
  });

  test('records a range payment with an empty billing_id and never touches Monthly_Billing', async () => {
    const payment = await paymentService.recordPayment(
      { studentId: 'LIB-2026-0001', periodStart: '2026-08-01', periodEnd: '2026-08-15', amount: 750, paymentMethod: 'upi' },
      ACTOR
    );
    expect(payment.billing_id).toBe('');
    expect(payment.period_start).toBe('2026-08-01');
    expect(payment.period_end).toBe('2026-08-15');
    // The one Monthly_Billing row in the fixture must be untouched by a range payment.
    expect(repos.__store.Monthly_Billing[0].paid).toBe(0);
  });

  test('a range payment still auto-archives a receipt', async () => {
    const payment = await paymentService.recordPayment(
      { studentId: 'LIB-2026-0001', periodStart: '2026-08-01', periodEnd: '2026-08-15', amount: 750, paymentMethod: 'cash' },
      ACTOR
    );
    expect(repos.__store.Receipts).toHaveLength(1);
    expect(repos.__store.Receipts[0].payment_id).toBe(payment.payment_id);
  });

  test('voiding a range payment does not attempt to update Monthly_Billing', async () => {
    const payment = await paymentService.recordPayment(
      { studentId: 'LIB-2026-0001', periodStart: '2026-08-01', periodEnd: '2026-08-15', amount: 750, paymentMethod: 'cash' },
      ACTOR
    );
    const voided = await paymentService.voidPayment(payment.payment_id, 'Refunded', ACTOR);
    expect(voided.status).toBe('void');
    expect(repos.__store.Monthly_Billing[0].paid).toBe(0);
  });
});

describe('paymentService.voidPayment', () => {
  beforeEach(() => {
    resetStore();
    jest.clearAllMocks();
  });

  test('requires a reason and recomputes the billing paid total', async () => {
    const payment = await paymentService.recordPayment({ studentId: 'LIB-2026-0001', billingId: 'b1', amount: 1000, paymentMethod: 'cash' }, ACTOR);
    await expect(paymentService.voidPayment(payment.payment_id, '', ACTOR)).rejects.toThrow(/reason/i);

    const voided = await paymentService.voidPayment(payment.payment_id, 'Duplicate entry', ACTOR);
    expect(voided.status).toBe('void');
    expect(repos.__store.Monthly_Billing[0].paid).toBe(0); // voided payment no longer counts
  });

  test('cannot void an already-void payment', async () => {
    const payment = await paymentService.recordPayment({ studentId: 'LIB-2026-0001', billingId: 'b1', amount: 1000, paymentMethod: 'cash' }, ACTOR);
    await paymentService.voidPayment(payment.payment_id, 'Mistake', ACTOR);
    await expect(paymentService.voidPayment(payment.payment_id, 'Again', ACTOR)).rejects.toThrow(/already/i);
  });
});
