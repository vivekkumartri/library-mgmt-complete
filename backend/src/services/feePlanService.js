const repos = require('../repositories');
const { uuid } = require('../utils/id');
const { AppError } = require('../utils/AppError');
const auditService = require('./auditService');

/**
 * Tracks a student's monthly fee (and discount) over time (spec section
 * 16/17). Each change creates a NEW Fee_Plans row with an effective_from
 * date and closes the previous plan's effective_to the day before — the
 * old plan row is never edited beyond stamping that end date, so it still
 * shows the fee that was in force when a past billing record was created.
 * Monthly_Billing rows themselves always store their own base_fee/discount
 * at creation time (see billingService) and are never rewritten when the
 * fee plan changes later — this service only answers "what is/was the
 * fee for this student on date X", it does not touch billing history.
 */
class FeePlanService {
  async getHistory(studentId) {
    const rows = await repos.feePlans.findAll((p) => p.student_id === studentId);
    return rows.sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1));
  }

  /** Returns the fee plan in force on `asOfDate` (defaults to today), or null if none has been set. */
  async getCurrentFee(studentId, asOfDate) {
    const date = asOfDate || new Date().toISOString().slice(0, 10);
    const rows = await repos.feePlans.findAll(
      (p) => p.student_id === studentId && p.effective_from <= date && (!p.effective_to || p.effective_to >= date)
    );
    if (rows.length === 0) return null;
    // In the rare case ranges overlap (shouldn't happen via setFee, but
    // defensively), prefer the most recently started plan.
    return rows.sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0];
  }

  async setFee({ studentId, monthlyFee, discount = 0, effectiveFrom, notes }, actor) {
    if (monthlyFee === undefined || monthlyFee === null) {
      throw new AppError('VALIDATION_ERROR', 'monthlyFee is required.', 400);
    }
    const student = await repos.students.findById(studentId);
    if (!student) throw new AppError('NOT_FOUND', 'Student not found.', 404);

    const from = effectiveFrom || new Date().toISOString().slice(0, 10);
    const dayBefore = new Date(from);
    dayBefore.setDate(dayBefore.getDate() - 1);
    const closeDate = dayBefore.toISOString().slice(0, 10);

    // Close any open-ended (or overlapping) previous plan(s) so history
    // stays a clean non-overlapping timeline; never delete them.
    const openPlans = await repos.feePlans.findAll(
      (p) => p.student_id === studentId && (!p.effective_to || p.effective_to >= from)
    );
    for (const plan of openPlans) {
      if (plan.effective_from >= from) {
        // A plan that starts on/after the new one entirely — leave it
        // alone; this is an edge case (backdating) the admin should review
        // manually rather than have silently truncated.
        continue;
      }
      await repos.feePlans.update(plan.fee_plan_id, { effective_to: closeDate });
    }

    const record = {
      fee_plan_id: uuid(),
      student_id: studentId,
      monthly_fee: monthlyFee,
      discount,
      effective_from: from,
      effective_to: '',
      created_at: new Date().toISOString(),
      created_by: actor?.id || 'system',
    };
    await repos.feePlans.create(record);
    await auditService.log({
      actor, action: 'fee_plan_changed', entity: 'Fee_Plans', entityId: record.fee_plan_id,
      newValue: { studentId, monthlyFee, discount, effectiveFrom: from, notes },
    });
    return record;
  }
}

module.exports = new FeePlanService();
