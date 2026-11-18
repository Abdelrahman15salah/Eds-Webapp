# Authentication

Cookie-based JWT auth (access + rotating refresh) with Google sign-in. Responses: `{ "success": true, "data": … }` or `{ "success": false, "error": { "code", "message", "details?" } }`.

## Flow

1. `POST /auth/login` (or Google callback) sets three cookies:
   - `access_token` – JWT, 15 min, HttpOnly, path `/`
   - `refresh_token` – JWT, 7 days, HttpOnly, path `/auth` only
   - `csrf_token` – random value, readable by JS
2. Browser calls private routes with `credentials: "include"`. Access tokens are verified (HS256, issuer, audience, `typ`) and the user is re-loaded from the DB on every request.
3. On `401 TOKEN_EXPIRED`, call `POST /auth/refresh` with header `X-CSRF-Token: <csrf_token cookie>`. The old refresh token is consumed and a new one issued (rotation).
4. Presenting an already-used refresh token → `401 REFRESH_TOKEN_REUSED` and the **whole token family is revoked** (user must log in again).
5. `POST /auth/logout` (also needs `X-CSRF-Token`) revokes the session and clears cookies.

Refresh tokens are stored only as SHA-256 hashes (`RefreshToken` collection, TTL-indexed). Non-browser clients may send `Authorization: Bearer <access>`.

## Google flow

`GET /auth/google` → 302 to Google (authorization code + PKCE S256 + state + nonce; verifier/state/nonce live in a 10-min signed HttpOnly `oauth_tx` cookie) → `GET /auth/google/callback` validates state, exchanges the code, verifies the ID token (audience + nonce), requires `email_verified`, then:

- Google ID already linked → sign in.
- Unknown → create a Google-only user (no password).
- Email belongs to an existing password account → `409 ACCOUNT_EXISTS` (never auto-linked).

Google's tokens are discarded after login; nothing from Google is stored besides the account ID (`sub`). If `FRONTEND_URL` is set the callback redirects (`/` on success, `/login?auth_error=<CODE>` on failure); otherwise it returns JSON.

## Google Cloud setup

1. https://console.cloud.google.com → create/select a project.
2. **APIs & Services → OAuth consent screen**: choose External, fill app name/support email, add scopes `openid`, `email`, `profile`; add yourself as a test user while in Testing mode.
3. **Credentials → Create credentials → OAuth client ID → Web application**.
4. **Authorized redirect URIs**: add exactly your `GOOGLE_REDIRECT_URI` (dev: `http://localhost:5000/auth/google/callback`; prod: `https://api.yourdomain.com/auth/google/callback`).
5. Copy the client ID and secret into `.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`).

## Environment variables

See `.env.example`. Required: `MONGODB_URI`, `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET` (different, ≥32 chars), `GOOGLE_*` (only for Google routes). Set later when the frontend is known: `FRONTEND_URL`, `CORS_ORIGINS`, `COOKIE_SAMESITE` (`none` + HTTPS if the frontend is on another site), `COOKIE_DOMAIN`.

## Example requests

```bash
# Register
curl -X POST localhost:5000/auth/register -H 'Content-Type: application/json' \
  -d '{"name":"Ada Lovelace","email":"ada@example.com","password":"Sup3rSecret"}'
# 201 {"success":true,"data":{"user":{"id":"…","name":"Ada Lovelace","email":"ada@example.com","role":"Student","authProviders":["local"],"emailVerified":false,"createdAt":"…"}}}
# 409 {"success":false,"error":{"code":"EMAIL_TAKEN","message":"An account with this email already exists"}}
# 400 {"success":false,"error":{"code":"VALIDATION_ERROR","message":"Invalid input","details":[{"field":"password","message":"Password must be at least 8 characters"}]}}

# Login (cookie jar), me, refresh, logout
curl -c jar.txt -X POST localhost:5000/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","password":"Sup3rSecret"}'
curl -b jar.txt localhost:5000/auth/me
CSRF=$(grep csrf_token jar.txt | awk '{print $7}')
curl -b jar.txt -c jar.txt -X POST localhost:5000/auth/refresh -H "X-CSRF-Token: $CSRF"
curl -b jar.txt -X POST localhost:5000/auth/logout -H "X-CSRF-Token: $CSRF"
# 401 {"success":false,"error":{"code":"INVALID_CREDENTIALS","message":"Invalid email or password"}}
# 429 {"success":false,"error":{"code":"RATE_LIMITED","message":"Too many attempts, please try again later"}}
```

## Tests

`npm test` (Vitest + Supertest + in-memory MongoDB; Google's token exchange is mocked).
