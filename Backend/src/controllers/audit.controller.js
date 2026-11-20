import { z } from "zod";
import { AuditLog } from "../models/AuditLog.model.js";
import { objectId } from "../validators/user.validators.js";

const listAuditQuery = z.object({
  entityType: z.enum(["course", "module"]).optional(),
  entityId: objectId.optional(),
  actor: objectId.optional(),
  action: z.string().trim().min(1).max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const listAuditLogs = async (req, res) => {
  const { page, limit, ...filter } = listAuditQuery.parse(req.query);
  const [logs, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("actor", "userName"),
    AuditLog.countDocuments(filter),
  ]);
  res.json({
    success: true,
    data: {
      logs: logs.map((l) => ({
        id: String(l._id),
        action: l.action,
        entityType: l.entityType,
        entityId: String(l.entityId),
        actor: { id: String(l.actor?._id ?? l.actor), name: l.actor?.userName ?? null, role: l.actorRole },
        changes: l.changes,
        meta: l.meta ?? null,
        createdAt: l.createdAt,
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    },
  });
};
