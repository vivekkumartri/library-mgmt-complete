/**
 * Section 63 critical-rule coverage for billingService, alongside
 * feePlanService.test.js (which already covers the fee-plan timeline
 * itself). These two tests exercise the boundary between the two
 * services: a Monthly_Billing row always freezes its own base_fee at
 * creation time and is never rewritten when the student's fee plan
 * changes afterwards, and an admin can override the payable amount for a
 * single month (e.g. a mid-month joiner) without that override ever
 * touching the student's standing fee plan.
 */
jest.mock('../src/repositories', () => {
  const store = { Monthly_Billing: [], Students: [{ student_id: 'LIB-2026-0001', status: 'active' }], Fee_Plans: [] };
  return {
    __store: store,
    billing: {
      findAll: jest.fn(async (filterFn) => (filterFn ? store.Monthly_Billing.filter(filterFn) : store.Monthly_Billing)),
      findById: jest.fn(async (id) => store.Monthly_Billing.find((b) => b.billing_id === id) || null),
      create: jest.fn(async (rec) => {
        store.Monthly_Billing.push(rec);
        return rec;
      }),
      update: jest.fn(async (id, patch) => {
        const idx = store.Monthly_Billing.findIndex((b) => b.billing_id === id);
        store.Monthly_Billing[idx] = { ...store.Monthly_Billing[idx], ...patch };
        return store.Monthly_Billing[idx];
      }),
    },
    students: {
      findById: jest.fn(async (id) => store.Students.find((s) => s.student_id === id) || null),
    },
    feePlans: {
      findAll: jest.fn(async (filterFn) => (filterFn ? store.Fee_Plans.filter(filterFn) : store.Fee_Plans)),
      create: jest.fn(async (rec) => {
        store.Fee_Plans.push(rec);
        return rec;
      }),
      update: jest.fn(async (id, patch) => {
        const idx = store.Fee_Plans.findIndex((p) => p.fee_plan_id === id);
        store.Fee_Plans[idx] = { ...store.Fee_Plans[idx], ...patch };
        return store.Fee_Plans[idx];
      }),
    },
  };
});

jest.mock('../src/services/auditService', () => ({ log: jest.fn(async () => {}) }));

const repos = require('../src/repositories');
const billingService = require('../src/services/billingService');
const feePlanService = require('../src/services/feePlanService');

const STUDENT = 'LIB-2026-0001';
const ACTOR = { id: 'admin-1', name: 'Test Admin' };

function resetStore() {
  repos.__store.Monthly_Billing.length = 0;
  repos.__store.Fee_Plans.length = 0;
}

describe('billingService — fee-change-preserves-old-billing (section 17/19)', () => {
  beforeEach(resetStore);

  test('a fee plan change made after a billing record exists never rewrites that record', async () => {
    await feePlanService.setFee({ studentId: STUDENT, monthlyFee: 800, effectiveFrom: '2026-08-01' }, ACTOR);

    const augustBilling = await billingService.createBillingRecord(
      { studentId: STUDENT, billingMonth: '2026-08', baseFee: 800, discount: 0, lateFee: 0, dueDate: '2026-08-05' },
      ACTOR
    );
    expect(augustBilling.payable).toBe(800);

    // Admin raises the fee for future months.
    await feePlanService.setFee({ studentId: STUDENT, monthlyFee: 1000, effectiveFrom: '2026-09-01' }, ACTOR);

    // The already-created August billing record is untouched.
    const reloaded = await repos.billing.findById(augustBilling.billing_id);
    expect(reloaded.base_fee).toBe(800);
    expect(reloaded.payable).toBe(800);

    // A new September billing record picks up the new fee, but that's a
    // brand-new row, not a mutation of August's.
    const septemberBilling = await billingService.createBillingRecord(
      { studentId: STUDENT, billingMonth: '2026-09', baseFee: 1000, discount: 0, lateFee: 0, dueDate: '2026-09-05' },
      ACTOR
    );
    expect(septemberBilling.payable).toBe(1000);
    const augustStillFrozen = await repos.billing.findById(augustBilling.billing_id);
    expect(augustStillFrozen.base_fee).toBe(800);
  });

  test('a billing record cannot be duplicated for a month that already has one', async () => {
    await billingService.createBillingRecord(
      { studentId: STUDENT, billingMonth: '2026-08', baseFee: 800 },
      ACTOR
    );
    await expect(
      billingService.createBillingRecord({ studentId: STUDENT, billingMonth: '2026-08', baseFee: 900 }, ACTOR)
    ).rejects.toThrow(/already exists/i);
  });
});

describe('billingService — mid-month joining override (section 19)', () => {
  beforeEach(resetStore);

  test('an explicit payableOverride is used as-is, ignoring the normal base/discount/late-fee computation', async () => {
    // Student joins on the 20th of the month with a full monthly fee of
    // 1000 — admin manually prorates to 400 for the partial month via
    // payableOverride rather than editing baseFee/discount.
    const billing = await billingService.createBillingRecord(
      {
        studentId: STUDENT,
        billingMonth: '2026-08',
        baseFee: 1000,
        discount: 0,
        lateFee: 0,
        payableOverride: 400,
        dueDate: '2026-08-25',
        notes: 'Mid-month join on the 20th, prorated.',
      },
      ACTOR
    );
    expect(billing.payable).toBe(400);
    expect(billing.base_fee).toBe(1000); // the standing fee is still recorded for reference
  });

  test('the prorated override never retroactively changes when the student\'s standing fee plan is set afterwards', async () => {
    const billing = await billingService.createBillingRecord(
      { studentId: STUDENT, billingMonth: '2026-08', baseFee: 1000, payableOverride: 400, dueDate: '2026-08-25' },
      ACTOR
    );
    await feePlanService.setFee({ studentId: STUDENT, monthlyFee: 1000, effectiveFrom: '2026-08-20' }, ACTOR);

    const reloaded = await repos.billing.findById(billing.billing_id);
    expect(reloaded.payable).toBe(400);
  });

  test('without an override, payable falls back to the normal base - discount + late fee computation', async () => {
    const billing = await billingService.createBillingRecord(
      { studentId: STUDENT, billingMonth: '2026-08', baseFee: 1000, discount: 100, lateFee: 50, dueDate: '2026-08-05' },
      ACTOR
    );
    expect(billing.payable).toBe(950);
  });
});
