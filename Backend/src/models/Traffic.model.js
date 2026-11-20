import mongoose from "mongoose";

// One document per Africa/Cairo calendar day ("YYYY-MM-DD").
const dailyStatSchema = new mongoose.Schema(
  {
    day: { type: String, required: true, unique: true },
    // API traffic
    requests: { type: Number, default: 0 },
    status2xx: { type: Number, default: 0 },
    status4xx: { type: Number, default: 0 },
    status5xx: { type: Number, default: 0 },
    totalMs: { type: Number, default: 0 },
    // Website traffic reported by the frontend via POST /analytics/visit
    pageViews: { type: Number, default: 0 },
    uniqueVisitors: { type: Number, default: 0 },
  },
  { versionKey: false },
);

// Page views per path per day (paths are capped/normalised before saving).
const pathStatSchema = new mongoose.Schema(
  {
    day: { type: String, required: true },
    path: { type: String, required: true, maxlength: 200 },
    views: { type: Number, default: 0 },
  },
  { versionKey: false },
);
pathStatSchema.index({ day: 1, path: 1 }, { unique: true });

// Anonymous per-day visitor fingerprints (salted hash of ip + user-agent), kept 2 days
// only, so unique visitors can be counted without storing raw IPs.
const visitorDaySchema = new mongoose.Schema(
  {
    day: { type: String, required: true },
    hash: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 48 },
  },
  { versionKey: false },
);
visitorDaySchema.index({ day: 1, hash: 1 }, { unique: true });

export const DailyStat = mongoose.model("DailyStat", dailyStatSchema);
export const PathStat = mongoose.model("PathStat", pathStatSchema);
export const VisitorDay = mongoose.model("VisitorDay", visitorDaySchema);
