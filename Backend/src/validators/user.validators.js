import { z } from "zod";

export const ROLES = ["Student", "Instructor", "SuperAdmin", "Lab"];

// ?role=Student or ?role=Student,Instructor
const roles = z
  .string()
  .transform((v) =>
    v
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.enum(ROLES)).min(1).max(ROLES.length));

export const listUsersQuery = z.object({
  role: roles.optional(),
  isActive: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  search: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z
    .enum(["createdAt", "-createdAt", "userName", "-userName"])
    .default("-createdAt"),
});

import { name, phoneNumber } from "./auth.validators.js";

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

// Admin update: role, activation and profile fields.
export const adminUpdateUserSchema = z
  .object({
    role: z.enum(ROLES).optional(),
    isActive: z.boolean().optional(),
    name: name.optional(),
    phoneNumber: phoneNumber.nullable().optional(),
  })
  .refine(
    (v) => Object.keys(v).length > 0,
    "Provide at least one field to update",
  );
