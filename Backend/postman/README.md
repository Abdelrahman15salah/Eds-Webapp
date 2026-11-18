# Postman

Import both files (Postman → Import), then select the **EDS Backend - Local** environment (top-right).

- `EDS-Backend.postman_collection.json` – all endpoints with status-code tests
- `EDS-Backend.local.postman_environment.json` – variables (`baseUrl`, `email`, `password`, …)

## Before you start
1. Start the server (`npm run dev`) and make sure `baseUrl` matches your `PORT` (default `http://localhost:5000`).
2. `.env` needs `ACCESS_TOKEN_SECRET` and `REFRESH_TOKEN_SECRET` (see `.env.example`).

## How auth works in Postman
Login stores the `access_token`, `refresh_token` and `csrf_token` cookies in Postman's cookie jar; they are sent automatically. A collection-level pre-request script copies the `csrf_token` cookie into the `X-CSRF-Token` header (needed for refresh, logout, change-password, `PATCH /auth/me` and all `/users` writes). No manual token handling.

## Suggested order
1. **1. Auth**: Register → Login → Me → Update me → Refresh → Change password → Logout.
2. **2. Users (SuperAdmin)**: promote your account, log in again, then run the list/filter requests.
   ```powershell
   npm run make-admin -- tester@example.com
   ```
   To test update/delete, register a second user, copy their `id` into the `targetUserId` environment variable, and run the user requests (the admin cannot modify themselves).
3. **3. Negative / security checks**: each should return the status in its name.

## Testing "other sessions are signed out" on password change
Postman has one cookie jar, so use a second client (a second Postman cookie jar isn't available): log in with curl or the browser as the same user, change the password in Postman, then call `/auth/me` from the other client. It returns `401 TOKEN_REVOKED`.

## Google sign-in
Browser-only. Open `{{baseUrl}}/auth/google` in a browser (needs the `GOOGLE_*` variables set).
