import { Module } from "../models/Module.model.js";
import { badRequest, forbidden } from "../utils/AppError.js";
import { publicModule } from "../utils/catalog.serializers.js";
import {
  assertCanManageModule,
  assertInstructors,
  compactModuleOrder,
  isAdmin,
  isStaff,
  loadCourseFor,
  loadModuleFor,
} from "../services/catalog.service.js";
import { objectId } from "../validators/user.validators.js";
import { MODULE_INSTRUCTOR_FIELDS } from "../validators/course.validators.js";

export const listModules = async (req, res) => {
  const course = await loadCourseFor(req.user, objectId.parse(req.params.id));
  const filter = { course: course._id };
  if (!isStaff(req.user)) filter.status = "published";
  const modules = await Module.find(filter).sort({ order: 1 }).populate("instructors", "userName");
  res.json({ success: true, data: { modules: modules.map(publicModule) } });
};

export const createModule = async (req, res) => {
  const course = await loadCourseFor(req.user, objectId.parse(req.params.id));
  await assertInstructors(req.body.instructors);
  const last = await Module.findOne({ course: course._id }).sort({ order: -1 }).select("order");
  const mod = await Module.create({
    ...req.body,
    course: course._id,
    order: (last?.order ?? 0) + 1,
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
  Object.assign(mod, req.body);
  await mod.save();
  res.json({ success: true, data: { module: publicModule(mod) } });
};

export const setModuleInstructors = async (req, res) => {
  const mod = await loadModuleFor(req.user, objectId.parse(req.params.id));
  await assertInstructors(req.body.instructors);
  mod.instructors = req.body.instructors;
  await mod.save();
  await mod.populate("instructors", "userName");
  res.json({ success: true, data: { module: publicModule(mod) } });
};

// Stage 2 adds a guard here that blocks deletion when enrollments exist.
export const deleteModule = async (req, res) => {
  const mod = await loadModuleFor(req.user, objectId.parse(req.params.id));
  await mod.deleteOne();
  await compactModuleOrder(mod.course);
  res.json({ success: true, data: { message: "Module deleted" } });
};

// Body must list every module of the course exactly once, in the desired order.
export const reorderModules = async (req, res) => {
  const course = await loadCourseFor(req.user, objectId.parse(req.params.id));
  const { moduleIds } = req.body;
  const existing = await Module.find({ course: course._id }).select("_id");
  const have = new Set(existing.map((m) => String(m._id)));
  const sent = new Set(moduleIds);
  if (sent.size !== moduleIds.length || sent.size !== have.size || [...sent].some((id) => !have.has(id))) {
    throw badRequest("moduleIds must contain every module of this course exactly once", "INVALID_ORDER");
  }
  await Module.bulkWrite(
    moduleIds.map((id, i) => ({ updateOne: { filter: { _id: id }, update: { order: i + 1 } } })),
  );
  const modules = await Module.find({ course: course._id }).sort({ order: 1 }).populate("instructors", "userName");
  res.json({ success: true, data: { modules: modules.map(publicModule) } });
};
