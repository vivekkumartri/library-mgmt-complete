require('dotenv').config();

function required(name, fallback) {
  const v = process.env[name] ?? fallback;
  return v;
}

module.exports = {
  port: process.env.PORT || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  backendUrl: process.env.BACKEND_URL || 'http://localhost:4000',

  google: {
    projectId: process.env.GOOGLE_PROJECT_ID,
    clientEmail: process.env.GOOGLE_CLIENT_EMAIL,
    // Render/most hosts store multiline secrets with literal \n — convert back.
    privateKey: process.env.GOOGLE_PRIVATE_KEY
      ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
      : undefined,
    spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID,
    driveRootFolderId: process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID,
  },

  auth: {
    jwtSecret: required('JWT_SECRET', 'dev-only-insecure-secret'),
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
    sessionSecret: required('SESSION_SECRET', 'dev-only-insecure-secret'),
    // Long-lived opaque refresh token (not a JWT — stored hashed, looked
    // up server-side, and individually revocable) used by the mobile
    // app's biometric unlock to silently mint a new short-lived JWT
    // without asking for a password again. Days, not a jsonwebtoken
    // duration string.
    refreshTokenDays: Number(process.env.REFRESH_TOKEN_DAYS) || 30,
  },

  backup: {
    // Off by default — turn on with BACKUP_ENABLED=true once Drive is
    // configured. Cron expression is evaluated in the server's local time.
    enabled: process.env.BACKUP_ENABLED === 'true',
    cron: process.env.BACKUP_CRON || '0 2 * * *', // default: daily at 02:00
  },

  push: {
    // Off by default — turn on with PUSH_ENABLED=true once a Firebase
    // service account is configured. Separate from the Google Sheets
    // service account above (google.*) — this is a Firebase project's
    // own key, used only for sending FCM pushes, never for Sheets/Drive.
    enabled: process.env.PUSH_ENABLED === 'true',
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      : undefined,
    // Daily payment-due-reminder push run. Same "host can sleep" caveat
    // as BACKUP_CRON — see render.yaml and scripts/runPaymentReminders.js.
    reminderCron: process.env.PUSH_REMINDER_CRON || '0 9 * * *', // default: daily at 09:00
  },

  defaults: {
    studentIdPrefix: process.env.STUDENT_ID_PREFIX || 'LIB',
    receiptPrefix: process.env.RECEIPT_PREFIX || 'RCPT',
    currency: process.env.DEFAULT_CURRENCY || 'INR',
  },

  // Set true automatically when Google credentials are absent, so the
  // backend still boots (e.g. for running tests / local UI work) but
  // clearly reports degraded functionality instead of pretending success.
  get googleConfigured() {
    return Boolean(
      this.google.clientEmail && this.google.privateKey && this.google.spreadsheetId
    );
  },

  get pushConfigured() {
    return Boolean(this.push.projectId && this.push.clientEmail && this.push.privateKey);
  },
};
