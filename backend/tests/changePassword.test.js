/**
 * POST /auth/change-password — self-service password change for whichever
 * account type is logged in (decided by req.user.type from the JWT, not a
 * request field). Requires the current password, unlike the admin-
 * triggered reset endpoints which don't need it.
 */
process.env.JWT_SECRET = 'test-secret';

const bcrypt = require('bcryptjs');

jest.mock('../src/repositories', () => {
  const store = {
    Admins: [],
    Students: [],
  };
  return {
    __store: store,
    admins: {
      findById: jest.fn(async (id) => store.Admins.find((a) => a.admin_id === id) || null),
      findAll: jest.fn(async (filterFn) => (filterFn ? store.Admins.filter(filterFn) : store.Admins)),
      update: jest.fn(async (id, patch) => {
        const a = store.Admins.find((x) => x.admin_id === id);
        Object.assign(a, patch);
        return a;
      }),
    },
    students: {
      findById: jest.fn(async (id) => store.Students.find((s) => s.student_id === id) || null),
      findAll: jest.fn(async (filterFn) => (filterFn ? store.Students.filter(filterFn) : store.Students)),
      update: jest.fn(async (id, patch) => {
        const s = store.Students.find((x) => x.student_id === id);
        Object.assign(s, patch);
        return s;
      }),
    },
  };
});

jest.mock('../src/services/auditService', () => ({ log: jest.fn(async () => {}) }));

const request = require('supertest');
const authService = require('../src/services/authService');
const repos = require('../src/repositories');
const app = require('../src/app');

async function seedAdmin() {
  repos.__store.Admins.length = 0;
  repos.__store.Admins.push({
    admin_id: 'admin-1', name: 'Test Admin', email: 'admin@test.com',
    password_hash: await bcrypt.hash('OldPass123', 12), role: 'super_admin', status: 'active',
  });
}

async function seedStudent() {
  repos.__store.Students.length = 0;
  repos.__store.Students.push({
    student_id: 'LIB-2026-0001', full_name: 'Test Student',
    password_hash: await bcrypt.hash('OldPass123', 12), status: 'active', must_reset_password: 'true',
  });
}

function adminToken() {
  return authService.issueToken({ sub: 'admin-1', type: 'admin', role: 'super_admin', name: 'Test Admin' });
}

function studentToken() {
  return authService.issueToken({ sub: 'LIB-2026-0001', type: 'student', name: 'Test Student' });
}

describe('POST /auth/change-password', () => {
  test('admin can change their own password with the correct current password', async () => {
    await seedAdmin();
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ currentPassword: 'OldPass123', newPassword: 'NewPass456' });

    expect(res.status).toBe(200);
    const updated = repos.__store.Admins[0];
    expect(await bcrypt.compare('NewPass456', updated.password_hash)).toBe(true);
  });

  test('rejects an admin change with the wrong current password', async () => {
    await seedAdmin();
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ currentPassword: 'WrongPass', newPassword: 'NewPass456' });

    expect(res.status).toBe(401);
    const stillOld = repos.__store.Admins[0];
    expect(await bcrypt.compare('OldPass123', stillOld.password_hash)).toBe(true);
  });

  test('student can change their own password and it clears must_reset_password', async () => {
    await seedStudent();
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${studentToken()}`)
      .send({ currentPassword: 'OldPass123', newPassword: 'NewPass456' });

    expect(res.status).toBe(200);
    const updated = repos.__store.Students[0];
    expect(await bcrypt.compare('NewPass456', updated.password_hash)).toBe(true);
    expect(updated.must_reset_password).toBe('false');
  });

  test('rejects a new password shorter than 8 characters', async () => {
    await seedAdmin();
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ currentPassword: 'OldPass123', newPassword: 'short' });

    expect(res.status).toBe(400);
  });

  test('requires authentication', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .send({ currentPassword: 'OldPass123', newPassword: 'NewPass456' });

    expect(res.status).toBe(401);
  });
});
