// Central, validated access to environment configuration.
// Values are read lazily so tests can set process.env before first use.
const required = (name, minLength = 1) => {
  const value = process.env[name];
  if (!value || value.length < minLength) {
    throw new Error(
      `Missing or too short environment variable: ${name}` +
        (minLength > 1 ? ` (min ${minLength} chars)` : ""),
    );
  }
  return value;
};

const list = (name) =>
  (process.env[name] || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export const config = {
  get isProd() {
    return process.env.NODE_ENV === "production";
  },
  get isTest() {
    return process.env.NODE_ENV === "test";
  },
  jwt: {
    get accessSecret() {
      return required("ACCESS_TOKEN_SECRET", 32);
    },
    get refreshSecret() {
      const s = required("REFRESH_TOKEN_SECRET", 32);
      if (s === process.env.ACCESS_TOKEN_SECRET) {
        throw new Error("REFRESH_TOKEN_SECRET must differ from ACCESS_TOKEN_SECRET");
      }
      return s;
    },
    get issuer() {
      return process.env.JWT_ISSUER || "eds-backend";
    },
    get audience() {
      return process.env.JWT_AUDIENCE || "eds-client";
    },
    get accessTtlSeconds() {
      return Number(process.env.ACCESS_TOKEN_TTL_SECONDS) || 15 * 60;
    },
    get refreshTtlSeconds() {
      return (Number(process.env.REFRESH_TOKEN_TTL_DAYS) || 7) * 24 * 60 * 60;
    },
  },
  cookies: {
    get sameSite() {
      return process.env.COOKIE_SAMESITE || "lax"; // lax | strict | none
    },
    get domain() {
      return process.env.COOKIE_DOMAIN || undefined;
    },
    get secure() {
      // SameSite=None requires Secure; always Secure in production.
      return config.isProd || process.env.COOKIE_SECURE === "true";
    },
  },
  google: {
    get clientId() {
      return required("GOOGLE_CLIENT_ID");
    },
    get clientSecret() {
      return required("GOOGLE_CLIENT_SECRET");
    },
    get redirectUri() {
      return required("GOOGLE_REDIRECT_URI");
    },
  },
  get frontendUrl() {
    return (process.env.FRONTEND_URL || "").replace(/\/+$/, "");
  },
  get corsOrigins() {
    return list("CORS_ORIGINS");
  },
  rateLimit: {
    get loginMax() {
      return Number(process.env.LOGIN_RATE_LIMIT_MAX) || 10;
    },
    get loginWindowMs() {
      return (Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MIN) || 15) * 60 * 1000;
    },
  },
  get trustProxy() {
    return process.env.TRUST_PROXY || false;
  },
};
