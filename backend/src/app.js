const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const env = require('./config/env');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimit');

const authRoutes = require('./routes/authRoutes');
const studentRoutes = require('./routes/studentRoutes');
const floorSeatRoutes = require('./routes/floorSeatRoutes');
const allocationRoutes = require('./routes/allocationRoutes');
const financeRoutes = require('./routes/financeRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const { expensesRouter, noticesRouter, settingsRouter, adminsRouter } = require('./routes/miscRoutes');
const backupRoutes = require('./routes/backupRoutes');
const roleRoutes = require('./routes/roleRoutes');
const pushRoutes = require('./routes/pushRoutes');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const app = express();

app.use(helmet());
// The mobile app (Capacitor) is served from a fixed native-shell origin
// rather than the web frontend's own domain — Android's WebView uses
// https://localhost, iOS uses capacitor://localhost, and a local native
// dev build may still be plain http://localhost. Allow those alongside
// the configured web frontend origin.
const allowedOrigins = new Set([
  env.frontendUrl,
  'capacitor://localhost',
  'http://localhost',
  'https://localhost',
]);
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));
app.use('/api', apiLimiter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', googleConfigured: env.googleConfigured, env: env.nodeEnv });
});

app.use('/api/auth', authRoutes);

app.use('/api/students', studentRoutes);

app.post('/api/settings/logo', upload.single('logo'));

app.use('/api', floorSeatRoutes); // exposes /api/floors and /api/floors/:id/seats, /api/seats/:id
app.use('/api/allocations', allocationRoutes);
app.use('/api', financeRoutes); // /api/billing, /api/payments
app.use('/api/attendance', attendanceRoutes);
app.use('/api/expenses', expensesRouter);
app.use('/api/notices', noticesRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/admins', adminsRouter);
app.use('/api/roles', roleRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/reports', dashboardRoutes);
app.use('/api/dashboard', dashboardRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
