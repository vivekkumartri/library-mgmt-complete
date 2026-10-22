process.env.JWT_SECRET = 'test-secret';

jest.mock('../src/services/pushService', () => ({
  registerDevice: jest.fn(async () => {}),
  unregisterDevice: jest.fn(async () => {}),
  sendPaymentDueReminders: jest.fn(async () => ({ studentsChecked: 5, notified: 2, skipped: 3 })),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const pushService = require('../src/services/pushService');

function studentToken() {
  return jwt.sign({ sub: 'LIB-2026-0001', type: 'student', name: 'Rahul' }, 'test-secret', { expiresIn: '1h' });
}
function adminToken(role = 'staff') {
  return jwt.sign({ sub: 'admin-1', type: 'admin', role, name: 'Admin' }, 'test-secret', { expiresIn: '1h' });
}

beforeEach(() => jest.clearAllMocks());

describe('POST /push/register-device', () => {
  test('requires authentication', async () => {
    const res = await request(app).post('/api/push/register-device').send({ fcmToken: 'tok-1' });
    expect(res.status).toBe(401);
  });

  test('registers the device under the logged-in user, never a user-supplied id', async () => {
    const res = await request(app)
      .post('/api/push/register-device')
      .set('Authorization', `Bearer ${studentToken()}`)
      .send({ fcmToken: 'tok-1', platform: 'android' });

    expect(res.status).toBe(200);
    expect(pushService.registerDevice).toHaveBeenCalledWith({
      ownerType: 'student', ownerId: 'LIB-2026-0001', fcmToken: 'tok-1', platform: 'android',
    });
  });

  test('rejects a missing fcmToken', async () => {
    const res = await request(app)
      .post('/api/push/register-device')
      .set('Authorization', `Bearer ${studentToken()}`)
      .send({});
    expect(res.status).toBe(400);
  });

  test('rejects an invalid platform value', async () => {
    const res = await request(app)
      .post('/api/push/register-device')
      .set('Authorization', `Bearer ${studentToken()}`)
      .send({ fcmToken: 'tok-1', platform: 'windows' });
    expect(res.status).toBe(400);
  });
});

describe('POST /push/unregister-device', () => {
  test('requires authentication', async () => {
    const res = await request(app).post('/api/push/unregister-device').send({ fcmToken: 'tok-1' });
    expect(res.status).toBe(401);
  });

  test('unregisters the given token', async () => {
    const res = await request(app)
      .post('/api/push/unregister-device')
      .set('Authorization', `Bearer ${studentToken()}`)
      .send({ fcmToken: 'tok-1' });
    expect(res.status).toBe(200);
    expect(pushService.unregisterDevice).toHaveBeenCalledWith('tok-1');
  });
});

describe('POST /push/send-payment-reminders', () => {
  test('requires super admin, not just any admin', async () => {
    const res = await request(app)
      .post('/api/push/send-payment-reminders')
      .set('Authorization', `Bearer ${adminToken('staff')}`)
      .send({});
    expect(res.status).toBe(403);
    expect(pushService.sendPaymentDueReminders).not.toHaveBeenCalled();
  });

  test('a student can never trigger it', async () => {
    const res = await request(app)
      .post('/api/push/send-payment-reminders')
      .set('Authorization', `Bearer ${studentToken()}`)
      .send({});
    expect(res.status).toBe(403);
  });

  test('a super admin can trigger it and gets the result back', async () => {
    const res = await request(app)
      .post('/api/push/send-payment-reminders')
      .set('Authorization', `Bearer ${adminToken('super_admin')}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ studentsChecked: 5, notified: 2, skipped: 3 });
  });
});
