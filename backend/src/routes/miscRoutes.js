const express = require('express');
const repos = require('../repositories');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireAdmin, requireSuperAdmin, requirePermission } = require('../middleware/auth');
const { AppError } = require('../utils/AppError');
const { uuid } = require('../utils/id');
const auditService = require('../services/auditService');
const authService = require('../services/authService');
const driveService = require('../services/googleDriveService');

const expensesRouter = express.Router();
const noticesRouter = express.Router();
const settingsRouter = express.Router();
const adminsRouter = express.Router();

// ---------------- Expenses ----------------
expensesRouter.get(
  '/',
  requireAuth,
  requireAdmin,
  requirePermission('expenses'),
  asyncHandler(async (req, res) => {
    const { from, to, category, includeVoid } = req.query;
    let rows = await repos.expenses.findAll();
    if (!includeVoid) rows = rows.filter((e) => e.status !== 'void');
    if (from) rows = rows.filter((e) => e.date >= from);
    if (to) rows = rows.filter((e) => e.date <= to);
    if (category) rows = rows.filter((e) => e.category === category);
    res.json({ expenses: rows });
  })
);

expensesRouter.post(
  '/',
  requireAuth,
  requireAdmin,
  requirePermission('expenses'),
  asyncHandler(async (req, res) => {
    const { date, category, description, amount, paymentMode, notes } = req.body;
    if (!date || !category || amount === undefined) {
      throw new AppError('VALIDATION_ERROR', 'date, category and amount are required.', 400);
    }
    const record = {
      expense_id: uuid(),
      date,
      category,
      description: description || '',
      amount,
      payment_mode: paymentMode || '',
      added_by: req.user.id,
      notes: notes || '',
      created_at: new Date().toISOString(),
      status: 'active',
      void_reason: '',
      updated_at: '',
      updated_by: '',
    };
    await repos.expenses.create(record);
    await auditService.log({ actor: req.user, action: 'expense_created', entity: 'Expenses', entityId: record.expense_id, newValue: record });
    res.status(201).json({ expense: record });
  })
);

// Corrections keep an audit trail rather than silently overwriting
// financial history (section 22/43) — same pattern used for payments.
expensesRouter.patch(
  '/:id',
  requireAuth,
  requireAdmin,
  requirePermission('expenses'),
  asyncHandler(async (req, res) => {
    const allowed = ['date', 'category', 'description', 'amount', 'payment_mode', 'notes'];
    const before = await repos.expenses.findById(req.params.id);
    if (!before) throw new AppError('NOT_FOUND', 'Expense not found.', 404);
    if (before.status === 'void') throw new AppError('EXPENSE_VOID', 'This expense has been voided and cannot be edited.', 400);
    const patch = { updated_at: new Date().toISOString(), updated_by: req.user.id };
    for (const key of allowed) if (req.body[key] !== undefined) patch[key] = req.body[key];
    const updated = await repos.expenses.update(req.params.id, patch);
    await auditService.log({ actor: req.user, action: 'expense_edited', entity: 'Expenses', entityId: req.params.id, previousValue: before, newValue: updated });
    res.json({ expense: updated });
  })
);

expensesRouter.post(
  '/:id/void',
  requireAuth,
  requireAdmin,
  requirePermission('expenses'),
  asyncHandler(async (req, res) => {
    const { reason } = req.body;
    if (!reason) throw new AppError('VALIDATION_ERROR', 'A reason is required to void an expense.', 400);
    const before = await repos.expenses.findById(req.params.id);
    if (!before) throw new AppError('NOT_FOUND', 'Expense not found.', 404);
    if (before.status === 'void') throw new AppError('ALREADY_VOID', 'This expense is already void.', 400);
    const updated = await repos.expenses.update(req.params.id, {
      status: 'void', void_reason: reason, updated_at: new Date().toISOString(), updated_by: req.user.id,
    });
    await auditService.log({ actor: req.user, action: 'expense_voided', entity: 'Expenses', entityId: req.params.id, previousValue: before, newValue: updated });
    res.json({ expense: updated });
  })
);

// ---------------- Notices ----------------
noticesRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    let rows = await repos.notices.findAll();
    if (req.user.type === 'student') {
      const today = new Date().toISOString().slice(0, 10);
      rows = rows.filter(
        (n) => n.status === 'active' && (!n.publish_date || n.publish_date <= today) && (!n.expiry_date || n.expiry_date >= today)
      );
    }
    res.json({ notices: rows });
  })
);

noticesRouter.post(
  '/',
  requireAuth,
  requireAdmin,
  requirePermission('notices'),
  asyncHandler(async (req, res) => {
    const { titleEn, descriptionEn, titleHi, descriptionHi, publishDate, expiryDate, priority } = req.body;
    if (!titleEn) throw new AppError('VALIDATION_ERROR', 'English title is required.', 400);
    const record = {
      notice_id: uuid(),
      title_en: titleEn,
      description_en: descriptionEn || '',
      title_hi: titleHi || '',
      description_hi: descriptionHi || '',
      publish_date: publishDate || '',
      expiry_date: expiryDate || '',
      priority: priority || 'normal',
      status: 'active',
      created_by: req.user.id,
      created_at: new Date().toISOString(),
    };
    await repos.notices.create(record);
    res.status(201).json({ notice: record });
  })
);

