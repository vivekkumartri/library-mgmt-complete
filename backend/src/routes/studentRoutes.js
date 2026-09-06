const express = require('express');
const { z } = require('zod');
const repos = require('../repositories');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireAdmin, requirePermission, requireStudent } = require('../middleware/auth');
const { AppError } = require('../utils/AppError');
const authService = require('../services/authService');
const auditService = require('../services/auditService');
const driveService = require('../services/googleDriveService');
const feePlanService = require('../services/feePlanService');
const { AllocationService } = require('../services/allocationService');

const router = express.Router();

const createStudentSchema = z.object({
  fullName: z.string().min(1),
  fatherName: z.string().optional().default(''),
  motherName: z.string().optional().default(''),
  mobile: z.string().min(6),
  alternateMobile: z.string().optional().default(''),
  email: z.string().email().optional().or(z.literal('')).default(''),
  address: z.string().optional().default(''),
  dateOfBirth: z.string().optional().default(''),
  idProofDetails: z.string().optional().default(''),
  emergencyContact: z.string().optional().default(''),
  joiningDate: z.string().min(1),
  notes: z.string().optional().default(''),
});

// ---- Admin: list / search ----
router.get(
  '/',
  requireAuth,
  requireAdmin,
  requirePermission('students'),
  asyncHandler(async (req, res) => {
    const { status = 'active', q } = req.query;
    let students = await repos.students.findAll((s) => (status === 'all' ? true : s.status === status));
    if (q) {
      const needle = String(q).toLowerCase();
      students = students.filter(
        (s) =>
          s.full_name.toLowerCase().includes(needle) ||
          s.student_id.toLowerCase().includes(needle) ||
          s.mobile.includes(needle)
      );
    }
    // Enriched with each student's automatic payment status (no
    // Monthly_Billing record required) so the student list can show a due
    // date/urgency at a glance, same as the seat map.
    const withPaymentStatus = await Promise.all(
      students.map(async (s) => {
        const payment = await AllocationService.paymentStatusForStudent(s.student_id);
        return { ...stripSensitive(s), paymentDueDate: payment.dueDate, paymentUrgency: payment.urgency };
      })
    );
    res.json({ students: withPaymentStatus });
  })
);

router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user.type === 'student' && req.user.id !== req.params.id) {
      throw new AppError('FORBIDDEN', 'You can only view your own profile.', 403);
    }
    const student = await repos.students.findById(req.params.id);
    if (!student) throw new AppError('NOT_FOUND', 'Student not found.', 404);
    res.json({ student: stripSensitive(student) });
  })
);

router.post(
  '/',
  requireAuth,
  requireAdmin,
  requirePermission('students'),
  asyncHandler(async (req, res) => {
    const data = createStudentSchema.parse(req.body);
    const { studentId, password, passwordHash } = await authService.createStudentCredentials({
      fullName: data.fullName,
      joiningDate: data.joiningDate,
    });
    const record = {
      student_id: studentId,
      full_name: data.fullName,
      father_name: data.fatherName,
      mother_name: data.motherName,
      mobile: data.mobile,
      alternate_mobile: data.alternateMobile,
      email: data.email,
      address: data.address,
      date_of_birth: data.dateOfBirth,
      photo_drive_file_id: '',
      id_proof_details: data.idProofDetails,
      emergency_contact: data.emergencyContact,
      joining_date: data.joiningDate,
      leaving_date: '',
      signature_drive_file_id: '',
      notes: data.notes,
      status: 'active',
      password_hash: passwordHash,
      must_reset_password: 'true',
      created_at: new Date().toISOString(),
      created_by: req.user.id,
      updated_at: new Date().toISOString(),
    };
    await repos.students.create(record);
    await auditService.log({ actor: req.user, action: 'student_created', entity: 'Students', entityId: studentId, newValue: { full_name: data.fullName } });

    // Password is returned once, for the admin to show/print immediately.
    res.status(201).json({ student: stripSensitive(record), temporaryPassword: password });
  })
);

