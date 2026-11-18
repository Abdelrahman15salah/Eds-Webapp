const ok = (desc, data) => ({
  description: desc,
  content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data } } } },
});
const err = { description: "Error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };
const body = (properties, required = Object.keys(properties)) => ({
  required: true,
  content: { "application/json": { schema: { type: "object", required, properties } } },
});
const str = { type: "string" };
const userRef = { type: "object", properties: { user: { $ref: "#/components/schemas/User" } } };
const csrf = [{ cookieAuth: [] }];
const idParam = { name: "id", in: "path", required: true, schema: str };

export const openapi = {
  openapi: "3.0.3",
  info: { title: "EDS Backend API", version: "1.0.0" },
  components: {
    securitySchemes: {
      cookieAuth: { type: "apiKey", in: "cookie", name: "access_token" },
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          success: { type: "boolean", example: false },
          error: { type: "object", properties: { code: str, message: str, details: { type: "array", items: { type: "object" } } } },
        },
      },
      User: {
        type: "object",
        properties: {
          id: str, name: str, email: str,
          role: { type: "string", enum: ["Student", "Instructor", "SuperAdmin", "Lab"] },
          phoneNumber: { type: "string", nullable: true },
          isActive: { type: "boolean" },
          authProviders: { type: "array", items: str },
          emailVerified: { type: "boolean" },
          createdAt: str, updatedAt: str,
        },
      },
    },
  },
  paths: {
    "/health": { get: { tags: ["System"], summary: "Liveness + database status", responses: { 200: { description: "OK" }, 503: { description: "Database down" } } } },
    "/auth/register": { post: { tags: ["Auth"], summary: "Register", requestBody: body({ name: str, email: str, password: str }), responses: { 201: ok("Created", userRef), 400: err, 409: err } } },
    "/auth/login": { post: { tags: ["Auth"], summary: "Login (sets cookies)", requestBody: body({ email: str, password: str }), responses: { 200: ok("OK", userRef), 401: err, 429: err } } },
    "/auth/refresh": { post: { tags: ["Auth"], summary: "Rotate refresh token (needs X-CSRF-Token)", responses: { 200: ok("OK", userRef), 401: err, 403: err } } },
    "/auth/logout": { post: { tags: ["Auth"], summary: "Log out this session", responses: { 200: { description: "OK" } } } },
    "/auth/logout-all": { post: { tags: ["Auth"], summary: "Log out every session", security: csrf, responses: { 200: { description: "OK" }, 401: err } } },
    "/auth/me": {
      get: { tags: ["Auth"], summary: "Current user", security: csrf, responses: { 200: ok("OK", userRef), 401: err } },
      patch: { tags: ["Auth"], summary: "Update own name / phone", security: csrf, requestBody: body({ name: str, phoneNumber: { type: "string", nullable: true } }, []), responses: { 200: ok("OK", userRef), 400: err, 401: err } },
    },
    "/auth/change-password": { post: { tags: ["Auth"], summary: "Change password; signs out other sessions", security: csrf, requestBody: body({ currentPassword: str, newPassword: str }), responses: { 200: { description: "OK" }, 400: err, 403: err } } },
    "/auth/google": { get: { tags: ["Auth"], summary: "Start Google sign-in (redirect)", responses: { 302: { description: "Redirect to Google" } } } },
    "/auth/google/callback": { get: { tags: ["Auth"], summary: "Google OAuth callback", responses: { 200: { description: "Signed in" }, 302: { description: "Redirect to frontend" }, 400: err, 409: err } } },
    "/users": { get: { tags: ["Users (SuperAdmin)"], summary: "List users", security: csrf, parameters: [
      { name: "role", in: "query", schema: str, description: "Comma separated roles" },
      { name: "isActive", in: "query", schema: { type: "boolean" } },
      { name: "search", in: "query", schema: str },
      { name: "page", in: "query", schema: { type: "integer" } },
      { name: "limit", in: "query", schema: { type: "integer" } },
      { name: "sort", in: "query", schema: str },
    ], responses: { 200: { description: "OK" }, 403: err } } },
    "/users/{id}": {
      get: { tags: ["Users (SuperAdmin)"], summary: "Get user", security: csrf, parameters: [idParam], responses: { 200: ok("OK", userRef), 404: err } },
      patch: { tags: ["Users (SuperAdmin)"], summary: "Update role / active status / profile", security: csrf, parameters: [idParam], requestBody: body({ role: str, isActive: { type: "boolean" }, name: str, phoneNumber: { type: "string", nullable: true } }, []), responses: { 200: ok("OK", userRef), 403: err, 404: err } },
      delete: { tags: ["Users (SuperAdmin)"], summary: "Permanently delete user", security: csrf, parameters: [idParam], responses: { 200: { description: "Deleted" }, 403: err, 404: err } },
    },
  },
};
