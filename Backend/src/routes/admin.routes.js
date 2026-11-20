import { Router } from "express";
import * as admin from "../controllers/admin.controller.js";
import { authenticate, csrfProtect, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(csrfProtect, authenticate, requireRole("SuperAdmin"));

router.get("/dashboard", admin.dashboard); // everything in one call
router.get("/server", admin.server); // live server health, cheap to poll
router.get("/traffic", admin.traffic); // ?days=1..90

export default router;
