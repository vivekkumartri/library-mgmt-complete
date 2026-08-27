const express = require('express');
const repos = require('../repositories');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireAdmin, requirePermission, requireSuperAdmin } = require('../middleware/auth');
const { AppError } = require('../utils/AppError');
const { uuid } = require('../utils/id');
const auditService = require('../services/auditService');
const attendanceRetentionService = require('../services/attendanceRetentionService');

const router = express.Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { studentId, date, from, to } = req.query;
    let rows = await repos.attendance.findAll();
    if (req.user.type === 'student') rows = rows.filter((a) => a.student_id === req.user.id);
    if (studentId) rows = rows.filter((a) => a.student_id === studentId);
    if (date) rows = rows.filter((a) => a.date === date);
    if (from) rows = rows.filter((a) => a.date >= from);
    if (to) rows = rows.filter((a) => a.date <= to);
    res.json({ attendance: rows });
  })
);

// Mark (or update) attendance for a student on a given date — at most once/day (section 24).
router.post(
  '/',
  requireAuth,
  requireAdmin,
  requirePermission('attendance'),
  asyncHandler(async (req, res) => {
    const { studentId, date, status } = req.body;
    if (!studentId || !date || !['present', 'absent'].includes(status)) {
      throw new AppError('VALIDATION_ERROR', 'studentId, date and status (present|absent) are required.', 400);
    }
    const existingRows = await repos.attendance.findAll((a) => a.student_id === studentId && a.date === date);
    if (existingRows.length > 0) {
      const existing = existingRows[0];
      const updated = await repos.attendance.update(existing.attendance_id, {
        status,
        updated_by: req.user.id,
        updated_at: new Date().toISOString(),
      });
      await auditService.log({ actor: req.user, action: 'attendance_edited', entity: 'Attendance', entityId: existing.attendance_id, previousValue: existing, newValue: updated });
      return res.json({ attendance: updated });
    }
    const record = {
      attendance_id: uuid(),
      student_id: studentId,
      date,
      status,
      marked_by: req.user.id,
      marked_at: new Date().toISOString(),
      updated_by: '',
      updated_at: '',
    };
    await repos.attendance.create(record);
    await auditService.log({ actor: req.user, action: 'attendance_marked', entity: 'Attendance', entityId: record.attendance_id, newValue: record });
    res.status(201).json({ attendance: record });
  })
);

router.get(
  '/dashboard',
  requireAuth,
  requireAdmin,
  requirePermission('attendance'),
  asyncHandler(async (req, res) => {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const [attendanceToday, activeStudents] = await Promise.all([
      repos.attendance.findAll((a) => a.date === date),
      repos.students.findAll((s) => s.status === 'active'),
    ]);
    const present = attendanceToday.filter((a) => a.status === 'present').length;
    const absent = attendanceToday.filter((a) => a.status === 'absent').length;
    const totalActive = activeStudents.length;
    const notMarked = Math.max(0, totalActive - attendanceToday.length);
    res.json({
      date,
      totalActive,
      present,
      absent,
      notMarked,
      attendancePercentage: totalActive > 0 ? Math.round((present / totalActive) * 100) : 0,
    });
  })
);

// Manual trigger for the retention purge (section: attendance data should
// flush after the configured window) — the daily cron in server.js runs
// this automatically, but a super admin can also fire it on demand, e.g.
// right after lowering the retention setting.
router.post(
  '/purge',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const result = await attendanceRetentionService.purgeOldAttendance(req.user);
    res.json(result);
  })
);

module.exports = router;
