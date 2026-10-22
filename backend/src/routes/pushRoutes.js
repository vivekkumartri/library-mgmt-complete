const express = require('express');
const { z } = require('zod');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const pushService = require('../services/pushService');

const router = express.Router();

const registerSchema = z.object({
  fcmToken: z.string().min(1),
  platform: z.enum(['android', 'ios']).optional(),
});
const unregisterSchema = z.object({ fcmToken: z.string().min(1) });

// Any logged-in user (admin or student) registers their own device —
// there's no cross-user case here, req.user is always the owner.
router.post(
  '/register-device',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { fcmToken, platform } = registerSchema.parse(req.body);
    await pushService.registerDevice({ ownerType: req.user.type, ownerId: req.user.id, fcmToken, platform });
    res.json({ success: true });
  })
);

router.post(
  '/unregister-device',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { fcmToken } = unregisterSchema.parse(req.body);
    await pushService.unregisterDevice(fcmToken);
    res.json({ success: true });
  })
);

// Manual trigger for testing/ops — same reminder logic the daily cron
// runs. Super-admin-only since it pushes to every overdue student at
// once, same sensitivity bar as /backup/run.
router.post(
  '/send-payment-reminders',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const result = await pushService.sendPaymentDueReminders();
    res.json(result);
  })
);

module.exports = router;
