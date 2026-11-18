import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { config } from "../config/env.js";
import { AppError } from "../utils/AppError.js";

const handler = (req, res, next) =>
  next(new AppError(429, "RATE_LIMITED", "Too many attempts, please try again later"));

// Failed logins per IP + email (slows targeted guessing). Successes are not counted.
export const loginAccountLimiter = rateLimit({
  windowMs: config.rateLimit.loginWindowMs,
  limit: () => config.rateLimit.loginMax,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) =>
    `${ipKeyGenerator(req.ip)}|${String(req.body?.email ?? "").trim().toLowerCase()}`,
  handler,
});

// Failed logins per IP across all emails (slows credential spraying).
export const loginIpLimiter = rateLimit({
  windowMs: config.rateLimit.loginWindowMs,
  limit: () => Number(process.env.LOGIN_IP_RATE_LIMIT_MAX) || config.rateLimit.loginMax * 5,
  skipSuccessfulRequests: true,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  handler,
});

// General limiter for the other auth endpoints.
export const authLimiter = rateLimit({
  windowMs: config.rateLimit.loginWindowMs,
  limit: () => Number(process.env.AUTH_RATE_LIMIT_MAX) || 100,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  handler,
});