router.patch(
  '/:id',
  requireAuth,
  requireAdmin,
  requirePermission('students'),
  asyncHandler(async (req, res) => {
    const allowed = [
      'full_name', 'father_name', 'mother_name', 'mobile', 'alternate_mobile', 'email',
      'address', 'date_of_birth', 'id_proof_details', 'emergency_contact', 'notes',
    ];
    const patch = {};
    for (const key of allowed) if (req.body[key] !== undefined) patch[key] = req.body[key];
    patch.updated_at = new Date().toISOString();
    const before = await repos.students.findById(req.params.id);
    if (!before) throw new AppError('NOT_FOUND', 'Student not found.', 404);
    const updated = await repos.students.update(req.params.id, patch);
    await auditService.log({ actor: req.user, action: 'student_edited', entity: 'Students', entityId: req.params.id, previousValue: before, newValue: updated });
    res.json({ student: stripSensitive(updated) });
  })
);

router.post(
  '/:id/deactivate',
  requireAuth,
  requireAdmin,
  requirePermission('students'),
  asyncHandler(async (req, res) => {
    const before = await repos.students.findById(req.params.id);
    if (!before) throw new AppError('NOT_FOUND', 'Student not found.', 404);
    const updated = await repos.students.update(req.params.id, { status: 'deactivated', updated_at: new Date().toISOString() });
    await auditService.log({ actor: req.user, action: 'student_deactivated', entity: 'Students', entityId: req.params.id, previousValue: before, newValue: updated });
    res.json({ student: stripSensitive(updated) });
  })
);

router.post(
  '/:id/reactivate',
  requireAuth,
  requireAdmin,
  requirePermission('students'),
  asyncHandler(async (req, res) => {
    const before = await repos.students.findById(req.params.id);
    if (!before) throw new AppError('NOT_FOUND', 'Student not found.', 404);
    const updated = await repos.students.update(req.params.id, { status: 'active', leaving_date: '', updated_at: new Date().toISOString() });
    await auditService.log({ actor: req.user, action: 'student_reactivated', entity: 'Students', entityId: req.params.id, previousValue: before, newValue: updated });
    res.json({ student: stripSensitive(updated) });
  })
);

/**
 * Permanent delete — only for a student with zero real activity (no
 * allocation, payment, or attendance record ever created for them), so
 * this can only clean up a mistakenly-created entry. Anyone with actual
 * history must go through /:id/deactivate instead, which is reversible
 * and keeps their records resolvable.
 */
router.delete(
  '/:id',
  requireAuth,
  requireAdmin,
  requirePermission('students'),
  asyncHandler(async (req, res) => {
    const student = await repos.students.findById(req.params.id);
    if (!student) throw new AppError('NOT_FOUND', 'Student not found.', 404);

    const [allocations, payments, attendance] = await Promise.all([
      repos.allocations.findAll((a) => a.student_id === req.params.id),
      repos.payments.findAll((p) => p.student_id === req.params.id),
      repos.attendance.findAll((a) => a.student_id === req.params.id),
    ]);
    if (allocations.length > 0 || payments.length > 0 || attendance.length > 0) {
      throw new AppError(
        'STUDENT_HAS_HISTORY',
        'This student has allocation, payment, or attendance history and cannot be permanently deleted — use Deactivate instead.',
        409
      );
    }

    // Profile-only data (no financial/attendance meaning) — safe to clean
    // up alongside the student record itself.
    const [documents, vacations, feePlans] = await Promise.all([
      repos.studentDocuments.findAll((d) => d.student_id === req.params.id),
      repos.studentVacations.findAll((v) => v.student_id === req.params.id),
      repos.feePlans.findAll((f) => f.student_id === req.params.id),
    ]);

    const driveFileIds = [
      student.photo_drive_file_id,
      student.signature_drive_file_id,
      ...documents.map((d) => d.drive_file_id),
    ].filter(Boolean);
    for (const fileId of driveFileIds) {
      try {
        await driveService.deleteFile(fileId);
      } catch {
        // Best-effort — a file already removed/missing shouldn't block
        // deleting the student record itself.
      }
    }

    for (const doc of documents) await repos.studentDocuments.delete(doc.document_id);
    for (const vacation of vacations) await repos.studentVacations.delete(vacation.vacation_id);
    for (const plan of feePlans) await repos.feePlans.delete(plan.fee_plan_id);
    await repos.students.delete(req.params.id);

    await auditService.log({
      actor: req.user, action: 'student_deleted', entity: 'Students', entityId: req.params.id,
      previousValue: stripSensitive(student),
    });
    res.status(204).send();
  })
);

