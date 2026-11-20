import { Course } from "../models/Course.model.js";
import { Module } from "../models/Module.model.js";
import { User } from "../models/User.model.js";
import { AppError, badRequest, forbidden } from "../utils/AppError.js";
import { SLUG_RE } from "../utils/slug.js";

export const isAdmin = (user) => user.role === "SuperAdmin";
export const isStaff = (user) => user.role === "SuperAdmin" || user.role === "Instructor";

export const isAssignedToModule = (user, mod) =>
  (mod.instructors ?? []).some((id) => String(id?._id ?? id) === String(user._id));

// Throws 403 unless the user is a SuperAdmin or an instructor assigned to the module.
export const assertCanManageModule = (user, mod) => {
  if (isAdmin(user) || isAssignedToModule(user, mod)) return;
  throw forbidden("You are not assigned to this module", "NOT_ASSIGNED");
};

// Every id must be an active user with the Instructor role.
export const assertInstructors = async (ids) => {
  if (!ids?.length) return;
  const count = await User.countDocuments({ _id: { $in: ids }, role: "Instructor", isActive: true });
  if (count !== ids.length) {
    throw badRequest("All instructors must be active users with the Instructor role", "INVALID_INSTRUCTORS");
  }
};

// Returns `base`, or base-2, base-3... until no other course uses it.
export const uniqueSlug = async (base, excludeId) => {
  let candidate = base;
  for (let n = 2; ; n++) {
    const taken = await Course.exists({ slug: candidate, ...(excludeId ? { _id: { $ne: excludeId } } : {}) });
    if (!taken) return candidate;
    candidate = `${base.slice(0, 85)}-${n}`;
  }
};

// Courses are addressed by ObjectId or slug.
export const loadCourseFor = async (user, idOrSlug) => {
  let query;
  if (/^[a-f\d]{24}$/i.test(idOrSlug)) query = Course.findById(idOrSlug);
  else if (SLUG_RE.test(idOrSlug)) query = Course.findOne({ slug: idOrSlug });
  else throw badRequest("Invalid course id or slug", "VALIDATION_ERROR");
  const course = await query.populate("instructors", "userName");
  if (!course || (!isStaff(user) && course.status !== "published")) {
    throw new AppError(404, "COURSE_NOT_FOUND", "Course not found");
  }
  return course;
};

export const loadModuleFor = async (user, id) => {
  const mod = await Module.findById(id).populate("instructors", "userName");
  if (!mod) throw new AppError(404, "MODULE_NOT_FOUND", "Module not found");
  if (!isStaff(user)) {
    const course = await Course.findById(mod.course).select("status");
    if (mod.status !== "published" || course?.status !== "published") {
      throw new AppError(404, "MODULE_NOT_FOUND", "Module not found");
    }
  }
  return mod;
};

// Re-numbers a course's modules 1..n in their current order.
export const compactModuleOrder = async (courseId) => {
  const mods = await Module.find({ course: courseId }).sort({ order: 1, _id: 1 }).select("_id");
  if (!mods.length) return;
  await Module.bulkWrite(
    mods.map((m, i) => ({ updateOne: { filter: { _id: m._id }, update: { order: i + 1 } } })),
  );
};
