# TASK-036 Review 02

## Verdict

`VERDICT: PASS`

## Scope reviewed

- Task: `TASK-036` — Add the Mini App mock-exam taking flow, including `review_fix_refinement`
- Commit(s): `42ec90703e6ffa494d4934cf9fcd3dd5dcaa992f`, `91c44ee6ad331b2e8c2b4cbb7fa1c15023808808`
- Relevant ADR(s): `ADR-005` — Mini App browser/API boundary
- Checks supplied: `.agent/checks/TASK-036-checks-01.txt` and `.agent/checks/TASK-036-checks-02.txt` (`pnpm check`, `pnpm build`, and `pnpm test:e2e` all passed after the review fix)
- Focused reviewer checks: `pnpm exec vitest run tests/web-exam.test.ts` (4 passed) and `pnpm exec playwright test tests/e2e/exam.spec.ts --grep "fully answered restored"` (1 passed)

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| Accessible entry restores an owned current exam before start | PASS | Setup and practice expose keyboard-operable entry points. Each mount performs one authenticated, no-store current lookup before a start action is offered, validates the owned response, and safely handles missing, unauthorized, vehicle, transport, and contract failures. |
| Navigate 50 immutable questions, submit once, show progress/countdown, hide correctness | PASS | Strict contracts enforce fixed policy, canonical identities, unique ordered snapshots, answer pairing and authoritative progress. The UI supports localization, navigation, read-only persisted answers, relevant pending states, and a server-aligned clamped timer without exposing correctness, score, explanations, or hidden answer fields. |
| All-answered and expired exams complete and render authoritative results with safe recovery | PASS | Final-answer, exact-expiry, answer-conflict, completion retry, and restored-all-answered paths use the same mounted-safe single-flight completion function. The review fix immediately completes a valid restored exam with zero remaining answers; focused Playwright coverage proves one exact `{ examId }` request and a validated result. |
| Browser contracts, same-origin routes, responsive states, documentation, and deterministic tests | PASS | Only the four accepted exam routes were added to explicit same-origin rewrites. README and responsive styles cover the flow. Unit tests reject privacy/invariant violations, while Playwright covers start, restore, final answer, restored terminal state, expiry, localization, conflicts, malformed/transport responses, session expiry, storage/URL privacy, and stale response handling. |

## Findings

### Blockers

None.

### Important

None.

### Minor

None.

## Security review

- PASS. Bearer credentials remain in React memory and authorization headers. Requests are same-origin and no token or exam payload is persisted in URLs, browser storage, cookies, logs, or client-visible hidden fields. Strict response schemas reject unknown and privacy-sensitive members.

## Test review

- Coverage adequate.
- The restored-all-answered regression directly exercises the prior blocker and asserts exactly one completion request with the exact body before checking the authoritative result.
- Mounted guards, single-flight refs, timer completion, answer completion, and stale response behavior have deterministic browser coverage.
- Missing scenarios: none material to the task acceptance criteria.

## Architecture review

- Compliant with ADR-005. The implementation stays in the allowed web, test, and documentation scope; it adds only explicit same-origin endpoint rewrites and introduces no generic proxy, browser auth bypass, dependency, credential, API/database change, or deployment decision.

## Final reviewer statement

The review fix closes the prior terminal restore defect without weakening the accepted timer, privacy, stale-response, or single-flight behavior. All original acceptance criteria and the review-fix refinement are satisfied with passing authoritative and focused checks.

VERDICT: PASS
