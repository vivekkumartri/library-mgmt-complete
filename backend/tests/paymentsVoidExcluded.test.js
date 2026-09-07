/**
 * GET /payments excludes voided ("deleted") payments by default, same
 * convention as GET /expenses — so an admin deleting a mistaken payment
 * makes it disappear everywhere it's listed (including the student's own
 * portal), not just from billing math. includeVoid=true opts back in for
 * an audit view that deliberately wants the history.
 */
process.env.JWT_SECRET = 'test-secret';

jest.mock('../src/repositories', () => {
  const store = {
    Payments: [
      { payment_id: 'p1', student_id: 'S-1', status: 'active', amount: 500 },
      { payment_id: 'p2', student_id: 'S-1', status: 'void', amount: 300, void_reason: 'entered by mistake' },
    ],
  };
  return {
    __store: store,
    payments: {
      findAll: jest.fn(async (filterFn) => (filterFn ? store.Payments.filter(filterFn) : store.Payments)),
    },
  };
});

const request = require('supertest');
const authService = require('../src/services/authService');
const app = require('../src/app');

function adminToken() {
  return authService.issueToken({ sub: 'admin-1', type: 'admin', role: 'super_admin', name: 'Test Admin' });
}

describe('GET /payments — void exclusion', () => {
  test('excludes voided payments by default', async () => {
    const res = await request(app)
      .get('/api/payments')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.payments.map((p) => p.payment_id)).toEqual(['p1']);
  });

  test('includes voided payments when includeVoid=true', async () => {
    const res = await request(app)
      .get('/api/payments')
      .query({ includeVoid: 'true' })
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.payments.map((p) => p.payment_id).sort()).toEqual(['p1', 'p2']);
  });
});
