const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const repos = require('../repositories');
const { AppError } = require('../utils/AppError');
const { uuid, nextSequentialId } = require('../utils/id');
const auditService = require('./auditService');

const SALT_ROUNDS = 12;

function randomPassword(length = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let out = '';
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

class AuthService {
  async hashPassword(plain) {
    return bcrypt.hash(plain, SALT_ROUNDS);
  }

  async verifyPassword(plain, hash) {
    if (!hash) return false;
    return bcrypt.compare(plain, hash);
  }

  issueToken(payload) {
    return jwt.sign(payload, env.auth.jwtSecret, { expiresIn: env.auth.jwtExpiresIn });
  }

  verifyToken(token) {
    return jwt.verify(token, env.auth.jwtSecret);
  }

  async adminLogin(email, password) {
    const admins = await repos.admins.findAll((a) => a.email === email && a.status === 'active');
    const admin = admins[0];
    // Constant-shaped response regardless of which check fails, to avoid
    // leaking whether an email exists.
    const ok = admin ? await this.verifyPassword(password, admin.password_hash) : false;
    if (!admin || !ok) {
      throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password.', 401);
    }
    await repos.admins.update(admin.admin_id, { last_login_at: new Date().toISOString() });
    const token = this.issueToken({
      sub: admin.admin_id,
      type: 'admin',
      role: admin.role,
      name: admin.name,
    });
    return {
      token,
      user: {
        id: admin.admin_id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        permissions: safeParsePermissions(admin.permissions_json),
      },
    };
  }

  async studentLogin(studentId, password) {
    const student = await repos.students.findById(studentId);
    const ok = student ? await this.verifyPassword(password, student.password_hash) : false;
    if (!student || !ok || student.status === 'deactivated') {
      throw new AppError('INVALID_CREDENTIALS', 'Invalid student ID or password.', 401);
    }
    const token = this.issueToken({ sub: student.student_id, type: 'student', name: student.full_name });
    return {
      token,
      user: {
        id: student.student_id,
        name: student.full_name,
        mustResetPassword: student.must_reset_password === 'true',
      },
    };
  }

  /**
   * Self-service password change for either an admin or a logged-in
   * student — requires the current password, unlike the admin-triggered
   * resets below which don't (an admin resetting a student's password
   * doesn't know it). Clears a student's must_reset_password flag, since
   * choosing their own password satisfies whatever prompted that flag.
   */
  async changeOwnPassword({ type, id, currentPassword, newPassword }, actor) {
    const repo = type === 'admin' ? repos.admins : repos.students;
    const idField = type === 'admin' ? 'admin_id' : 'student_id';
    const record = await repo.findById(id);
    if (!record) throw new AppError('NOT_FOUND', 'Account not found.', 404);
    const ok = await this.verifyPassword(currentPassword, record.password_hash);
    if (!ok) throw new AppError('INVALID_CREDENTIALS', 'Current password is incorrect.', 401);
    const patch = { password_hash: await this.hashPassword(newPassword), updated_at: new Date().toISOString() };
    if (type === 'student') patch.must_reset_password = 'false';
    await repo.update(id, patch);
    await auditService.log({
      actor, action: type === 'admin' ? 'admin_password_changed' : 'student_password_changed',
      entity: type === 'admin' ? 'Admins' : 'Students', entityId: id,
    });
    return { [idField]: id };
  }

  /** Admin-triggered reset — never reveals or reuses the old password. */
  async resetStudentPassword(studentId, actor) {
    const student = await repos.students.findById(studentId);
    if (!student) throw new AppError('NOT_FOUND', 'Student not found.', 404);
    const newPassword = randomPassword();
    const hash = await this.hashPassword(newPassword);
    await repos.students.update(studentId, { password_hash: hash, must_reset_password: 'false' });
    await auditService.log({
      actor, action: 'student_password_reset', entity: 'Students', entityId: studentId,
    });
    // The plaintext password is returned ONCE, to be shown/printed by the
    // admin immediately. It is never stored or logged anywhere.
    return { studentId, newPassword };
  }

  async createStudentCredentials({ fullName, joiningDate, actor }) {
    const year = new Date(joiningDate || Date.now()).getFullYear();
    const existing = await repos.students.findAll();
    const studentId = nextSequentialId(env.defaults.studentIdPrefix, year, existing.map((s) => s.student_id));
    const password = randomPassword();
    const passwordHash = await this.hashPassword(password);
    return { studentId, password, passwordHash };
  }

  async createAdmin({ name, email, password, role, permissions, roleId }, actor) {
    const existing = await repos.admins.findAll((a) => a.email === email);
    if (existing.length > 0) throw new AppError('EMAIL_IN_USE', 'An admin with this email already exists.', 409);
    let effectivePermissions = permissions || {};
    if (roleId) {
      const assignedRole = await repos.roles.findById(roleId);
      if (!assignedRole) throw new AppError('NOT_FOUND', 'Role not found.', 404);
      // Role sets the starting permission set; explicit `permissions` (if
      // also sent) still wins so an admin can be assigned a role and
      // fine-tuned in the same request.
      effectivePermissions = { ...JSON.parse(assignedRole.permissions_json || '{}'), ...(permissions || {}) };
    }
    const record = {
      admin_id: uuid(),
      name,
      email,
      password_hash: await this.hashPassword(password),
      role: role === 'super_admin' ? 'super_admin' : 'staff',
      role_id: roleId || '',
      permissions_json: JSON.stringify(effectivePermissions),
      status: 'active',
      created_at: new Date().toISOString(),
      created_by: actor?.id || 'system',
      last_login_at: '',
    };
    await repos.admins.create(record);
    await auditService.log({ actor, action: 'admin_created', entity: 'Admins', entityId: record.admin_id, newValue: { email, role } });
    return record;
  }
}

function safeParsePermissions(json) {
  try {
    return json ? JSON.parse(json) : {};
  } catch {
    return {};
  }
}

module.exports = new AuthService();
