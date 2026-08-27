jest.mock('../src/repositories', () => {
  const store = { Roles: [], Admins: [{ admin_id: 'admin-1', role: 'staff', permissions_json: '{}' }] };
  return {
    __store: store,
    roles: {
      findAll: jest.fn(async (filterFn) => (filterFn ? store.Roles.filter(filterFn) : store.Roles)),
      findById: jest.fn(async (id) => store.Roles.find((r) => r.role_id === id) || null),
      create: jest.fn(async (rec) => {
        store.Roles.push(rec);
        return rec;
      }),
      update: jest.fn(async (id, patch) => {
        const idx = store.Roles.findIndex((r) => r.role_id === id);
        store.Roles[idx] = { ...store.Roles[idx], ...patch };
        return store.Roles[idx];
      }),
    },
    admins: {
      findById: jest.fn(async (id) => store.Admins.find((a) => a.admin_id === id) || null),
      update: jest.fn(async (id, patch) => {
        const idx = store.Admins.findIndex((a) => a.admin_id === id);
        store.Admins[idx] = { ...store.Admins[idx], ...patch };
        return store.Admins[idx];
      }),
    },
  };
});

jest.mock('../src/services/auditService', () => ({ log: jest.fn(async () => {}) }));

const repos = require('../src/repositories');
const roleService = require('../src/services/roleService');

const ACTOR = { id: 'super-1', name: 'Super Admin' };

describe('roleService', () => {
  beforeEach(() => {
    repos.__store.Roles.length = 0;
    repos.__store.Admins[0].permissions_json = '{}';
    repos.__store.Admins[0].role_id = undefined;
  });

  test('createRole rejects a duplicate name', async () => {
    await roleService.createRole({ roleName: 'Front Desk', permissions: { students: true } }, ACTOR);
    await expect(roleService.createRole({ roleName: 'front desk', permissions: {} }, ACTOR)).rejects.toThrow(/already exists/);
  });

  test('applyRoleToAdmin copies the role permissions onto the admin', async () => {
    const role = await roleService.createRole({ roleName: 'Accountant', permissions: { payments: true, expenses: true } }, ACTOR);
    const updated = await roleService.applyRoleToAdmin('admin-1', role.role_id, ACTOR);
    expect(JSON.parse(updated.permissions_json)).toEqual({ payments: true, expenses: true });
    expect(updated.role_id).toBe(role.role_id);
  });

  test('applyRoleToAdmin throws for an unknown role', async () => {
    await expect(roleService.applyRoleToAdmin('admin-1', 'missing-role', ACTOR)).rejects.toThrow(/not found/i);
  });
});
