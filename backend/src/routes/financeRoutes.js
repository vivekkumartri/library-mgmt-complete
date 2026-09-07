const express = require('express');
const repos = require('../repositories');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireAdmin, requirePermission } = require('../middleware/auth');
const { AppError } = require('../utils/AppError');
const billingService = require('../services/billingService');
const paymentService = require('../services/paymentService');
const { buildReceiptPdf } = require('../services/receiptService');
const driveService = require('../services/googleDriveService');
const repositoriesModule = require('../repositories');
const { uuid } = require('../utils/id');

const router = express.Router();

// ---- Billing ----
router.get(
  '/billing',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { studentId, month, status } = req.query;
    let rows = await repos.billing.findAll();
    if (req.user.type === 'student') rows = rows.filter((b) => b.student_id === req.user.id);
    if (studentId) rows = rows.filter((b) => b.student_id === studentId);
    if (month) rows = rows.filter((b) => b.billing_month === month);
    if (status) rows = rows.filter((b) => b.status === status);
    res.json({ billing: rows });
  })
);

router.post(
  '/billing',
  requireAuth,
  requireAdmin,
  requirePermission('payments'),
  asyncHandler(async (req, res) => {
    const { studentId, allocationId, billingMonth, baseFee, discount, lateFee, payableOverride, dueDate, notes } = req.body;
    if (!studentId || !billingMonth || baseFee === undefined) {
      throw new AppError('VALIDATION_ERROR', 'studentId, billingMonth and baseFee are required.', 400);
    }
    const record = await billingService.createBillingRecord(
      { studentId, allocationId, billingMonth, baseFee, discount, lateFee, payableOverride, dueDate, notes },
      req.user
    );
    res.status(201).json({ billing: record });
  })
);

// ---- Payments ----
router.get(
  '/payments',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { studentId, billingId, includeVoid } = req.query;
    let rows = await repos.payments.findAll();
    // A voided ("deleted") payment is excluded everywhere by default — the
    // same convention expensesRouter's GET / already uses — so an admin
    // deleting a mistaken payment makes it disappear for the student too,
    // not just from billing math. Pass includeVoid=true for an admin audit
    // view that deliberately wants to see the history.
    if (!includeVoid) rows = rows.filter((p) => p.status !== 'void');
    if (req.user.type === 'student') rows = rows.filter((p) => p.student_id === req.user.id);
    if (studentId) rows = rows.filter((p) => p.student_id === studentId);
    if (billingId) rows = rows.filter((p) => p.billing_id === billingId);
    res.json({ payments: rows });
  })
);

router.post(
  '/payments',
  requireAuth,
  requireAdmin,
  requirePermission('payments'),
  asyncHandler(async (req, res) => {
    const { studentId, billingId, periodStart, periodEnd, amount, paymentMethod, referenceNumber, paymentDate, notes } = req.body;
    if (!studentId || !amount || !paymentMethod) {
      throw new AppError('VALIDATION_ERROR', 'studentId, amount and paymentMethod are required.', 400);
    }
    if (!billingId && !(periodStart && periodEnd)) {
      throw new AppError('VALIDATION_ERROR', 'Either billingId, or both periodStart and periodEnd, are required.', 400);
    }
    const payment = await paymentService.recordPayment(
      { studentId, billingId, periodStart, periodEnd, amount, paymentMethod, referenceNumber, paymentDate, notes },
      req.user
    );
    res.status(201).json({ payment });
  })
);

router.post(
  '/payments/:id/void',
  requireAuth,
  requireAdmin,
  requirePermission('payments'),
  asyncHandler(async (req, res) => {
    const updated = await paymentService.voidPayment(req.params.id, req.body.reason, req.user);
    res.json({ payment: updated });
  })
);

router.patch(
  '/payments/:id',
  requireAuth,
  requireAdmin,
  requirePermission('payments'),
  asyncHandler(async (req, res) => {
    const { reason, ...patch } = req.body;
    const updated = await paymentService.correctPayment(req.params.id, patch, reason, req.user);
    res.json({ payment: updated });
  })
);

// ---- Receipts (PDF) ----
router.get(
  '/payments/:id/receipt.pdf',
  requireAuth,
  asyncHandler(async (req, res) => {
    const payment = await repos.payments.findById(req.params.id);
    if (!payment) throw new AppError('NOT_FOUND', 'Payment not found.', 404);
    if (req.user.type === 'student' && req.user.id !== payment.student_id) {
      throw new AppError('FORBIDDEN', 'You can only view your own receipts.', 403);
    }
    const pdfBuffer = await buildReceiptPdf(req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${payment.receipt_number}.pdf"`);
    res.send(pdfBuffer);
  })
);

router.post(
  '/payments/:id/receipt/archive',
  requireAuth,
  requireAdmin,
  requirePermission('payments'),
  asyncHandler(async (req, res) => {
    const payment = await repos.payments.findById(req.params.id);
    if (!payment) throw new AppError('NOT_FOUND', 'Payment not found.', 404);
    const pdfBuffer = await buildReceiptPdf(req.params.id);
    const date = new Date(payment.payment_date || Date.now());
    const year = String(date.getFullYear());
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const { fileId } = await driveService.uploadBuffer({
      pathSegments: ['Receipts', year, month],
      fileName: `${payment.receipt_number}.pdf`,
      mimeType: 'application/pdf',
      buffer: pdfBuffer,
    });
    const record = {
      receipt_id: uuid(),
      receipt_number: payment.receipt_number,
      payment_id: payment.payment_id,
      student_id: payment.student_id,
      pdf_drive_file_id: fileId,
      generated_at: new Date().toISOString(),
    };
    await repositoriesModule.receipts.create(record);
    res.status(201).json({ receipt: record });
  })
);

module.exports = router;
