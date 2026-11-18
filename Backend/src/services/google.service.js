import crypto from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { config } from "../config/env.js";
import { AppError } from "../utils/AppError.js";
import { randomToken } from "../utils/tokens.js";

const client = () =>
  new OAuth2Client({
    clientId: config.google.clientId,
    clientSecret: config.google.clientSecret,
    redirectUri: config.google.redirectUri,
  });

// Authorization-code flow with PKCE (S256), state and an OIDC nonce.
export const buildAuthRequest = () => {
  const state = randomToken(24);
  const nonce = randomToken(24);
  const verifier = randomToken(48);
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");

  const url = client().generateAuthUrl({
    scope: ["openid", "email", "profile"],
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return { url, state, nonce, verifier };
};

// Exchanges the code and returns the verified identity. Google's own tokens are
// used only inside this function and are never stored or logged.
export const exchangeCodeForIdentity = async ({ code, verifier, nonce }) => {
  try {
    const c = client();
    const { tokens } = await c.getToken({ code, codeVerifier: verifier });
    if (!tokens.id_token) throw new Error("missing id_token");
    const ticket = await c.verifyIdToken({
      idToken: tokens.id_token,
      audience: config.google.clientId,
    });
    const payload = ticket.getPayload();
    if (!payload || payload.nonce !== nonce) throw new Error("nonce mismatch");
    return {
      googleId: payload.sub,
      email: payload.email?.toLowerCase(),
      emailVerified: payload.email_verified === true,
      name: payload.name || payload.given_name || payload.email?.split("@")[0],
    };
  } catch {
    // Deliberately generic: Google error bodies can contain sensitive details.
    throw new AppError(401, "GOOGLE_AUTH_FAILED", "Google authentication failed");
  }
};
