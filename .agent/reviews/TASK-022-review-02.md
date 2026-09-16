# TASK-022 Review 02

## Verdict

`VERDICT: PASS`

## Scope reviewed

- Task: `TASK-022` — Choose a practice category in the Mini App
- Commit(s): `6be4d70c5287e4301703e440adbbee41b83986de` and review-fix `7465e28299face0391a108ebaa1e3832c872e877`, reviewed against pre-task parent `8d0d5eb3aea034b8acdf7cf9d2864e7b215a683b`
- Relevant ADR(s): ADR-002, ADR-004, ADR-005
- Checks supplied: `.agent/checks/TASK-022-checks-01.txt` — `pnpm check` PASS (119 tests), `pnpm build` PASS, `pnpm test:e2e` PASS (57 tests), `pnpm test:integration` PASS (37 tests); `.agent/checks/TASK-022-checks-02.txt` — `pnpm check` PASS (127 tests), `pnpm build` PASS, `pnpm test:e2e` PASS (57 tests), `pnpm test:integration` PASS (37 tests). Reviewer reruns: `pnpm check` PASS (127 tests), focused category contract tests PASS (8 tests), focused practice browser suite PASS (30 tests).

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| The Mini App loads and strictly validates eligible categories for the saved vehicle through the accepted API. | PASS | The explicit same-origin GET rewrite is present. The browser sends the in-memory bearer token with `cache: 'no-store'` and accepts only a strict envelope of at most 100 strict category objects. UUIDs, trimmed nonblank strings, positive integer counts, unknown members, duplicate slugs and canonicalized duplicate UUID identities are validated before rendering. |
| A learner can practice all questions or select one category, and every next-question request carries the exact corresponding selector. | PASS | The accessible radio group preserves server order and stable category IDs, shows counts, defaults to All categories on each fresh mount and follows the existing language choice. All sends exactly `{}`; selected and continued category practice send exactly `{ categoryId }`. Scope is locked for unanswered/pending work and can change after a result without changing that completed presentation or result. |
| Loading, empty, retry, expired-session, missing-vehicle, malformed-response and no-question states remain accessible and recoverable. | PASS | Category loading blocks question delivery, empty categories retain All categories, failures expose retry, 401 clears the session, 409 returns to vehicle setup, invalid payloads render nothing, and filtered/unfiltered 404 states preserve the intended scope behavior. Responses arriving after departure are ignored. Established answer retry, duplicate-answer, navigation and stale-response handling remain intact. |
| Browser tests cover category rendering, localization, selection, request bodies, continuation and established practice regressions. | PASS | Playwright covers authenticated loading, server order/counts, language labels, All and category bodies, selected continuation, post-result scope changes, empty/retry/malformed/duplicate/401/409/404/late-response paths, and existing question, answer, navigation, history and mistakes regressions. Focused schema tests independently isolate case-variant duplicate UUIDs, 100/101 items, blank/untrimmed strings, zero/fractional counts, unknown item fields and extra envelope fields. |

## Findings

### Blockers

None.

### Important

None.

### Minor

None.

## Security review

- PASS. Category requests use the memory-only bearer session, explicit same-origin routing and `no-store`; credentials are neither persisted nor rendered. Protected 401 handling clears the session, payloads are runtime-validated before use, and late responses cannot re-enter a departed practice view.

## Test review

- coverage adequate
- missing scenarios: none material to TASK-022

## Architecture review

- compliant. The change stays within `apps/web/**`, `tests/**` and `README.md`, preserves the accepted web/API/session boundary, and introduces no backend, persistence, dependency, deployment or architecture change.

## Final reviewer statement

The review-fix canonicalizes UUID identity for duplicate detection while preserving the API-provided stable value, and its browser test now exercises the case-variant duplicate through the user-visible rejection/retry path. Focused contract tests protect every validation boundary identified in Review 01. The full implementation satisfies TASK-022 with no unresolved blocker or material test gap; `VERDICT: PASS`.
