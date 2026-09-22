# TASK-039 Review 01

## Verdict

`VERDICT: PASS`

## Scope reviewed

- Task: TASK-039 — Retry serializable exam start on real driver conflicts
- Commit(s): `562710770aab9bb4ad358c9a2c75ebd2cd76358b`
- Relevant ADR(s): ADR-002 core TypeScript monorepo stack
- Checks supplied: `.agent/checks/TASK-039-checks-01.txt`
- Independent checks: `pnpm exec vitest run tests/transaction.test.ts` PASS (7 tests); isolated PostgreSQL `tests/exam-start.integration.test.ts` PASS (8 tests); a 40-round concurrent-start loop under 8 CPU-saturating loops PASS after the fix, having failed on the same loop before it

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| Shared unit-tested predicate for P2034 and SQLSTATE 40001/40P01 in the cause chain | PASS | `packages/database/src/transaction.ts` reads properties through `Reflect.get` with no type assertions, bounds the cause walk at depth 5 and therefore terminates on a cyclic cause. Seven unit tests cover both accepted forms and nine rejected ones. |
| Concurrent starts yield one 200 and one 409 with one session, including under load | PASS | The repeated six-round integration test asserts the invariant; the load repro that previously produced `[200, 500]` now passes 40 rounds. |
| An isolated PostgreSQL test proves the predicate against a real driver conflict | PASS | The new test induces a genuine write-skew between two serializable transactions and asserts the driver's own thrown error is classified, rather than asserting against a hand-written object. It retries induction up to three times and fails loudly if PostgreSQL never conflicts. |
| Concurrent-start failures carry response bodies | PASS | Both concurrent assertions pass a message containing each status and a truncated body. |

## Findings

### Blockers

None.

### Important

None.

### Minor

None. The retry budget was deliberately left at six attempts: with correct classification the losing attempt re-reads the committed session and returns 409 on its second try, so widening the budget would have hidden the real cause rather than fixed it.

## Security review

- N/A for the change itself. The endpoint's authentication, ownership and sanitized error behavior are untouched; the predicate inspects error metadata only and never reaches a response body.

## Test review

- Coverage adequate and the diagnosis is now permanent: a future regression fails with the response bodies attached, and the predicate is pinned against the real adapter error shape.
- Not covered: whether other transactional endpoints need the same predicate. Exam answer and completion use row locks under default isolation, so SQLSTATE 40001 is not expected there; noted in the follow-ups register rather than widened in this task.

## Architecture review

- Compliant. One small shared module in the database package, no migration, no dependency, no contract change.

## Final reviewer statement

This closes a real concurrency defect that the README had already promised was handled, and it replaces a load-dependent test failure with a deterministic proof.

VERDICT: PASS
