import crypto from "node:crypto";
import { RefreshToken } from "../models/RefreshToken.model.js";
import { User } from "../models/User.model.js";
import { config } from "../config/env.js";
import { unauthorized } from "../utils/AppError.js";
import {
  sha256,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../utils/tokens.js";

const clientInfo = (req) => ({
  userAgent: (req.get("user-agent") || "").slice(0, 300),
  ip: req.ip,
});

// Creates a refresh-token record (hash only) and returns the raw token pair.
export const issueSession = async (user, req, family = crypto.randomUUID()) => {
  const jti = crypto.randomUUID();
  const refreshToken = signRefreshToken({ userId: user._id, familyId: family, jti });
  await RefreshToken.create({
    user: user._id,
    family,
    tokenHash: sha256(refreshToken),
    expiresAt: new Date(Date.now() + config.jwt.refreshTtlSeconds * 1000),
    ...clientInfo(req),
  });
  return { accessToken: signAccessToken(user), refreshToken };
};

export const revokeFamily = (family) =>
  RefreshToken.updateMany({ family, revokedAt: null }, { revokedAt: new Date() });

// Rotates a refresh token. Presenting an already-used token revokes the whole family.
export const rotateSession = async (rawToken, req) => {
  const payload = verifyRefreshToken(rawToken);
  const tokenHash = sha256(rawToken);

  // Atomic: only one concurrent request can consume a given token.
  const consumed = await RefreshToken.findOneAndUpdate(
    { tokenHash, revokedAt: null },
    { revokedAt: new Date() },
  );

  if (!consumed) {
    const known = await RefreshToken.findOne({ tokenHash }).select("family");
    if (known) {
      await revokeFamily(known.family);
      throw unauthorized("Refresh token reuse detected", "REFRESH_TOKEN_REUSED");
    }
    throw unauthorized("Invalid refresh token", "TOKEN_INVALID");
  }

  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) {
    await revokeFamily(consumed.family);
    throw unauthorized("Invalid refresh token", "TOKEN_INVALID");
  }

  const tokens = await issueSession(user, req, consumed.family);
  await RefreshToken.updateOne(
    { _id: consumed._id },
    { replacedByHash: sha256(tokens.refreshToken) },
  );
  return { user, ...tokens };
};

// Ends every session of a user: revokes all refresh tokens and invalidates all
// outstanding access tokens. Returns the updated user (with the new tokenVersion).
export const revokeAllSessions = async (userId) => {
  await RefreshToken.updateMany({ user: userId, revokedAt: null }, { revokedAt: new Date() });
  return User.findByIdAndUpdate(userId, { $inc: { tokenVersion: 1 } }, { returnDocument: "after" });
};

// Logout: best-effort revocation of the session behind a raw refresh token.
export const revokeSessionByToken = async (rawToken) => {
  if (!rawToken) return;
  const doc = await RefreshToken.findOne({ tokenHash: sha256(rawToken) }).select("family");
  if (doc) await revokeFamily(doc.family);
};
