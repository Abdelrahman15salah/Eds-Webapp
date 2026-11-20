import os from "node:os";
import mongoose from "mongoose";
import { User } from "../models/User.model.js";
import { Course } from "../models/Course.model.js";
import { Module } from "../models/Module.model.js";
import { RefreshToken } from "../models/RefreshToken.model.js";
import { AuditLog } from "../models/AuditLog.model.js";
import { DailyStat, PathStat } from "../models/Traffic.model.js";
import { cairoDay, lastDays, live } from "./traffic.service.js";

const TZ = "Africa/Cairo";
const countBy = (rows) => Object.fromEntries(rows.map((r) => [r._id ?? "none", r.count]));
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000);
const mb = (b) => Math.round((b / 1024 / 1024) * 10) / 10;

export const serverInfo = async () => {
  const mem = process.memoryUsage();
  let db = {
    state: ["disconnected", "connected", "connecting", "disconnecting"][mongoose.connection.readyState] ?? "unknown",
  };
  try {
    const s = await mongoose.connection.db.stats();
    db = {
      ...db,
      name: s.db,
      collections: s.collections,
      documents: s.objects,
      dataSizeMB: mb(s.dataSize),
      storageSizeMB: mb(s.storageSize),
      indexes: s.indexes,
    };
  } catch {
    /* stats unavailable */
  }
  return {
    status: db.state === "connected" ? "ok" : "degraded",
    environment: process.env.NODE_ENV ?? "development",
    nodeVersion: process.version,
    platform: `${os.platform()} ${os.arch()}`,
    pid: process.pid,
    startedAt: new Date(live.startedAt),
    uptimeSeconds: Math.round(process.uptime()),
    memory: {
      rssMB: mb(mem.rss),
      heapUsedMB: mb(mem.heapUsed),
      heapTotalMB: mb(mem.heapTotal),
      systemTotalMB: mb(os.totalmem()),
      systemFreeMB: mb(os.freemem()),
    },
    cpu: { cores: os.cpus().length, loadAverage: os.loadavg().map((n) => Math.round(n * 100) / 100) },
    database: db,
    sinceBoot: {
      requests: live.requests,
      serverErrors: live.errors5xx,
      avgResponseMs: live.requests ? Math.round(live.totalMs / live.requests) : 0,
    },
  };
};

export const trafficSummary = async (days = 30) => {
  const range = lastDays(days);
  const [rows, topPaths] = await Promise.all([
    DailyStat.find({ day: { $in: range } }).lean(),
    PathStat.aggregate([
      { $match: { day: { $in: range } } },
      { $group: { _id: "$path", views: { $sum: "$views" } } },
      { $sort: { views: -1 } },
      { $limit: 10 },
    ]),
  ]);
  const byDay = Object.fromEntries(rows.map((r) => [r.day, r]));
  const series = range.map((day) => {
    const r = byDay[day] ?? {};
    return {
      day,
      pageViews: r.pageViews ?? 0,
      uniqueVisitors: r.uniqueVisitors ?? 0,
      requests: r.requests ?? 0,
      errors4xx: r.status4xx ?? 0,
      errors5xx: r.status5xx ?? 0,
      avgResponseMs: r.requests ? Math.round(r.totalMs / r.requests) : 0,
    };
  });
  const sum = (arr, k) => arr.reduce((a, r) => a + r[k], 0);
  const window = (n) => {
    const s = series.slice(-n);
    const requests = sum(s, "requests");
    const errors5xx = sum(s, "errors5xx");
    return {
      pageViews: sum(s, "pageViews"),
      // Sum of daily uniques: a person visiting on 3 days counts 3 times.
      uniqueVisitorDays: sum(s, "uniqueVisitors"),
      requests,
      errors5xx,
      errorRatePct: requests ? Math.round((errors5xx / requests) * 10000) / 100 : 0,
    };
  };
  return {
    timezone: TZ,
    today: window(1),
    last7Days: window(Math.min(7, days)),
    last30Days: window(Math.min(30, days)),
    topPages: topPaths.map((p) => ({ path: p._id, views: p.views })),
    daily: series,
  };
};

export const usersSummary = async () => {
  const since30 = daysAgo(30);
  const [total, byRole, active, new7, new30, signups, sessions] = await Promise.all([
    User.countDocuments(),
    User.aggregate([{ $group: { _id: "$role", count: { $sum: 1 } } }]),
    User.countDocuments({ isActive: true }),
    User.countDocuments({ createdAt: { $gte: daysAgo(7) } }),
    User.countDocuments({ createdAt: { $gte: since30 } }),
    User.aggregate([
      { $match: { createdAt: { $gte: since30 } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: TZ } },
          count: { $sum: 1 },
        },
      },
    ]),
    RefreshToken.countDocuments({ revokedAt: null, expiresAt: { $gt: new Date() } }),
  ]);
  const sg = Object.fromEntries(signups.map((s) => [s._id, s.count]));
  return {
    total,
    active,
    inactive: total - active,
    byRole: { Student: 0, Instructor: 0, SuperAdmin: 0, Lab: 0, ...countBy(byRole) },
    newLast7Days: new7,
    newLast30Days: new30,
    activeSessions: sessions,
    signupsPerDay: lastDays(30).map((day) => ({ day, count: sg[day] ?? 0 })),
  };
};

export const catalogSummary = async () => {
  const [cs, ms, cats, optional, noInstructors] = await Promise.all([
    Course.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Module.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Course.aggregate([{ $group: { _id: "$category", count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    Module.countDocuments({ isRequired: false }),
    Course.countDocuments({ status: "published", instructors: { $size: 0 } }),
  ]);
  const courses = { draft: 0, published: 0, archived: 0, ...countBy(cs) };
  const modules = { draft: 0, published: 0, archived: 0, ...countBy(ms) };
  const total = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  return {
    courses: { total: total(courses), ...courses },
    modules: { total: total(modules), ...modules, optional },
    byCategory: cats.map((c) => ({ category: c._id ?? "Uncategorised", courses: c.count })),
    publishedWithoutInstructors: noInstructors,
  };
};

export const recentActivity = async (limit = 10) => {
  const logs = await AuditLog.find().sort({ createdAt: -1, _id: -1 }).limit(limit).populate("actor", "userName");
  return logs.map((l) => ({
    id: String(l._id),
    action: l.action,
    entityType: l.entityType,
    entityId: String(l.entityId),
    actor: { id: String(l.actor?._id ?? l.actor), name: l.actor?.userName ?? null, role: l.actorRole },
    createdAt: l.createdAt,
  }));
};

export const fullDashboard = async (days = 30) => {
  const [server, traffic, users, catalog, activity] = await Promise.all([
    serverInfo(),
    trafficSummary(days),
    usersSummary(),
    catalogSummary(),
    recentActivity(),
  ]);
  return { generatedAt: new Date(), today: cairoDay(), server, traffic, users, catalog, recentActivity: activity };
};
