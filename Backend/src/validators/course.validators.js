import { z } from "zod";
import { objectId } from "./user.validators.js";
import { SLUG_RE } from "../utils/slug.js";

// Integer piasters: 100 = 1 EGP.
const price = z
  .number({ error: "Price must be a number (piasters)" })
  .int("Price must be an integer number of piasters")
  .min(0)
  .max(100_000_000);

const title = z.string().trim().min(3, "Title must be at least 3 characters").max(120);
const description = z.string().trim().max(5000);
const idList = z
  .array(objectId)
  .max(20)
  .refine((a) => new Set(a).size === a.length, "Duplicate ids");

const atLeastOne = (v) => Object.keys(v).length > 0;

const slug = z.string().trim().toLowerCase().max(90).regex(SLUG_RE, "Slug may contain lowercase letters, digits and single hyphens");

export const createCourseSchema = z.object({
  title,
  slug: slug.optional(),
  description: description.optional(),
  category: z.string().trim().min(1).max(60).optional(),
  price,
  instructors: idList.optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
});

export const updateCourseSchema = z
  .object({
    title: title.optional(),
    slug: slug.optional(),
    description: description.optional(),
    category: z.string().trim().min(1).max(60).nullable().optional(),
    price: price.optional(),
    status: z.enum(["draft", "published", "archived"]).optional(),
  })
  .refine(atLeastOne, "Provide at least one field to update");

export const setInstructorsSchema = z.object({ instructors: idList });

export const createModuleSchema = z.object({
  title,
  description: description.optional(),
  price,
  isRequired: z.boolean().optional(),
  instructors: idList.optional(),
  status: z.enum(["draft", "published"]).optional(),
});

// Full update (SuperAdmin). Instructors are limited to MODULE_INSTRUCTOR_FIELDS.
export const updateModuleSchema = z
  .object({
    title: title.optional(),
    description: description.optional(),
    price: price.optional(),
    isRequired: z.boolean().optional(),
    status: z.enum(["draft", "published"]).optional(),
  })
  .refine(atLeastOne, "Provide at least one field to update");

export const MODULE_INSTRUCTOR_FIELDS = ["title", "description"];

export const reorderModulesSchema = z.object({ moduleIds: z.array(objectId).min(1).max(200) });

export const listCoursesQuery = z.object({
  status: z.enum(["draft", "published", "archived"]).optional(),
  category: z.string().trim().min(1).max(60).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(["createdAt", "-createdAt", "title", "-title", "price", "-price"]).default("-createdAt"),
});
