import { Module } from "../models/Module.model.js";
import { badRequest, conflict, forbidden } from "../utils/AppError.js";
import { MODULE_AUDIT_FIELDS, auditChange, recordAudit, snapshot } from "../services/audit.service.js";
import { publicModule } from "../utils/catalog.serializers.js";
import {
  assertCanManageModule,
  assertInstructors,
  isAdmin,
  isStaff,
  loadCourseFor,
  loadModuleFor,
} from "../services/catalog.service.js";
import { objectId } from "../validators/user.validators.js";
import { MODULE_INSTRUCTOR_FIELDS } from "../validators/course.validators.js";

export const listModules = async (req, res) => {
  const course = await loadCourseFor(req.user, req.params.id);
  const filter = { course: course._id };
  if (!isStaff(req.user)) filter.status = "published";
  const modules = await Module.find(filter).sort({ order: 1 }).populate("instructors", "userName");
  res.json({ success: true, data: { modules: modules.map(publicModule) } });
};

export const createModule = async (req, res) => {
  const course = await loadCourseFor(req.user, req.params.id);
  await assertInstructors(req.body.instructors);
  const last = await Module.findOne({ course: course._id }).sort({ order: -1 }).select("order");
  const mod = await Module.create({
    ...req.body,
    course: course._id,
    order: (last?.order ?? 0) + 1,
  });
  await recordAudit(req, {
    action: "module.create",
    entityType: "module",
    entityId: mod._id,
    changes: Object.entries(snapshot(mod, MODULE_AUDIT_FIELDS)).map(([field, to]) => ({ field, from: null, to })),
    meta: { course: String(course._id) },
  });
  await mod.populate("instructors", "userName");
  res.status(201).json({ success: true, data: { module: publicModule(mod) } });
};

export const getModule = async (req, res) => {
  const mod = await loadModuleFor(req.user, objectId.parse(req.params.id));
  res.json({ success: true, data: { module: publicModule(mod) } });
};

export const updateModule = async (req, res) => {
  const mod = await loadModuleFor(req.user, objectId.parse(req.params.id));
  if (!isAdmin(req.user)) {
    assertCanManageModule(req.user, mod);
    // Assigned instructors may edit content text only, never price/status/requirement.
    const blocked = Object.keys(req.body).filter((k) => !MODULE_INSTRUCTOR_FIELDS.includes(k));
    if (blocked.length) {
      throw forbidden(
        `Instructors can only edit: ${MODULE_INSTRUCTOR_FIELDS.join(", ")}`,
        "FIELD_NOT_ALLOWED",
      );
    }
  }
  const before = snapshot(mod, MODULE_AUDIT_FIELDS);
  Object.assign(mod, req.body);
  await mod.save();
  await auditChange(req, { action: "module.update", entityType: "module", doc: mod, before, fields: MODULE_AUDIT_FIELDS });
  res.json({ success: true, data: { module: publicModule(mod) } });
};

export const setModuleInstructors = async (req, res) => {
  const mod = await loadModuleFor(req.user, objectId.parse(req.params.id));
  await assertInstructors(req.body.instructors);
  const before = snapshot(mod, MODULE_AUDIT_FIELDS);
  mod.instructors = req.body.instructors;
  await mod.save();
  await auditChange(req, { action: "module.instructors", entityType: "module", doc: mod, before, fields: MODULE_AUDIT_FIELDS });
  await mod.populate("instructors", "userName");
  res.json({ success: true, data: { module: publicModule(mod) } });
};

// Modules are archived, never hard-deleted. Archived modules keep their position.
const setStatus = (action, allowed, to, errCode, errMsg) => async (req, res) => {
  const mod = await loadModuleFor(req.user, objectId.parse(req.params.id));
  if (!allowed(mod.status)) throw conflict(errMsg, errCode);
  const before = snapshot(mod, MODULE_AUDIT_FIELDS);
  mod.status = to;
  await mod.save();
  await auditChange(req, { action, entityType: "module", doc: mod, before, fields: MODULE_AUDIT_FIELDS });
  res.json({ success: true, data: { module: publicModule(mod) } });
};

export const archiveModule = setStatus("module.archive", (s) => s !== "archived", "archived", "ALREADY_ARCHIVED", "Module is already archived");
export const restoreModule = setStatus("module.restore", (s) => s === "archived", "draft", "NOT_ARCHIVED", "Module is not archived");

// Body must list every module of the course exactly once, in the desired order.
export const reorderModules = async (req, res) => {
  const course = await loadCourseFor(req.user, req.params.id);
  const { moduleIds } = req.body;
  const existing = await Module.find({ course: course._id }).select("_id");
  const have = new Set(existing.map((m) => String(m._id)));
  const sent = new Set(moduleIds);
  if (sent.size !== moduleIds.length || sent.size !== have.size || [...sent].some((id) => !have.has(id))) {
    throw badRequest("moduleIds must contain every module of this course exactly once", "INVALID_ORDER");
  }
  const before = Object.fromEntries((await Module.find({ course: course._id }).select("order")).map((m) => [String(m._id), m.order]));
  await Module.bulkWrite(
    moduleIds.map((id, i) => ({ updateOne: { filter: { _id: id }, update: { order: i + 1 } } })),
  );
  await recordAudit(req, {
    action: "course.reorder-modules",
    entityType: "course",
    entityId: course._id,
    changes: [{ field: "moduleOrder", from: Object.keys(before).sort((a, b) => before[a] - before[b]), to: moduleIds }],
  });
  const modules = await Module.find({ course: course._id }).sort({ order: 1 }).populate("instructors", "userName");
  res.json({ success: true, data: { modules: modules.map(publicModule) } });
};
