const repos = require('../repositories');
const { uuid } = require('../utils/id');
const { AppError } = require('../utils/AppError');
const auditService = require('./auditService');

/**
 * Roles are named, reusable permission bundles (spec sections 2/38/66).
 * They exist to make assigning a new staff member fast ("make them a Front
 * Desk staffer") and to keep the permission catalog centrally defined
 * instead of hardcoded in route files. The actual authorization check
 * (middleware/auth.js requirePermission) still reads permissions_json on
 * the Admins row directly — applying a role just seeds/overwrites that
 * JSON, after which it can still be hand-tuned per admin. This keeps the
 * hot-path permission check a single-row read with no join, while giving
 * admins a real role-based workflow.
 */
class RoleService {
  async listPermissionsCatalog() {
    const rows = await repos.permissionsCatalog.findAll();
    return rows
      .map((r) => ({ key: r.permission_key, label: r.label, category: r.category, sortOrder: Number(r.sort_order || 0) }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async listRoles() {
    return repos.roles.findAll();
  }

  async createRole({ roleName, description, permissions }, actor) {
    if (!roleName) throw new AppError('VALIDATION_ERROR', 'Role name is required.', 400);
    const existing = await repos.roles.findAll((r) => r.role_name.toLowerCase() === roleName.toLowerCase());
    if (existing.length > 0) throw new AppError('DUPLICATE_ROLE', 'A role with this name already exists.', 409);
    const record = {
      role_id: uuid(),
      role_name: roleName,
      description: description || '',
      permissions_json: JSON.stringify(permissions || {}),
      is_system: 'false',
      created_at: new Date().toISOString(),
      created_by: actor?.id || 'system',
      updated_at: new Date().toISOString(),
    };
    await repos.roles.create(record);
    await auditService.log({ actor, action: 'role_created', entity: 'Roles', entityId: record.role_id, newValue: record });
    return record;
  }

  async updateRole(roleId, { roleName, description, permissions }, actor) {
    const before = await repos.roles.findById(roleId);
    if (!before) throw new AppError('NOT_FOUND', 'Role not found.', 404);
    const patch = { updated_at: new Date().toISOString() };
    if (roleName !== undefined) patch.role_name = roleName;
    if (description !== undefined) patch.description = description;
    if (permissions !== undefined) patch.permissions_json = JSON.stringify(permissions);
    const updated = await repos.roles.update(roleId, patch);
    await auditService.log({ actor, action: 'role_updated', entity: 'Roles', entityId: roleId, previousValue: before, newValue: updated });
    return updated;
  }

  /** Applies a role's permission set to an admin (overwrites permissions_json; admin can still edit afterward). */
  async applyRoleToAdmin(adminId, roleId, actor) {
    const role = await repos.roles.findById(roleId);
    if (!role) throw new AppError('NOT_FOUND', 'Role not found.', 404);
    const before = await repos.admins.findById(adminId);
    if (!before) throw new AppError('NOT_FOUND', 'Admin not found.', 404);
    const updated = await repos.admins.update(adminId, {
      role_id: roleId,
      permissions_json: role.permissions_json,
      updated_at: new Date().toISOString(),
    });
    await auditService.log({ actor, action: 'admin_role_assigned', entity: 'Admins', entityId: adminId, previousValue: { role_id: before.role_id }, newValue: { role_id: roleId, role_name: role.role_name } });
    return updated;
  }
}

module.exports = new RoleService();
