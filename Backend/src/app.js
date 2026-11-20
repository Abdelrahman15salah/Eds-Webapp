import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import mongoose from "mongoose";
import swaggerUi from "swagger-ui-express";
import { openapi } from "./docs/openapi.js";
import { config } from "./config/env.js";
import authRoutes from "./routes/auth.routes.js";
import userRoutes from "./routes/user.routes.js";
import courseRoutes from "./routes/course.routes.js";
import auditRoutes from "./routes/audit.routes.js";
import moduleRoutes from "./routes/module.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import analyticsRoutes from "./routes/analytics.routes.js";
import { trafficMiddleware } from "./services/traffic.service.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";

export const createApp = () => {
  const app = express();

  // Needed for correct req.ip (rate limiting) behind a reverse proxy.
  if (config.trustProxy) app.set("trust proxy", config.trustProxy);

  // Log method, path (NOT the query string: OAuth callbacks carry codes), status, time.
  morgan.token("safe-url", (req) => req.originalUrl.split("?")[0]);
  if (!config.isTest) {
    app.use(morgan(":method :safe-url :status :res[content-length] - :response-time ms"));
  }

  // API docs are mounted before helmet (Swagger UI needs inline scripts); off in production unless ENABLE_DOCS=true.
  if (!config.isProd || process.env.ENABLE_DOCS === "true") {
    app.get("/docs.json", (req, res) => res.json(openapi));
    app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapi));
  }

  app.use(trafficMiddleware);
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => {
        // Non-browser clients send no Origin header.
        if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
        return cb(null, false);
      },
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
    }),
  );
  app.use(express.json({ limit: "10kb" }));
  app.use(cookieParser());

  app.get("/", (req, res) => {
    res.json({ message: "Express server running with ES Modul-es" });
  });

  app.get("/health", (req, res) => {
    const dbUp = mongoose.connection.readyState === 1;
    res.status(dbUp ? 200 : 503).json({
      status: dbUp ? "ok" : "degraded",
      db: dbUp ? "up" : "down",
      uptime: Math.round(process.uptime()),
    });
  });

  app.use("/auth", authRoutes);
  app.use("/users", userRoutes);
  app.use("/courses", courseRoutes);
  app.use("/audit-logs", auditRoutes);
  app.use("/modules", moduleRoutes);
  app.use("/admin", adminRoutes);
  app.use("/analytics", analyticsRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
};
