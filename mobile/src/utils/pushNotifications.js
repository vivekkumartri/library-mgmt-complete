import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import api from '../services/api';

/**
 * Registers this device for push (payment-due reminders) and sends the
 * resulting FCM token to the backend against the currently logged-in
 * user. Web-only sessions never reach FCM/APNs, so this is a no-op there
 * — the web app keeps relying on the WhatsApp/SMS/email reminders.
 *
 * Safe to call every time the app becomes authenticated (login, biometric
 * unlock, or app resume with an existing session) — registering the same
 * token again just bumps registered_at server-side rather than
 * duplicating anything (see pushService.registerDevice).
 */
export async function registerForPushNotifications() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const permission = await PushNotifications.checkPermissions();
    if (permission.receive !== 'granted') {
      const requested = await PushNotifications.requestPermissions();
      if (requested.receive !== 'granted') return; // user declined — nothing more to do
    }

    // addListener BEFORE register(), or the 'registration' event firing
    // synchronously on some platforms can be missed entirely.
    await PushNotifications.addListener('registration', async (token) => {
      try {
        await api.post('/push/register-device', {
          fcmToken: token.value,
          platform: Capacitor.getPlatform() === 'ios' ? 'ios' : 'android',
        });
        localStorage.setItem('lib_push_token', token.value);
      } catch {
        // Non-fatal — the app works fine without push; it just won't
        // receive reminders until a later registration attempt succeeds.
      }
    });
    await PushNotifications.addListener('registrationError', () => {
      // Device/OS declined to issue a token (e.g. no network, Play
      // Services unavailable) — nothing actionable for the user here.
    });

    await PushNotifications.register();
  } catch {
    // Any plugin-level failure here must never block login/app usage.
  }
}

/** Unregisters this device's push token, both locally and on the server. Call on logout. */
export async function unregisterPushNotifications() {
  if (!Capacitor.isNativePlatform()) return;
  const token = localStorage.getItem('lib_push_token');
  localStorage.removeItem('lib_push_token');
  if (!token) return;
  try {
    await api.post('/push/unregister-device', { fcmToken: token });
  } catch {
    // Best-effort — the device will simply get pruned server-side the
    // next time a push to this stale token fails (see pushService).
  }
  try {
    await PushNotifications.unregister();
  } catch {
    // Non-fatal.
  }
}
