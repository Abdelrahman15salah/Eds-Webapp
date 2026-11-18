import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app.js";
import { User } from "../src/models/User.model.js";
import { RefreshToken } from "../src/models/RefreshToken.model.js";
import { sha256 } from "../src/utils/tokens.js";
import {
  clearDb,
  cookieHeader,
  cookieValue,
  rawCookie,
  startDb,
  stopDb,
  validUser,
} from "./helpers.js";

const app = createApp();

beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

const register = (over) => request(app).post("/auth/register").send(validUser(over));
const login = (over = {}) =>
  request(app)
    .post("/auth/login")
    .send({ email: "test@example.com", password: "Passw0rdOk", ...over });

// Registers + logs in, returns the cookies as the browser would hold them.
const session = async () => {
  await register();
  const res = await login();
  const jar = {
    access_token: cookieValue(res, "access_token"),
    refresh_token: cookieValue(res, "refresh_token"),
    csrf_token: cookieValue(res, "csrf_token"),
  };
  return { res, jar };
};
const withCookies = (req, jar, csrf = jar.csrf_token) =>
  req.set("Cookie", cookieHeader(jar)).set("X-CSRF-Token", csrf ?? "");

const goneCookie = /Expires=Thu, 01 Jan 1970/;

describe("registration", () => {
  it("registers a user, hashes the password, hides sensitive fields", async () => {
    const res = await register({ email: "  Test@Example.COM " });
    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({
      name: "Test User",
      email: "test@example.com",
      role: "Student",
    });
    expect(JSON.stringify(res.body)).not.toMatch(/password|Passw0rd/i);
    const stored = await User.findOne({ email: "test@example.com" }).select("+password");
    expect(stored.password).not.toBe("Passw0rdOk");
    expect(stored.password).toMatch(/^\$2[aby]\$/);
  });

  it("rejects an existing email (case-insensitive) with 409", async () => {
    await register();
    const res = await register({ email: "TEST@example.com", name: "Other" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMAIL_TAKEN");
  });

  it.each([
    ["bad email", { email: "nope" }],
    ["short password", { password: "a1" }],
    ["password without number", { password: "onlyletters" }],
    ["short name", { name: "A" }],
    ["non-string email (NoSQL injection)", { email: { $gt: "" } }],
    ["missing name", { name: undefined }],
  ])("returns 400 for invalid input: %s", async (_, over) => {
    const res = await register(over);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("ignores privilege-escalation fields like role", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ ...validUser(), role: "SuperAdmin" });
    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe("Student");
  });

  it("returns 400 on malformed JSON", async () => {
    const res = await request(app)
      .post("/auth/register")
      .set("Content-Type", "application/json")
      .send("{bad");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
  });
});

describe("login", () => {
  it("logs in and sets secure cookies; no tokens in body", async () => {
    await register();
    const res = await login();
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/eyJ/);
    expect(rawCookie(res, "access_token")).toMatch(/HttpOnly/i);
    expect(rawCookie(res, "access_token")).toMatch(/SameSite=Lax/i);
    expect(rawCookie(res, "refresh_token")).toMatch(/HttpOnly/i);
    expect(rawCookie(res, "refresh_token")).toMatch(/Path=\/auth/);
    expect(rawCookie(res, "csrf_token")).not.toMatch(/HttpOnly/i);
  });

  it("stores only a hash of the refresh token", async () => {
    const { jar } = await session();
    const doc = await RefreshToken.findOne({});
    expect(doc.tokenHash).toBe(sha256(jar.refresh_token));
    expect(JSON.stringify(doc.toObject())).not.toContain(jar.refresh_token);
  });

  it("uses the same 401 for wrong password and unknown email", async () => {
    await register();
    const wrongPw = await login({ password: "WrongPass1" });
    const unknown = await login({ email: "nobody@example.com" });
    expect(wrongPw.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrongPw.body).toEqual(unknown.body);
    expect(wrongPw.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("rejects deactivated accounts", async () => {
    await register();
    await User.updateOne({ email: "test@example.com" }, { isActive: false });
    expect((await login()).status).toBe(401);
  });

  it("rate limits repeated failed logins with 429", async () => {
    await register({ email: "victim@example.com" });
    let last;
    for (let i = 0; i < 6; i++) {
      last = await login({ email: "victim@example.com", password: "Wrong1234" });
    }
    expect(last.status).toBe(429);
    expect(last.body.error.code).toBe("RATE_LIMITED");
    // even the right password is blocked while limited
    expect((await login({ email: "victim@example.com" })).status).toBe(429);
  });
});

describe("protected route /auth/me", () => {
  it("returns the current user with a valid cookie", async () => {
    const { jar } = await session();
    const res = await request(app)
      .get("/auth/me")
      .set("Cookie", cookieHeader({ access_token: jar.access_token }));
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe("test@example.com");
    expect(JSON.stringify(res.body)).not.toMatch(/password|tokenHash|googleId/i);
  });

  it("also accepts a Bearer token", async () => {
    const { jar } = await session();
    const res = await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${jar.access_token}`);
    expect(res.status).toBe(200);
  });

  it("401 TOKEN_MISSING without credentials", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("TOKEN_MISSING");
  });

  it("401 TOKEN_EXPIRED for an expired access token", async () => {
    const { jar } = await session();
    const { sub } = jwt.decode(jar.access_token);
    const expired = jwt.sign({ typ: "access" }, process.env.ACCESS_TOKEN_SECRET, {
      subject: sub,
      issuer: "eds-test",
      audience: "eds-test-client",
      expiresIn: -10,
    });
    const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("TOKEN_EXPIRED");
  });

  it("401 TOKEN_INVALID for garbage, wrong secret, alg=none, wrong audience, refresh-as-access", async () => {
    const { jar } = await session();
    const { sub } = jwt.decode(jar.access_token);
    const opts = { subject: sub, issuer: "eds-test", audience: "eds-test-client", expiresIn: 60 };
    const bad = [
      "not.a.jwt",
      jwt.sign({ typ: "access" }, "x".repeat(40), opts),
      jwt.sign({ typ: "access" }, "", { ...opts, algorithm: "none" }),
      jwt.sign({ typ: "access" }, process.env.ACCESS_TOKEN_SECRET, {
        ...opts,
        audience: "someone-else",
      }),
      jwt.sign({ typ: "refresh" }, process.env.ACCESS_TOKEN_SECRET, opts),
      jar.refresh_token,
    ];
    for (const t of bad) {
      const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${t}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("TOKEN_INVALID");
    }
  });

  it("rejects a valid token for a deleted user", async () => {
    const { jar } = await session();
    await User.deleteMany({});
    const res = await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${jar.access_token}`);
    expect(res.status).toBe(401);
  });
});

describe("refresh token rotation", () => {
  it("rotates: issues new tokens and invalidates the old refresh token", async () => {
    const { jar } = await session();
    const res = await withCookies(request(app).post("/auth/refresh"), jar);
    expect(res.status).toBe(200);
    const next = cookieValue(res, "refresh_token");
    expect(next).toBeTruthy();
    expect(next).not.toBe(jar.refresh_token);
    expect(cookieValue(res, "access_token")).toBeTruthy();
    const old = await RefreshToken.findOne({ tokenHash: sha256(jar.refresh_token) });
    expect(old.revokedAt).toBeTruthy();
    expect(old.replacedByHash).toBe(sha256(next));
  });

  it("detects reuse of a rotated token and revokes the whole family", async () => {
    const { jar } = await session();
    const first = await withCookies(request(app).post("/auth/refresh"), jar);
    const newJar = {
      ...jar,
      refresh_token: cookieValue(first, "refresh_token"),
      csrf_token: cookieValue(first, "csrf_token"),
    };

    const replay = await withCookies(request(app).post("/auth/refresh"), jar);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe("REFRESH_TOKEN_REUSED");

    // The legitimately rotated token is now revoked too.
    const after = await withCookies(request(app).post("/auth/refresh"), newJar);
    expect(after.status).toBe(401);
    expect(await RefreshToken.countDocuments({ revokedAt: null })).toBe(0);
  });

  it("rejects a missing or forged refresh token", async () => {
    const none = await request(app).post("/auth/refresh");
    expect(none.status).toBe(401);
    const forged = jwt.sign({ typ: "refresh" }, "y".repeat(40), {
      subject: "1",
      issuer: "eds-test",
      audience: "eds-test-client",
    });
    const res = await withCookies(
      request(app).post("/auth/refresh"),
      { refresh_token: forged, csrf_token: "abc" },
      "abc",
    );
    expect(res.status).toBe(401);
  });

  it("rejects a validly signed token that is not in the database", async () => {
    const { jar } = await session();
    await RefreshToken.deleteMany({});
    const res = await withCookies(request(app).post("/auth/refresh"), jar);
    expect(res.status).toBe(401);
  });

  it("requires a CSRF token when cookies are used", async () => {
    const { jar } = await session();
    const missing = await request(app).post("/auth/refresh").set("Cookie", cookieHeader(jar));
    expect(missing.status).toBe(403);
    expect(missing.body.error.code).toBe("CSRF_INVALID");
    const wrong = await withCookies(request(app).post("/auth/refresh"), jar, "wrong");
    expect(wrong.status).toBe(403);
  });
});

describe("logout", () => {
  it("revokes the session and clears cookies", async () => {
    const { jar } = await session();
    const res = await withCookies(request(app).post("/auth/logout"), jar);
    expect(res.status).toBe(200);
    expect(rawCookie(res, "refresh_token")).toMatch(goneCookie);
    expect(rawCookie(res, "access_token")).toMatch(goneCookie);
    expect(await RefreshToken.countDocuments({ revokedAt: null })).toBe(0);

    const reuse = await withCookies(request(app).post("/auth/refresh"), jar);
    expect(reuse.status).toBe(401);
  });

  it("is a harmless no-op without cookies", async () => {
    const res = await request(app).post("/auth/logout");
    expect(res.status).toBe(200);
  });

  it("is blocked without a CSRF token when cookies are present", async () => {
    const { jar } = await session();
    const res = await request(app).post("/auth/logout").set("Cookie", cookieHeader(jar));
    expect(res.status).toBe(403);
    expect(await RefreshToken.countDocuments({ revokedAt: null })).toBe(1);
  });
});

describe("misc security", () => {
  it("returns 404 JSON for unknown routes", async () => {
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("only allows configured CORS origins", async () => {
    const ok = await request(app).get("/").set("Origin", "http://allowed.test");
    expect(ok.headers["access-control-allow-origin"]).toBe("http://allowed.test");
    expect(ok.headers["access-control-allow-credentials"]).toBe("true");
    const bad = await request(app).get("/").set("Origin", "http://evil.test");
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
