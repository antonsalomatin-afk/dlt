# TASK-032 Review 02

## Verdict

`VERDICT: PASS`

## Scope reviewed

- Task: TASK-032 — Complete and score an owned mock exam, including `review_fix_refinement`
- Commit(s): `f50e3cdaad1415fcbfcf9ee2f6b505722148586c`, `8268e91c50ea5527316a9efbf4e36d5fb53d976e`
- Relevant ADR(s): ADR-002 core TypeScript monorepo stack; ADR-004 opaque bearer API sessions
- Checks supplied: `.agent/checks/TASK-032-checks-01.txt` — `pnpm check` PASS (150 tests), `pnpm prisma validate` PASS, `pnpm test:integration` PASS (93 tests); `.agent/checks/TASK-032-checks-02.txt` — the same gates PASS after the fix, including 94 integration tests
- Independent checks: `pnpm exec vitest run tests/exam-complete.test.ts` PASS (3 tests); isolated PostgreSQL `tests/exam-complete.integration.test.ts` PASS (10 tests); isolated PostgreSQL `tests/exam-answer.integration.test.ts` PASS (9 tests)

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| Protected completion endpoint finalizes all-answered or expired owned exams | PASS | Authentication and request time precede strict query/body validation; ownership remains nondisclosing; all-answered, exact-expiry, and later-expiry paths are covered. |
| Validate immutable answers, count unanswered as incorrect, and persist one consistent completion tuple atomically | PASS | Completion validates snapshots and complete/null answer tuples, derives the score from immutable snapshots, and persists the three-field completion tuple while holding the owned session row lock. |
| Deterministic early, expired, repeated, concurrent, ownership, corruption, privacy, and rollback behavior in PostgreSQL | PASS | Both answer and completion acquire the same owned `ExamSession` row before authoritative reads. The forced final-answer/exact-expiry overlap now serializes, and the waiting endpoint re-reads session state after acquiring the lock. |
| Return a documented authoritative privacy-safe score/pass summary | PASS | The strict response exposes only aggregate counts, policy, pass result, and completion timestamp; README documents the contract and shared serialization boundary. |

## Findings

### Blockers

None.

### Important

None.

### Minor

None.

## Security review

- PASS: bearer authentication remains uniform and executes before parsing; absent and other-user resources retain identical 404 behavior; both raw lock queries bind UUID values through `Prisma.sql`; no answer, explanation, source, or user data is disclosed.

## Test review

- Coverage is adequate. Unit contracts cover canonical input, aggregate invariants, privacy, and the 44/45 boundary. Isolated PostgreSQL coverage includes ownership, deadline boundaries, immutable scoring, corruption rollback, idempotency, concurrent completion, answer regression behavior, and a deterministic cross-endpoint overlap.
- The overlap test blocks an admitted pre-expiry answer after it has locked the session, proves exact-expiry completion waits, and verifies a single score of 50. The reverse lock ordering is safe by the same parent-first protocol: completion retains the session lock through its conditional write, and a waiting answer then re-reads `completedAt` before any `ExamQuestion` update and returns 409. Neither endpoint acquires an exam-question write lock before the shared session lock, so their lock order is consistent.

## Architecture review

- Compliant with the accepted Fastify, Prisma, PostgreSQL, and bearer-session architecture. The fix adds no migration or dependency and uses the existing transaction boundary.

## Final reviewer statement

The completion endpoint satisfies the strict scoring, privacy, idempotency, and rollback contract. The answer/completion race from review attempt 1 is closed by a shared database-owned session-row lock, with authoritative state re-read under that lock and focused PostgreSQL coverage proving the contested ordering.

VERDICT: PASS
