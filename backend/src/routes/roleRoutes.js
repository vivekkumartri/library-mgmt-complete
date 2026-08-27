const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const { AppError } = require('../utils/AppError');
const roleService = require('../services/roleService');
const repos = require('../repositories');

const router = express.Router();

// The permission catalog is read-only over the API (edited via the sheet
// directly if the set of app permissions ever changes) but any admin can
// read it, since the Admins screen needs it to render checkboxes.
router.get(
  '/permissions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const permissions = await roleService.listPermissionsCatalog();
    res.json({ permissions });
  })
);

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const roles = await roleService.listRoles();
    res.json({ roles });
  })
);

router.post(
  '/',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const { roleName, description, permissions } = req.body;
    const role = await roleService.createRole({ roleName, description, permissions }, req.user);
    res.status(201).json({ role });
  })
);

router.patch(
  '/:id',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const { roleName, description, permissions } = req.body;
    const role = await roleService.updateRole(req.params.id, { roleName, description, permissions }, req.user);
    res.json({ role });
  })
);

// Assign a role's permission set to an admin. The admin's permissions_json
// can still be hand-edited afterward via PATCH /api/admins/:id.
router.post(
  '/:id/assign/:adminId',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const before = await repos.admins.findById(req.params.adminId);
    if (!before) throw new AppError('NOT_FOUND', 'Admin not found.', 404);
    const updated = await roleService.applyRoleToAdmin(req.params.adminId, req.params.id, req.user);
    const { password_hash, ...safe } = updated;
    res.json({ admin: safe });
  })
);

module.exports = router;
