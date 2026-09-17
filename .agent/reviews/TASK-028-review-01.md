# TASK-028 Review 01

## Verdict

`VERDICT: FAIL`

## Scope reviewed

- Task: `.agent/tasks/TASK-028.yaml` — Show basic progress in the Mini App, including every resolved Supervisor refinement.
- Commit(s): Builder commit `cb5bf187f34d75e39e0fde15b78af89e05b06f65` against exact parent `e3e646087968cb99d041d9a021f923aaa2e41783`.
- Relevant ADR(s): ADR-004 (opaque memory-only bearer sessions) and ADR-005 (strict browser DTO validation and explicit same-origin rewrites).
- Checks supplied: `.agent/checks/TASK-028-checks-01.txt` records `pnpm check` PASS (17 files, 137 tests), `pnpm build` PASS, `pnpm test:e2e` PASS (103 tests), and `pnpm test:integration` PASS (13 files, 60 tests). Reviewer reruns passed: `pnpm exec vitest run tests/web-progress.test.ts` (1 test) and `pnpm exec playwright test tests/e2e/progress.spec.ts --workers=1` (21 tests).
- Surrounding code inspected: setup/practice navigation and remount behavior, session-expiry handling, accepted history/mistakes/favorites lifecycle patterns, browser contracts, explicit rewrite configuration, Progress styles, README documentation, and the complete Progress unit/browser coverage.

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| Progress is accessible from vehicle setup and practice and loads the accepted progress summary with the in-memory bearer session. | PASS | Setup exposes Progress even with no saved vehicle; practice exposes the same entry. The fixed `/me/progress` request is `GET`, includes the memory-only bearer token, has no body, uses `cache: 'no-store'` and `AbortSignal.timeout(15000)`, and is backed only by the explicit rewrite. Back preserves setup origin and remounts a clean Practice instance for practice origin. |
| The view presents localized answered, correct, incorrect and accuracy metrics, including a friendly no-answers state. | PASS | The strict parsed summary renders as an accessible `dl`; nonzero accuracy includes `%`, while zero answers render three zero counts, an em dash for null accuracy and start-practicing guidance. English, Russian and Thai copies cover the title, description, language legend, loading/error/empty states, summary label, metric labels and actions; language defaults to English and remains local to the mounted view. |
| Loading, retry, expired-session, malformed-response and stale-response behavior is accessible, safe and recoverable. | FAIL | Runtime behavior is implemented with an accessible busy/status state, safe alert/retry path, no partial metrics, synchronous overlap guard, strict parsing, parent session clearing on an active 401, and an instance-local active ref that invalidates callbacks on departure. However, the required stale-response/fresh-remount browser regression is not deterministically exercised, as detailed in the blocker below. |
| Browser tests cover exact request behavior, strict response validation, localization, navigation origins, empty progress and existing practice/history/mistakes/favorites regressions. | FAIL | Exact method/auth/no-body/no-store/single-call behavior, safe arithmetic constraints, nonempty/zero rendering, three-language switching, both origins, clean practice return, transport/HTTP/malformed retry, active 401 clearing and synchronous retry guarding are covered. The full authoritative suite keeps all existing E2E regressions green. The old-request/replacement-mount race and deterministic completion of released stale outcomes remain uncovered. |
| Strict safe arithmetic response contract | PASS | `z.strictObject` rejects unknown and missing fields; every count is a nonnegative safe integer; the safe sum must equal `answered`; accuracy is a bounded whole number or null and must equal the exact `Math.round((correct / answered) * 100)` result, with null required only at zero. Unit and E2E cases cover unknown, missing, fractional, unsafe, negative, inconsistent-count, incorrect-rounding and invalid null/zero accuracy payloads. |
| Immediate leave, clean fresh mount and no browser persistence | PASS | Back invalidates the mounted instance before parent navigation. A later callback cannot update it because `active` and `busy` are component-instance refs; a newly constructed Progress instance has fresh refs and issues a new request. No token, locale or response is written to local storage, session storage, cookies or another persistence API. |
| Accessibility, exact scope and documentation | PASS | The panel has a labelled heading and `aria-busy`, loading uses `role=status`, errors use `role=alert`, languages are a labelled radio group, metrics use native description-list semantics, and Back stays operable while loading. Changes remain within the allowed web/tests/README boundary and add no backend/schema/dependency/deployment behavior, mutation, chart, trend or unsupported breakdown. README documents the route, request, contract, localization, failure handling, origin return and memory-only behavior. |

## Findings

### Blockers

1. **Stale callbacks are not tested against an active replacement mount**
   - Severity: blocker
   - File: `tests/e2e/progress.spec.ts:177`, `tests/e2e/progress.spec.ts:197`
   - Problem: The three late success/error/401 tests release the held response after Back and then use `page.waitForTimeout(100)` before checking setup. That sleep does not prove the browser delivered the response through the component's async continuation before the assertions, so a slow callback can run after the test has already passed. More significantly, the fresh-mount test releases the first request and waits 100 ms at lines 208–210 before reopening Progress. The old request is therefore deliberately settled before the replacement instance exists; the test never covers an old success, error or 401 arriving while a new Progress mount and its own request are active.
   - Why it matters: TASK-028 explicitly requires ignored late success/error/401 behavior, a fresh request on a fresh mount, and browser regression coverage for the lifecycle behavior. The untested overlap is the dangerous React case: a shared/reactivated active ref or stale 401 could clear the live session, stale success could replace the new summary, or stale finalization could alter the replacement request state. The current product code appears correctly isolated by component-instance refs, but the mandated regression would not catch those lifecycle regressions and its fixed sleep is timing-dependent.
   - Required correction: Keep the first `/me/progress` response gated, leave, and remount Progress while that first request is still in flight. Prove the replacement sends its own request, then release the old success/error/401 while the replacement is active and synchronize on network delivery plus a browser event-loop/render checkpoint rather than an arbitrary timeout. Assert that the replacement request/view/session remains authoritative. Make the existing late-outcome checks deterministic in the same way, then rerun the focused and full E2E gates.

### Important

None.

### Minor

None.

## Security review

- PASS — only the fixed same-origin `/me/progress` rewrite is added; the opaque credential stays in component memory and is sent only through the Authorization header; requests and documented responses use no-store behavior; the strict DTO rejects unknown and inconsistent external data before rendering; no response, locale or credential persistence is introduced. Active-instance checks suppress late 401 handling in the reviewed implementation.

## Test review

- coverage inadequate
- missing scenarios: an old success, HTTP/transport error and 401 completing after a replacement Progress mount is active; deterministic proof that each released late response reached the old async continuation before the no-effect assertions. All other required Progress cases are represented, and both the supplied authoritative run and reviewer focused reruns are green.

## Architecture review

- compliant — the implementation preserves ADR-004's memory-only opaque session, ADR-005's explicit fixed rewrite and strict browser-validation boundary, strict TypeScript and the established setup/practice navigation model. It stays within `apps/web/**`, `tests/**` and `README.md` and introduces no material architecture or backend change.

## Final reviewer statement

The Progress implementation satisfies the request, contract, localization, navigation, rendering, expiry, persistence, accessibility, documentation and scope requirements on inspection, and all supplied and focused checks pass. Acceptance is still blocked because the explicitly required stale-response regression relies on fixed sleeps and settles the old request before remount, leaving the replacement-mount lifecycle race untested.

VERDICT: FAIL
