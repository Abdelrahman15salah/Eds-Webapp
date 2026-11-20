import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { User } from "../src/models/User.model.js";
import { Course } from "../src/models/Course.model.js";
import { Module } from "../src/models/Module.model.js";
import { AuditLog } from "../src/models/AuditLog.model.js";
import { signAccessToken } from "../src/utils/tokens.js";
import { clearDb, cookieHeader, cookieValue, startDb, stopDb } from "./helpers.js";

const app = createApp();
beforeAll(startDb);
afterAll(stopDb);

let admin, ivy, bob, student;
let tok = {};

beforeEach(async () => {
  await clearDb();
  const mk = (userName, email, role) =>
    User.create({ userName, email, role, password: "Passw0rdOk" });
  admin = await mk("Admin", "admin@example.com", "SuperAdmin");
  ivy = await mk("Ivy Instructor", "ivy@example.com", "Instructor");
  bob = await mk("Bob Instructor", "bob@example.com", "Instructor");
  student = await mk("Sara Student", "sara@example.com", "Student");
  tok = {
    admin: signAccessToken(admin),
    ivy: signAccessToken(ivy),
    bob: signAccessToken(bob),
    student: signAccessToken(student),
  };
});

const api = (method, path, who, body) => {
  const r = request(app)[method](path);
  if (who) r.set("Authorization", `Bearer ${tok[who]}`);
  return body === undefined ? r : r.send(body);
};

const makeCourse = async (over = {}) =>
  (await api("post", "/courses", "admin", { title: "Anatomy 101", price: 150000, ...over })).body.data.course;
const makeModule = async (courseId, over = {}) =>
  (await api("post", `/courses/${courseId}/modules`, "admin", { title: "Module A", price: 50000, ...over })).body.data.module;

