# TASK-036 Review 01

## Verdict

`VERDICT: FAIL`

## Scope reviewed

- Task: `TASK-036` — Add the Mini App mock-exam taking flow
- Commit(s): `42ec90703e6ffa494d4934cf9fcd3dd5dcaa992f`
- Relevant ADR(s): `ADR-005` — Mini App browser/API boundary
- Checks supplied: `.agent/checks/TASK-036-checks-01.txt` (`pnpm check`, `pnpm build`, and `pnpm test:e2e` all passed)

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| Accessible entry restores an owned current exam before start | PASS | Both setup and practice expose the entry; it performs one authenticated, no-store current-exam request and handles missing, invalid, unauthorized, and conflict states safely. |
| Navigate 50 immutable questions, submit once, show progress/countdown, hide correctness | PASS | Strict DTO validation, read-only persisted answers, single-flight guards, navigator controls, localization, timer, and nondisclosing answer acknowledgements are implemented. |
| All-answered and expired exams complete and render authoritative results with safe recovery | FAIL | Expired and newly all-answered exams complete, but an all-answered exam restored by `GET /exam/current` does not. |
| Browser contracts, same-origin routes, responsive states, documentation, and deterministic tests | FAIL | Coverage is broad, but it omits the restored-all-answered terminal state and therefore did not catch the blocker. |

## Findings

### Blockers

1. **A restored exam with all answers saved does not complete**
   - Severity: blocker
   - File: `apps/web/app/exam.tsx`
   - Problem: `installExam` accepts a current response with `remainingCount === 0`, selects question 1, and leaves the learner in the taking view. The timer effect calls `complete` only when the countdown reaches zero. Consequently, if the final answer was persisted but the previous completion request never ran or its page was closed, reopening the Mini App shows 50 read-only questions and no completion action until the 60-minute deadline.
   - Why it matters: The task requires all-answered exams to complete through the accepted API and requires current-exam restoration. The accepted API explicitly allows a current uncompleted session with 50 saved answers to be completed before expiry.
   - Required correction: After installing a validated current exam, invoke the existing single-flight completion path when `remainingCount === 0`, while preserving the mounted/stale-response guards. Add deterministic Playwright coverage that restores `currentPayload(50)` before expiry, asserts exactly one `POST /exam/complete` with `{ examId }`, and verifies the authoritative result.

### Important

None.

### Minor

None.

## Security review

- PASS. Requests remain same-origin, bearer credentials stay in React memory and headers, response contracts reject unknown and correctness-sensitive members, and the taking UI does not disclose correctness before completion.

## Test review

- Coverage inadequate because the restored-all-answered state is missing.
- Missing scenario: restoring a valid current exam with `answeredCount: 50` and `remainingCount: 0` must issue one completion request and render its validated result.

## Architecture review

- Compliant with ADR-005. The change adds only explicit endpoint rewrites, introduces no client secret or generic proxy, and stays inside the allowed web/test/documentation scope.

## Final reviewer statement

The implementation satisfies the main start, taking, expiry, privacy, recovery, accessibility, and responsive contracts, but it does not complete a fully answered exam restored from the server. This unresolved acceptance-path defect requires a Builder fix and regression coverage.

VERDICT: FAIL
