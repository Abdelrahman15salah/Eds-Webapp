import { Router } from "express";
import { listAuditLogs } from "../controllers/audit.controller.js";
import { authenticate, csrfProtect, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(csrfProtect, authenticate, requireRole("SuperAdmin"));
router.get("/", listAuditLogs);
export default router;
