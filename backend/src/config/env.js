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
  },

  backup: {
    // Off by default — turn on with BACKUP_ENABLED=true once Drive is
    // configured. Cron expression is evaluated in the server's local time.
    enabled: process.env.BACKUP_ENABLED === 'true',
    cron: process.env.BACKUP_CRON || '0 2 * * *', // default: daily at 02:00
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
};
