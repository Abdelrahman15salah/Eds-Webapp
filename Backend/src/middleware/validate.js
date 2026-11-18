// Parses req.body with a zod schema and replaces it with the sanitized result
// (unknown fields such as "role" are stripped).
export const validateBody = (schema) => (req, res, next) => {
  req.body = schema.parse(req.body ?? {});
  next();
};
