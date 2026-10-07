# TASK-063 Review 01

## Verdict

`VERDICT: PASS`

## Scope reviewed

- Task: `TASK-063` — Persist the learner's preferred language
- Commit(s): `064a8a83001b6455128d08361a1ecbd997e005ef` and its parent/diff
- Relevant ADR(s): `ADR-002-core-stack.md`, `ADR-004-api-sessions.md`
- Checks supplied: `.agent/checks/TASK-063-checks-01.txt` — `pnpm check` passed (52 files, 279 tests), `pnpm prisma validate` passed, and the unchanged `pnpm test:integration` suite passed (38 files, 193 tests) after the repository PostgreSQL service was started. The earlier integration failure is an infrastructure failure consistently showing that `127.0.0.1:55432` was unavailable, not a product-code failure.
- Additional reviewer check: `pnpm exec vitest run tests/language.test.ts` passed (1 file, 3 tests).

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| Additive migration stores one non-null language with exactly `ENGLISH`, `RUSSIAN`, or `THAI`, defaulting existing and new users to English | PASS | The PostgreSQL enum and non-null column have matching database and Prisma defaults. Migrated-PostgreSQL coverage checks exact enum order, schema metadata, legacy backfill, new-row default, null rejection, unsupported-value rejection, and preservation of sessions, learning state, reminders, presentations, answers, exams, favorites, and reports. |
| `GET /me/language` authenticates and returns exactly the caller's persisted preference | PASS | The route is protected by the plugin-scoped `onRequest` bearer lookup, derives the user solely from the session, selects only `preferredLanguage`, validates the exact response contract, rejects body/query input, and sets `Cache-Control: no-store`. |
| `PATCH /me/language` authenticates before strict parsing, accepts exactly one supported language, and atomically returns the persisted value | PASS | Authentication executes in `onRequest`, before Fastify content parsing. The custom JSON parser rejects duplicate top-level members, media type and query boundaries are strict, Zod rejects missing/extra/unsupported members, and Prisma's single-row `UPDATE ... RETURNING` semantics provide an atomic write whose response reflects that write. Repeated updates are idempotent. |
| Invalid, unauthenticated, and error paths do not mutate or disclose learner data | PASS | Tests cover missing, malformed, unknown, revoked, and expired credentials; invalid/duplicate/malformed bodies; unsupported media; query injection; GET bodies; and injected read/write failures. Responses use the established sanitized shapes and expose only the language enum. Persistence checks demonstrate no unauthorized, validation-failure, or failed-update mutation. |
| Existing authentication, reminder, user, practice, exam, and progress contracts remain unchanged | PASS | Existing DTO selection remains explicit and excludes the new field. The diff does not modify established response schemas or learning behavior, focused integration assertions cover `/me`, reminders, and progress, and the complete 193-test integration suite passes. |
| Documentation and tests cover migration integrity, defaults, updates, idempotence, ownership, boundaries, failure safety, and privacy | PASS | README documents the exact enum, defaults, routes, ownership, caching, exclusions, and non-goals. Unit and isolated PostgreSQL tests cover every requested behavior, including all three values, concurrent writes, exact response keys, relation preservation, and database-error sanitization. |

## Findings

### Blockers

None.

### Important

None.

### Minor

None.

## Security review

- PASS. Authentication precedes query, media-type, and JSON validation for both language routes. Ownership is derived only from the authenticated internal user ID. Strict parsing prevents extra identity selectors and duplicate-member ambiguity. Responses and error paths reveal no Telegram identity, bearer/session data, reminder state, activity, vehicle, timing, or learning records.

## Test review

- Coverage adequate.
- No material missing scenarios. The tests exercise exact contracts, no-store behavior, legacy and new-user defaults, each supported update, idempotence, concurrent last-committed-write behavior, ownership isolation, validation/authentication precedence, malformed and duplicate JSON, unsupported media, GET boundaries, database failures, response privacy, migration constraints, relation preservation, and regressions through the full integration suite.

## Architecture review

- Compliant. The change stays within the Fastify/PostgreSQL/Prisma architecture selected by ADR-002 and preserves the opaque bearer-session boundary in ADR-004. It adds no scheduler, queue, delivery behavior, dependency, external provider, credential, deployment change, or material architecture decision. Files changed remain inside the task's allowed scope.

## Final reviewer statement

`VERDICT: PASS` — all acceptance criteria are satisfied, authoritative checks are green, and no unresolved blocker, security defect, data-integrity issue, architecture violation, or material test gap was found.
