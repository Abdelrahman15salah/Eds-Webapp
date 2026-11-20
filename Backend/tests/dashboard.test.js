import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { User } from "../src/models/User.model.js";
import { DailyStat } from "../src/models/Traffic.model.js";
import { signAccessToken } from "../src/utils/tokens.js";
import { cairoDay, drainTraffic } from "../src/services/traffic.service.js";
import { clearDb, startDb, stopDb } from "./helpers.js";

const app = createApp();
beforeAll(startDb);
afterAll(stopDb);

let tok = {};
beforeEach(async () => {
  await clearDb();
  const mk = (userName, email, role) => User.create({ userName, email, role, password: "Passw0rdOk" });
  const [admin, ivy, sara] = await Promise.all([
    mk("Admin", "admin@example.com", "SuperAdmin"),
    mk("Ivy", "ivy@example.com", "Instructor"),
    mk("Sara", "sara@example.com", "Student"),
  ]);
  tok = { admin: signAccessToken(admin), ivy: signAccessToken(ivy), sara: signAccessToken(sara) };
});

const api = (method, path, who, body) => {
  const r = request(app)[method](path);
  if (who) r.set("Authorization", `Bearer ${tok[who]}`);
  return body === undefined ? r : r.send(body);
};

describe("visit tracking", () => {
  it("counts page views and unique visitors per day, without login", async () => {
    const visit = (path, ua) =>
      request(app).post("/analytics/visit").set("User-Agent", ua).send({ path });
    expect((await visit("/courses/endo?x=1", "A")).status).toBe(202);
    await visit("/courses/endo", "A"); // same visitor, same day
    await visit("/", "B"); // different visitor
    const day = await DailyStat.findOne({ day: cairoDay() });
    expect(day.pageViews).toBe(3);
    expect(day.uniqueVisitors).toBe(2);

    const res = await api("get", "/admin/traffic?days=7", "admin");
    expect(res.body.data.today).toMatchObject({ pageViews: 3, uniqueVisitorDays: 2 });
    expect(res.body.data.topPages[0]).toEqual({ path: "/courses/endo", views: 2 });
    expect(res.body.data.daily).toHaveLength(7);
  });

  it("validates the path", async () => {
    expect((await request(app).post("/analytics/visit").send({})).status).toBe(400);
    expect((await request(app).post("/analytics/visit").send({ path: "nope" })).status).toBe(400);
  });
});

describe("api request stats", () => {
  it("counts requests and error classes, but not /admin or /health", async () => {
    await api("get", "/courses", "sara"); // 200
    await api("get", "/courses/bad_id!", "sara"); // 400
    await api("get", "/nothing-here"); // 404
    await request(app).get("/health");
    await api("get", "/admin/server", "admin");
    await drainTraffic();
    const day = await DailyStat.findOne({ day: cairoDay() });
    expect(day.requests).toBe(3);
    expect(day.status2xx).toBe(1);
    expect(day.status4xx).toBe(2);
    expect(day.status5xx).toBe(0);
  });
});

describe("admin dashboard", () => {
  it("is SuperAdmin only", async () => {
    for (const p of ["/admin/dashboard", "/admin/server", "/admin/traffic"]) {
      expect((await api("get", p)).status).toBe(401);
      expect((await api("get", p, "sara")).status).toBe(403);
      expect((await api("get", p, "ivy")).status).toBe(403);
    }
  });

  it("returns server, traffic, users, catalog and recent activity", async () => {
    await api("post", "/courses", "admin", { title: "Anatomy 101", price: 1000, category: "Medical", status: "published" });
    await api("post", "/courses", "admin", { title: "Draft course", price: 1000 });
    const res = await api("get", "/admin/dashboard", "admin");
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.server).toMatchObject({ status: "ok", database: { state: "connected" } });
    expect(d.server.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(d.server.memory.rssMB).toBeGreaterThan(0);
    expect(d.users).toMatchObject({ total: 3, active: 3, byRole: { Student: 1, Instructor: 1, SuperAdmin: 1, Lab: 0 } });
    expect(d.users.signupsPerDay).toHaveLength(30);
    expect(d.users.signupsPerDay.at(-1).count).toBe(3);
    expect(d.catalog.courses).toMatchObject({ total: 2, published: 1, draft: 1, archived: 0 });
    expect(d.catalog.publishedWithoutInstructors).toBe(1);
    expect(d.catalog.byCategory).toEqual(expect.arrayContaining([{ category: "Medical", courses: 1 }]));
    expect(d.traffic.daily).toHaveLength(30);
    expect(d.recentActivity[0].action).toBe("course.create");
  });

  it("validates the days parameter", async () => {
    expect((await api("get", "/admin/traffic?days=0", "admin")).status).toBe(400);
    expect((await api("get", "/admin/traffic?days=91", "admin")).status).toBe(400);
  });
});
