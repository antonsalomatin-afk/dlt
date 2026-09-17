# TASK-026 Review 01

## Verdict

`VERDICT: FAIL`

## Scope reviewed

- Task: `TASK-026` — Save and review favorites in the Mini App
- Commit(s): `afe27160bf6e8990dbc137bda42ee335d58f2dfb` against parent `657551efc1a71b95998b34752d1daf8b79661b97`
- Relevant ADR(s): ADR-001, ADR-002, ADR-004, ADR-005
- Checks supplied: `.agent/checks/TASK-026-checks-01.txt` — `pnpm check` PASS (15 files, 131 tests), `pnpm build` PASS, `pnpm test:e2e` PASS (79 tests), and `pnpm test:integration` PASS (12 files, 57 tests). Reviewer rerun: `pnpm exec playwright test tests/e2e/favorites.spec.ts` produced 21 PASS and 1 FAIL; the failed removal test then passed 5/5 in an isolated repeat, demonstrating timing-dependent coverage rather than a deterministic product failure.
- Surrounding code inspected: accepted presentation/favorite/feed database contracts and handlers, existing practice/history/mistakes browser contracts and navigation lifecycles, Next rewrite boundary, README behavior/API documentation, and all new Favorites E2E coverage.

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| An authenticated learner can save the current presented question through the accepted favorite mutation API. | PASS | The visible presentation sends exactly `{ presentationId, favorite: true }` with the in-memory bearer token and `no-store`; the response is strict and must exactly match. Synchronous guards prevent duplicate saves and answer/continue races. Failures retain the presentation and answer/result state; 401 clears the session, 404 uses safe guidance, navigation invalidates late callbacks, and the next presentation starts unsaved. |
| Favorites are accessible from setup and practice as a localized, paginated immutable question list with removal controls. | FAIL | Entry, origin return, safe snapshot rendering, localization/fallback, paging and exact-confirmation removal are present, but removal can erase the traversal's duplicate memory. A later page can therefore re-append the same presentation/question that was already returned and removed locally. |
| Loading, retry, empty, expired-session, malformed-response, duplicate-page and stale-response states are accessible and recoverable. | FAIL | Most states are handled correctly, including exact-cursor retry and late 401 suppression. Cross-page duplicate rejection fails after removal because validation uses only the current visible list rather than all IDs observed in the traversal. |
| Browser tests cover save, browse, pagination, removal, navigation, localization and existing practice/history/mistakes regressions. | FAIL | The scenarios are broadly represented and the full authoritative suite passed, but the removal overlap test has a real readiness race and failed the reviewer suite. No test combines successful removal with a later duplicate page, which leaves the blocker undetected. |

## Findings

### Blockers

1. **Removing an item resets its cross-page duplicate protection**
   - Severity: blocker
   - File: `apps/web/app/favorites.tsx:47`
   - Problem: Every page response rebuilds `presentationIds` and `questionIds` solely from `itemsRef.current`. A successful removal filters that item out of `itemsRef.current` at lines 92–94. Consequently, after page 1 returns favorite A and A is removed, a later malformed or stale page containing A's presentation ID or question ID passes the duplicate check and is appended. The same gap occurs when pagination and removal overlap and removal wins before the page callback validates its payload.
   - Why it matters: The task explicitly requires duplicate presentation/question rejection across pages and asks removal requests to remain safe under concurrency. The current boundary can render a duplicate traversal record and can visibly resurrect a favorite the learner just removed. It also means the browser no longer fails closed on a response shape the accepted feed invariant says cannot occur.
   - Required correction: Track presentation and question IDs observed during the complete mounted feed traversal independently of the currently displayed items. Add IDs only after an entire page passes validation, never delete them on local removal, and preserve them across pagination retries. Add browser cases for both repeated presentation ID and repeated question ID after the corresponding first-page favorite has been removed, including an overlapping removal/page-response ordering.

### Important

1. **The removal concurrency E2E can silently click before the feed is ready**
   - Severity: important
   - File: `tests/e2e/favorites.spec.ts:329`
   - Problem: `openFavorites` returns immediately after clicking the navigation button. The test then uses `page.evaluate` to find Remove and calls `button?.click()` twice without first asserting that the first favorite has rendered. Under the normal two-worker focused suite, the optional chain clicked nothing and the test failed waiting for Removing. An isolated `--repeat-each=5 --workers=1` run passed 5/5, confirming load-timing sensitivity.
   - Why it matters: This is the required synchronous duplicate-removal guard coverage. A test that can skip the action under load makes the gate unreliable and violates the Definition of Done requirement that tests not depend unnecessarily on timing.
   - Required correction: Wait for the favorite entry/Remove control to be visible before dispatching the two same-turn clicks, while retaining the same-turn double-click that verifies the synchronous guard. Rerun the focused suite under its configured parallelism and the complete E2E gate.

### Minor

1. **README's explicit rewrite inventory omits the two new routes**
   - Severity: minor
   - File: `README.md:428`
   - Problem: The Mini App section still says the explicit rewrites cover the old route list “only,” omitting `/me/favorites` and `/practice/favorite`, although `next.config.ts` now exposes both and the new Favorites documentation relies on them.
   - Why it matters: The security-boundary documentation contradicts the actual explicit proxy surface and can mislead maintainers reviewing or configuring the web/API boundary.
   - Required correction: Add `/me/favorites` and `/practice/favorite` to the explicit rewrite inventory.

## Security review

- PASS — the implementation keeps bearer credentials in component memory, uses only explicit same-origin route rewrites and `no-store` requests, rejects unknown fields at every nested Favorites response boundary, validates UUIDs/canonical timestamps/canonical bounded cursors, renders only the safe presented-question fields, and suppresses late response/401 effects after departure. No correctness, answer, explanation, source, image or credential data is rendered or persisted. The duplicate-state blocker is a correctness/trust-boundary failure but does not expose another learner's data.

## Test review

- coverage inadequate
- missing scenarios: duplicate presentation ID after the first-page item is removed; duplicate question ID after the first-page item is removed; overlap where a removal completes before a pending page response is validated. The existing removal guard test also needs an explicit readiness wait before its same-turn double click. Save/submit/continue guards, exact mutation bodies, transport/HTTP/malformed retries, 401/404 behavior, localization fallback, ordinary two-page traversal, cursor retry, initial/in-page malformed responses, late navigation, origin return and existing practice/history/mistakes suites otherwise have appropriate browser coverage.

## Architecture review

- compliant — the implementation stays within `apps/web/**`, `tests/**` and `README.md`, adds no dependency or persistence/backend change, uses strict TypeScript without unsafe escapes, preserves the Next/Fastify boundary and in-memory opaque session strategy, and introduces no material architecture change. The README route inventory should be corrected as noted above.

## Final reviewer statement

The primary save, browse, localization, navigation, retry, 401 and safe-rendering paths are sound, and the authoritative gates passed. The feed nevertheless forgets previously returned identities when an item is removed, so it does not uphold the task's cross-page duplicate contract during a required removal interaction. The missing regression case and timing-dependent removal test prevent reliable acceptance until corrected.

VERDICT: FAIL
