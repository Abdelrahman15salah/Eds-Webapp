import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../src/services/google.service.js", async (importOriginal) => ({
  ...(await importOriginal()),
  exchangeCodeForIdentity: vi.fn(),
}));

import { createApp } from "../src/app.js";
import { AppError } from "../src/utils/AppError.js";
import { User } from "../src/models/User.model.js";
import { exchangeCodeForIdentity } from "../src/services/google.service.js";
import { clearDb, cookieHeader, cookieValue, rawCookie, startDb, stopDb } from "./helpers.js";

const app = createApp();
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => {
  await clearDb();
  vi.mocked(exchangeCodeForIdentity).mockReset();
  delete process.env.FRONTEND_URL;
});

const identity = (over = {}) => ({
  googleId: "g-123",
  email: "gina@example.com",
  emailVerified: true,
  name: "Gina G",
  ...over,
});

// Starts the flow like a browser: returns the tx cookie + the state sent to Google.
const start = async () => {
  const res = await request(app).get("/auth/google");
  const url = new URL(res.headers.location);
  return { res, url, tx: cookieValue(res, "oauth_tx"), state: url.searchParams.get("state") };
};
const callback = (tx, query) =>
  request(app)
    .get("/auth/google/callback")
    .query(query)
    .set("Cookie", tx ? cookieHeader({ oauth_tx: tx }) : "");
const goneCookie = /Expires=Thu, 01 Jan 1970/;

describe("GET /auth/google", () => {
  it("redirects to Google with state, nonce, PKCE S256 and openid scopes", async () => {
    const { res, url, tx } = await start();
    expect(res.status).toBe(302);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe(process.env.GOOGLE_CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(process.env.GOOGLE_REDIRECT_URI);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("nonce")).toBeTruthy();
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(rawCookie(res, "oauth_tx")).toMatch(/HttpOnly/i);
    expect(res.headers.location).not.toContain(tx);
  });
});

