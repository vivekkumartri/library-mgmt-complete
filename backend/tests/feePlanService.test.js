jest.mock('../src/repositories', () => {
  const store = { Students: [{ student_id: 'LIB-2026-0001', status: 'active' }], Fee_Plans: [] };
  return {
    __store: store,
    students: {
      findById: jest.fn(async (id) => store.Students.find((s) => s.student_id === id) || null),
    },
    feePlans: {
      findAll: jest.fn(async (filterFn) => {
        const rows = store.Fee_Plans;
        return filterFn ? rows.filter(filterFn) : rows;
      }),
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
const feePlanService = require('../src/services/feePlanService');

const STUDENT = 'LIB-2026-0001';
const ACTOR = { id: 'admin-1', name: 'Test Admin' };

function resetStore() {
  repos.__store.Fee_Plans.length = 0;
}

describe('feePlanService', () => {
  beforeEach(resetStore);

  test('setFee creates an open-ended plan when none exists', async () => {
    const plan = await feePlanService.setFee({ studentId: STUDENT, monthlyFee: 1000, discount: 100, effectiveFrom: '2026-08-01' }, ACTOR);
    expect(plan.monthly_fee).toBe(1000);
    expect(plan.effective_to).toBe('');
    const current = await feePlanService.getCurrentFee(STUDENT, '2026-08-15');
    expect(current.fee_plan_id).toBe(plan.fee_plan_id);
  });

  test('a later fee change closes the previous plan the day before it starts, never edits its amount', async () => {
    const first = await feePlanService.setFee({ studentId: STUDENT, monthlyFee: 800, effectiveFrom: '2026-08-01' }, ACTOR);
    await feePlanService.setFee({ studentId: STUDENT, monthlyFee: 1000, effectiveFrom: '2026-09-01' }, ACTOR);

    const closedFirst = repos.__store.Fee_Plans.find((p) => p.fee_plan_id === first.fee_plan_id);
    expect(closedFirst.monthly_fee).toBe(800); // amount itself is untouched
    expect(closedFirst.effective_to).toBe('2026-08-31');

    // A billing month inside the first plan's window still resolves to the old fee.
    const augustFee = await feePlanService.getCurrentFee(STUDENT, '2026-08-20');
    expect(augustFee.monthly_fee).toBe(800);

    // September resolves to the new fee.
    const septemberFee = await feePlanService.getCurrentFee(STUDENT, '2026-09-05');
    expect(septemberFee.monthly_fee).toBe(1000);
  });

  test('getHistory returns plans newest-first', async () => {
    await feePlanService.setFee({ studentId: STUDENT, monthlyFee: 800, effectiveFrom: '2026-06-01' }, ACTOR);
    await feePlanService.setFee({ studentId: STUDENT, monthlyFee: 900, effectiveFrom: '2026-07-01' }, ACTOR);
    await feePlanService.setFee({ studentId: STUDENT, monthlyFee: 1000, effectiveFrom: '2026-08-01' }, ACTOR);

    const history = await feePlanService.getHistory(STUDENT);
    expect(history.map((h) => h.monthly_fee)).toEqual([1000, 900, 800]);
  });

  test('getCurrentFee returns null when no plan has been set', async () => {
    const current = await feePlanService.getCurrentFee('LIB-2026-9999');
    expect(current).toBeNull();
  });

  test('setFee requires monthlyFee', async () => {
    await expect(feePlanService.setFee({ studentId: STUDENT }, ACTOR)).rejects.toThrow(/monthlyFee/);
  });
});
