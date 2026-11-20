import crypto from "node:crypto";
import { config } from "../config/env.js";
import { DailyStat, PathStat, VisitorDay } from "../models/Traffic.model.js";

const TZ = "Africa/Cairo";
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
export const cairoDay = (d = new Date()) => dayFmt.format(d);

// Last `n` Cairo days, oldest first, as "YYYY-MM-DD".
export const lastDays = (n) =>
  Array.from({ length: n }, (_, i) => cairoDay(new Date(Date.now() - (n - 1 - i) * 86_400_000)));

// Since-boot, in-memory counters for the live server panel.
export const live = { startedAt: Date.now(), requests: 0, errors5xx: 0, totalMs: 0 };

const pending = new Set();
const track = (p) => {
  const t = p.catch((e) => console.error("traffic stat failed:", e.message)).finally(() => pending.delete(t));
  pending.add(t);
};
// Waits for in-flight stat writes (used by tests and graceful shutdown).
export const drainTraffic = () => Promise.all([...pending]);

const SKIP = [/^\/health/, /^\/docs/, /^\/admin/, /^\/analytics/];

// Counts every API request: totals, status classes and response time.
export const trafficMiddleware = (req, res, next) => {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const path = req.originalUrl.split("?")[0];
    if (SKIP.some((r) => r.test(path))) return;
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    live.requests += 1;
    live.totalMs += ms;
    if (res.statusCode >= 500) live.errors5xx += 1;
    const cls = res.statusCode >= 500 ? "status5xx" : res.statusCode >= 400 ? "status4xx" : "status2xx";
    track(
      DailyStat.updateOne(
        { day: cairoDay() },
        { $inc: { requests: 1, [cls]: 1, totalMs: Math.round(ms) } },
        { upsert: true },
      ),
    );
  });
  next();
};

const normalisePath = (p) => {
  const clean = String(p).split(/[?#]/)[0].replace(/\/{2,}/g, "/").toLowerCase();
  const trimmed = clean.length > 1 ? clean.replace(/\/$/, "") : clean;
  return trimmed.slice(0, 200);
};

// Frontend reports a page view. Returns whether it was the visitor's first today.
export const recordVisit = async ({ path, ip, userAgent }) => {
  const day = cairoDay();
  const hash = crypto
    .createHmac("sha256", config.jwt.accessSecret)
    .update(`${day}|${ip}|${userAgent ?? ""}`)
    .digest("hex");
  const res = await VisitorDay.updateOne({ day, hash }, { $setOnInsert: { day, hash } }, { upsert: true });
  const isNew = res.upsertedCount > 0;
  await DailyStat.updateOne(
    { day },
    { $inc: { pageViews: 1, uniqueVisitors: isNew ? 1 : 0 } },
    { upsert: true },
  );
  await PathStat.updateOne({ day, path: normalisePath(path) }, { $inc: { views: 1 } }, { upsert: true });
  return isNew;
};
