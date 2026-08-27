const express = require('express');
const repos = require('../repositories');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const finance = require('../services/financeService');

const router = express.Router();

router.get(
  '/today',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    // One batched Sheets API call for all five tabs instead of five separate
    // reads — this endpoint is hit on every dashboard load.
    const { students, seats, attendanceToday, payments, expenses } = await repos.readMany({
      students: 'students',
      seats: 'seats',
      attendanceToday: ['attendance', (a) => a.date === today],
      payments: ['payments', (p) => p.payment_date === today && p.status === 'active'],
      expenses: ['expenses', (e) => e.date === today && e.status !== 'void'],
    });

    const activeStudents = students.filter((s) => s.status === 'active');
    const totalSeats = seats.length;
    const disabledSeats = seats.filter((s) => s.status === 'disabled').length;
    const availableSeats = seats.filter((s) => s.status === 'available').length;

    res.json({
      date: today,
      totalActiveStudents: activeStudents.length,
      studentsPresent: attendanceToday.filter((a) => a.status === 'present').length,
      totalSeats,
      availableSeats,
      disabledSeats,
      todaysAttendanceMarked: attendanceToday.length,
      todaysPayments: finance.sumAmounts(payments.map((p) => Number(p.amount))),
      todaysExpenses: finance.sumAmounts(expenses.map((e) => Number(e.amount))),
    });
  })
);

router.get(
  '/financial',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    // One batched Sheets API call for all three tabs, same pattern as /today.
    const { billing, payments, expenses } = await repos.readMany({
      billing: ['billing', (b) => b.billing_month === month],
      payments: ['payments', (p) => p.status === 'active' && (p.payment_date || '').startsWith(month)],
      expenses: ['expenses', (e) => (e.date || '').startsWith(month) && e.status !== 'void'],
    });

    const expected = finance.sumAmounts(billing.map((b) => Number(b.payable)));
    const collected = finance.sumAmounts(payments.map((p) => Number(p.amount)));
    const pending = finance.sumAmounts(
      billing.filter((b) => b.status === 'pending' || b.status === 'partially_paid').map((b) => Number(b.payable) - Number(b.paid))
    );
    const overdue = finance.sumAmounts(billing.filter((b) => b.status === 'overdue').map((b) => Number(b.payable) - Number(b.paid)));
    const totalExpenses = finance.sumAmounts(expenses.map((e) => Number(e.amount)));

    res.json({
      month,
      expectedFees: expected,
      collected,
      pendingFees: pending,
      overdueFees: overdue,
      totalExpenses,
      netIncome: finance.sumAmounts([collected, -totalExpenses]),
    });
  })
);

router.get(
  '/operational',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { students, seats, allocations } = await repos.readMany({
      students: 'students',
      seats: 'seats',
      allocations: ['allocations', (a) => a.status === 'active'],
    });
    const activeStudents = students.filter((s) => s.status === 'active').length;
    const pastStudents = students.filter((s) => s.status === 'past').length;
    const vacantSeats = seats.filter((s) => s.status === 'available').length;
    const disabledSeats = seats.filter((s) => s.status === 'disabled').length;
    const utilization = seats.length > 0 ? Math.round((allocations.length / seats.length) * 100) : 0;
    res.json({ activeStudents, pastStudents, vacantSeats, disabledSeats, totalSeats: seats.length, seatUtilizationPercent: utilization });
  })
);

router.get(
  '/payment-due',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const { billing, students } = await repos.readMany({
      billing: ['billing', (b) => ['pending', 'partially_paid', 'overdue'].includes(b.status)],
      students: 'students',
    });
    const byId = Object.fromEntries(students.map((s) => [s.student_id, s]));
    const due = billing.map((b) => ({
      billingId: b.billing_id,
      studentId: b.student_id,
      studentName: byId[b.student_id]?.full_name || 'Unknown',
      amountDue: Math.max(0, Number(b.payable) - Number(b.paid)),
      billingMonth: b.billing_month,
      status: b.due_date && b.due_date < today ? 'overdue' : b.due_date === today ? 'due_today' : b.status,
    }));
    res.json({ paymentDue: due });
  })
);

