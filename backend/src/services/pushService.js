const { initializeApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const env = require('../config/env');
const repos = require('../repositories');
const { AppError } = require('../utils/AppError');
const { uuid } = require('../utils/id');
const AllocationService = require('./allocationService').AllocationService;

class PushService {
  _messaging() {
    if (!env.pushConfigured) {
      throw new AppError(
        'PUSH_NOT_CONFIGURED',
        'Push notifications are not configured on this server. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY.',
        503
      );
    }
    if (!this._firebaseApp) {
      this._firebaseApp = initializeApp({
        credential: cert({
          projectId: env.push.projectId,
          clientEmail: env.push.clientEmail,
          privateKey: env.push.privateKey,
        }),
      });
    }
    return getMessaging(this._firebaseApp);
  }

  /**
   * Registers (or re-registers) a device for push. One row per
   * device/install — a second call with the same token just bumps
   * registered_at rather than creating a duplicate, so reinstalling the
   * app or logging in again on the same device never piles up rows.
   */
  async registerDevice({ ownerType, ownerId, fcmToken, platform }) {
    if (!fcmToken) throw new AppError('VALIDATION_ERROR', 'fcmToken is required.', 400);
    const existing = await repos.deviceTokens.findAll((d) => d.fcm_token === fcmToken);
    if (existing[0]) {
      return repos.deviceTokens.update(existing[0].device_token_id, {
        owner_type: ownerType,
        owner_id: ownerId,
        platform: platform || existing[0].platform,
        registered_at: new Date().toISOString(),
      });
    }
    return repos.deviceTokens.create({
      device_token_id: uuid(),
      owner_type: ownerType,
      owner_id: ownerId,
      fcm_token: fcmToken,
      platform: platform || '',
      registered_at: new Date().toISOString(),
      last_notified_at: '',
    });
  }

  /** Removes a device's token — called on logout so a signed-out device stops receiving pushes. */
  async unregisterDevice(fcmToken) {
    if (!fcmToken) return;
    const existing = await repos.deviceTokens.findAll((d) => d.fcm_token === fcmToken);
    if (existing[0]) await repos.deviceTokens.delete(existing[0].device_token_id);
  }

  /**
   * Sends one push to every device registered for a given owner (a
   * student may be logged in on more than one device). An invalid/expired
   * token (FCM's registration-token-not-registered error) is pruned from
   * Device_Tokens right away instead of being retried forever on every
   * future reminder run.
   */
  async sendToOwner({ ownerType, ownerId, title, body, data }) {
    const devices = await repos.deviceTokens.findAll((d) => d.owner_type === ownerType && d.owner_id === ownerId);
    if (devices.length === 0) return { sent: 0, pruned: 0 };

    const messaging = this._messaging();
    let sent = 0;
    let pruned = 0;
    for (const device of devices) {
      try {
        await messaging.send({
          token: device.fcm_token,
          notification: { title, body },
          data: data || {},
        });
        sent += 1;
        await repos.deviceTokens.update(device.device_token_id, { last_notified_at: new Date().toISOString() });
      } catch (err) {
        if (err.code === 'messaging/registration-token-not-registered' || err.code === 'messaging/invalid-registration-token') {
          await repos.deviceTokens.delete(device.device_token_id);
          pruned += 1;
        } else {
          // eslint-disable-next-line no-console
          console.error(`[push] failed to notify device ${device.device_token_id}:`, err.message);
        }
      }
    }
    return { sent, pruned };
  }

  /**
   * Daily run: pushes a payment reminder to every active student whose
   * automatic payment status (same calculation the WhatsApp/SMS/email
   * reminders and the seat map's payment-risk coloring already use) is
   * due_today or overdue. Deliberately sends every run while a student
   * stays in either state — the reminder should keep nudging daily until
   * they pay, not go silent after the first day. last_notified_at on
   * Device_Tokens is just an audit trail of when each device was last
   * pushed, not a dedup guard against this.
   */
  async sendPaymentDueReminders() {
    const students = await repos.students.findAll((s) => s.status === 'active');
    let notified = 0;
    let skipped = 0;
    for (const student of students) {
      const status = await AllocationService.paymentStatusForStudent(student.student_id);
      if (status.urgency !== 'due_today' && status.urgency !== 'overdue') {
        skipped += 1;
        continue;
      }
      const body = status.amountDue > 0
        ? `₹${status.amountDue} is due${status.urgency === 'overdue' ? ' — please pay as soon as possible.' : ' today.'}`
        : 'Your payment is due today.';
      const result = await this.sendToOwner({
        ownerType: 'student',
        ownerId: student.student_id,
        title: 'Payment reminder',
        body,
        data: { type: 'payment_due', studentId: student.student_id },
      });
      notified += result.sent;
    }
    return { studentsChecked: students.length, notified, skipped };
  }
}

module.exports = new PushService();