noticesRouter.patch(
  '/:id',
  requireAuth,
  requireAdmin,
  requirePermission('notices'),
  asyncHandler(async (req, res) => {
    const allowed = ['title_en', 'description_en', 'title_hi', 'description_hi', 'publish_date', 'expiry_date', 'priority', 'status'];
    const patch = {};
    for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];
    const updated = await repos.notices.update(req.params.id, patch);
    res.json({ notice: updated });
  })
);

// ---------------- Settings ----------------
settingsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await repos.settings.findAll();
    res.json({ settings: Object.fromEntries(rows.map((s) => [s.key, s.value])) });
  })
);

settingsRouter.put(
  '/',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const updates = req.body || {};
    const results = {};
    for (const [key, value] of Object.entries(updates)) {
      const existing = await repos.settings.findById(key);
      if (existing) {
        results[key] = await repos.settings.update(key, { value, updated_at: new Date().toISOString(), updated_by: req.user.id });
      } else {
        results[key] = await repos.settings.create({ key, value, updated_at: new Date().toISOString(), updated_by: req.user.id });
      }
    }
    await auditService.log({ actor: req.user, action: 'settings_changed', entity: 'Settings', entityId: 'bulk', newValue: updates });
    res.json({ settings: results });
  })
);

// Library logo (section 36) — stored in Drive like any other file, with
// just its file id kept in Settings (never the binary in Sheets, per
// section 38's "don't store large binaries in Sheets" rule). Receipts
// (receiptService) read this id to draw the logo on generated PDFs.
settingsRouter.post(
  '/logo',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError('NO_FILE', 'No logo file was uploaded.', 400);
    const { fileId } = await driveService.uploadBuffer({
      pathSegments: ['Settings'],
      fileName: `logo-${Date.now()}.png`,
      mimeType: req.file.mimetype,
      buffer: req.file.buffer,
    });
    const existing = await repos.settings.findById('library_logo_drive_file_id');
    if (existing) {
      await repos.settings.update('library_logo_drive_file_id', { value: fileId, updated_at: new Date().toISOString(), updated_by: req.user.id });
    } else {
      await repos.settings.create({ key: 'library_logo_drive_file_id', value: fileId, updated_at: new Date().toISOString(), updated_by: req.user.id });
    }
    await auditService.log({ actor: req.user, action: 'settings_changed', entity: 'Settings', entityId: 'library_logo_drive_file_id', newValue: { fileId } });
    res.status(201).json({ logoFileId: fileId });
  })
);

// ---------------- Admins (super admin only) ----------------
adminsRouter.get(
  '/',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const rows = await repos.admins.findAll();
    res.json({ admins: rows.map(({ password_hash, ...safe }) => safe) });
  })
);

adminsRouter.post(
  '/',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const { name, email, password, role, permissions, roleId } = req.body;
    if (!name || !email || !password) throw new AppError('VALIDATION_ERROR', 'name, email and password are required.', 400);
    const record = await authService.createAdmin({ name, email, password, role, permissions, roleId }, req.user);
    const { password_hash, ...safe } = record;
    res.status(201).json({ admin: safe });
  })
);

adminsRouter.patch(
  '/:id',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const { permissions, status, role, roleId } = req.body;
    const patch = { updated_at: new Date().toISOString() };
    if (permissions) patch.permissions_json = JSON.stringify(permissions);
    if (status) patch.status = status;
    if (role) patch.role = role;
    if (roleId !== undefined) patch.role_id = roleId;
    const before = await repos.admins.findById(req.params.id);
    if (!before) throw new AppError('NOT_FOUND', 'Admin not found.', 404);
    const updated = await repos.admins.update(req.params.id, patch);
    await auditService.log({ actor: req.user, action: 'admin_permission_changed', entity: 'Admins', entityId: req.params.id, previousValue: before, newValue: updated });
    const { password_hash, ...safe } = updated;
    res.json({ admin: safe });
  })
);

/**
 * Permanent delete — same bar as creating/managing an admin (super admin
 * only). Unlike students, an admin has no financial/attendance history
 * tied to them that a delete could orphan, so there's no "has history"
 * block here — just two safety rails: you can't delete yourself (avoids
 * locking yourself out mid-session), and the last remaining super admin
 * can't be deleted (the system must always keep someone who can manage
 * other admins).
 */
adminsRouter.delete(
  '/:id',
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    if (req.params.id === req.user.id) {
      throw new AppError('CANNOT_DELETE_SELF', 'You cannot delete your own admin account.', 400);
    }
    const admin = await repos.admins.findById(req.params.id);
    if (!admin) throw new AppError('NOT_FOUND', 'Admin not found.', 404);

    if (admin.role === 'super_admin') {
      const superAdmins = await repos.admins.findAll((a) => a.role === 'super_admin' && a.status === 'active');
      if (superAdmins.length <= 1) {
        throw new AppError('LAST_SUPER_ADMIN', 'Cannot delete the last remaining super admin.', 409);
      }
    }

    await repos.admins.delete(req.params.id);
    await auditService.log({
      actor: req.user, action: 'admin_deleted', entity: 'Admins', entityId: req.params.id,
      previousValue: (({ password_hash, ...safe }) => safe)(admin),
    });
    res.status(204).send();
  })
);

module.exports = { expensesRouter, noticesRouter, settingsRouter, adminsRouter };
