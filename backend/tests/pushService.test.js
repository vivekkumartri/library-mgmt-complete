process.env.PUSH_ENABLED = 'true';
process.env.FIREBASE_PROJECT_ID = 'test-project';
process.env.FIREBASE_CLIENT_EMAIL = 'test@example.com';
process.env.FIREBASE_PRIVATE_KEY = 'test-key';

const mockSend = jest.fn();
jest.mock('firebase-admin/app', () => ({
  initializeApp: jest.fn(() => ({})),
  cert: jest.fn(() => ({})),
}));
jest.mock('firebase-admin/messaging', () => ({
  getMessaging: jest.fn(() => ({ send: mockSend })),
}));

jest.mock('../src/repositories', () => {
  const store = { Device_Tokens: [], Students: [] };
  return {
    __store: store,
    deviceTokens: {
      findAll: jest.fn(async (filterFn) => (filterFn ? store.Device_Tokens.filter(filterFn) : store.Device_Tokens)),
      create: jest.fn(async (rec) => {
        store.Device_Tokens.push(rec);
        return rec;
      }),
      update: jest.fn(async (id, patch) => {
        const row = store.Device_Tokens.find((d) => d.device_token_id === id);
        Object.assign(row, patch);
        return row;
      }),
      delete: jest.fn(async (id) => {
        store.Device_Tokens = store.Device_Tokens.filter((d) => d.device_token_id !== id);
      }),
    },
    students: {
      findAll: jest.fn(async (filterFn) => (filterFn ? store.Students.filter(filterFn) : store.Students)),
    },
  };
});

jest.mock('../src/services/allocationService', () => ({
  AllocationService: { paymentStatusForStudent: jest.fn() },
}));

const repos = require('../src/repositories');
const { AllocationService } = require('../src/services/allocationService');
const pushService = require('../src/services/pushService');

function resetStore() {
  repos.__store.Device_Tokens.length = 0;
  repos.__store.Students.length = 0;
  mockSend.mockReset();
  AllocationService.paymentStatusForStudent.mockReset();
}

describe('pushService.registerDevice', () => {
  beforeEach(resetStore);

  test('creates a new device token row', async () => {
    await pushService.registerDevice({ ownerType: 'student', ownerId: 'S1', fcmToken: 'tok-1', platform: 'android' });
    expect(repos.__store.Device_Tokens).toHaveLength(1);
    expect(repos.__store.Device_Tokens[0]).toMatchObject({ owner_id: 'S1', fcm_token: 'tok-1', platform: 'android' });
  });

  test('re-registering the same token updates the existing row instead of duplicating it', async () => {
    await pushService.registerDevice({ ownerType: 'student', ownerId: 'S1', fcmToken: 'tok-1', platform: 'android' });
    await pushService.registerDevice({ ownerType: 'student', ownerId: 'S1', fcmToken: 'tok-1', platform: 'android' });
    expect(repos.__store.Device_Tokens).toHaveLength(1);
  });

  test('requires an fcmToken', async () => {
    await expect(pushService.registerDevice({ ownerType: 'student', ownerId: 'S1', fcmToken: '' })).rejects.toThrow(/fcmToken/i);
  });
});

describe('pushService.unregisterDevice', () => {
  beforeEach(resetStore);

  test('removes the matching device token row', async () => {
    await pushService.registerDevice({ ownerType: 'student', ownerId: 'S1', fcmToken: 'tok-1' });
    await pushService.unregisterDevice('tok-1');
    expect(repos.__store.Device_Tokens).toHaveLength(0);
  });

  test('is a no-op when the token is not found', async () => {
    await expect(pushService.unregisterDevice('unknown-token')).resolves.toBeUndefined();
  });
});

describe('pushService.sendToOwner', () => {
  beforeEach(resetStore);

  test('sends to every device registered for the owner', async () => {
    mockSend.mockResolvedValue({});
    await pushService.registerDevice({ ownerType: 'student', ownerId: 'S1', fcmToken: 'tok-1' });
    await pushService.registerDevice({ ownerType: 'student', ownerId: 'S1', fcmToken: 'tok-2' });

    const result = await pushService.sendToOwner({ ownerType: 'student', ownerId: 'S1', title: 'Hi', body: 'There' });

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ sent: 2, pruned: 0 });
  });

  test('prunes an unregistered/invalid token instead of leaving it to fail forever', async () => {
    mockSend.mockRejectedValueOnce({ code: 'messaging/registration-token-not-registered' });
    await pushService.registerDevice({ ownerType: 'student', ownerId: 'S1', fcmToken: 'stale-token' });

    const result = await pushService.sendToOwner({ ownerType: 'student', ownerId: 'S1', title: 'Hi', body: 'There' });

    expect(result).toEqual({ sent: 0, pruned: 1 });
    expect(repos.__store.Device_Tokens).toHaveLength(0);
  });

  test('a non-token-related send failure neither sends nor prunes, and does not throw', async () => {
    mockSend.mockRejectedValueOnce({ code: 'messaging/internal-error', message: 'boom' });
    await pushService.registerDevice({ ownerType: 'student', ownerId: 'S1', fcmToken: 'tok-1' });

    const result = await pushService.sendToOwner({ ownerType: 'student', ownerId: 'S1', title: 'Hi', body: 'There' });

    expect(result).toEqual({ sent: 0, pruned: 0 });
    expect(repos.__store.Device_Tokens).toHaveLength(1);
  });

  test('a student with no registered devices sends nothing and does not call messaging', async () => {
    const result = await pushService.sendToOwner({ ownerType: 'student', ownerId: 'no-devices', title: 'Hi', body: 'There' });
    expect(result).toEqual({ sent: 0, pruned: 0 });
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('pushService.sendPaymentDueReminders', () => {
  beforeEach(resetStore);

  test('notifies only students whose payment status is due_today or overdue', async () => {
    mockSend.mockResolvedValue({});
    repos.__store.Students.push(
      { student_id: 'S1', status: 'active' },
      { student_id: 'S2', status: 'active' },
      { student_id: 'S3', status: 'active' }
    );
    await pushService.registerDevice({ ownerType: 'student', ownerId: 'S1', fcmToken: 'tok-s1' });
    await pushService.registerDevice({ ownerType: 'student', ownerId: 'S2', fcmToken: 'tok-s2' });
    // S3 has no registered device — still "checked" but can't be notified.

    AllocationService.paymentStatusForStudent.mockImplementation(async (id) => {
      if (id === 'S1') return { urgency: 'overdue', amountDue: 500 };
      if (id === 'S2') return { urgency: 'ok', amountDue: 0 };
      return { urgency: 'due_today', amountDue: 100 };
    });

    const result = await pushService.sendPaymentDueReminders();

    expect(mockSend).toHaveBeenCalledTimes(1); // only S1 has urgency + a device
    expect(result).toEqual({ studentsChecked: 3, notified: 1, skipped: 1 });
  });

  test('inactive students are never checked', async () => {
    repos.__store.Students.push({ student_id: 'S1', status: 'deactivated' });
    const result = await pushService.sendPaymentDueReminders();
    expect(AllocationService.paymentStatusForStudent).not.toHaveBeenCalled();
    expect(result.studentsChecked).toBe(0);
  });
});
