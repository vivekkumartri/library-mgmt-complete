class AppError extends Error {
  constructor(code, message, statusCode = 400, meta = undefined) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.meta = meta;
  }
}

module.exports = { AppError };
