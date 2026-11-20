import { z } from "zod";
import { fullDashboard, serverInfo, trafficSummary } from "../services/dashboard.service.js";
import { recordVisit } from "../services/traffic.service.js";

const daysQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(30) });

const wrap = (fn) => async (req, res) => res.json({ success: true, data: await fn(req) });

export const dashboard = wrap((req) => fullDashboard(daysQuery.parse(req.query).days));
export const server = wrap(() => serverInfo());
export const traffic = wrap((req) => trafficSummary(daysQuery.parse(req.query).days));

const visitBody = z.object({ path: z.string().trim().min(1).max(200).startsWith("/") });

// Public: the frontend calls this once per page view. Stores no raw IP.
export const trackVisit = async (req, res) => {
  const { path } = visitBody.parse(req.body);
  await recordVisit({ path, ip: req.ip, userAgent: req.get("user-agent") });
  res.status(202).json({ success: true, data: { recorded: true } });
};