router.post(
  '/:id/reset-password',
  requireAuth,
  requireAdmin,
  requirePermission('students'),
  asyncHandler(async (req, res) => {
    const result = await authService.resetStudentPassword(req.params.id, req.user);
    res.json(result);
  })
);

// ---- Photo / signature upload (multipart handled by route-level middleware in server.js) ----
router.post(
  '/:id/photo',
  requireAuth,
  requireAdmin,
  requirePermission('students'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError('NO_FILE', 'No photo file was uploaded.', 400);
    const student = await repos.students.findById(req.params.id);
    if (!student) throw new AppError('NOT_FOUND', 'Student not found.', 404);
    const { fileId } = await driveService.uploadBuffer({
      pathSegments: ['Students', req.params.id, 'Photo'],
      fileName: `photo-${Date.now()}.jpg`,
      mimeType: req.file.mimetype,
      buffer: req.file.buffer,
    });
    const updated = await repos.students.update(req.params.id, { photo_drive_file_id: fileId, updated_at: new Date().toISOString() });
    res.json({ student: stripSensitive(updated) });
  })
);

router.post(
  '/:id/signature',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user.type === 'student' && req.user.id !== req.params.id) {
      throw new AppError('FORBIDDEN', 'You can only manage your own signature.', 403);
    }
    if (!req.file) throw new AppError('NO_FILE', 'No signature image was uploaded.', 400);
    const student = await repos.students.findById(req.params.id);
    if (!student) throw new AppError('NOT_FOUND', 'Student not found.', 404);
    const { fileId } = await driveService.uploadBuffer({
      pathSegments: ['Students', req.params.id, 'Signature'],
      fileName: `signature-${Date.now()}.png`,
      mimeType: req.file.mimetype || 'image/png',
      buffer: req.file.buffer,
    });
    const updated = await repos.students.update(req.params.id, { signature_drive_file_id: fileId, updated_at: new Date().toISOString() });
    res.json({ student: stripSensitive(updated) });
  })
);

// ---- Vacations ----
router.get(
  '/:id/vacations',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user.type === 'student' && req.user.id !== req.params.id) {
      throw new AppError('FORBIDDEN', 'You can only view your own vacation history.', 403);
    }
    const vacations = await repos.studentVacations.findAll((v) => v.student_id === req.params.id);
    res.json({ vacations });
  })
);

router.post(
  '/:id/vacations',
  requireAuth,
  requireAdmin,
  requirePermission('students'),
  asyncHandler(async (req, res) => {
    const { startDate, endDate, reason, notes } = req.body;
    if (!startDate || !endDate) throw new AppError('VALIDATION_ERROR', 'Start and end date are required.', 400);
    const record = {
      vacation_id: require('../utils/id').uuid(),
      student_id: req.params.id,
      start_date: startDate,
      end_date: endDate,
      reason: reason || '',
      notes: notes || '',
      created_at: new Date().toISOString(),
      created_by: req.user.id,
    };
    await repos.studentVacations.create(record);
    res.status(201).json({ vacation: record });
  })
);

// ---- Fee plans (fee history, section 16/17) ----
router.get(
  '/:id/fee-plans',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user.type === 'student' && req.user.id !== req.params.id) {
      throw new AppError('FORBIDDEN', 'You can only view your own fee history.', 403);
    }
    const [history, current] = await Promise.all([
      feePlanService.getHistory(req.params.id),
      feePlanService.getCurrentFee(req.params.id),
    ]);
    res.json({ history, current });
  })
);

router.post(
  '/:id/fee-plans',
  requireAuth,
  requireAdmin,
  requirePermission('payments'),
  asyncHandler(async (req, res) => {
    const { monthlyFee, discount, effectiveFrom, notes } = req.body;
    const plan = await feePlanService.setFee(
      { studentId: req.params.id, monthlyFee, discount, effectiveFrom, notes },
      req.user
    );
    res.status(201).json({ feePlan: plan });
  })
);

// ---- Automatic payment status (no Monthly_Billing record required) ----
router.get(
  '/:id/payment-status',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user.type === 'student' && req.user.id !== req.params.id) {
      throw new AppError('FORBIDDEN', 'You can only view your own payment status.', 403);
    }
    const status = await AllocationService.paymentStatusForStudent(req.params.id);
    res.json(status);
  })
);

function stripSensitive(student) {
  const { password_hash, ...safe } = student;
  return safe;
}

module.exports = router;
