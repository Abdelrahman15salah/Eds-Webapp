import { Router } from "express";
import * as modules from "../controllers/module.controller.js";
import { authenticate, csrfProtect, requireRole } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { setInstructorsSchema, updateModuleSchema } from "../validators/course.validators.js";

const router = Router();

router.use(csrfProtect, authenticate);

router.get("/:id", modules.getModule);
// SuperAdmin: any field. Instructor: title/description of modules they are assigned to (checked in controller).
router.patch(
  "/:id",
  requireRole("SuperAdmin", "Instructor"),
  validateBody(updateModuleSchema),
  modules.updateModule,
);
router.put("/:id/instructors", requireRole("SuperAdmin"), validateBody(setInstructorsSchema), modules.setModuleInstructors);
router.delete("/:id", requireRole("SuperAdmin"), modules.deleteModule);

export default router;
