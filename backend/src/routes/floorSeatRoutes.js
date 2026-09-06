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
  // One entry per row, e.g. [14, 13, 12] — rows need not be the same width.
  rowConfig: z.array(z.number().int().positive()).min(1),
  openingTime: z.string().optional().default(''),
  closingTime: z.string().optional().default(''),
  notes: z.string().optional().default(''),
});

/** Creates seats 1..sum(rowConfig) for a floor, stamping each with its (row, col) position. */
async function generateSeatsForRowConfig(floorId, rowConfig, startingSeatNumber = 1) {
  let seatNumber = startingSeatNumber;
  let created = 0;
  for (let rowIdx = 0; rowIdx < rowConfig.length; rowIdx++) {
    const rowNumber = rowIdx + 1;
    for (let col = 1; col <= rowConfig[rowIdx]; col++) {
      await repos.seats.create({
        seat_id: uuid(),
        floor_id: floorId,
        seat_number: seatNumber,
        status: 'available',
        disabled_reason: '',
        notes: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        row_number: rowNumber,
        col_number: col,
      });
      seatNumber++;
      created++;
    }
  }
  return created;
}

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
      rows: data.rowConfig.length,
      columns: Math.max(...data.rowConfig),
      opening_time: data.openingTime,
      closing_time: data.closingTime,
      status: 'active',
      notes: data.notes,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      row_config_json: JSON.stringify(data.rowConfig),
    };
    await repos.floors.create(floor);

    // Auto-generate seats for this floor, row by row (section 7/8).
    const total = await generateSeatsForRowConfig(floorId, data.rowConfig);

    await auditService.log({ actor: req.user, action: 'floor_created', entity: 'Floors', entityId: floorId, newValue: floor });
    res.status(201).json({ floor, seatsGenerated: total });
  })
);

const resizeSchema = z.object({
  // Full replacement row config, e.g. [14, 13, 12]. Row count is
  // rowConfig.length; rows can shrink, grow, be added, or be dropped
  // entirely, each independently of the others.
  rowConfig: z.array(z.number().int().positive()).min(1),
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
    const newRowConfig = data.rowConfig;

    let oldRowConfig = [];
    try {
      oldRowConfig = JSON.parse(floor.row_config_json || '[]');
    } catch {
      oldRowConfig = [];
    }
    // Floors created before this feature have no row_config_json — treat
    // them as one row per existing row, all at the old uniform width.
    if (oldRowConfig.length === 0 && Number(floor.rows) > 0) {
      oldRowConfig = Array(Number(floor.rows)).fill(Number(floor.columns) || 0);
    }

    const seats = await repos.seats.findAll((s) => s.floor_id === req.params.id);
    const highestEverIssued = seats.reduce((max, s) => Math.max(max, Number(s.seat_number)), 0);
    let nextSeatNumber = highestEverIssued + 1;

    const rowCount = Math.max(oldRowConfig.length, newRowConfig.length);

    // Dry run first: collect every seat that a shrink/drop would remove and
    // check none of them are actively allocated, so a resize either fully
    // applies or fully refuses rather than partially mutating the grid.
    const plannedRemovals = [];
    for (let i = 0; i < rowCount; i++) {
      const rowNumber = i + 1;
      const oldWidth = oldRowConfig[i] || 0;
      const newWidth = newRowConfig[i] || 0;
      if (newWidth < oldWidth) {
        const toRemove = seats.filter(
          (s) => Number(s.row_number) === rowNumber && Number(s.col_number) > newWidth && s.status !== 'removed'
        );
        plannedRemovals.push(...toRemove);
      }
    }
    const blocking = [];
    for (const seat of plannedRemovals) {
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

    let seatsAdded = 0;
    let seatsRemoved = 0;

    for (let i = 0; i < rowCount; i++) {
      const rowNumber = i + 1;
      const oldWidth = oldRowConfig[i] || 0;
      const newWidth = newRowConfig[i] || 0;

      if (newWidth > oldWidth) {
        const removedInRow = new Map(
          seats
            .filter((s) => Number(s.row_number) === rowNumber && s.status === 'removed')
            .map((s) => [Number(s.col_number), s])
        );
        for (let col = oldWidth + 1; col <= newWidth; col++) {
          const revive = removedInRow.get(col);
          if (revive) {
            await repos.seats.update(revive.seat_id, { status: 'available', disabled_reason: '', updated_at: new Date().toISOString() });
          } else {
            await repos.seats.create({
              seat_id: uuid(),
              floor_id: req.params.id,
              seat_number: nextSeatNumber++,
              status: 'available',
              disabled_reason: '',
              notes: '',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              row_number: rowNumber,
              col_number: col,
            });
          }
          seatsAdded++;
        }
      } else if (newWidth < oldWidth) {
        const toRemove = seats.filter(
          (s) => Number(s.row_number) === rowNumber && Number(s.col_number) > newWidth && s.status !== 'removed'
        );
        // Non-destructive: mark removed rather than deleting, so historical
        // allocation/attendance records for these seats stay resolvable.
        for (const seat of toRemove) {
          await repos.seats.update(seat.seat_id, { status: 'removed', updated_at: new Date().toISOString() });
          seatsRemoved++;
        }
      }
    }

    const updatedFloor = await repos.floors.update(req.params.id, {
      rows: newRowConfig.length,
      columns: Math.max(...newRowConfig),
      row_config_json: JSON.stringify(newRowConfig),
      updated_at: new Date().toISOString(),
    });
    await auditService.log({
      actor: req.user, action: 'floor_resized', entity: 'Floors', entityId: req.params.id,
      previousValue: { rowConfig: oldRowConfig },
      newValue: { rowConfig: newRowConfig, seatsAdded, seatsRemoved },
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
