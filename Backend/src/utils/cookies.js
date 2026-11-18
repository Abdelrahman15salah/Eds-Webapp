import crypto from "node:crypto";
import { config } from "../config/env.js";
import { randomToken } from "./tokens.js";

export const COOKIE = {
  access: "access_token",
  refresh: "refresh_token",
  csrf: "csrf_token",
  oauthTx: "oauth_tx",
};

export const REFRESH_COOKIE_PATH = "/auth";
export const OAUTH_COOKIE_PATH = "/auth/google";

const base = () => ({
  secure: config.cookies.secure,
  sameSite: config.cookies.sameSite,
  domain: config.cookies.domain,
});

export const setAuthCookies = (res, { accessToken, refreshToken }) => {
  const csrf = randomToken(24);
  res.cookie(COOKIE.access, accessToken, {
    ...base(),
    httpOnly: true,
    path: "/",
    maxAge: config.jwt.accessTtlSeconds * 1000,
  });
  // Refresh token is only ever sent to /auth/*.
  res.cookie(COOKIE.refresh, refreshToken, {
    ...base(),
    httpOnly: true,
    path: REFRESH_COOKIE_PATH,
    maxAge: config.jwt.refreshTtlSeconds * 1000,
  });
  // Double-submit CSRF token: readable by the frontend JS, echoed in X-CSRF-Token.
  res.cookie(COOKIE.csrf, csrf, {
    ...base(),
    httpOnly: false,
    path: "/",
    maxAge: config.jwt.refreshTtlSeconds * 1000,
  });
};

export const clearAuthCookies = (res) => {
  res.clearCookie(COOKIE.access, { ...base(), httpOnly: true, path: "/" });
  res.clearCookie(COOKIE.refresh, { ...base(), httpOnly: true, path: REFRESH_COOKIE_PATH });
  res.clearCookie(COOKIE.csrf, { ...base(), path: "/" });
};

export const safeEqual = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
};
