/**
 * Refresh-token flow backing the mobile app's biometric unlock. A login
 * only issues a refresh token when the caller opts in (wantsRefreshToken)
 * — ordinary web logins never get one. /auth/refresh exchanges a valid
 * refresh token for a new short-lived JWT and rotates the refresh token
 * itself; /auth/logout revokes it so a signed-out device can't silently
 * mint new JWTs afterward.
 */
process.env.JWT_SECRET = 'test-secret';

const bcrypt = require('bcryptjs');
const crypto = require('crypto');

jest.mock('../src/repositories', () => {
  const store = { Admins: [], Refresh_Tokens: [] };
  return {
    __store: store,
    admins: {
      findAll: jest.fn(async (filterFn) => (filterFn ? store.Admins.filter(filterFn) : store.Admins)),
      findById: jest.fn(async (id) => store.Admins.find((a) => a.admin_id === id) || null),
      update: jest.fn(async (id, patch) => {
        const a = store.Admins.find((x) => x.admin_id === id);
        Object.assign(a, patch);
        return a;
      }),
    },
    students: {
      findById: jest.fn(async () => null),
    },
    refreshTokens: {
      findAll: jest.fn(async (filterFn) => (filterFn ? store.Refresh_Tokens.filter(filterFn) : store.Refresh_Tokens)),
      create: jest.fn(async (rec) => {
        store.Refresh_Tokens.push(rec);
        return rec;
      }),
      update: jest.fn(async (id, patch) => {
        const r = store.Refresh_Tokens.find((x) => x.token_id === id);
        Object.assign(r, patch);
        return r;
      }),
    },
  };
});

jest.mock('../src/services/auditService', () => ({ log: jest.fn(async () => {}) }));

const request = require('supertest');
const repos = require('../src/repositories');
const app = require('../src/app');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function seedAdmin() {
  repos.__store.Admins.length = 0;
  repos.__store.Refresh_Tokens.length = 0;
  repos.__store.Admins.push({
    admin_id: 'admin-1', name: 'Test Admin', email: 'admin@example.com',
    password_hash: await bcrypt.hash('CorrectPass123', 12), role: 'staff', status: 'active',
    permissions_json: '{}',
  });
}

describe('POST /auth/admin/login — refresh token opt-in', () => {
  test('does not issue a refresh token by default', async () => {
    await seedAdmin();
    const res = await request(app)
      .post('/api/auth/admin/login')
      .send({ email: 'admin@example.com', password: 'CorrectPass123' });
    expect(res.status).toBe(200);
    expect(res.body.refreshToken).toBeUndefined();
    expect(repos.__store.Refresh_Tokens.length).toBe(0);
  });

  test('issues and stores a hashed refresh token when wantsRefreshToken is true', async () => {
    await seedAdmin();
    const res = await request(app)
      .post('/api/auth/admin/login')
      .send({ email: 'admin@example.com', password: 'CorrectPass123', wantsRefreshToken: true });
    expect(res.status).toBe(200);
    expect(typeof res.body.refreshToken).toBe('string');
    expect(repos.__store.Refresh_Tokens.length).toBe(1);
    // Only the hash is ever stored, never the raw token.
    expect(repos.__store.Refresh_Tokens[0].token_hash).toBe(hashToken(res.body.refreshToken));
    expect(repos.__store.Refresh_Tokens[0].token_hash).not.toBe(res.body.refreshToken);
  });
});

describe('POST /auth/refresh', () => {
  test('exchanges a valid refresh token for a new JWT and rotates the refresh token', async () => {
    await seedAdmin();
    const loginRes = await request(app)
      .post('/api/auth/admin/login')
      .send({ email: 'admin@example.com', password: 'CorrectPass123', wantsRefreshToken: true });
    const firstRefreshToken = loginRes.body.refreshToken;

    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: firstRefreshToken });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user.id).toBe('admin-1');
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.refreshToken).not.toBe(firstRefreshToken);

    // The old refresh token is revoked — using it again must fail.
    const reuseRes = await request(app).post('/api/auth/refresh').send({ refreshToken: firstRefreshToken });
    expect(reuseRes.status).toBe(401);
  });

  test('rejects an unknown refresh token', async () => {
    await seedAdmin();
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: 'not-a-real-token' });
    expect(res.status).toBe(401);
  });

  test('rejects an expired refresh token', async () => {
    await seedAdmin();
    const rawToken = 'expired-token-raw';
    repos.__store.Refresh_Tokens.push({
      token_id: 'rt-1',
      token_hash: hashToken(rawToken),
      owner_type: 'admin',
      owner_id: 'admin-1',
      status: 'active',
      created_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
      expires_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: rawToken });
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  test('revokes the refresh token so it can no longer be used to refresh', async () => {
    await seedAdmin();
    const loginRes = await request(app)
      .post('/api/auth/admin/login')
      .send({ email: 'admin@example.com', password: 'CorrectPass123', wantsRefreshToken: true });
    const refreshToken = loginRes.body.refreshToken;

    const logoutRes = await request(app).post('/api/auth/logout').send({ refreshToken });
    expect(logoutRes.status).toBe(200);

    const refreshAfterLogout = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(refreshAfterLogout.status).toBe(401);
  });
});
