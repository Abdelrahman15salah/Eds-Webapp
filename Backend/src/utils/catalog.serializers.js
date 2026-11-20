// Instructors are exposed by id + name only (never email/phone) to every viewer.
const person = (u) =>
  u && u.userName !== undefined
    ? { id: String(u._id), name: u.userName }
    : { id: String(u?._id ?? u) };

export const publicModule = (m) => ({
  id: String(m._id),
  courseId: String(m.course?._id ?? m.course),
  title: m.title,
  description: m.description,
  price: m.price,
  order: m.order,
  isRequired: m.isRequired,
  status: m.status,
  instructors: (m.instructors ?? []).map(person),
  createdAt: m.createdAt,
  updatedAt: m.updatedAt,
});

export const publicCourse = (c, modules) => ({
  id: String(c._id),
  slug: c.slug ?? null,
  title: c.title,
  description: c.description,
  category: c.category ?? null,
  price: c.price,
  status: c.status,
  instructors: (c.instructors ?? []).map(person),
  ...(modules ? { modules: modules.map(publicModule) } : {}),
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});
