const repos = require('../repositories');
const { uuid } = require('../utils/id');
const { AppError } = require('../utils/AppError');
const auditService = require('./auditService');
const feePlanService = require('./feePlanService');
const financeService = require('./financeService');

const ACTIVE_LIKE = new Set(['scheduled', 'active']);

function timeToMinutes(t) {
  // Accepts "HH:MM" 24h.
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/**
 * True if [aStart,aEnd) overlaps [bStart,bEnd). Times are "HH:MM" strings.
 * Does not attempt to handle overnight ranges crossing midnight — the spec
 * only requires same-day timing slots.
 */
function timesOverlap(aStart, aEnd, bStart, bEnd) {
  const s1 = timeToMinutes(aStart);
  const e1 = timeToMinutes(aEnd);
  const s2 = timeToMinutes(bStart);
  const e2 = timeToMinutes(bEnd);
  return s1 < e2 && s2 < e1;
}

class AllocationService {
  /** Every allocation for a student that is currently scheduled/active. */
  async _studentActiveAllocations(studentId, excludeAllocationId) {
    const all = await repos.allocations.findAll(
      (r) => r.student_id === studentId && ACTIVE_LIKE.has(r.status)
    );
    return excludeAllocationId ? all.filter((a) => a.allocation_id !== excludeAllocationId) : all;
  }

  /** All scheduled/active allocations on a given seat (for overlap warnings). */
  async _seatActiveAllocations(seatId, excludeAllocationId) {
    const all = await repos.allocations.findAll(
      (r) => r.seat_id === seatId && ACTIVE_LIKE.has(r.status)
    );
    return excludeAllocationId ? all.filter((a) => a.allocation_id !== excludeAllocationId) : all;
  }

  /**
   * Checks the two hard business rules and returns any soft warnings.
   * Throws AppError for hard violations. Never throws for overlaps —
   * those are warnings the admin can still confirm through.
   */
  async validateAllocation({ studentId, seatId, startTime, endTime, excludeAllocationId }) {
    if (timeToMinutes(startTime) >= timeToMinutes(endTime)) {
      throw new AppError('INVALID_TIME_RANGE', 'Start time must be before end time.', 400);
    }

    const seat = await repos.seats.findById(seatId);
    if (!seat) throw new AppError('SEAT_NOT_FOUND', 'Seat not found.', 404);
    if (seat.status === 'disabled') {
      throw new AppError('SEAT_DISABLED', 'This seat is disabled and cannot receive a new allocation.', 400);
    }

    // Hard rule: a student can have only one active/scheduled allocation at a time.
    const studentActive = await this._studentActiveAllocations(studentId, excludeAllocationId);
    if (studentActive.length > 0) {
      throw new AppError(
        'STUDENT_ALREADY_ALLOCATED',
        'This student already has an active seat allocation.',
        409
      );
    }

    // Soft rule: seats CAN be shared by multiple students; overlapping
    // times are allowed but must be surfaced as a warning.
    const seatActive = await this._seatActiveAllocations(seatId, excludeAllocationId);
    const overlaps = seatActive.filter((a) => timesOverlap(startTime, endTime, a.start_time, a.end_time));

    return {
      warning:
        overlaps.length > 0
          ? "This allocation overlaps with another student's existing allocation."
          : null,
      overlappingAllocations: overlaps,
    };
  }

  async createAllocation(input, actor) {
    const {
      studentId, floorId, seatId, startDate, startTime, endTime,
      monthlyFee, discount = 0, lateFeeConfig = null, notes = '',
    } = input;

    const { warning, overlappingAllocations } = await this.validateAllocation({
      studentId, seatId, startTime, endTime,
    });

    const record = {
      allocation_id: uuid(),
      student_id: studentId,
      floor_id: floorId,
      seat_id: seatId,
      start_date: startDate,
      actual_end_date: '',
      start_time: startTime,
      end_time: endTime,
      monthly_fee: monthlyFee,
      discount,
      late_fee_config_json: lateFeeConfig ? JSON.stringify(lateFeeConfig) : '',
      status: 'active',
      notes,
      created_by: actor?.id || 'system',
      created_at: new Date().toISOString(),
      updated_by: actor?.id || 'system',
      updated_at: new Date().toISOString(),
    };
    await repos.allocations.create(record);

    await auditService.log({
      actor, action: 'allocation_created', entity: 'Seat_Allocations', entityId: record.allocation_id,
      newValue: record,
    });

    // Seed the student's fee plan history from this allocation's fee so
    // "current fee" (used to prefill new billing records) is never empty
    // for an actively-allocated student. This does NOT touch billing
    // records already created, and admins can change the fee plan
    // independently later (section 16/17) without editing the allocation.
    try {
      await feePlanService.setFee(
        { studentId, monthlyFee, discount, effectiveFrom: startDate, notes: 'Set from seat allocation' },
        actor
      );
    } catch (err) {
      // Non-fatal — the allocation itself is the source of truth for its
      // own fee; fee-plan seeding is a convenience and must not block
      // allocation creation if it fails.
      // eslint-disable-next-line no-console
      console.error('[allocation] failed to seed fee plan', err.message);
    }

    return { allocation: record, warning, overlappingAllocations };
  }

  /**
   * Corrects an existing allocation's start date (e.g. it was entered
   * wrong at booking time). Re-runs the same overlap check createAllocation
   * uses — excluding this allocation itself — so moving the date can't
   * silently create an undetected seat double-booking; like creation, an
   * overlap is only a warning the caller must explicitly confirm through,
   * not a hard block.
   */
  async updateAllocationStartDate(allocationId, { startDate, confirmOverlap = false }, actor) {
    const existing = await repos.allocations.findById(allocationId);
    if (!existing) throw new AppError('NOT_FOUND', 'Allocation not found.', 404);
    if (existing.status === 'ended' || existing.status === 'cancelled') {
      throw new AppError('ALREADY_ENDED', 'This allocation has already ended and cannot be edited.', 400);
    }
    if (existing.actual_end_date && startDate > existing.actual_end_date) {
      throw new AppError('INVALID_DATE_RANGE', 'Start date cannot be after this allocation\'s end date.', 400);
    }

    const { warning, overlappingAllocations } = await this.validateAllocation({
      studentId: existing.student_id,
      seatId: existing.seat_id,
      startTime: existing.start_time,
      endTime: existing.end_time,
      excludeAllocationId: allocationId,
    });
    if (warning && !confirmOverlap) {
      return { requiresConfirmation: true, warning, overlappingAllocations };
    }

    const updated = await repos.allocations.update(allocationId, {
      start_date: startDate,
      updated_by: actor?.id || 'system',
      updated_at: new Date().toISOString(),
    });

    await auditService.log({
      actor, action: 'allocation_start_date_edited', entity: 'Seat_Allocations', entityId: allocationId,
      previousValue: { start_date: existing.start_date }, newValue: { start_date: updated.start_date },
    });

    return { allocation: updated, warning: null, overlappingAllocations: [] };
  }

  async endAllocation(allocationId, { actualEndDate, reason, notes }, actor) {
    const existing = await repos.allocations.findById(allocationId);
    if (!existing) throw new AppError('NOT_FOUND', 'Allocation not found.', 404);
    if (existing.status === 'ended' || existing.status === 'cancelled') {
      throw new AppError('ALREADY_ENDED', 'This allocation has already ended.', 400);
    }
    const patch = {
      status: 'ended',
      actual_end_date: actualEndDate,
      notes: [existing.notes, reason, notes].filter(Boolean).join(' | '),
      updated_by: actor?.id || 'system',
      updated_at: new Date().toISOString(),
    };
    const updated = await repos.allocations.update(allocationId, patch);

    await auditService.log({
      actor, action: 'allocation_ended', entity: 'Seat_Allocations', entityId: allocationId,
      previousValue: existing, newValue: updated,
    });

    return updated;
  }

  /**
   * A student's automatic, billing-record-free payment status — no admin
   * has to create a Monthly_Billing row for this to work. Derived straight
   * from their current active allocation's start_date (when they joined
   * this seat) and monthly_fee, plus the sum of every active Payments row
   * for them (both billing-linked and free-standing date-range payments).
   * Powers the seat map's payment-risk coloring and the seat detail
   * drawer; a student with no active allocation, or who just joined and
   * hasn't had a chance to pay yet, reads as 'ok', not overdue.
   */
  async paymentStatusForStudent(studentId, allocation) {
    const [resolvedAllocation, payments] = await Promise.all([
      allocation ? Promise.resolve(allocation) : this._studentActiveAllocations(studentId).then((rows) => rows[0] || null),
      repos.payments.findAll((p) => p.student_id === studentId && p.status === 'active'),
    ]);
    const totalPaid = financeService.sumAmounts(payments.map((p) => Number(p.amount)));
    if (!resolvedAllocation) {
      return { urgency: 'ok', dueDate: null, amountDue: 0, joinDate: null, monthlyFee: null, paid: totalPaid, owed: 0 };
    }
    const status = financeService.autoPaymentStatus({
      joinDate: resolvedAllocation.start_date,
      monthlyFee: Number(resolvedAllocation.monthly_fee),
      totalPaid,
    });
    return {
      urgency: status.urgency,
      dueDate: status.paidThroughDate,
      amountDue: status.balance,
      joinDate: resolvedAllocation.start_date,
      monthlyFee: Number(resolvedAllocation.monthly_fee),
      paid: status.paid,
      owed: status.owed,
    };
  }

  /**
   * Builds the seat detail "timeline" view described in the spec (section
   * 11) — enriched with the allocated student's name and current payment
   * urgency so the seat map and seat detail drawer can both show "who's
   * here and are they paid up" without a second round trip per seat.
   */
  async seatTimeline(seatId) {
    const allocations = await this._seatActiveAllocations(seatId);
    const enriched = await Promise.all(
      allocations.map(async (a) => {
        const [student, payment] = await Promise.all([
          repos.students.findById(a.student_id),
          this.paymentStatusForStudent(a.student_id, a),
        ]);
        return {
          allocationId: a.allocation_id,
          studentId: a.student_id,
          studentName: student?.full_name || '',
          studentMobile: student?.mobile || '',
          startDate: a.start_date,
          startTime: a.start_time,
          endTime: a.end_time,
          monthlyFee: a.monthly_fee,
          status: a.status,
          paymentUrgency: payment.urgency,
          paymentDueDate: payment.dueDate,
          paymentAmountDue: payment.amountDue,
        };
      })
    );
    return enriched.sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
  }
}

module.exports = { AllocationService: new AllocationService(), timesOverlap, timeToMinutes };
