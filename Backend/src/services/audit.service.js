import { AuditLog } from "../models/AuditLog.model.js";

export const COURSE_AUDIT_FIELDS = ["title", "description", "category", "price", "status", "slug", "instructors"];
export const MODULE_AUDIT_FIELDS = ["title", "description", "price", "isRequired", "status", "instructors", "order"];

const norm = (v) => {
  if (Array.isArray(v)) return v.map((x) => String(x?._id ?? x));
  if (v === undefined) return null;
  return v;
};

// Plain snapshot of the audited fields (populated users collapse to ids).
export const snapshot = (doc, fields) => Object.fromEntries(fields.map((f) => [f, norm(doc[f])]));

export const diff = (before, after) =>
  Object.keys(after)
    .filter((f) => JSON.stringify(before[f]) !== JSON.stringify(after[f]))
    .map((f) => ({ field: f, from: before[f], to: after[f] }));

export const recordAudit = (req, { action, entityType, entityId, changes = [], meta }) =>
  AuditLog.create({
    actor: req.user._id,
    actorRole: req.user.role,
    action,
    entityType,
    entityId,
    changes,
    meta,
    ip: req.ip,
  });

// Convenience: diff a doc against an earlier snapshot and log it (skips no-op saves).
export const auditChange = async (req, { action, entityType, doc, before, fields, meta }) => {
  const changes = diff(before, snapshot(doc, fields));
  if (!changes.length && !meta) return;
  await recordAudit(req, { action, entityType, entityId: doc._id, changes, meta });
};
