const repos = require('../repositories');
const env = require('../config/env');
const { uuid, nextSequentialId } = require('../utils/id');
const { AppError } = require('../utils/AppError');
const finance = require('./financeService');
const billingService = require('./billingService');
const auditService = require('./auditService');
const driveService = require('./googleDriveService');

class PaymentService {
  async _nextReceiptNumber() {
    const year = new Date().getFullYear();
    const existing = await repos.payments.findAll();
    return nextSequentialId(env.defaults.receiptPrefix, year, existing.map((p) => p.receipt_number));
  }

  /**
   * Records a payment. There are two shapes:
   *  - Against a Monthly_Billing record (billingId given): the normal
   *    monthly-fee flow — validates the billing record, updates its paid
   *    total and status, section 21/22 style.
   *  - A date-range payment (billingId omitted, periodStart/periodEnd
   *    given instead): used for the "record a payment covering a custom
   *    date range" flow, e.g. paying for a few weeks rather than a full
   *    billing month. This skips the Monthly_Billing lookup/update entirely
   *    so month-based billing/report data is never polluted by a
   *    non-month-shaped record — billing_id is stored as '' for these.
   */
  async recordPayment({ studentId, billingId, periodStart, periodEnd, amount, paymentMethod, referenceNumber, paymentDate, notes }, actor) {
    if (!['cash', 'upi'].includes(paymentMethod)) {
      throw new AppError('VALIDATION_ERROR', "Payment method must be 'cash' or 'upi'.", 400);
    }

    let billing = null;
    if (billingId) {
      billing = await repos.billing.findById(billingId);
      if (!billing) throw new AppError('NOT_FOUND', 'Billing record not found.', 404);
      if (billing.student_id !== studentId) {
        throw new AppError('VALIDATION_ERROR', 'Billing record does not belong to this student.', 400);
      }
    } else {
      if (!periodStart || !periodEnd) {
        throw new AppError('VALIDATION_ERROR', 'Either billingId or both periodStart and periodEnd are required.', 400);
      }
      if (periodEnd < periodStart) {
        throw new AppError('VALIDATION_ERROR', 'periodEnd must not be before periodStart.', 400);
      }
    }

    const receiptNumber = await this._nextReceiptNumber();
    const record = {
      payment_id: uuid(),
      receipt_number: receiptNumber,
      student_id: studentId,
      billing_id: billingId || '',
      amount,
      payment_method: paymentMethod,
      reference_number: referenceNumber || '',
      payment_date: paymentDate || new Date().toISOString().slice(0, 10),
      received_by: actor?.id || 'system',
      status: 'active',
      void_reason: '',
      notes: notes || '',
      created_at: new Date().toISOString(),
      period_start: billing ? '' : periodStart,
      period_end: billing ? '' : periodEnd,
    };
    await repos.payments.create(record);

    // Update the billing record's paid total (allows multiple partial payments — section 21).
    // Only applies to the billing-record flow — a range payment has no
    // Monthly_Billing row to update.
    if (billing) {
      const allPayments = await repos.payments.findAll((p) => p.billing_id === billingId && p.status === 'active');
      const totalPaid = finance.sumAmounts(allPayments.map((p) => Number(p.amount)));
      await repos.billing.update(billingId, { paid: totalPaid, updated_at: new Date().toISOString() });
      await billingService.recalculateStatus(billingId);
    }

    await auditService.log({ actor, action: 'payment_created', entity: 'Payments', entityId: record.payment_id, newValue: record });

    // Archive the receipt PDF to Drive automatically (section 23) instead
    // of requiring a separate manual "archive" action. Best-effort: a
    // Drive/PDF hiccup here must never fail the payment itself — the
    // payment and billing state above are already durably saved, and the
    // receipt can still be viewed/regenerated on demand from
    // GET /payments/:id/receipt.pdf either way.
    try {
      // Lazy require avoids a require cycle (receiptService also touches repositories/finance).
      const { buildReceiptPdf } = require('./receiptService');
      const pdfBuffer = await buildReceiptPdf(record.payment_id);
      const date = new Date(record.payment_date);
      const year = String(date.getFullYear());
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const { fileId } = await driveService.uploadBuffer({
        pathSegments: ['Receipts', year, month],
        fileName: `${record.receipt_number}.pdf`,
        mimeType: 'application/pdf',
        buffer: pdfBuffer,
      });
      await repos.receipts.create({
        receipt_id: uuid(),
        receipt_number: record.receipt_number,
        payment_id: record.payment_id,
        student_id: record.student_id,
        pdf_drive_file_id: fileId,
        generated_at: new Date().toISOString(),
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[payment] receipt auto-archive failed (payment still recorded)', err.message);
    }

    return record;
  }

  /** Corrections never delete history — they append an audit trail and, if voiding, mark void (section 22). */
  async voidPayment(paymentId, reason, actor) {
    const before = await repos.payments.findById(paymentId);
    if (!before) throw new AppError('NOT_FOUND', 'Payment not found.', 404);
    if (before.status === 'void') throw new AppError('ALREADY_VOID', 'This payment has already been voided.', 400);
    if (!reason) throw new AppError('REASON_REQUIRED', 'A reason is required to void a payment.', 400);

    const updated = await repos.payments.update(paymentId, { status: 'void', void_reason: reason });

    // A range payment (no billing_id) has no Monthly_Billing record to
    // recompute — nothing further to do there.
    if (before.billing_id) {
      const allPayments = await repos.payments.findAll((p) => p.billing_id === before.billing_id && p.status === 'active');
      const totalPaid = finance.sumAmounts(allPayments.map((p) => Number(p.amount)));
      await repos.billing.update(before.billing_id, { paid: totalPaid, updated_at: new Date().toISOString() });
      await billingService.recalculateStatus(before.billing_id);
    }

    await auditService.log({ actor, action: 'payment_voided', entity: 'Payments', entityId: paymentId, previousValue: before, newValue: updated });
    return updated;
  }

  async correctPayment(paymentId, patch, reason, actor) {
    const before = await repos.payments.findById(paymentId);
    if (!before) throw new AppError('NOT_FOUND', 'Payment not found.', 404);
    if (!reason) throw new AppError('REASON_REQUIRED', 'A reason is required to correct a payment record.', 400);
    const allowed = ['amount', 'payment_method', 'reference_number', 'payment_date', 'notes'];
    const safePatch = {};
    for (const k of allowed) if (patch[k] !== undefined) safePatch[k] = patch[k];
    const updated = await repos.payments.update(paymentId, safePatch);

    if (safePatch.amount !== undefined && before.billing_id) {
      const allPayments = await repos.payments.findAll((p) => p.billing_id === before.billing_id && p.status === 'active');
      const totalPaid = finance.sumAmounts(allPayments.map((p) => Number(p.amount)));
      await repos.billing.update(before.billing_id, { paid: totalPaid, updated_at: new Date().toISOString() });
      await billingService.recalculateStatus(before.billing_id);
    }

    await auditService.log({
      actor, action: 'payment_edited', entity: 'Payments', entityId: paymentId,
      previousValue: before, newValue: { ...updated, correction_reason: reason },
    });
    return updated;
  }
}

module.exports = new PaymentService();
