/**
 * POST /auth/admin/login — email matching is case/whitespace-insensitive.
 * A mobile keyboard auto-capitalizing the first letter, or a stray leading/
 * trailing space, must not turn a correct password into "invalid
 * credentials": both the stored email and the submitted one are trimmed
 * and lowercased before comparing.
 */
process.env.JWT_SECRET = 'test-secret';

const bcrypt = require('bcryptjs');

jest.mock('../src/repositories', () => {
  const store = { Admins: [] };
  return {
    __store: store,
    admins: {
      findAll: jest.fn(async (filterFn) => (filterFn ? store.Admins.filter(filterFn) : store.Admins)),
      update: jest.fn(async (id, patch) => {
        const a = store.Admins.find((x) => x.admin_id === id);
        Object.assign(a, patch);
        return a;
      }),
    },
  };
});

jest.mock('../src/services/auditService', () => ({ log: jest.fn(async () => {}) }));

const request = require('supertest');
const repos = require('../src/repositories');
const app = require('../src/app');

async function seedAdmin() {
  repos.__store.Admins.length = 0;
  repos.__store.Admins.push({
    admin_id: 'admin-1', name: 'Test Admin', email: 'someone@example.com',
    password_hash: await bcrypt.hash('CorrectPass123', 12), role: 'staff', status: 'active',
  });
}

describe('POST /auth/admin/login — email normalization', () => {
  test('logs in with the exact stored email', async () => {
    await seedAdmin();
    const res = await request(app)
      .post('/api/auth/admin/login')
      .send({ email: 'someone@example.com', password: 'CorrectPass123' });
    expect(res.status).toBe(200);
  });

  test('logs in when the email is submitted with different casing', async () => {
    await seedAdmin();
    const res = await request(app)
      .post('/api/auth/admin/login')
      .send({ email: 'Someone@Example.com', password: 'CorrectPass123' });
    expect(res.status).toBe(200);
  });

  test('logs in when the email has stray leading/trailing whitespace', async () => {
    await seedAdmin();
    const res = await request(app)
      .post('/api/auth/admin/login')
      .send({ email: '  someone@example.com  ', password: 'CorrectPass123' });
    expect(res.status).toBe(200);
  });

  test('still rejects a genuinely wrong password', async () => {
    await seedAdmin();
    const res = await request(app)
      .post('/api/auth/admin/login')
      .send({ email: 'Someone@Example.com', password: 'WrongPassword' });
    expect(res.status).toBe(401);
  });
});
