import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "../config/env.js";
import { unauthorized } from "./AppError.js";

const ALG = "HS256";

export const sha256 = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");

export const randomToken = (bytes = 32) =>
  crypto.randomBytes(bytes).toString("base64url");

export const signAccessToken = (user) =>
  jwt.sign({ typ: "access", role: user.role }, config.jwt.accessSecret, {
    algorithm: ALG,
    subject: String(user._id),
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
    expiresIn: config.jwt.accessTtlSeconds,
  });

export const signRefreshToken = ({ userId, familyId, jti }) =>
  jwt.sign({ typ: "refresh", fam: familyId }, config.jwt.refreshSecret, {
    algorithm: ALG,
    subject: String(userId),
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
    expiresIn: config.jwt.refreshTtlSeconds,
    jwtid: jti,
  });

const verify = (token, secret, typ) => {
  let payload;
  try {
    payload = jwt.verify(token, secret, {
      algorithms: [ALG],
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
    });
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      throw unauthorized("Token expired", "TOKEN_EXPIRED");
    }
    throw unauthorized("Invalid token", "TOKEN_INVALID");
  }
  if (payload.typ !== typ) throw unauthorized("Invalid token", "TOKEN_INVALID");
  return payload;
};

export const verifyAccessToken = (t) => verify(t, config.jwt.accessSecret, "access");
export const verifyRefreshToken = (t) => verify(t, config.jwt.refreshSecret, "refresh");
