# TASK-035 Review 01

## Verdict

`VERDICT: PASS`

## Scope reviewed

- Task: TASK-035 — Take a timed mock exam in the Mini App
- Commit(s): `e8393be2452cabc88f65c194ac33f520c136ceba`
- Relevant ADR(s): ADR-002 core TypeScript monorepo stack; ADR-004 opaque bearer API sessions; ADR-005 Mini App boundary
- Checks supplied: `.agent/checks/TASK-035-checks-01.txt`
- Independent checks: `pnpm exec vitest run tests/web-exam.test.ts` PASS (3 tests); `pnpm exec playwright test tests/e2e/exam.spec.ts` PASS (19 tests); full `pnpm test:e2e` PASS

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| Reachable from setup after a saved vehicle and from practice; Back returns to origin | PASS | `page.tsx` records the origin like the accepted feeds; the practice-origin test proves a clean practice remount. |
| One exact start request, strict start contract, positioned questions, countdown and counts | PASS | `examStartSchema` enforces 50 consecutive unique rows and the 60-minute window; the view checks the vehicle identity; the countdown is anchored to the server `startedAt` via a clock offset. |
| Exact answer request, strict receipt, no correctness, conflict handling | PASS | `examAnswerSchema` is strict and carries no correctness; a receipt with `isCorrect` is rejected; already-submitted, expired, completed, 404, transport and malformed paths are tested. Selected choice survives failure so Retry resends the same IDs. |
| Finish only when complete or time is up; strict summary rendering | PASS | `canFinish` gates the button; the strict `examCompleteSchema` and examId identity check protect the result view; incomplete 409 reports the remaining count. |
| Lifecycle, 401, 409 vehicle, stale response, departure and E2E coverage with existing suites green | PASS | `active` ref invalidates late outcomes; `busy` ref guards overlap; storage stays empty; the complete E2E suite passes. |

## Findings

### Blockers

None.

### Important

None.

### Minor

None. The Answered/Remaining counts use the server's persisted counts from each receipt; the local increment on an already-submitted conflict is a best-effort display only and never feeds a request.

## Security review

- PASS: the bearer token stays in memory and is only sent in the Authorization header; responses are strictly validated before rendering; no correctness or explanation leaves the completion boundary before the exam is finished; nothing is written to browser storage.

## Test review

- Coverage adequate. Contract unit tests plus 19 browser tests including test-clock time-up. Not covered: a live API/browser full-stack exam run, which the existing full-stack gate does not include and is out of scope.

## Architecture review

- Compliant. Three explicit same-origin rewrites, no dependency, no backend change.

## Final reviewer statement

The Mini App exam flow follows the accepted view patterns, validates every response strictly and never discloses correctness before completion.

VERDICT: PASS
