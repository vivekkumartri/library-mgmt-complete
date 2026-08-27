const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const { AppError } = require('../utils/AppError');
const backupService = require('../services/backupService');

const router = express.Router();

// Backups touch every sheet and the whole Drive tree — restrict to super
// admins, same bar as Admins & Roles management.
router.post(
  '/run',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const result = await backupService.runBackup({ actor: req.user });
    res.json({ backup: result });
  })
);

router.get(
  '/status',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    res.json({ lastRun: backupService.lastRun() });
  })
);

router.get(
  '/list',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const backups = await backupService.listBackups();
    res.json({ backups });
  })
);

// Restoring overwrites live data, so this requires an explicit
// `confirm: true` in the body on top of the super-admin auth check —
// no restore happens as the side effect of a routine status poll.
router.post(
  '/restore',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const { date, time, sheets, confirm } = req.body;
    if (confirm !== true) {
      throw new AppError('VALIDATION_ERROR', 'Restoring overwrites live data — resend with confirm: true to proceed.', 400);
    }
    const result = await backupService.restoreBackup({ date, time, sheets, actor: req.user });
    res.json({ restore: result });
  })
);

// Same confirm-gate as whole-sheet restore, but scoped to one row — see
// backupService.restoreRecord for why this exists.
router.post(
  '/restore-record',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const { date, time, sheet, recordId, confirm } = req.body;
    if (confirm !== true) {
      throw new AppError('VALIDATION_ERROR', 'Restoring overwrites this record — resend with confirm: true to proceed.', 400);
    }
    const result = await backupService.restoreRecord({ date, time, sheet, recordId, actor: req.user });
    res.json({ restore: result });
  })
);

module.exports = router;
