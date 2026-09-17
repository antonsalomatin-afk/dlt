# TASK-028 Review 02

## Verdict

`VERDICT: PASS`

## Scope reviewed

- Task: `.agent/tasks/TASK-028.yaml` — Show basic progress in the Mini App, including every resolved Supervisor refinement.
- Commit(s): implementation commit `cb5bf187f34d75e39e0fde15b78af89e05b06f65` and review-fix commit `f9fe0846870a3d6fb3ee2549ff32307308a6409e`.
- Relevant ADR(s): ADR-004 (opaque memory-only bearer sessions) and ADR-005 (strict browser DTO validation and explicit same-origin rewrites).
- Checks supplied: `.agent/checks/TASK-028-checks-02.txt` records `pnpm check` PASS (17 files, 137 tests), `pnpm build` PASS, `pnpm test:e2e` PASS (102 tests), and `pnpm test:integration` PASS (13 files, 60 tests). Reviewer reruns passed: `pnpm exec vitest run tests/web-progress.test.ts` (1 test) and `pnpm exec playwright test tests/e2e/progress.spec.ts --workers=1 --repeat-each=3` (60 tests).
- Surrounding code inspected: setup/practice navigation and remount behavior, session-expiry handling, accepted history/mistakes/favorites lifecycle patterns, browser contracts, explicit rewrite configuration, Progress styles, README documentation, the complete Progress unit/browser coverage, review attempt 1, and the attempt-2 synchronization fix.

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| Progress is accessible from vehicle setup and practice and loads the accepted progress summary with the in-memory bearer session. | PASS | Setup exposes Progress before vehicle selection and practice exposes the same control. `apps/web/app/progress.tsx:51-56` sends the fixed `GET /me/progress` request with the memory-only bearer token, no body, `cache: 'no-store'`, and the established 15-second timeout. `apps/web/next.config.ts:8` adds only the explicit rewrite. |
| The view presents localized answered, correct, incorrect and accuracy metrics, including a friendly no-answers state. | PASS | `apps/web/app/progress.tsx:8-33` supplies English, Russian and Thai title, metric, loading, error, empty and action copy. Lines 83-95 render the accessible selector and summary; zero answers keep all counts at zero, render an em dash for null accuracy and show localized start-practicing guidance, while nonzero accuracy includes `%`. |
| Loading, retry, expired-session, malformed-response and stale-response behavior is accessible, safe and recoverable. | PASS | `apps/web/app/progress.tsx:44-76` provides a synchronous overlap guard, accessible pending/error states, strict parse-before-render behavior, retry, active 401 expiry, and lifecycle invalidation on immediate departure. No partial summary survives an error. The corrected stale matrix deterministically exercises replacement-mount authority as detailed below. |
| Browser tests cover exact request behavior, strict response validation, localization, navigation origins, empty progress and existing practice/history/mistakes/favorites regressions. | PASS | `tests/e2e/progress.spec.ts:28-178` covers the exact method/auth/no-body/no-store/single-call request, nonempty and zero summaries, all three languages, setup and practice origins with clean return, transport/HTTP/malformed retry, the strict malformed-value matrix and active 401. Lines 234-256 cover synchronous retry overlap. The supplied full 102-test E2E run keeps all existing practice/history/mistakes/favorites suites green. |
| Strict safe arithmetic response contract | PASS | `apps/web/lib/contracts.ts:141-158` uses a strict object, nonnegative safe-integer counts, a safe and exact `answered === correct + incorrect` invariant, bounded whole-number/null accuracy, and exact `Math.round((correct / answered) * 100)` consistency with null only at zero. Unit and browser tests reject unknown, missing, fractional, unsafe, negative, inconsistent-count, incorrect-rounding and invalid null/zero accuracy payloads. |
| Immediate leave, stale outcome isolation, clean fresh mount and no browser persistence | PASS | `tests/e2e/progress.spec.ts:180-232` holds request 1, leaves immediately, remounts Progress, proves request 2 rendered its distinct summary, and only then releases request 1 for success, HTTP error and 401. The test awaits intercepted response fulfillment and a two-frame browser render checkpoint rather than a fixed sleep, then verifies every replacement metric, absence of alerts, exactly two requests, and retained session after stale 401. Component-instance `active` and `busy` refs isolate the old continuation. Code inspection and the browser persistence assertion show no token, locale or response persistence. This closes the sole blocker from review 01. |
| Accessibility, exact scope and documentation | PASS | The view has a labelled heading and `aria-busy`, loading uses `role=status`, errors use `role=alert`, language controls use a labelled radio group, metrics use native description-list semantics, and Back remains operable during loading. Changes stay within `apps/web/**`, `tests/**` and `README.md`, add no backend/schema/dependency/deployment behavior, and document the request, response contract, localization, failures, origin return and memory-only behavior. |

## Findings

### Blockers

None.

### Important

None.

### Minor

None.

## Security review

- PASS — the browser uses only the fixed same-origin `/me/progress` rewrite; the opaque session token stays in component memory and is sent only in the Authorization header; requests use no-store; strict runtime validation rejects untrusted malformed or inconsistent data before rendering; no token, locale or response persistence is introduced; and a stale 401 cannot clear the active replacement session.

## Test review

- coverage adequate
- missing scenarios: none material to TASK-028. The attempt-2 stale success/error/401 matrix now exercises the required old-request/new-mount overlap without fixed sleeps and remained stable across three reviewer repetitions.

## Architecture review

- compliant — the implementation preserves ADR-004's memory-only opaque session and ADR-005's explicit fixed rewrite and strict browser-validation boundary. It uses strict TypeScript, follows the established setup/practice navigation model, and introduces no material architecture or backend change.

## Final reviewer statement

TASK-028 satisfies its acceptance criteria and every resolved refinement. The authoritative checks pass, the focused reviewer reruns pass, and review 01's only blocker is closed by deterministic replacement-mount coverage for stale success, error and 401 outcomes. No blocker remains.

VERDICT: PASS
