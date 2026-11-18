import { z } from "zod";

const email = z
  .string({ error: "Email is required" })
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ error: "Please provide a valid email address" }));

// bcrypt only uses the first 72 bytes, so cap the length there.
const newPassword = z
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
