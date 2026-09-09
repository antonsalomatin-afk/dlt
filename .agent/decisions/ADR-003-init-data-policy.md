# ADR-003 — Mini App authentication validation policy

Status: Accepted
Date: 2026-09-09

## Context
The accepted architecture requires server-side signed initData validation and freshness checks. TASK-008 needs deterministic boundaries before implementation. This decision covers validation only; session issuance remains a separate ADR for TASK-009.

## Decision
Use Telegram's bot-token HMAC-SHA-256 validation for raw initData, following the official protocol. Exclude hash from the alphabetically sorted decoded key/value data-check string; retain other signed fields, including signature when present. Derive the HMAC key using WebAppData as key and the bot token as message. Compare correctly sized digest bytes using constant-time comparison.

Default maximum age:300 seconds. Maximum future clock skew:30 seconds. Exact boundaries are inclusive. Inject current time for tests, expressed as integer Unix seconds; overrides must be finite nonnegative safe integers, with positive maximum age. These durations are a ThaiDLT engineering policy, not values mandated by Telegram.

Reject duplicate query keys, malformed encoding, missing or malformed hash/user/auth_date, unsafe user IDs and invalid required identity fields. Cap raw input at16 KiB to bound parsing work. Verify the signature before interpreting user identity as trusted. Preserve valid unknown signed fields in signature calculation for protocol compatibility; return only explicitly validated identity fields.

Accept positive integer Telegram IDs up to the documented52-bit range and return an exact bigint or decimal string suitable for the existing database identity. Never return or log tokens/raw initData. Failure responses must not echo supplied input. Tests use synthetic tokens and independent signed vectors, never live credentials.

## Consequences
Opening the Mini App again may be needed after the freshness period. Validation alone does not prevent reuse within the short freshness window; session/replay policy belongs to TASK-009. No third-party Ed25519 validator or frontend authentication is introduced.

## Source
https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app (checked2026-09-09). Revisit if Telegram changes the protocol or measured clock behavior requires adjustment.
