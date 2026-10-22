import { describe, test, expect, vi, beforeEach } from 'vitest';

const capacitorMocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => true),
  getPlatform: vi.fn(() => 'android'),
}));
vi.mock('@capacitor/core', () => ({ Capacitor: capacitorMocks }));

const pushPluginMocks = vi.hoisted(() => ({
  checkPermissions: vi.fn(async () => ({ receive: 'granted' })),
  requestPermissions: vi.fn(async () => ({ receive: 'granted' })),
  addListener: vi.fn(async (event, handler) => {
    pushPluginMocks._handlers[event] = handler;
    return { remove: vi.fn() };
  }),
  register: vi.fn(async () => {}),
  unregister: vi.fn(async () => {}),
  _handlers: {},
}));
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: pushPluginMocks }));

vi.mock('../services/api', () => ({ default: { post: vi.fn() } }));

import api from '../services/api';
import { registerForPushNotifications, unregisterPushNotifications } from '../utils/pushNotifications';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  pushPluginMocks._handlers = {};
  capacitorMocks.isNativePlatform.mockReturnValue(true);
  capacitorMocks.getPlatform.mockReturnValue('android');
  pushPluginMocks.checkPermissions.mockResolvedValue({ receive: 'granted' });
});

describe('registerForPushNotifications', () => {
  test('is a no-op on the web (never touches the plugin)', async () => {
    capacitorMocks.isNativePlatform.mockReturnValue(false);
    await registerForPushNotifications();
    expect(pushPluginMocks.register).not.toHaveBeenCalled();
  });

  test('requests permission when not already granted, then registers', async () => {
    pushPluginMocks.checkPermissions.mockResolvedValue({ receive: 'prompt' });
    pushPluginMocks.requestPermissions.mockResolvedValue({ receive: 'granted' });

    await registerForPushNotifications();

    expect(pushPluginMocks.requestPermissions).toHaveBeenCalled();
    expect(pushPluginMocks.register).toHaveBeenCalled();
  });

  test('never calls register() if the user declines permission', async () => {
    pushPluginMocks.checkPermissions.mockResolvedValue({ receive: 'prompt' });
    pushPluginMocks.requestPermissions.mockResolvedValue({ receive: 'denied' });

    await registerForPushNotifications();

    expect(pushPluginMocks.register).not.toHaveBeenCalled();
  });

  test('sends the token to the backend and stores it locally once registration succeeds', async () => {
    api.post.mockResolvedValue({ data: { success: true } });
    await registerForPushNotifications();

    await pushPluginMocks._handlers.registration({ value: 'fcm-token-123' });

    expect(api.post).toHaveBeenCalledWith('/push/register-device', { fcmToken: 'fcm-token-123', platform: 'android' });
    expect(localStorage.getItem('lib_push_token')).toBe('fcm-token-123');
  });

  test('reports ios as the platform on iOS', async () => {
    capacitorMocks.getPlatform.mockReturnValue('ios');
    api.post.mockResolvedValue({ data: {} });
    await registerForPushNotifications();

    await pushPluginMocks._handlers.registration({ value: 'ios-token' });

    expect(api.post).toHaveBeenCalledWith('/push/register-device', { fcmToken: 'ios-token', platform: 'ios' });
  });

  test('never throws if the backend call fails', async () => {
    api.post.mockRejectedValue(new Error('network error'));
    await registerForPushNotifications();

    await expect(pushPluginMocks._handlers.registration({ value: 'fcm-token-123' })).resolves.toBeUndefined();
    expect(localStorage.getItem('lib_push_token')).toBeNull();
  });
});

describe('unregisterPushNotifications', () => {
  test('is a no-op on the web', async () => {
    capacitorMocks.isNativePlatform.mockReturnValue(false);
    await unregisterPushNotifications();
    expect(pushPluginMocks.unregister).not.toHaveBeenCalled();
  });

  test('does nothing if no token was ever stored', async () => {
    await unregisterPushNotifications();
    expect(api.post).not.toHaveBeenCalled();
    expect(pushPluginMocks.unregister).not.toHaveBeenCalled();
  });

  test('unregisters the stored token both server-side and on the plugin, then clears it locally', async () => {
    localStorage.setItem('lib_push_token', 'fcm-token-123');
    api.post.mockResolvedValue({ data: { success: true } });

    await unregisterPushNotifications();

    expect(api.post).toHaveBeenCalledWith('/push/unregister-device', { fcmToken: 'fcm-token-123' });
    expect(pushPluginMocks.unregister).toHaveBeenCalled();
    expect(localStorage.getItem('lib_push_token')).toBeNull();
  });

  test('still clears the local token even if the server call fails', async () => {
    localStorage.setItem('lib_push_token', 'fcm-token-123');
    api.post.mockRejectedValue(new Error('network error'));

    await unregisterPushNotifications();

    expect(localStorage.getItem('lib_push_token')).toBeNull();
  });
});