// ---- Detailed reports (section 32): Student, Seat, Payment, Attendance ----
// (Fee report is already covered by /financial above; Expense report by
// GET /expenses with from/to filters; this section fills in the rest.)

router.get(
  '/students',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const students = await repos.students.findAll();
    const active = students.filter((s) => s.status === 'active');
    const past = students.filter((s) => s.status === 'past');
    const newThisMonth = students.filter((s) => (s.joining_date || '').startsWith(month));
    const leavingThisMonth = students.filter((s) => (s.leaving_date || '').startsWith(month));
    res.json({
      month,
      counts: { active: active.length, past: past.length, new: newThisMonth.length, leaving: leavingThisMonth.length },
      active: active.map(summarizeStudent),
      past: past.map(summarizeStudent),
      newThisMonth: newThisMonth.map(summarizeStudent),
      leavingThisMonth: leavingThisMonth.map(summarizeStudent),
    });
  })
);

router.get(
  '/seats',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { floors, seats, allocations } = await repos.readMany({
      floors: 'floors',
      seats: 'seats',
      allocations: ['allocations', (a) => a.status === 'active' || a.status === 'scheduled'],
    });
    const byFloor = floors.map((f) => {
      const floorSeats = seats.filter((s) => s.floor_id === f.floor_id);
      const available = floorSeats.filter((s) => s.status === 'available').length;
      const disabled = floorSeats.filter((s) => s.status === 'disabled').length;
      const seatIdsAllocated = new Set(allocations.filter((a) => floorSeats.some((s) => s.seat_id === a.seat_id)).map((a) => a.seat_id));
      return {
        floorId: f.floor_id,
        floorName: f.floor_name,
        totalSeats: floorSeats.length,
        available,
        disabled,
        allocated: seatIdsAllocated.size,
      };
    });

    // Allocation conflicts: same seat, overlapping time ranges among active/scheduled allocations.
    const conflicts = [];
    const bySeat = {};
    for (const a of allocations) {
      (bySeat[a.seat_id] = bySeat[a.seat_id] || []).push(a);
    }
    for (const [seatId, list] of Object.entries(bySeat)) {
      const sorted = list.slice().sort((a, b) => a.start_time.localeCompare(b.start_time));
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].start_time < sorted[i - 1].end_time) {
          conflicts.push({ seatId, allocationIds: [sorted[i - 1].allocation_id, sorted[i].allocation_id] });
        }
      }
    }

    res.json({ byFloor, conflicts });
  })
);

router.get(
  '/payments',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const payments = await repos.payments.findAll(
      (p) => p.status === 'active' && (p.payment_date || '').startsWith(month)
    );
    const cash = payments.filter((p) => p.payment_method === 'cash');
    const upi = payments.filter((p) => p.payment_method === 'upi');
    const byDate = {};
    for (const p of payments) {
      byDate[p.payment_date] = (byDate[p.payment_date] || 0) + Number(p.amount);
    }
    res.json({
      month,
      totalCollection: finance.sumAmounts(payments.map((p) => Number(p.amount))),
      cashTotal: finance.sumAmounts(cash.map((p) => Number(p.amount))),
      upiTotal: finance.sumAmounts(upi.map((p) => Number(p.amount))),
      dateWise: Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)).map(([date, amount]) => ({ date, amount })),
    });
  })
);

router.get(
  '/attendance',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const attendance = await repos.attendance.findAll((a) => (a.date || '').startsWith(month));
    const present = attendance.filter((a) => a.status === 'present').length;
    const absent = attendance.filter((a) => a.status === 'absent').length;
    const byDate = {};
    for (const a of attendance) {
      byDate[a.date] = byDate[a.date] || { present: 0, absent: 0 };
      byDate[a.date][a.status] = (byDate[a.date][a.status] || 0) + 1;
    }
    res.json({
      month,
      totalMarked: attendance.length,
      present,
      absent,
      dateWise: Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)).map(([date, counts]) => ({ date, ...counts })),
    });
  })
);

function summarizeStudent(s) {
  return {
    studentId: s.student_id,
    fullName: s.full_name,
    mobile: s.mobile,
    status: s.status,
    joiningDate: s.joining_date,
    leavingDate: s.leaving_date,
  };
}

module.exports = router;
