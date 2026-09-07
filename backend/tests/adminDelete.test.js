/**
 * DELETE /admins/:id — permanent delete of a staff admin account, super
 * admin only. Two safety rails: can't delete yourself, and can't delete
 * the last remaining active super admin.
 */
process.env.JWT_SECRET = 'test-secret';

jest.mock('../src/repositories', () => {
  const store = { Admins: [] };
  return {
    __store: store,
    admins: {
      findById: jest.fn(async (id) => store.Admins.find((a) => a.admin_id === id) || null),
      findAll: jest.fn(async (filterFn) => (filterFn ? store.Admins.filter(filterFn) : store.Admins)),
      delete: jest.fn(async (id) => {
        store.Admins = store.Admins.filter((a) => a.admin_id !== id);
      }),
    },
  };
});

jest.mock('../src/services/auditService', () => ({ log: jest.fn(async () => {}) }));

const request = require('supertest');
const authService = require('../src/services/authService');
const repos = require('../src/repositories');
const app = require('../src/app');

function tokenFor(id, role = 'super_admin') {
  return authService.issueToken({ sub: id, type: 'admin', role, name: 'Test Admin' });
}

function resetStore() {
  repos.__store.Admins.length = 0;
}

describe('DELETE /admins/:id', () => {
  beforeEach(() => resetStore());

  test('super admin can permanently delete a staff admin', async () => {
    repos.__store.Admins.push(
      { admin_id: 'super-1', role: 'super_admin', status: 'active' },
      { admin_id: 'staff-1', role: 'staff', status: 'active' }
    );
    const res = await request(app)
      .delete('/api/admins/staff-1')
      .set('Authorization', `Bearer ${tokenFor('super-1')}`);

    expect(res.status).toBe(204);
    expect(repos.__store.Admins.find((a) => a.admin_id === 'staff-1')).toBeUndefined();
  });

  test('refuses to delete your own account', async () => {
    repos.__store.Admins.push({ admin_id: 'super-1', role: 'super_admin', status: 'active' });
    const res = await request(app)
      .delete('/api/admins/super-1')
      .set('Authorization', `Bearer ${tokenFor('super-1')}`);

    expect(res.status).toBe(400);
    expect(repos.__store.Admins).toHaveLength(1);
  });

  test('allows deleting a super admin down to exactly one remaining', async () => {
    repos.__store.Admins.push(
      { admin_id: 'super-1', role: 'super_admin', status: 'active' },
      { admin_id: 'super-2', role: 'super_admin', status: 'active' }
    );
    const res = await request(app)
      .delete('/api/admins/super-2')
      .set('Authorization', `Bearer ${tokenFor('super-1')}`);

    expect(res.status).toBe(204);
    expect(repos.__store.Admins.filter((a) => a.role === 'super_admin')).toHaveLength(1);
  });

  test('the LAST_SUPER_ADMIN guard fires when only one active super admin remains', async () => {
    // Not reachable through the self-delete rule in normal operation (the
    // sole remaining super admin can only ever be themselves as the
    // actor) — this exercises the guard directly the way a stale-token
    // edge case could reach it, so the safety rail stays covered.
    repos.__store.Admins.push({ admin_id: 'super-1', role: 'super_admin', status: 'active' });
    const res = await request(app)
      .delete('/api/admins/super-1')
      .set('Authorization', `Bearer ${tokenFor('ghost-actor')}`); // actor id not in store — simulates a stale token

    // Self-delete check compares against the token's own id ('ghost-actor'),
    // which differs from the target, so this reaches the super-admin count
    // check and is blocked there instead.
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LAST_SUPER_ADMIN');
  });

  test('refuses non-super-admin callers', async () => {
    repos.__store.Admins.push({ admin_id: 'staff-1', role: 'staff', status: 'active' });
    const res = await request(app)
      .delete('/api/admins/staff-1')
      .set('Authorization', `Bearer ${tokenFor('staff-2', 'staff')}`);
    expect(res.status).toBe(403);
  });

  test('404s for a non-existent admin', async () => {
    repos.__store.Admins.push({ admin_id: 'super-1', role: 'super_admin', status: 'active' });
    const res = await request(app)
      .delete('/api/admins/does-not-exist')
      .set('Authorization', `Bearer ${tokenFor('super-1')}`);
    expect(res.status).toBe(404);
  });
});
