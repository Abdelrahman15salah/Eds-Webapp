import { Router } from "express";
import * as auth from "../controllers/auth.controller.js";
import { authenticate, csrfProtect } from "../middleware/auth.js";
import { authLimiter, loginAccountLimiter, loginIpLimiter } from "../middleware/rateLimit.js";
import { validateBody } from "../middleware/validate.js";
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  updateMeSchema,
} from "../validators/auth.validators.js";

const router = Router();

router.use(authLimiter);

router.post("/register", validateBody(registerSchema), auth.register);
router.post(
  "/login",
  validateBody(loginSchema),
  loginIpLimiter,
  loginAccountLimiter,
  auth.login,
);
router.post("/refresh", csrfProtect, auth.refresh);
router.post("/logout", csrfProtect, auth.logout);
router.get("/me", authenticate, auth.me);
router.patch("/me", csrfProtect, authenticate, validateBody(updateMeSchema), auth.updateMe);
router.post("/logout-all", csrfProtect, authenticate, auth.logoutAll);
router.post(
  "/change-password",
  csrfProtect,
  authenticate,
  loginIpLimiter,
  validateBody(changePasswordSchema),
  auth.changePassword,
);

router.get("/google", auth.googleStart);
router.get("/google/callback", auth.googleCallback);

export default router;
