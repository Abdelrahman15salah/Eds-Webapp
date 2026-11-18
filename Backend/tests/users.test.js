import { RefreshToken } from "../src/models/RefreshToken.model.js";
import { issueSession } from "../src/services/session.service.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { User } from "../src/models/User.model.js";
import { signAccessToken } from "../src/utils/tokens.js";
import { clearDb, cookieHeader, cookieValue, startDb, stopDb } from "./helpers.js";

const app = createApp();
beforeAll(startDb);
afterAll(stopDb);

let adminToken;
let studentToken;

beforeEach(async () => {
  await clearDb();
  const mk = (userName, email, role, extra = {}) =>
    User.create({ userName, email, role, password: "Passw0rdOk", ...extra });
  const admin = await mk("Admin", "admin@example.com", "SuperAdmin");
  const student = await mk("Sara Student", "sara@example.com", "Student");
  await mk("Sam Student", "sam@example.com", "Student", { isActive: false });
  await mk("Ivy Instructor", "ivy@example.com", "Instructor");
  await mk("Lab Larry", "lab@example.com", "Lab");
  adminToken = signAccessToken(admin);
  studentToken = signAccessToken(student);
});

const get = (qs = "", token = adminToken) =>
  request(app).get(`/users${qs}`).set("Authorization", `Bearer ${token}`);

describe("GET /users", () => {
  it("requires authentication and the SuperAdmin role", async () => {
    expect((await request(app).get("/users")).status).toBe(401);
    expect((await get("", studentToken)).status).toBe(403);
  });

  it("lists users without sensitive fields", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.data.users).toHaveLength(5);
    expect(res.body.data.pagination).toMatchObject({ page: 1, total: 5, pages: 1 });
    expect(JSON.stringify(res.body)).not.toMatch(/password|googleId/i);
  });

  it("filters by a single role", async () => {
    const res = await get("?role=Student");
    expect(res.body.data.users.map((u) => u.role)).toEqual(["Student", "Student"]);
  });

  it("filters by multiple roles", async () => {
    const res = await get("?role=Instructor,Lab");
    expect(res.body.data.users.map((u) => u.email).sort()).toEqual([
      "ivy@example.com",
      "lab@example.com",
    ]);
  });

  it("combines role with isActive and search", async () => {
    const active = await get("?role=Student&isActive=true");
    expect(active.body.data.users.map((u) => u.email)).toEqual(["sara@example.com"]);
    const found = await get("?search=sam");
    expect(found.body.data.users.map((u) => u.email)).toEqual(["sam@example.com"]);
  });

  it("paginates and sorts", async () => {
    const res = await get("?limit=2&page=2&sort=userName");
    expect(res.body.data.users).toHaveLength(2);
    expect(res.body.data.pagination).toMatchObject({ page: 2, limit: 2, total: 5, pages: 3 });
  });

  it("rejects invalid roles and params with 400", async () => {
    for (const qs of ["?role=Hacker", "?limit=1000", "?page=0", "?sort=password"]) {
      const res = await get(qs);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("treats search as literal text, not a regex", async () => {
    expect((await get("?search=.*")).body.data.users).toHaveLength(0);
  });
});



describe("account management (SuperAdmin)", () => {
  const send = (method, path, body, token = adminToken) =>
    request(app)[method](path).set("Authorization", `Bearer ${token}`).send(body);

  it("gets a user by id; 404 for unknown, 400 for malformed id", async () => {
    const sara = await User.findOne({ email: "sara@example.com" });
    
    const res = await request(app).get(`/users/${sara._id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe("sara@example.com");
    const missing = await request(app).get("/users/64b000000000000000000000").set("Authorization", `Bearer ${adminToken}`);
    expect(missing.status).toBe(404);
    const bad = await request(app).get("/users/not-an-id").set("Authorization", `Bearer ${adminToken}`);
    expect(bad.status).toBe(400);
  });

  it("changes a user's role", async () => {
    const sara = await User.findOne({ email: "sara@example.com" });
    const res = await send("patch", `/users/${sara._id}`, { role: "Instructor" });
    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe("Instructor");
    expect((await User.findById(sara._id)).role).toBe("Instructor");
  });

  it("rejects invalid roles and empty updates", async () => {
    const sara = await User.findOne({ email: "sara@example.com" });
    expect((await send("patch", `/users/${sara._id}`, { role: "Root" })).status).toBe(400);
    expect((await send("patch", `/users/${sara._id}`, {})).status).toBe(400);
  });

  it("deactivating a user revokes their sessions immediately", async () => {
    const sara = await User.findOne({ email: "sara@example.com" });
    const sess = await issueSession(sara, { get: () => "", ip: "1.1.1.1" });
    const before = await request(app).get("/auth/me").set("Authorization", `Bearer ${studentToken}`);
    expect(before.status).toBe(200);

    expect((await send("patch", `/users/${sara._id}`, { isActive: false })).status).toBe(200);
    const after = await request(app).get("/auth/me").set("Authorization", `Bearer ${studentToken}`);
    expect(after.status).toBe(401);
    expect(await RefreshToken.countDocuments({ user: sara._id, revokedAt: null })).toBe(0);
    expect(sess.refreshToken).toBeTruthy();
  });

  it("prevents admins from changing their own role/status or deleting themselves", async () => {
    const admin = await User.findOne({ email: "admin@example.com" });
    expect((await send("patch", `/users/${admin._id}`, { role: "Student" })).status).toBe(403);
    expect((await send("patch", `/users/${admin._id}`, { isActive: false })).status).toBe(403);
    expect((await send("delete", `/users/${admin._id}`)).status).toBe(403);
    // but may edit their own profile fields
    expect((await send("patch", `/users/${admin._id}`, { name: "Admin Two" })).status).toBe(200);
  });

  it("deletes a user and their sessions; non-admins are forbidden", async () => {
    const sara = await User.findOne({ email: "sara@example.com" });
    expect((await send("delete", `/users/${sara._id}`, undefined, studentToken)).status).toBe(403);
    expect((await send("delete", `/users/${sara._id}`)).status).toBe(200);
    expect(await User.findById(sara._id)).toBeNull();
    expect((await send("delete", `/users/${sara._id}`)).status).toBe(404);
  });
});

describe("cookie-based admin writes (CSRF)", () => {
  it("PATCH/DELETE /users/:id work with cookies + matching X-CSRF-Token and fail without", async () => {
    const login = await request(app).post("/auth/login").send({ email: "admin@example.com", password: "Passw0rdOk" });
    const jar = {
      access_token: cookieValue(login, "access_token"),
      csrf_token: cookieValue(login, "csrf_token"),
    };
    const sara = await User.findOne({ email: "sara@example.com" });
    const base = () => request(app).patch(`/users/${sara._id}`).set("Cookie", cookieHeader(jar));

    expect((await base().send({ role: "Instructor" })).status).toBe(403);
    const ok = await base().set("X-CSRF-Token", jar.csrf_token).send({ role: "Instructor" });
    expect(ok.status).toBe(200);
    const del = await request(app).delete(`/users/${sara._id}`).set("Cookie", cookieHeader(jar)).set("X-CSRF-Token", jar.csrf_token);
    expect(del.status).toBe(200);
  });
});
