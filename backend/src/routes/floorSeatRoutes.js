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

const resizeSchema = z.object({
  rows: z.number().int().positive(),
  columns: z.number().int().positive(),
});

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

/**
 * Resizing the grid is split out from the general PATCH above because it
 * has real side effects on Seats (creating/removing rows), not just a
 * field update — callers must opt into it explicitly via this endpoint
 * rather than it riding along on an ordinary floor edit.
 */
router.patch(
  '/floors/:id/resize',
  requireAuth,
  requireAdmin,
  requirePermission('seats'),
  asyncHandler(async (req, res) => {
    const floor = await repos.floors.findById(req.params.id);
    if (!floor) throw new AppError('NOT_FOUND', 'Floor not found.', 404);
    const data = resizeSchema.parse(req.body);
    const newTotal = data.rows * data.columns;

    const seats = await repos.seats.findAll((s) => s.floor_id === req.params.id);
    const highestEverIssued = seats.reduce((max, s) => Math.max(max, Number(s.seat_number)), 0);
    const currentTotal = seats.filter((s) => s.status !== 'removed').reduce((max, s) => Math.max(max, Number(s.seat_number)), 0);

    let seatsAdded = 0;
    let seatsRemoved = 0;

    if (newTotal > currentTotal) {
      // Re-expanding after a prior shrink: revive previously-removed seats
      // at their old numbers instead of minting duplicates, then create
      // any genuinely new numbers beyond what's ever existed.
      const removedByNumber = new Map(seats.filter((s) => s.status === 'removed').map((s) => [Number(s.seat_number), s]));
      for (let n = currentTotal + 1; n <= newTotal; n++) {
        const revive = removedByNumber.get(n);
        if (revive) {
          await repos.seats.update(revive.seat_id, { status: 'available', disabled_reason: '', updated_at: new Date().toISOString() });
        } else if (n > highestEverIssued) {
          await repos.seats.create({
            seat_id: uuid(),
            floor_id: req.params.id,
            seat_number: n,
            status: 'available',
            disabled_reason: '',
            notes: '',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        }
        seatsAdded++;
      }
    } else if (newTotal < currentTotal) {
      const toRemove = seats.filter((s) => Number(s.seat_number) > newTotal);
      // Never shrink away a seat that's currently in use — the admin needs
      // to end those allocations (or pick a smaller cut) first.
      const blocking = [];
      for (const seat of toRemove) {
        const active = await AllocationService._seatActiveAllocations(seat.seat_id);
        if (active.length > 0) blocking.push(seat.seat_number);
      }
      if (blocking.length > 0) {
        throw new AppError(
          'SEATS_IN_USE',
          `Can't shrink the grid — seat(s) ${blocking.sort((a, b) => a - b).join(', ')} still have an active or scheduled allocation. End those allocations first.`,
          409
        );
      }
      // Non-destructive: mark removed rather than deleting, so historical
      // allocation/attendance records for these seats stay resolvable.
      for (const seat of toRemove) {
        await repos.seats.update(seat.seat_id, { status: 'removed', updated_at: new Date().toISOString() });
        seatsRemoved++;
      }
    }

    const updatedFloor = await repos.floors.update(req.params.id, {
      rows: data.rows,
      columns: data.columns,
      updated_at: new Date().toISOString(),
    });
    await auditService.log({
      actor: req.user, action: 'floor_resized', entity: 'Floors', entityId: req.params.id,
      previousValue: { rows: floor.rows, columns: floor.columns },
      newValue: { rows: data.rows, columns: data.columns, seatsAdded, seatsRemoved },
    });
    res.json({ floor: updatedFloor, seatsAdded, seatsRemoved });
  })
);

// ---- Seats ----

router.get(
  '/floors/:floorId/seats',
  requireAuth,
  asyncHandler(async (req, res) => {
    const seats = await repos.seats.findAll((s) => s.floor_id === req.params.floorId && s.status !== 'removed');
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
