# ADR-004 — Initial API session strategy

Status: Accepted
Date: 2026-09-09

## Context
TASK-009 needs a bounded server-issued session after validation under ADR-003. Web and API may run separately, and the accepted PostgreSQL service already provides persistence. No paid provider or new persistence system is required.

## Decision
Use opaque bearer sessions. Generate32 cryptographically random bytes encoded as base64url; return the raw token only in the successful login response. Store only its SHA-256 digest, uniquely constrained, linked to the User. Store creation time and expiry; default expiry is24 hours after issuance. These are ThaiDLT engineering defaults. Enforce expiry server-side on every protected request. A session can be revoked by deleting its row; no revocation endpoint is required in TASK-009.

POST /auth/telegram accepts a strict JSON object with initData only, bounded under ADR-003. Validate before any database mutation. Atomically upsert the Telegram user, update lastSeenAt/profile and create the session. Preserve existing vehicle choice. Return token, expiresAt and a minimal validated user DTO with id, nullable username/firstName and selectedVehicleType. Do not return raw initData, bot token, token hash or database internals.

GET /me requires an Authorization Bearer token and returns the same user DTO. Missing, malformed, unknown and expired tokens receive the same stable401 error shape. Validate response DTOs and body/header boundaries. Do not log credential-bearing bodies or authorization headers. Bind local development to loopback by default. No production deployment or new external calls are authorized by this decision.

The future Mini App should keep this bearer token in memory rather than persistent browser storage. HTTPS is required for nonlocal transport. Cookie authentication, refresh tokens and long-lived device sessions are outside this slice.

## Tradeoffs
There is a database lookup per protected request. This favors simple server-side expiry/revocation over stateless JWT complexity. Signed initData can be reused within its short freshness window; no stronger anti-replay claim is made. Sessions never extend expired initData by revalidating it as a session credential. Rate limiting and wider production hardening remain separate roadmap work.

## Validation
Use injected time for expiry boundaries. Integration tests verify invalid auth writes nothing, valid/repeated login targets one User, sessions store only digests, vehicle preference survives login, and valid/expired/unknown sessions are handled correctly. Use synthetic signed test data and the real local PostgreSQL database; no live Telegram secrets.