describe("courses: create / read", () => {
  it("SuperAdmin creates a course (draft by default, integer piasters)", async () => {
    const res = await api("post", "/courses", "admin", {
      title: "Anatomy 101",
      description: "Intro",
      category: "Medical",
      price: 150000,
      instructors: [String(ivy._id)],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.course).toMatchObject({
      title: "Anatomy 101",
      price: 150000,
      status: "draft",
      category: "Medical",
      instructors: [{ id: String(ivy._id), name: "Ivy Instructor" }],
      modules: [],
    });
    expect(JSON.stringify(res.body)).not.toMatch(/ivy@example/);
  });

  it.each([
    ["instructor", "ivy"],
    ["student", "student"],
    ["anonymous", undefined],
  ])("%s cannot create courses", async (_, who) => {
    const res = await api("post", "/courses", who, { title: "Nope Course", price: 1 });
    expect(res.status).toBe(who ? 403 : 401);
  });

  it.each([
    ["short title", { title: "ab" }],
    ["negative price", { price: -5 }],
    ["fractional price", { price: 10.5 }],
    ["string price", { price: "100" }],
    ["bad instructor id", { instructors: ["xyz"] }],
    ["bad status", { status: "live" }],
  ])("rejects invalid input: %s", async (_, over) => {
    const res = await api("post", "/courses", "admin", { title: "Good title", price: 100, ...over });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("only active Instructor-role users can be assigned as instructors", async () => {
    for (const bad of [student._id, admin._id, "64b000000000000000000000"]) {
      const res = await api("post", "/courses", "admin", { title: "Good title", price: 100, instructors: [String(bad)] });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INSTRUCTORS");
    }
    await User.updateOne({ _id: bob._id }, { isActive: false });
    const inactive = await api("post", "/courses", "admin", { title: "Good title", price: 100, instructors: [String(bob._id)] });
    expect(inactive.status).toBe(400);
  });

  it("students see only published courses; staff see all", async () => {
    const draft = await makeCourse({ title: "Draft Course" });
    const pub = await makeCourse({ title: "Published Course", status: "published" });

    const s = await api("get", "/courses", "student");
    expect(s.body.data.courses.map((c) => c.id)).toEqual([pub.id]);
    // a student cannot widen the filter
    const sTry = await api("get", "/courses?status=draft", "student");
    expect(sTry.body.data.courses.map((c) => c.id)).toEqual([pub.id]);
    expect((await api("get", `/courses/${draft.id}`, "student")).status).toBe(404);

    const i = await api("get", "/courses", "ivy");
    expect(i.body.data.courses).toHaveLength(2);
    expect((await api("get", `/courses/${draft.id}`, "ivy")).status).toBe(200);
  });

  it("filters, searches and paginates", async () => {
    await makeCourse({ title: "Alpha Course", category: "Med", status: "published" });
    await makeCourse({ title: "Beta Course", category: "Eng", status: "published" });
    await makeCourse({ title: "Gamma Course", category: "Med" });
    const med = await api("get", "/courses?category=Med&status=published", "admin");
    expect(med.body.data.courses.map((c) => c.title)).toEqual(["Alpha Course"]);
    const found = await api("get", "/courses?search=beta", "admin");
    expect(found.body.data.courses).toHaveLength(1);
    const page = await api("get", "/courses?limit=2&page=2&sort=title", "admin");
    expect(page.body.data.courses).toHaveLength(1);
    expect(page.body.data.pagination).toMatchObject({ total: 3, pages: 2 });
    expect((await api("get", "/courses?search=.*", "admin")).body.data.courses).toHaveLength(0);
    expect((await api("get", "/courses?limit=999", "admin")).status).toBe(400);
  });

  it("requires authentication to browse", async () => {
    expect((await api("get", "/courses")).status).toBe(401);
  });

  it("returns 400 for malformed ids and 404 for unknown", async () => {
    expect((await api("get", "/courses/not_an_id!", "admin")).status).toBe(400);
    expect((await api("get", "/courses/64b000000000000000000000", "admin")).status).toBe(404);
  });
});

describe("courses: update / delete / instructors", () => {
  it("SuperAdmin updates; instructors and students cannot", async () => {
    const c = await makeCourse();
    const ok = await api("patch", `/courses/${c.id}`, "admin", { title: "New Title", price: 99900, status: "published" });
    expect(ok.status).toBe(200);
    expect(ok.body.data.course).toMatchObject({ title: "New Title", price: 99900, status: "published" });
    expect((await api("patch", `/courses/${c.id}`, "ivy", { title: "Hacked" })).status).toBe(403);
    expect((await api("patch", `/courses/${c.id}`, "student", { title: "Hacked" })).status).toBe(403);
    expect((await api("patch", `/courses/${c.id}`, "admin", {})).status).toBe(400);
  });

  it("replaces course instructors", async () => {
    const c = await makeCourse();
    const res = await api("put", `/courses/${c.id}/instructors`, "admin", { instructors: [String(ivy._id), String(bob._id)] });
    expect(res.status).toBe(200);
    expect(res.body.data.course.instructors).toHaveLength(2);
    expect((await api("put", `/courses/${c.id}/instructors`, "ivy", { instructors: [] })).status).toBe(403);
  });

  it("archiving hides a course from students, keeps data, and restore returns a draft", async () => {
    const c = await makeCourse({ status: "published" });
    await makeModule(c.id);
    expect((await api("post", `/courses/${c.id}/archive`, "ivy")).status).toBe(403);
    const res = await api("post", `/courses/${c.id}/archive`, "admin");
    expect(res.status).toBe(200);
    expect(res.body.data.course.status).toBe("archived");
    expect((await api("post", `/courses/${c.id}/archive`, "admin")).body.error.code).toBe("ALREADY_ARCHIVED");
    expect((await api("get", `/courses/${c.id}`, "student")).status).toBe(404);
    expect(await Course.countDocuments()).toBe(1);
    expect(await Module.countDocuments()).toBe(1);
    const back = await api("post", `/courses/${c.id}/restore`, "admin");
    expect(back.body.data.course.status).toBe("draft");
    expect((await api("post", `/courses/${c.id}/restore`, "admin")).body.error.code).toBe("NOT_ARCHIVED");
  });

  it("there is no hard-delete endpoint", async () => {
    const c = await makeCourse();
    expect((await api("delete", `/courses/${c.id}`, "admin")).status).toBe(404);
  });
});

describe("slugs", () => {
  it("generates a unique slug from the title and resolves courses by slug", async () => {
    const a = await makeCourse({ title: "Endodontics 101!", status: "published" });
    const b = await makeCourse({ title: "Endodontics 101", status: "published" });
    expect(a.slug).toBe("endodontics-101");
    expect(b.slug).toBe("endodontics-101-2");
    const res = await api("get", "/courses/endodontics-101", "student");
    expect(res.status).toBe(200);
    expect(res.body.data.course.id).toBe(a.id);
    expect((await api("get", "/courses/no-such-course", "admin")).status).toBe(404);
    expect((await api("get", "/courses/Bad_Slug!", "admin")).status).toBe(400);
  });

  it("falls back to a generic slug for non-latin titles", async () => {
    const c = await makeCourse({ title: "علم التشريح" });
    expect(c.slug).toBe("course");
  });

  it("accepts a custom slug, rejects duplicates, and keeps the slug when the title changes", async () => {
    const a = await makeCourse({ slug: "perio-basics" });
    expect(a.slug).toBe("perio-basics");
    expect((await api("post", "/courses", "admin", { title: "Other one", price: 1, slug: "perio-basics" })).body.error.code).toBe("SLUG_TAKEN");
    const b = await makeCourse({ title: "Second" });
    const clash = await api("patch", `/courses/${b.id}`, "admin", { slug: "perio-basics" });
    expect(clash.status).toBe(409);
    const renamed = await api("patch", `/courses/${a.id}`, "admin", { title: "Totally new title" });
    expect(renamed.body.data.course.slug).toBe("perio-basics");
    const moved = await api("patch", `/courses/${b.id}`, "admin", { slug: "second-edition" });
    expect(moved.body.data.course.slug).toBe("second-edition");
  });

  it("works for module routes under a slug", async () => {
    await makeCourse({ slug: "slugged" });
    const m = await api("post", "/courses/slugged/modules", "admin", { title: "Mod one", price: 100 });
    expect(m.status).toBe(201);
    expect((await api("get", "/courses/slugged/modules", "admin")).body.data.modules).toHaveLength(1);
  });
});

describe("audit trail", () => {
  it("records create, field-level updates, archive and restore with the actor", async () => {
    const c = await makeCourse();
    await api("patch", `/courses/${c.id}`, "admin", { price: 99900, title: "Renamed course" });
    await api("post", `/courses/${c.id}/archive`, "admin");
    await api("post", `/courses/${c.id}/restore`, "admin");

    const res = await api("get", `/audit-logs?entityType=course&entityId=${c.id}`, "admin");
    expect(res.status).toBe(200);
    const logs = res.body.data.logs;
    expect(logs.map((l) => l.action)).toEqual(["course.restore", "course.archive", "course.update", "course.create"]);
    const upd = logs.find((l) => l.action === "course.update");
    expect(upd.actor).toMatchObject({ id: String(admin._id), role: "SuperAdmin" });
    expect(upd.changes).toEqual(
      expect.arrayContaining([
        { field: "price", from: 150000, to: 99900 },
        { field: "title", from: "Anatomy 101", to: "Renamed course" },
      ]),
    );
    expect(upd.changes).toHaveLength(2);
  });

  it("logs instructor edits on modules, module archive and reorder; no-op saves are not logged", async () => {
    const c = await makeCourse();
    const m1 = await makeModule(c.id, { title: "First one", instructors: [String(ivy._id)] });
    const m2 = await makeModule(c.id, { title: "Second one" });
    await api("patch", `/modules/${m1.id}`, "ivy", { title: "First edited" });
    await api("patch", `/modules/${m1.id}`, "ivy", { title: "First edited" });
    await api("put", `/courses/${c.id}/modules/order`, "admin", { moduleIds: [m2.id, m1.id] });
    expect((await api("post", `/modules/${m2.id}/archive`, "ivy")).status).toBe(403);
    expect((await api("post", `/modules/${m2.id}/archive`, "admin")).body.data.module.status).toBe("archived");

    const ml = await api("get", `/audit-logs?entityId=${m1.id}`, "admin");
    expect(ml.body.data.logs.map((l) => l.action)).toEqual(["module.update", "module.create"]);
    expect(ml.body.data.logs[0].actor.role).toBe("Instructor");
    expect(ml.body.data.logs[0].changes).toEqual([{ field: "title", from: "First one", to: "First edited" }]);

    const all = await api("get", "/audit-logs?action=course.reorder-modules", "admin");
    expect(all.body.data.logs).toHaveLength(1);
    expect(all.body.data.logs[0].changes[0].to).toEqual([m2.id, m1.id]);

    await api("patch", `/courses/${c.id}`, "admin", { status: "published" });
    await api("patch", `/modules/${m1.id}`, "admin", { status: "published" });
    expect((await api("get", `/courses/${c.id}/modules`, "student")).body.data.modules).toHaveLength(1);
    expect((await api("post", `/modules/${m2.id}/restore`, "admin")).body.data.module.status).toBe("draft");
  });

  it("is SuperAdmin only and filterable/paginated", async () => {
    expect((await api("get", "/audit-logs", "ivy")).status).toBe(403);
    expect((await api("get", "/audit-logs", "student")).status).toBe(403);
    expect((await api("get", "/audit-logs")).status).toBe(401);
    await makeCourse();
    await makeCourse({ title: "Another" });
    const res = await api("get", `/audit-logs?limit=1&actor=${admin._id}`, "admin");
    expect(res.body.data.logs).toHaveLength(1);
    expect(res.body.data.pagination.total).toBe(2);
    expect(await AuditLog.countDocuments()).toBe(2);
  });
});

describe("modules", () => {
  it("creates modules in order; required by default, optional when set", async () => {
    const c = await makeCourse();
    const m1 = await makeModule(c.id, { title: "Basics" });
    const m2 = await makeModule(c.id, { title: "Bonus Lab", isRequired: false, price: 0 });
    const m3 = await makeModule(c.id, { title: "Advanced" });
    expect([m1.order, m2.order, m3.order]).toEqual([1, 2, 3]);
    expect(m1.isRequired).toBe(true);
    expect(m2.isRequired).toBe(false);
    expect(m2.price).toBe(0);
    expect(m1.status).toBe("draft");

    const detail = await api("get", `/courses/${c.id}`, "admin");
    expect(detail.body.data.course.modules.map((m) => [m.title, m.isRequired])).toEqual([
      ["Basics", true],
      ["Bonus Lab", false],
      ["Advanced", true],
    ]);
  });

  it("only SuperAdmin creates modules; unknown course 404; bad input 400", async () => {
    const c = await makeCourse();
    expect((await api("post", `/courses/${c.id}/modules`, "ivy", { title: "Module X", price: 1 })).status).toBe(403);
    expect((await api("post", "/courses/64b000000000000000000000/modules", "admin", { title: "Module X", price: 1 })).status).toBe(404);
    expect((await api("post", `/courses/${c.id}/modules`, "admin", { title: "Module X", price: -1 })).status).toBe(400);
  });

  it("students only see published modules of published courses", async () => {
    const c = await makeCourse({ status: "published" });
    const pub = await makeModule(c.id, { title: "Public One", status: "published" });
    const draft = await makeModule(c.id, { title: "Hidden Draft" });

    const list = await api("get", `/courses/${c.id}/modules`, "student");
    expect(list.body.data.modules.map((m) => m.id)).toEqual([pub.id]);
    expect((await api("get", `/modules/${draft.id}`, "student")).status).toBe(404);
    expect((await api("get", `/modules/${pub.id}`, "student")).status).toBe(200);
    const course = await api("get", `/courses/${c.id}`, "student");
    expect(course.body.data.course.modules).toHaveLength(1);
    expect((await api("get", `/courses/${c.id}/modules`, "ivy")).body.data.modules).toHaveLength(2);

    // a published module inside an unpublished course is also hidden
    await Course.updateOne({ _id: c.id }, { status: "draft" });
    expect((await api("get", `/modules/${pub.id}`, "student")).status).toBe(404);
  });

  it("assigned instructor edits title/description only", async () => {
    const c = await makeCourse();
    const m = await makeModule(c.id, { instructors: [String(ivy._id)] });

    const ok = await api("patch", `/modules/${m.id}`, "ivy", { title: "Better Title", description: "Updated" });
    expect(ok.status).toBe(200);
    expect(ok.body.data.module).toMatchObject({ title: "Better Title", description: "Updated", price: 50000 });

    for (const forbidden of [{ price: 1 }, { isRequired: false }, { status: "published" }, { title: "Fine Title", price: 1 }]) {
      const res = await api("patch", `/modules/${m.id}`, "ivy", forbidden);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FIELD_NOT_ALLOWED");
    }
    expect((await Module.findById(m.id)).price).toBe(50000);
  });

  it("unassigned instructors and students cannot edit a module", async () => {
    const c = await makeCourse();
    const m = await makeModule(c.id, { instructors: [String(ivy._id)] });
    const other = await api("patch", `/modules/${m.id}`, "bob", { title: "Not Mine" });
    expect(other.status).toBe(403);
    expect(other.body.error.code).toBe("NOT_ASSIGNED");
    expect((await api("patch", `/modules/${m.id}`, "student", { title: "Not Mine" })).status).toBe(403);
    // but may view it
    expect((await api("get", `/modules/${m.id}`, "bob")).status).toBe(200);
  });

  it("SuperAdmin edits any field and assigns module instructors", async () => {
    const c = await makeCourse();
    const m = await makeModule(c.id);
    const res = await api("patch", `/modules/${m.id}`, "admin", { price: 12345, isRequired: false, status: "published" });
    expect(res.body.data.module).toMatchObject({ price: 12345, isRequired: false, status: "published" });
    const inst = await api("put", `/modules/${m.id}/instructors`, "admin", { instructors: [String(bob._id)] });
    expect(inst.body.data.module.instructors[0].name).toBe("Bob Instructor");
    expect((await api("put", `/modules/${m.id}/instructors`, "ivy", { instructors: [] })).status).toBe(403);
    // newly assigned instructor can now edit
    expect((await api("patch", `/modules/${m.id}`, "bob", { title: "Bob Edit" })).status).toBe(200);
  });

  it("reorders modules and rejects invalid orderings", async () => {
    const c = await makeCourse();
    const [a, b, d] = [await makeModule(c.id, { title: "AAA" }), await makeModule(c.id, { title: "BBB" }), await makeModule(c.id, { title: "CCC" })];
    const res = await api("put", `/courses/${c.id}/modules/order`, "admin", { moduleIds: [d.id, a.id, b.id] });
    expect(res.status).toBe(200);
    expect(res.body.data.modules.map((m) => [m.title, m.order])).toEqual([["CCC", 1], ["AAA", 2], ["BBB", 3]]);

    for (const moduleIds of [[a.id, b.id], [a.id, a.id, b.id], [a.id, b.id, "64b000000000000000000000"]]) {
      const bad = await api("put", `/courses/${c.id}/modules/order`, "admin", { moduleIds });
      expect(bad.status).toBe(400);
    }
    expect((await api("put", `/courses/${c.id}/modules/order`, "ivy", { moduleIds: [d.id, a.id, b.id] })).status).toBe(403);
  });

  it("archiving a module hides it from students and keeps its position", async () => {
    const c = await makeCourse({ status: "published" });
    const a = await makeModule(c.id, { title: "AAA", status: "published" });
    const b = await makeModule(c.id, { title: "BBB", status: "published" });
    expect((await api("post", `/modules/${b.id}/archive`, "ivy")).status).toBe(403);
    expect((await api("post", `/modules/${b.id}/archive`, "admin")).status).toBe(200);
    expect((await api("post", `/modules/${b.id}/archive`, "admin")).body.error.code).toBe("ALREADY_ARCHIVED");
    expect((await api("get", `/courses/${c.id}/modules`, "student")).body.data.modules.map((m) => m.title)).toEqual(["AAA"]);
    expect((await api("get", `/modules/${b.id}`, "student")).status).toBe(404);
    expect((await api("delete", `/modules/${b.id}`, "admin")).status).toBe(404);
    expect(await Module.countDocuments()).toBe(2);
    expect(a.order).toBe(1);
  });
});

describe("cookie auth + CSRF on catalog writes", () => {
  it("POST /courses with cookies needs the CSRF header", async () => {
    const login = await request(app).post("/auth/login").send({ email: "admin@example.com", password: "Passw0rdOk" });
    const jar = { access_token: cookieValue(login, "access_token"), csrf_token: cookieValue(login, "csrf_token") };
    const body = { title: "Cookie Course", price: 1000 };
    const noCsrf = await request(app).post("/courses").set("Cookie", cookieHeader(jar)).send(body);
    expect(noCsrf.status).toBe(403);
    const ok = await request(app).post("/courses").set("Cookie", cookieHeader(jar)).set("X-CSRF-Token", jar.csrf_token).send(body);
    expect(ok.status).toBe(201);
  });
});
