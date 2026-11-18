import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { config } from "./config/env.js";
import authRoutes from "./routes/auth.routes.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";

export const createApp = () => {
  const app = express();

  // Needed for correct req.ip (rate limiting) behind a reverse proxy.
  if (config.trustProxy) app.set("trust proxy", config.trustProxy);

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

  app.use("/auth", authRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
};
