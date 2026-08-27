const express = require('express');
const { z } = require('zod');
const repos = require('../repositories');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireAdmin, requirePermission } = require('../middleware/auth');
const { AppError } = require('../utils/AppError');
const { AllocationService } = require('../services/allocationService');

const router = express.Router();

const createSchema = z.object({
  studentId: z.string().min(1),
  floorId: z.string().min(1),
  seatId: z.string().min(1),
  startDate: z.string().min(1),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  monthlyFee: z.number().nonnegative(),
  discount: z.number().nonnegative().optional().default(0),
  lateFeeConfig: z
    .object({ type: z.enum(['fixed', 'percentage']), value: z.number(), gracePeriodDays: z.number().optional() })
    .nullable()
    .optional(),
  notes: z.string().optional().default(''),
  confirmOverlap: z.boolean().optional().default(false),
});

const checkSchema = z.object({
  studentId: z.string().optional(), // omitted entirely for a not-yet-created student (e.g. the add-student wizard)
  seatId: z.string().min(1),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
});

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { studentId, seatId, status } = req.query;
    let allocations = await repos.allocations.findAll();
    if (req.user.type === 'student') allocations = allocations.filter((a) => a.student_id === req.user.id);
    if (studentId) allocations = allocations.filter((a) => a.student_id === studentId);
    if (seatId) allocations = allocations.filter((a) => a.seat_id === seatId);
    if (status) allocations = allocations.filter((a) => a.status === status);
    res.json({ allocations });
  })
);

/**
 * Creating an allocation is a two-step confirm flow: the first call
 * (confirmOverlap=false) returns any overlap warning without saving so the
 * UI can show it; the client re-submits with confirmOverlap=true to
 * actually persist (section 12/50 — overlaps are allowed but must be
 * surfaced and explicitly confirmed).
 */
router.post(
  '/',
  requireAuth,
  requireAdmin,
  requirePermission('allocations'),
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);

    if (!data.confirmOverlap) {
      const check = await AllocationService.validateAllocation({
        studentId: data.studentId,
        seatId: data.seatId,
        startTime: data.startTime,
        endTime: data.endTime,
      });
      if (check.warning) {
        return res.status(200).json({ requiresConfirmation: true, warning: check.warning, overlappingAllocations: check.overlappingAllocations });
      }
    }

    const result = await AllocationService.createAllocation(data, req.user);
    res.status(201).json(result);
  })
);

/**
 * A true dry-run: tells the caller whether a seat/time combination would
 * warn about an overlap, WITHOUT ever creating an allocation — unlike
 * POST / with confirmOverlap=false, which still persists the allocation
 * once there's no warning (that's correct for the normal "submit, but
 * flag conflicts" flow, but wrong for a pure availability check). This is
 * what the add-student wizard's seat-allocation step uses to preview
 * overlap warnings before the student even exists yet, so it no longer
 * needs to fake a studentId and risk leaving a ghost allocation behind.
 */
router.post(
  '/check',
  requireAuth,
  requireAdmin,
  requirePermission('allocations'),
  asyncHandler(async (req, res) => {
    const data = checkSchema.parse(req.body);
    const check = await AllocationService.validateAllocation({
      studentId: data.studentId || '',
      seatId: data.seatId,
      startTime: data.startTime,
      endTime: data.endTime,
    });
    res.json({ warning: check.warning, overlappingAllocations: check.overlappingAllocations });
  })
);

router.post(
  '/:id/end',
  requireAuth,
  requireAdmin,
  requirePermission('allocations'),
  asyncHandler(async (req, res) => {
    const { actualEndDate, reason, notes } = req.body;
    if (!actualEndDate) throw new AppError('VALIDATION_ERROR', 'Actual leaving/end date is required.', 400);
    const updated = await AllocationService.endAllocation(req.params.id, { actualEndDate, reason, notes }, req.user);

    // Move the student to Past Students if they have no other active allocation.
    const student = await repos.students.findById(updated.student_id);
    if (student && student.status === 'active') {
      const stillActive = await repos.allocations.findAll(
        (a) => a.student_id === updated.student_id && ['scheduled', 'active'].includes(a.status)
      );
      if (stillActive.length === 0) {
        await repos.students.update(updated.student_id, { status: 'past', leaving_date: actualEndDate, updated_at: new Date().toISOString() });
      }
    }

    res.json({ allocation: updated });
  })
);

module.exports = router;
