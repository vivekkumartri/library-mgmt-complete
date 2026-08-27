const express = require('express');
const { z } = require('zod');
const repos = require('../repositories');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireAdmin, requirePermission } = require('../middleware/auth');
const { AppError } = require('../utils/AppError');
const { uuid } = require('../utils/id');
const auditService = require('../services/auditService');
const { AllocationService } = require('../services/allocationService');

const router = express.Router();

const floorSchema = z.object({
  floorName: z.string().min(1),
  floorNumber: z.union([z.string(), z.number()]),
  rows: z.number().int().positive(),
  columns: z.number().int().positive(),
  openingTime: z.string().optional().default(''),
  closingTime: z.string().optional().default(''),
  notes: z.string().optional().default(''),
});

router.get(
  '/floors',
  requireAuth,
  asyncHandler(async (req, res) => {
    const floors = await repos.floors.findAll();
    res.json({ floors });
  })
);

router.post(
  '/floors',
  requireAuth,
  requireAdmin,
  requirePermission('seats'),
  asyncHandler(async (req, res) => {
    const data = floorSchema.parse(req.body);
    const floorId = uuid();
    const floor = {
      floor_id: floorId,
      floor_name: data.floorName,
      floor_number: data.floorNumber,
      rows: data.rows,
      columns: data.columns,
      opening_time: data.openingTime,
      closing_time: data.closingTime,
      status: 'active',
      notes: data.notes,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await repos.floors.create(floor);

    // Auto-generate seats 1..rows*columns for this floor (section 7/8).
    const total = data.rows * data.columns;
    for (let n = 1; n <= total; n++) {
      await repos.seats.create({
        seat_id: uuid(),
        floor_id: floorId,
        seat_number: n,
        status: 'available',
        disabled_reason: '',
        notes: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    await auditService.log({ actor: req.user, action: 'floor_created', entity: 'Floors', entityId: floorId, newValue: floor });
    res.status(201).json({ floor, seatsGenerated: total });
  })
);

router.patch(
  '/floors/:id',
  requireAuth,
  requireAdmin,
  requirePermission('seats'),
  asyncHandler(async (req, res) => {
    const allowed = ['floor_name', 'opening_time', 'closing_time', 'status', 'notes'];
    const patch = {};
    for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];
    patch.updated_at = new Date().toISOString();
    const updated = await repos.floors.update(req.params.id, patch);
    res.json({ floor: updated });
  })
);

// ---- Seats ----

router.get(
  '/floors/:floorId/seats',
  requireAuth,
  asyncHandler(async (req, res) => {
    const seats = await repos.seats.findAll((s) => s.floor_id === req.params.floorId);
    // Attach today's timeline so the seat map can render live status
    // (section 10 — a seat is not simply occupied/unoccupied).
    const withTimeline = await Promise.all(
      seats.map(async (s) => ({ ...s, timeline: await AllocationService.seatTimeline(s.seat_id) }))
    );
    res.json({ seats: withTimeline });
  })
);

router.get(
  '/seats/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const seat = await repos.seats.findById(req.params.id);
    if (!seat) throw new AppError('NOT_FOUND', 'Seat not found.', 404);
    const timeline = await AllocationService.seatTimeline(seat.seat_id);
    res.json({ seat: { ...seat, timeline } });
  })
);

router.patch(
  '/seats/:id',
  requireAuth,
  requireAdmin,
  requirePermission('seats'),
  asyncHandler(async (req, res) => {
    const { status, disabledReason, notes } = req.body;
    const patch = { updated_at: new Date().toISOString() };
    if (status) {
      if (!['available', 'disabled'].includes(status)) {
        throw new AppError('VALIDATION_ERROR', "Seat status must be 'available' or 'disabled'.", 400);
      }
      patch.status = status;
      patch.disabled_reason = status === 'disabled' ? disabledReason || 'Not specified' : '';
    }
    if (notes !== undefined) patch.notes = notes;
    const before = await repos.seats.findById(req.params.id);
    if (!before) throw new AppError('NOT_FOUND', 'Seat not found.', 404);
    const updated = await repos.seats.update(req.params.id, patch);
    await auditService.log({
      actor: req.user,
      action: status === 'disabled' ? 'seat_disabled' : 'seat_updated',
      entity: 'Seats', entityId: req.params.id, previousValue: before, newValue: updated,
    });
    res.json({ seat: updated });
  })
);

module.exports = router;
