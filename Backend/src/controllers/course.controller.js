import { Course } from "../models/Course.model.js";
import { Module } from "../models/Module.model.js";
import { escapeRegex } from "../utils/regex.js";
import { publicCourse } from "../utils/catalog.serializers.js";
import { assertInstructors, isStaff, loadCourseFor } from "../services/catalog.service.js";
import { objectId } from "../validators/user.validators.js";
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
  const course = await Course.create({ ...req.body, createdBy: req.user._id });
  await course.populate("instructors", "userName");
  res.status(201).json({ success: true, data: { course: publicCourse(course, []) } });
};

export const getCourse = async (req, res) => {
  const course = await loadCourseFor(req.user, objectId.parse(req.params.id));
  const modFilter = { course: course._id };
  if (!isStaff(req.user)) modFilter.status = "published";
  const modules = await Module.find(modFilter).sort({ order: 1 }).populate("instructors", "userName");
  res.json({ success: true, data: { course: publicCourse(course, modules) } });
};

export const updateCourse = async (req, res) => {
  const course = await loadCourseFor(req.user, objectId.parse(req.params.id));
  const { category, ...rest } = req.body;
  Object.assign(course, rest);
  if (category !== undefined) course.category = category ?? undefined;
  await course.save();
  res.json({ success: true, data: { course: publicCourse(course) } });
};

export const setCourseInstructors = async (req, res) => {
  const course = await loadCourseFor(req.user, objectId.parse(req.params.id));
  await assertInstructors(req.body.instructors);
  course.instructors = req.body.instructors;
  await course.save();
  await course.populate("instructors", "userName");
  res.json({ success: true, data: { course: publicCourse(course) } });
};

// Stage 2 adds a guard here that blocks deletion when enrollments exist.
export const deleteCourse = async (req, res) => {
  const course = await loadCourseFor(req.user, objectId.parse(req.params.id));
  await Module.deleteMany({ course: course._id });
  await course.deleteOne();
  res.json({ success: true, data: { message: "Course deleted" } });
};
