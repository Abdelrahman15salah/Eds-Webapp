import { Router } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { trackVisit } from "../controllers/admin.controller.js";
import { AppError } from "../utils/AppError.js";

const router = Router();

const visitLimiter = rateLimit({
  windowMs: 60_000,
  limit: () => Number(process.env.VISIT_RATE_LIMIT_MAX) || 60,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  handler: (req, res, next) => next(new AppError(429, "RATE_LIMITED", "Too many requests")),
});

router.post("/visit", visitLimiter, trackVisit);
export default router;
