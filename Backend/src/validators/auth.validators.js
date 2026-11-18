import { z } from "zod";

const email = z
  .string({ error: "Email is required" })
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ error: "Please provide a valid email address" }));

// bcrypt only uses the first 72 bytes, so cap the length there.
export const newPassword = z
  .string({ error: "Password is required" })
  .min(8, "Password must be at least 8 characters")
  .refine((v) => Buffer.byteLength(v) <= 72, "Password must be at most 72 bytes")
  .refine(
    (v) => /[A-Za-z]/.test(v) && /\d/.test(v),
    "Password must contain a letter and a number",
  );

export const registerSchema = z.object({
  name: z
    .string({ error: "Name is required" })
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(60, "Name cannot exceed 60 characters"),
  email,
  password: newPassword,
});

export const loginSchema = z.object({
  email,
  password: z.string({ error: "Password is required" }).min(1).max(1024),
});

export const phoneNumber = z
  .string()
  .trim()
  .regex(/^\+?[1-9]\d{1,14}$/, "Please provide a valid phone number");

export const name = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters")
  .max(60, "Name cannot exceed 60 characters");

// Self-service profile update. Role / isActive are intentionally not accepted here.
export const updateMeSchema = z
  .object({ name: name.optional(), phoneNumber: phoneNumber.nullable().optional() })
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field to update");

export const changePasswordSchema = z
  .object({
    currentPassword: z.string({ error: "Current password is required" }).min(1).max(1024),
    newPassword,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: "New password must be different from the current one",
    path: ["newPassword"],
  });
