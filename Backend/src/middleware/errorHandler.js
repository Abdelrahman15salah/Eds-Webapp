import { ZodError } from "zod";
import mongoose from "mongoose";
import { AppError } from "../utils/AppError.js";
import { config } from "../config/env.js";

export const notFound = (req, res, next) =>
  next(new AppError(404, "NOT_FOUND", "Route not found"));

const body = (code, message, details) => ({
  success: false,
  error: { code, message, ...(details ? { details } : {}) },
});

const isDbConnectionError = (err) =>
  [
    "MongoNetworkError",
    "MongoServerSelectionError",
    "MongooseServerSelectionError",
  ].includes(err?.name);

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  if (err instanceof AppError) {
    return res.status(err.statusCode).json(body(err.code, err.message, err.details));
  }
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ field: i.path.join("."), message: i.message }));
    return res.status(400).json(body("VALIDATION_ERROR", "Invalid input", details));
  }
  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((e) => ({
      field: e.path,
      message: e.message,
    }));
    return res.status(400).json(body("VALIDATION_ERROR", "Invalid input", details));
  }
  if (err?.code === 11000) {
    return res.status(409).json(body("DUPLICATE", "Resource already exists"));
  }
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json(body("INVALID_JSON", "Malformed JSON body"));
  }
  if (err?.type === "entity.too.large") {
    return res.status(413).json(body("PAYLOAD_TOO_LARGE", "Request body too large"));
  }
  if (isDbConnectionError(err)) {
    console.error(`[db] ${err.name}: ${err.message}`);
    return res
      .status(503)
      .json(body("DATABASE_UNAVAILABLE", "Service temporarily unavailable"));
  }

  // Unexpected: log server-side only (never the request body, headers or cookies).
  if (!config.isTest) console.error(`[error] ${req.method} ${req.path}:`, err);
  return res.status(500).json(body("INTERNAL_ERROR", "Internal server error"));
};
