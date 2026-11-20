import { Router } from "express";
import * as courses from "../controllers/course.controller.js";
import * as modules from "../controllers/module.controller.js";
import { authenticate, csrfProtect, requireRole } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import {
  createCourseSchema,
  createModuleSchema,
  reorderModulesSchema,
  setInstructorsSchema,
  updateCourseSchema,
} from "../validators/course.validators.js";

const router = Router();
const admin = requireRole("SuperAdmin");

router.use(csrfProtect, authenticate);

// Any signed-in user may browse; students only see published content.
router.get("/", courses.listCourses);
router.get("/:id", courses.getCourse);
router.get("/:id/modules", modules.listModules);

// SuperAdmin-only content management.
router.post("/", admin, validateBody(createCourseSchema), courses.createCourse);
router.patch("/:id", admin, validateBody(updateCourseSchema), courses.updateCourse);
router.post("/:id/archive", admin, courses.archiveCourse);
router.post("/:id/restore", admin, courses.restoreCourse);
router.put("/:id/instructors", admin, validateBody(setInstructorsSchema), courses.setCourseInstructors);
router.post("/:id/modules", admin, validateBody(createModuleSchema), modules.createModule);
router.put("/:id/modules/order", admin, validateBody(reorderModulesSchema), modules.reorderModules);

export default router;
