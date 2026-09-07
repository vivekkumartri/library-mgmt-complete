const express = require('express');
const { z } = require('zod');
const authService = require('../services/authService');
const asyncHandler = require('../utils/asyncHandler');
const { loginLimiter } = require('../middleware/rateLimit');
const { requireAuth } = require('../middleware/auth');
const repos = require('../repositories');
const auditService = require('../services/auditService');

const router = express.Router();

const adminLoginSchema = z.object({ email: z.string().trim().email(), password: z.string().min(1) });
const studentLoginSchema = z.object({ studentId: z.string().min(1), password: z.string().min(1) });

function requestMeta(req) {
  return { ip: req.ip || '', device: req.headers['user-agent'] || '' };
}

router.post(
  '/admin/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = adminLoginSchema.parse(req.body);
    const { ip, device } = requestMeta(req);
    try {
      const result = await authService.adminLogin(email, password);
      await auditService.log({ actor: result.user, action: 'admin_login_succeeded', entity: 'Admins', entityId: result.user.id, ip, device });
      res.json(result);
    } catch (err) {
      await auditService.log({ actor: { id: 'unknown', name: email }, action: 'admin_login_failed', entity: 'Admins', entityId: email, ip, device });
      throw err;
    }
  })
);

router.post(
  '/student/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { studentId, password } = studentLoginSchema.parse(req.body);
    const { ip, device } = requestMeta(req);
    try {
      const result = await authService.studentLogin(studentId, password);
      await auditService.log({ actor: result.user, action: 'student_login_succeeded', entity: 'Students', entityId: result.user.id, ip, device });
      res.json(result);
    } catch (err) {
      await auditService.log({ actor: { id: studentId, name: studentId }, action: 'student_login_failed', entity: 'Students', entityId: studentId, ip, device });
      throw err;
    }
  })
);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'New password must be at least 8 characters.'),
});

// Works for whichever type is logged in — the caller never picks admin vs
// student explicitly, req.user.type (set by requireAuth from the JWT)
// decides which record actually gets updated.
router.post(
  '/change-password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    await authService.changeOwnPassword(
      { type: req.user.type, id: req.user.id, currentPassword, newPassword },
      req.user
    );
    res.json({ success: true });
  })
);

router.post('/logout', (req, res) => {
  // Stateless JWT — logout is a client-side token discard. Endpoint exists
  // for a consistent API surface and future server-side session revocation.
  res.json({ success: true });
});

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user.type === 'admin') {
      const admin = await repos.admins.findById(req.user.id);
      if (!admin) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Admin not found.' } });
      const { password_hash, ...safe } = admin;
      return res.json({ user: { ...safe, type: 'admin' } });
    }
    const student = await repos.students.findById(req.user.id);
    if (!student) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Student not found.' } });
    const { password_hash, ...safe } = student;
    res.json({ user: { ...safe, type: 'student' } });
  })
);

module.exports = router;
