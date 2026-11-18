import { User } from "../models/User.model.js";
import { COOKIE, safeEqual } from "../utils/cookies.js";
import { forbidden, unauthorized } from "../utils/AppError.js";
import { verifyAccessToken } from "../utils/tokens.js";

const extractAccessToken = (req) => {
  if (req.cookies?.[COOKIE.access]) return req.cookies[COOKIE.access];
  const header = req.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  return null;
};

// Protects private routes. Re-loads the user so deactivated accounts are rejected.
export const authenticate = async (req, res, next) => {
  const token = extractAccessToken(req);
  if (!token) throw unauthorized("Authentication required", "TOKEN_MISSING");
  const payload = verifyAccessToken(token);
  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) throw unauthorized("Invalid token", "TOKEN_INVALID");
  req.user = user;
  next();
};

export const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) throw forbidden();
    next();
  };

// Double-submit-cookie CSRF check for cookie-authenticated, state-changing requests.
// Skipped when the request carries no auth cookies (nothing ambient to abuse).
export const csrfProtect = (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const usesCookies = req.cookies?.[COOKIE.access] || req.cookies?.[COOKIE.refresh];
  if (!usesCookies) return next();
  if (!safeEqual(req.cookies[COOKIE.csrf], req.get("x-csrf-token"))) {
    throw forbidden("Invalid CSRF token", "CSRF_INVALID");
  }
  next();
};
