const { AppError } = require('../utils/AppError');

function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'ROUTE_NOT_FOUND', message: 'Route not found.' } });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      // eslint-disable-next-line no-console
      console.error(`[error] ${err.code}:`, err.message, err.meta || '');
    }
    return res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
  }

  // Zod validation errors
  if (err?.name === 'ZodError') {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Some fields are invalid.',
        details: err.errors?.map((e) => ({ path: e.path.join('.'), message: e.message })),
      },
    });
  }

  // eslint-disable-next-line no-console
  console.error('[unhandled error]', err);
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' },
  });
}

module.exports = { notFoundHandler, errorHandler };
