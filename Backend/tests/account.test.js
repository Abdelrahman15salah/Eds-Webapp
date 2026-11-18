import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { User } from "../src/models/User.model.js";
import { RefreshToken } from "../src/models/RefreshToken.model.js";
import { clearDb, cookieHeader, cookieValue, startDb, stopDb, validUser } from "./helpers.js";

const app = createApp();
beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

const NEW_PW = "BrandNew123";

// Logs in once (one "device") and returns its cookie jar.
const device = async () => {
  const res = await request(app)
    .post("/auth/login")
    .send({ email: "test@example.com", password: "Passw0rdOk" });
  return {
    access_token: cookieValue(res, "access_token"),
    refresh_token: cookieValue(res, "refresh_token"),
    csrf_token: cookieValue(res, "csrf_token"),
  };
};
const setup = async () => {
  await request(app).post("/auth/register").send(validUser());
  return { a: await device(), b: await device() };
};
const call = (method, path, jar) =>
  request(app)[method](path).set("Cookie", cookieHeader(jar)).set("X-CSRF-Token", jar.csrf_token);
const me = (jar) =>
  request(app).get("/auth/me").set("Cookie", cookieHeader({ access_token: jar.access_token }));
const refresh = (jar) => call("post", "/auth/refresh", jar);

describe("POST /auth/change-password", () => {
  it("changes the password, signs out other sessions, keeps the caller signed in", async () => {
    const { a, b } = await setup();
    const res = await call("post", "/auth/change-password", a).send({
      currentPassword: "Passw0rdOk",
      newPassword: NEW_PW,
    });
    expect(res.status).toBe(200);

    // Other device: access token revoked immediately, refresh token dead.
    const bMe = await me(b);
    expect(bMe.status).toBe(401);
    expect(bMe.body.error.code).toBe("TOKEN_REVOKED");
    expect((await refresh(b)).status).toBe(401);

    // Calling device: old access token revoked, but fresh cookies were issued.
    expect((await me(a)).status).toBe(401);
    const fresh = {
      access_token: cookieValue(res, "access_token"),
      refresh_token: cookieValue(res, "refresh_token"),
      csrf_token: cookieValue(res, "csrf_token"),
    };
    expect((await me(fresh)).status).toBe(200);
    expect((await refresh(fresh)).status).toBe(200);

    // New password works, old one does not.
    const ok = await request(app).post("/auth/login").send({ email: "test@example.com", password: NEW_PW });
    expect(ok.status).toBe(200);
    const old = await request(app).post("/auth/login").send({ email: "test@example.com", password: "Passw0rdOk" });
    expect(old.status).toBe(401);
  });

  it("rejects a wrong current password with 403 and changes nothing", async () => {
    const { a, b } = await setup();
    const res = await call("post", "/auth/change-password", a).send({
      currentPassword: "WrongPass1",
      newPassword: NEW_PW,
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("INVALID_CURRENT_PASSWORD");
    expect((await me(b)).status).toBe(200);
  });

  it("validates the new password and requires it to differ", async () => {
    const { a } = await setup();
    for (const newPassword of ["short1", "nodigitshere", "Passw0rdOk"]) {
      const res = await call("post", "/auth/change-password", a).send({
        currentPassword: "Passw0rdOk",
        newPassword,
      });
      expect(res.status).toBe(400);
    }
  });

  it("requires authentication and CSRF", async () => {
    const { a } = await setup();
    const anon = await request(app)
      .post("/auth/change-password")
      .send({ currentPassword: "Passw0rdOk", newPassword: NEW_PW });
    expect(anon.status).toBe(401);
    const noCsrf = await request(app)
      .post("/auth/change-password")
      .set("Cookie", cookieHeader(a))
      .send({ currentPassword: "Passw0rdOk", newPassword: NEW_PW });
    expect(noCsrf.status).toBe(403);
  });

  it("tells Google-only users they have no password", async () => {
    const g = await User.create({ userName: "Gus", email: "gus@example.com", googleId: "g1", authProviders: ["google"] });
    const { signAccessToken } = await import("../src/utils/tokens.js");
    const res = await request(app)
      .post("/auth/change-password")
      .set("Authorization", `Bearer ${signAccessToken(g)}`)
      .send({ currentPassword: "x", newPassword: NEW_PW });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PASSWORD_NOT_SET");
  });
});

describe("POST /auth/logout-all", () => {
  it("ends every session on every device", async () => {
    const { a, b } = await setup();
    const res = await call("post", "/auth/logout-all", a);
    expect(res.status).toBe(200);
    expect((await me(a)).status).toBe(401);
    expect((await me(b)).status).toBe(401);
    expect((await refresh(b)).status).toBe(401);
    expect(await RefreshToken.countDocuments({ revokedAt: null })).toBe(0);
  });

  it("requires authentication", async () => {
    expect((await request(app).post("/auth/logout-all")).status).toBe(401);
  });
});

describe("PATCH /auth/me", () => {
  it("updates own name and phone, ignoring role/isActive", async () => {
    const { a } = await setup();
    const res = await call("patch", "/auth/me", a).send({
      name: "New Name",
      phoneNumber: "+201001234567",
      role: "SuperAdmin",
      isActive: false,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ name: "New Name", phoneNumber: "+201001234567", role: "Student", isActive: true });
  });

  it("can clear the phone number and rejects bad input", async () => {
    const { a } = await setup();
    await call("patch", "/auth/me", a).send({ phoneNumber: "+201001234567" });
    const cleared = await call("patch", "/auth/me", a).send({ phoneNumber: null });
    expect(cleared.body.data.user.phoneNumber).toBeNull();
    expect((await call("patch", "/auth/me", a).send({ phoneNumber: "abc" })).status).toBe(400);
    expect((await call("patch", "/auth/me", a).send({})).status).toBe(400);
  });
});

describe("project basics", () => {
  it("GET /health reports database status", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", db: "up" });
  });

  it("serves the OpenAPI document", async () => {
    const res = await request(app).get("/docs.json");
    expect(res.status).toBe(200);
    expect(res.body.paths["/auth/change-password"]).toBeTruthy();
  });
});
