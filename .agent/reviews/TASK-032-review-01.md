# TASK-032 Review 01

## Verdict

`VERDICT: FAIL`

## Scope reviewed

- Task: TASK-032 — Complete and score an owned mock exam
- Commit(s): `f50e3cdaad1415fcbfcf9ee2f6b505722148586c`
- Relevant ADR(s): ADR-002 core TypeScript monorepo stack; ADR-004 opaque bearer API sessions
- Checks supplied: `.agent/checks/TASK-032-checks-01.txt` — `pnpm check` PASS (150 tests), `pnpm prisma validate` PASS, `pnpm test:integration` PASS (93 tests)
- Independent check: a temporary isolated-PostgreSQL race probe delayed the final admitted answer while completing at exact expiry; the probe was removed after execution

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| Protected completion endpoint finalizes all-answered or expired owned exams | PASS | Authentication precedes query/body parsing, input is strict and canonical, ownership is nondisclosing, and early/exact-expiry behavior is implemented and covered. |
| Validate immutable answers, count unanswered as incorrect, and persist one consistent completion tuple atomically | FAIL | A concurrent admitted answer can commit after completion and leave the persisted score inconsistent with the final answer tuples. |
| Deterministic early, expired, repeated, concurrent, ownership, corruption, privacy, and rollback behavior in PostgreSQL | FAIL | Completion-versus-completion is covered, but completion-versus-final-answer is not serialized and produces a deterministic integrity failure under the independent race probe. |
| Return a documented authoritative privacy-safe score/pass summary | PASS | The strict response contains only aggregate result fields and README documentation matches the intended contract. |

## Findings

### Blockers

1. **An admitted final answer can invalidate a concurrently persisted completion result**
   - Severity: blocker
   - File: `apps/api/src/index.ts:565`
   - Problem: The answer transaction reads `completedAt`, then conditionally updates only the `ExamQuestion` answer tuple. The completion transaction independently reads all answer tuples and conditionally updates only `ExamSession`. Neither transaction locks a shared row nor otherwise serializes these read/write sets. An answer admitted just before expiry can therefore pause after observing an incomplete session; a completion request at expiry then sees that question unanswered and persists a lower score; the answer subsequently commits successfully after completion. The focused PostgreSQL probe received 200 from both endpoints and persisted score 49 while the final rows contained 50 correct answers (`expected 50, received 49`). A repeated completion then encounters the implementation's own score-consistency guard rather than returning the authoritative idempotent result.
   - Why it matters: The stored completion tuple is no longer authoritative or consistent with the immutable server-scored answers. This violates the task's atomic-finalization and idempotency requirements and can turn later reads into sanitized 500 responses.
   - Required correction: Serialize exam answering and completion on the same database-owned synchronization point, so an answer admitted before expiry either commits before scoring or cannot mutate rows after completion. Recheck completion state at the serialized write boundary, preserve the accepted answer endpoint behavior, and add an isolated PostgreSQL test that overlaps the final pre-expiry answer with exact-expiry completion and proves one consistent immutable result. The task currently says not to change exam-answer behavior; the Supervisor should explicitly refine that boundary to permit the necessary integrity correction.

### Important

None.

### Minor

None.

## Security review

- PASS: bearer authentication remains uniform; validation follows authentication; ownership is not disclosed; the response excludes choices, per-question correctness, explanations, source metadata, and user data.

## Test review

- Coverage inadequate because it tests concurrent completion requests but omits the cross-endpoint final-answer/completion race described above.
- Existing unit and integration coverage otherwise exercises strict request/response contracts, exact expiry, unanswered scoring, 44/45 boundary behavior, immutable source independence, corruption rollback, repeated completion, privacy, and absence of practice side effects.

## Architecture review

- Compliant with the accepted Fastify, Prisma, PostgreSQL, and bearer-session architecture; the blocker is a transaction-boundary defect rather than an architecture change.

## Final reviewer statement

The completion endpoint satisfies its static contracts, but it cannot yet guarantee an authoritative atomic result while a valid final answer is in flight.

VERDICT: FAIL