describe("GET /auth/google/callback", () => {
  it("creates a new user and issues app tokens (no Google tokens persisted)", async () => {
    vi.mocked(exchangeCodeForIdentity).mockResolvedValue(identity());
    const { tx, state } = await start();
    const res = await callback(tx, { state, code: "good" });
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({
      email: "gina@example.com",
      authProviders: ["google"],
      emailVerified: true,
    });
    expect(cookieValue(res, "access_token")).toBeTruthy();
    expect(cookieValue(res, "refresh_token")).toBeTruthy();
    const u = await User.findOne({ email: "gina@example.com" }).select("+googleId +password");
    expect(u.googleId).toBe("g-123");
    expect(u.password).toBeUndefined();
    expect(exchangeCodeForIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "good",
        verifier: expect.any(String),
        nonce: expect.any(String),
      }),
    );

    const me = await request(app)
      .get("/auth/me")
      .set("Cookie", cookieHeader({ access_token: cookieValue(res, "access_token") }));
    expect(me.status).toBe(200);
  });

  it("logs in an existing linked Google user without creating a duplicate", async () => {
    vi.mocked(exchangeCodeForIdentity).mockResolvedValue(identity());
    for (let i = 0; i < 2; i++) {
      const { tx, state } = await start();
      expect((await callback(tx, { state, code: "c" })).status).toBe(200);
    }
    expect(await User.countDocuments()).toBe(1);
  });

  it("matches by Google ID even if the Google email changed", async () => {
    vi.mocked(exchangeCodeForIdentity).mockResolvedValueOnce(identity());
    let s = await start();
    await callback(s.tx, { state: s.state, code: "c" });
    vi.mocked(exchangeCodeForIdentity).mockResolvedValueOnce(
      identity({ email: "new@example.com" }),
    );
    s = await start();
    const res = await callback(s.tx, { state: s.state, code: "c" });
    expect(res.status).toBe(200);
    expect(await User.countDocuments()).toBe(1);
  });

  it("does NOT auto-link to an existing password account with the same email", async () => {
    await request(app)
      .post("/auth/register")
      .send({ name: "Gina Local", email: "gina@example.com", password: "Passw0rdOk" });
    vi.mocked(exchangeCodeForIdentity).mockResolvedValue(identity());
    const { tx, state } = await start();
    const res = await callback(tx, { state, code: "c" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ACCOUNT_EXISTS");
    expect(cookieValue(res, "access_token")).toBeUndefined();
    const u = await User.findOne({ email: "gina@example.com" }).select("+googleId");
    expect(u.googleId).toBeUndefined();
  });

  it("lets password and Google users coexist with separate providers", async () => {
    await request(app)
      .post("/auth/register")
      .send({ name: "Local Lou", email: "lou@example.com", password: "Passw0rdOk" });
    vi.mocked(exchangeCodeForIdentity).mockResolvedValue(identity());
    const { tx, state } = await start();
    await callback(tx, { state, code: "c" });
    const local = await User.findOne({ email: "lou@example.com" });
    const google = await User.findOne({ email: "gina@example.com" });
    expect(local.authProviders).toEqual(["local"]);
    expect(google.authProviders).toEqual(["google"]);
  });

  it("Google-only accounts cannot log in with a password", async () => {
    vi.mocked(exchangeCodeForIdentity).mockResolvedValue(identity());
    const { tx, state } = await start();
    await callback(tx, { state, code: "c" });
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "gina@example.com", password: "anything1" });
    expect(res.status).toBe(401);
  });

  it("rejects an unverified Google email", async () => {
    vi.mocked(exchangeCodeForIdentity).mockResolvedValue(identity({ emailVerified: false }));
    const { tx, state } = await start();
    const res = await callback(tx, { state, code: "c" });
    expect(res.status).toBe(403);
    expect(await User.countDocuments()).toBe(0);
  });

  it("rejects a mismatched state", async () => {
    const { tx } = await start();
    const res = await callback(tx, { state: "attacker-state", code: "c" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("OAUTH_STATE_INVALID");
    expect(exchangeCodeForIdentity).not.toHaveBeenCalled();
  });

  it("rejects a missing or tampered transaction cookie", async () => {
    const { tx, state } = await start();
    const missing = await callback(undefined, { state, code: "c" });
    expect(missing.body.error.code).toBe("OAUTH_STATE_INVALID");
    const tampered = await callback(tx + "x", { state, code: "c" });
    expect(tampered.body.error.code).toBe("OAUTH_STATE_INVALID");
  });

  it("handles the user denying consent", async () => {
    const { tx, state } = await start();
    const res = await callback(tx, { state, error: "access_denied" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("GOOGLE_ACCESS_DENIED");
  });

  it("handles a missing code", async () => {
    const { tx, state } = await start();
    const res = await callback(tx, { state });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("OAUTH_CODE_MISSING");
  });

  it("handles Google failures without leaking details", async () => {
    vi.mocked(exchangeCodeForIdentity).mockRejectedValue(
      new AppError(401, "GOOGLE_AUTH_FAILED", "Google authentication failed"),
    );
    const { tx, state } = await start();
    const res = await callback(tx, { state, code: "expired" });
    expect(res.status).toBe(401);
    expect(res.body.error).toEqual({
      code: "GOOGLE_AUTH_FAILED",
      message: "Google authentication failed",
    });
  });

  it("clears the transaction cookie after the callback", async () => {
    vi.mocked(exchangeCodeForIdentity).mockResolvedValue(identity());
    const { tx, state } = await start();
    const done = await callback(tx, { state, code: "c" });
    expect(rawCookie(done, "oauth_tx")).toMatch(goneCookie);
  });

  it("redirects to FRONTEND_URL on success and failure when configured", async () => {
    process.env.FRONTEND_URL = "http://front.test/";
    vi.mocked(exchangeCodeForIdentity).mockResolvedValue(identity());
    let s = await start();
    const ok = await callback(s.tx, { state: s.state, code: "c" });
    expect(ok.status).toBe(302);
    expect(ok.headers.location).toBe("http://front.test/");
    s = await start();
    const bad = await callback(s.tx, { state: "wrong", code: "c" });
    expect(bad.status).toBe(302);
    expect(bad.headers.location).toBe("http://front.test/login?auth_error=OAUTH_STATE_INVALID");
  });
});
