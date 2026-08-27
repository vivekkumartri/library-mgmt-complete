const authService = require('../services/authService');
const repos = require('../repositories');
const { AppError } = require('../utils/AppError');

/** Verifies the bearer token and attaches req.user. Does not check role. */
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new AppError('UNAUTHENTICATED', 'Authentication required.', 401);
    const decoded = authService.verifyToken(token);
    req.user = { id: decoded.sub, type: decoded.type, role: decoded.role, name: decoded.name };
    next();
  } catch (err) {
    if (err instanceof AppError) return next(err);
    next(new AppError('INVALID_TOKEN', 'Your session has expired. Please log in again.', 401));
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.type !== 'admin') {
    return next(new AppError('FORBIDDEN', 'This action requires admin access.', 403));
  }
  next();
}

function requireStudent(req, res, next) {
  if (!req.user || req.user.type !== 'student') {
    return next(new AppError('FORBIDDEN', 'This action requires a student session.', 403));
  }
  next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.type !== 'admin' || req.user.role !== 'super_admin') {
    return next(new AppError('FORBIDDEN', 'This action requires super admin access.', 403));
  }
  next();
}

/**
 * Staff permission gate. Super admins always pass. Staff must have the
 * named permission set to true in their permissions_json (see Admins sheet).
 * Usage: requirePermission('students')
 */
function requirePermission(permissionKey) {
  return async (req, res, next) => {
    try {
      if (!req.user || req.user.type !== 'admin') {
        throw new AppError('FORBIDDEN', 'This action requires admin access.', 403);
      }
      if (req.user.role === 'super_admin') return next();
      const admin = await repos.admins.findById(req.user.id);
      const perms = admin?.permissions_json ? JSON.parse(admin.permissions_json) : {};
      if (!perms[permissionKey]) {
        throw new AppError('FORBIDDEN', `You do not have permission to manage ${permissionKey}.`, 403);
      }
      next();
    } catch (err) {
      next(err instanceof AppError ? err : new AppError('FORBIDDEN', 'Permission check failed.', 403));
    }
  };
}

module.exports = { requireAuth, requireAdmin, requireStudent, requireSuperAdmin, requirePermission };
