# TASK-024 Review 01

## Verdict

`VERDICT: FAIL`

## Scope reviewed

- Task: `TASK-024` — Persist favorite presented questions
- Commit(s): `5067f80cbcb1774ca9a4f7adbdac775c7331a37c` against parent `1f0f5a4b9f7424d73254ecab1445ad2afd4f277c`
- Relevant ADR(s): ADR-001, ADR-002, ADR-003, ADR-004
- Checks supplied: `.agent/checks/TASK-024-checks-01.txt` — `pnpm check` PASS (14 files, 127 tests), `pnpm prisma validate` PASS, and `pnpm test:integration` PASS (11 files, 50 tests); reviewer reran `tests/favorite.integration.test.ts` with the configured environment (1 file, 8 tests), PASS

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| A forward-only migration stores at most one favorite per user and question, anchored to an owned immutable presentation snapshot. | FAIL | The migration is forward-only and enforces uniqueness plus referential existence, but its three independent foreign keys do not enforce that the referenced presentation belongs to the stored user and question. |
| A protected mutation endpoint idempotently favorites or unfavorites a question that the authenticated user was presented. | PASS | Authentication runs in the route-scoped `onRequest` hook before JSON parsing. The owned presentation lookup supplies the user, question, and presentation values used by transactional upsert/delete; repeated true/false requests and concurrent true requests behave as specified. |
| Unknown and foreign presentations reveal no ownership metadata and produce no favorite writes. | PASS | Lookup uses one `id` plus authenticated `userId` predicate, both cases return the same exact 404 response, and the transaction performs no mutation when no owned presentation resolves. |
| Strict request, response, authentication precedence and database behavior are documented and covered by real PostgreSQL tests. | FAIL | Request/response/authentication, rollback, concurrency, isolation, deletion, migration-chain, and no-store behavior are well covered, but the PostgreSQL integrity test does not exercise an existing presentation whose user or question differs from the favorite row, so the missing anchor constraint remains undetected. |

## Findings

### Blockers

1. **Independent foreign keys permit a favorite to reference another user's or another question's presentation**
   - Severity: blocker
   - File: `packages/database/prisma/schema.prisma:144`; `packages/database/prisma/migrations/20260916110000_favorites/migration.sql:14`; `tests/favorite.integration.test.ts:262`
   - Problem: `Favorite.userId`, `Favorite.questionId`, and `Favorite.presentationId` each have an independent foreign key. PostgreSQL therefore accepts a row such as `(userId = Bob, questionId = question B, presentationId = Alice's presentation of question A)` whenever all three referenced rows exist and Bob does not already have a favorite for question B. The unique `(userId, questionId)` index does not relate either value to the presentation. The API currently derives all three values from an ownership-filtered presentation, but ordinary Prisma writes and future migrations/backfills can persist this inconsistent triple. The integrity test at lines 274–278 uses a nonexistent random presentation ID, which proves only referential existence and does not test a mismatched existing presentation.
   - Why it matters: The task requires every favorite to be anchored to an owned immutable presentation snapshot, and the Definition of Done requires database constraints to match business invariants. An inconsistent row can anchor a learner's favorite to a foreign or unrelated snapshot and would make a later favorites feed unsafe or incorrect even though every individual foreign key remains valid.
   - Required correction: Add a database-level constraint that ties the favorite's `presentationId`, `userId`, and `questionId` to the same `QuestionPresentation` row (for example, a composite candidate key plus composite foreign key, or an equivalent enforced design), represent that invariant in the Prisma schema, and preserve the required user cascade and question/presentation delete restrictions. Add real PostgreSQL tests showing that existing-but-mismatched owner and question presentations are rejected, while a matching triple and user-deletion cascade still work through the full fresh migration chain.

### Important

None.

### Minor

None.

## Security review

- Finding listed above. The HTTP ownership/privacy boundary passes: bearer authentication precedes parsing, foreign and unknown IDs are indistinguishable, malformed and duplicate-member JSON is rejected after valid authentication, errors are sanitized, and response data is minimal with `Cache-Control: no-store`. The unenforced relational ownership invariant remains a blocker for persisted-data isolation.

## Test review

- coverage inadequate
- missing scenarios: direct persistence with an existing presentation owned by a different user; direct persistence with an existing presentation for a different question; confirmation that the database rejects both inconsistent triples

## Architecture review

- compliant apart from the data-integrity finding above. The implementation stays within the accepted Fastify, Prisma, and PostgreSQL boundaries, adds no dependency or external service, and introduces no material architecture change.

## Final reviewer statement

The endpoint control flow, snapshot parse-before-mutation behavior, transactional rollback, idempotency, concurrent upsert behavior, uniform 404 privacy, exact response boundary, no-store policy, and current API-level user isolation are otherwise implemented and tested well. `VERDICT: FAIL` because the database can store a favorite whose presentation anchor belongs to a different user or question, so the owned-snapshot persistence invariant is not yet satisfied.
