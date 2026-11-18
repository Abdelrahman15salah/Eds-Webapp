import { Router } from "express";
import * as users from "../controllers/user.controller.js";
import { authenticate, csrfProtect, requireRole } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { adminUpdateUserSchema } from "../validators/user.validators.js";

const router = Router();

// Everything here is SuperAdmin-only.
router.use(csrfProtect, authenticate, requireRole("SuperAdmin"));

router.get("/", users.listUsers);
router.get("/:id", users.getUser);
router.patch("/:id", validateBody(adminUpdateUserSchema), users.updateUser);
router.delete("/:id", users.deleteUser);

export default router;
