import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { BCRYPT_ROUNDS, User } from "../models/User.model.js";
import { config } from "../config/env.js";
import { AppError, conflict, unauthorized } from "../utils/AppError.js";
import {
  clearAuthCookies,
  COOKIE,
  OAUTH_COOKIE_PATH,
  safeEqual,
  setAuthCookies,
} from "../utils/cookies.js";
import {
  issueSession,
  revokeSessionByToken,
  rotateSession,
} from "../services/session.service.js";
import { buildAuthRequest, exchangeCodeForIdentity } from "../services/google.service.js";

const publicUser = (u) => ({
  id: String(u._id),
  name: u.userName,
  email: u.email,
  role: u.role,
  authProviders: u.authProviders,
  emailVerified: u.emailVerified,
  createdAt: u.createdAt,
});

// Valid hash used to burn equivalent CPU time when no password can match (timing parity).
const DUMMY_HASH = bcrypt.hashSync("timing-equalizer", BCRYPT_ROUNDS);

export const register = async (req, res) => {
  const { name, email, password } = req.body;

  if (await User.exists({ email })) {
    throw conflict("An account with this email already exists", "EMAIL_TAKEN");
  }
  const user = await User.create({ userName: name, email, password });
  res.status(201).json({ success: true, data: { user: publicUser(user) } });
};

export const login = async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select("+password");

  // Same work and same response whether the email is unknown, OAuth-only or wrong password.
  const ok = user?.password
    ? await user.comparePassword(password)
    : await bcrypt.compare(password, DUMMY_HASH).then(() => false);

  if (!user || !ok || !user.isActive) {
    throw unauthorized("Invalid email or password", "INVALID_CREDENTIALS");
  }

  const tokens = await issueSession(user, req);
  setAuthCookies(res, tokens);
  res.json({ success: true, data: { user: publicUser(user) } });
};

export const refresh = async (req, res) => {
  const raw = req.cookies?.[COOKIE.refresh];
  if (!raw) throw unauthorized("Refresh token missing", "TOKEN_MISSING");
  try {
    const { user, ...tokens } = await rotateSession(raw, req);
    setAuthCookies(res, tokens);
    res.json({ success: true, data: { user: publicUser(user) } });
  } catch (err) {
    if (err instanceof AppError) clearAuthCookies(res);
    throw err;
  }
};

export const logout = async (req, res) => {
  await revokeSessionByToken(req.cookies?.[COOKIE.refresh]);
  clearAuthCookies(res);
  res.json({ success: true, data: { message: "Logged out" } });
};

export const me = (req, res) => {
  res.json({ success: true, data: { user: publicUser(req.user) } });
};

/* ------------------------------ Google OAuth ------------------------------ */

const txCookieOptions = () => ({
  httpOnly: true,
  secure: config.cookies.secure,
  sameSite: "lax", // must be Lax: Google redirects back with a cross-site top-level GET
  path: OAUTH_COOKIE_PATH,
  domain: config.cookies.domain,
});

const clearTx = (res) => res.clearCookie(COOKIE.oauthTx, txCookieOptions());

export const googleStart = (req, res) => {
  const { url, state, nonce, verifier } = buildAuthRequest();
  // Short-lived signed cookie binds state/nonce/PKCE verifier to this browser.
  const tx = jwt.sign({ typ: "oauth_tx", state, nonce, verifier }, config.jwt.accessSecret, {
    algorithm: "HS256",
    expiresIn: 600,
  });
  res.cookie(COOKIE.oauthTx, tx, { ...txCookieOptions(), maxAge: 600 * 1000 });
  res.redirect(302, url);
};

const readTx = (req) => {
  const raw = req.cookies?.[COOKIE.oauthTx];
  if (!raw) throw new AppError(400, "OAUTH_STATE_INVALID", "OAuth session expired or missing");
  try {
    const tx = jwt.verify(raw, config.jwt.accessSecret, { algorithms: ["HS256"] });
    if (tx.typ !== "oauth_tx") throw new Error("wrong type");
    return tx;
  } catch {
    throw new AppError(400, "OAUTH_STATE_INVALID", "OAuth session expired or invalid");
  }
};

const displayName = (n) => {
  const t = String(n || "").trim().slice(0, 60);
  return t.length >= 2 ? t : "User";
};

const findOrCreateGoogleUser = async (identity) => {
  if (!identity.email || !identity.emailVerified) {
    throw new AppError(403, "GOOGLE_EMAIL_UNVERIFIED", "Google account email is not verified");
  }

  const linked = await User.findOne({ googleId: identity.googleId });
  if (linked) return linked;

  // No automatic linking by email: an existing account must not be taken over
  // just because a Google account claims the same address.
  if (await User.exists({ email: identity.email })) {
    throw conflict(
      "An account with this email already exists. Sign in with your original method.",
      "ACCOUNT_EXISTS",
    );
  }

  return User.create({
    userName: displayName(identity.name),
    email: identity.email,
    googleId: identity.googleId,
    authProviders: ["google"],
    emailVerified: true,
  });
};

const failRedirect = (res, code) => {
  const url = new URL(config.frontendUrl + (process.env.FRONTEND_LOGIN_PATH || "/login"));
  url.searchParams.set("auth_error", code);
  res.redirect(302, url.toString());
};

export const googleCallback = async (req, res, next) => {
  try {
    const tx = readTx(req);
    clearTx(res);

    if (req.query.error) {
      throw new AppError(401, "GOOGLE_ACCESS_DENIED", "Google sign-in was cancelled or denied");
    }
    if (typeof req.query.state !== "string" || !safeEqual(req.query.state, tx.state)) {
      throw new AppError(400, "OAUTH_STATE_INVALID", "Invalid OAuth state");
    }
    if (typeof req.query.code !== "string" || !req.query.code) {
      throw new AppError(400, "OAUTH_CODE_MISSING", "Missing authorization code");
    }

    const identity = await exchangeCodeForIdentity({
      code: req.query.code,
      verifier: tx.verifier,
      nonce: tx.nonce,
    });
    const user = await findOrCreateGoogleUser(identity);
    if (!user.isActive) throw unauthorized("Account disabled", "INVALID_CREDENTIALS");

    setAuthCookies(res, await issueSession(user, req));

    if (config.frontendUrl) {
      return res.redirect(302, config.frontendUrl + (process.env.FRONTEND_SUCCESS_PATH || "/"));
    }
    return res.json({ success: true, data: { user: publicUser(user) } });
  } catch (err) {
    if (config.frontendUrl && err instanceof AppError) {
      clearTx(res);
      return failRedirect(res, err.code);
    }
    next(err);
  }
};
