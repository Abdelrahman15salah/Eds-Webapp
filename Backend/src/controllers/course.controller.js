import { Course } from "../models/Course.model.js";
import { Module } from "../models/Module.model.js";
import { escapeRegex } from "../utils/regex.js";
import { publicCourse } from "../utils/catalog.serializers.js";
import { assertInstructors, isStaff, loadCourseFor, uniqueSlug } from "../services/catalog.service.js";
import { COURSE_AUDIT_FIELDS, auditChange, recordAudit, snapshot } from "../services/audit.service.js";
import { conflict } from "../utils/AppError.js";
import { slugify } from "../utils/slug.js";
import { listCoursesQuery } from "../validators/course.validators.js";

const sortSpec = (sort) =>
  sort.startsWith("-") ? { [sort.slice(1)]: -1, _id: -1 } : { [sort]: 1, _id: 1 };

export const listCourses = async (req, res) => {
  const { status, category, search, page, limit, sort } = listCoursesQuery.parse(req.query);

  const filter = {};
  // Students only ever see published courses, whatever they ask for.
  if (!isStaff(req.user)) filter.status = "published";
  else if (status) filter.status = status;
  if (category) filter.category = category;
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ title: rx }, { description: rx }];
  }

  const [courses, total] = await Promise.all([
    Course.find(filter)
      .sort(sortSpec(sort))
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("instructors", "userName"),
    Course.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: {
      courses: courses.map((c) => publicCourse(c)),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    },
  });
};

export const createCourse = async (req, res) => {
  await assertInstructors(req.body.instructors);
  let slug = req.body.slug;
  if (slug) {
    if (await Course.exists({ slug })) throw conflict("Slug already in use", "SLUG_TAKEN");
  } else {
    slug = await uniqueSlug(slugify(req.body.title));
  }
  const course = await Course.create({ ...req.body, slug, createdBy: req.user._id });
  await recordAudit(req, {
    action: "course.create",
    entityType: "course",
    entityId: course._id,
    changes: Object.entries(snapshot(course, COURSE_AUDIT_FIELDS)).map(([field, to]) => ({ field, from: null, to })),
  });
  await course.populate("instructors", "userName");
  res.status(201).json({ success: true, data: { course: publicCourse(course, []) } });
};

export const getCourse = async (req, res) => {
  const course = await loadCourseFor(req.user, req.params.id);
  const modFilter = { course: course._id };
  if (!isStaff(req.user)) modFilter.status = "published";
  const modules = await Module.find(modFilter).sort({ order: 1 }).populate("instructors", "userName");
  res.json({ success: true, data: { course: publicCourse(course, modules) } });
};

export const updateCourse = async (req, res) => {
  const course = await loadCourseFor(req.user, req.params.id);
  const before = snapshot(course, COURSE_AUDIT_FIELDS);
  const { category, ...rest } = req.body;
  if (rest.slug && rest.slug !== course.slug && (await Course.exists({ slug: rest.slug, _id: { $ne: course._id } }))) {
    throw conflict("Slug already in use", "SLUG_TAKEN");
  }
  Object.assign(course, rest);
  if (category !== undefined) course.category = category ?? undefined;
  await course.save();
  await auditChange(req, { action: "course.update", entityType: "course", doc: course, before, fields: COURSE_AUDIT_FIELDS });
  res.json({ success: true, data: { course: publicCourse(course) } });
};

export const setCourseInstructors = async (req, res) => {
  const course = await loadCourseFor(req.user, req.params.id);
  await assertInstructors(req.body.instructors);
  const before = snapshot(course, COURSE_AUDIT_FIELDS);
  course.instructors = req.body.instructors;
  await course.save();
  await auditChange(req, { action: "course.instructors", entityType: "course", doc: course, before, fields: COURSE_AUDIT_FIELDS });
  await course.populate("instructors", "userName");
  res.json({ success: true, data: { course: publicCourse(course) } });
};

// Courses are never hard-deleted: archiving hides them from the catalog but keeps
// the data (and, from Stage 2, access for students who already bought it).
const setStatus = (action, from, to, errCode, errMsg) => async (req, res) => {
  const course = await loadCourseFor(req.user, req.params.id);
  if (!from(course.status)) throw conflict(errMsg, errCode);
  const before = snapshot(course, COURSE_AUDIT_FIELDS);
  course.status = to;
  await course.save();
  await auditChange(req, { action, entityType: "course", doc: course, before, fields: COURSE_AUDIT_FIELDS });
  res.json({ success: true, data: { course: publicCourse(course) } });
};

export const archiveCourse = setStatus("course.archive", (s) => s !== "archived", "archived", "ALREADY_ARCHIVED", "Course is already archived");
// Restored courses return as drafts so they must be re-published deliberately.
export const restoreCourse = setStatus("course.restore", (s) => s === "archived", "draft", "NOT_ARCHIVED", "Course is not archived");
