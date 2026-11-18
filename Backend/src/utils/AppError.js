export class AppError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
  }
}

export const badRequest = (msg = "Bad request", code = "BAD_REQUEST", d) =>
  new AppError(400, code, msg, d);
export const unauthorized = (msg = "Authentication required", code = "UNAUTHORIZED") =>
  new AppError(401, code, msg);
export const forbidden = (msg = "Forbidden", code = "FORBIDDEN") =>
  new AppError(403, code, msg);
export const conflict = (msg = "Conflict", code = "CONFLICT") =>
  new AppError(409, code, msg);
