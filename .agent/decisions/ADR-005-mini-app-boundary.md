# ADR-005 — Mini App browser/API boundary

Status: Accepted
Date: 2026-09-14

The accepted stack uses Next.js for the Mini App and Fastify for API business logic. Keep browser requests same-origin through explicit Next.js rewrites for only the existing API endpoints. Configure a server-only API_ORIGIN (loopback development default); validate its URL as an HTTP(S) origin without credentials, path, query or fragment. Do not implement a generic user-controlled proxy. This preserves independent service boundaries without adding browser CORS configuration for this slice.

The browser obtains raw initData from Telegram's official WebApp bridge after its script is ready, sends it to POST /auth/telegram, and keeps the returned opaque token in component/application memory only under ADR-004. Never use initDataUnsafe or browser-provided identity as proof. No tokens in URLs, persistent storage, logs or analytics. No server-side bot token or database imports may enter the client bundle. Missing Telegram data renders launch guidance; no development authentication bypass.

Validate HTTP response DTOs in the browser before rendering. Expired/rejected credentials clear in-memory auth and show reopen/retry guidance. Unknown responses and transport errors display safe local messages. Local UI tests may mock Telegram and API responses from the test harness; do not ship mock credentials or bypass modes in the app.

This is a local development routing choice, not a production deployment decision. HTTPS/nonlocal origin, credentials and production deployment remain separate work. No paid services are introduced.
