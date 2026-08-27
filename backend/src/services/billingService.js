const repos = require('../repositories');
const { uuid } = require('../utils/id');
const { AppError } = require('../utils/AppError');
const finance = require('./financeService');
const auditService = require('./auditService');

/**
 * Monthly billing is a plain record-creation flow (section 19/20): admin
 * decides the payable amount explicitly, no automatic pro-rating. This
 * service only enforces that historical months are never mutated once a
 * later month exists — new fee amounts always create a NEW billing record
 * for the new month rather than editing the old one.
 */
class BillingService {
  async createBillingRecord({ studentId, allocationId, billingMonth, baseFee, discount = 0, lateFee = 0, payableOverride, dueDate, notes }, actor) {
    const existing = await repos.billing.findAll((b) => b.student_id === studentId && b.billing_month === billingMonth);
    if (existing.length > 0) {
      throw new AppError('DUPLICATE_BILLING', `A billing record for ${billingMonth} already exists for this student.`, 409);
    }
    const payable = payableOverride !== undefined ? payableOverride : finance.computePayable({ baseFee, discount, lateFee });
    const record = {
      billing_id: uuid(),
      student_id: studentId,
      allocation_id: allocationId || '',
      billing_month: billingMonth,
      base_fee: baseFee,
      discount,
      late_fee: lateFee,
      payable,
      paid: 0,
      status: 'pending',
      due_date: dueDate || '',
      notes: notes || '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await repos.billing.create(record);
    await auditService.log({ actor, action: 'billing_created', entity: 'Monthly_Billing', entityId: record.billing_id, newValue: record });
    return record;
  }

  async recalculateStatus(billingId) {
    const billing = await repos.billing.findById(billingId);
    if (!billing) throw new AppError('NOT_FOUND', 'Billing record not found.', 404);
    const status = finance.billingStatus({
      payable: Number(billing.payable),
      paid: Number(billing.paid),
      dueDate: billing.due_date,
    });
    return repos.billing.update(billingId, { status, updated_at: new Date().toISOString() });
  }
}

module.exports = new BillingService();
