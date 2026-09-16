# TASK-022 Review 01

## Verdict

`VERDICT: FAIL`

## Scope reviewed

- Task: `TASK-022` — Choose a practice category in the Mini App
- Commit(s): `6be4d70c5287e4301703e440adbbee41b83986de` against parent `8d0d5eb3aea034b8acdf7cf9d2864e7b215a683b`
- Relevant ADR(s): ADR-002, ADR-004, ADR-005
- Checks supplied: `.agent/checks/TASK-022-checks-01.txt` — `pnpm check` PASS (119 tests), `pnpm build` PASS, `pnpm test:e2e` PASS (57 tests), `pnpm test:integration` PASS (37 tests)

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| The Mini App loads and strictly validates eligible categories for the saved vehicle through the accepted API. | FAIL | Authentication, no-store fetching, the explicit rewrite, strict objects, array limit, strings, counts and exact duplicate strings are implemented, but semantically duplicate UUIDs with different hexadecimal casing are accepted. |
| A learner can practice all questions or select one category, and every next-question request carries the exact corresponding selector. | PASS | All sends `{}`; selected and continued category practice send exactly `{ categoryId }`; server order and stable option values are preserved. |
| Loading, empty, retry, expired-session, missing-vehicle, malformed-response and no-question states remain accessible and recoverable. | PASS | The reviewed state transitions handle category loading/retry, empty lists, 401, 409, invalid payloads, filtered and unfiltered 404 responses, and departure while a request is pending. |
| Browser tests cover category rendering, localization, selection, request bodies, continuation and established practice regressions. | FAIL | Core flows and regressions are covered, but the strict validation boundary coverage does not independently exercise the array maximum, blank/untrimmed strings, or count rules, and it misses case-variant duplicate UUIDs. |

## Findings

### Blockers

1. **Case-variant representations of the same UUID bypass duplicate category-ID rejection**
   - Severity: blocker
   - File: `apps/web/lib/contracts.ts:45`
   - Problem: `z.uuid()` accepts uppercase and lowercase hexadecimal UUID representations, while the duplicate check stores the original strings in a case-sensitive `Set`. A payload containing `550e8400-e29b-41d4-a716-446655440101` and `550E8400-E29B-41D4-A716-446655440101` passes `practiceCategoriesSchema`, although both values identify the same UUID. I reproduced this directly against the committed schema. Both options can therefore render and submit the same backend category identity.
   - Why it matters: The task explicitly requires duplicate category IDs to be rejected before rendering. UUID hexadecimal casing does not create a distinct identifier, so this violates the strict response contract and can present duplicate scopes for one category.
   - Required correction: Compare category IDs in a canonical form (for example, lowercase for duplicate detection) or canonicalize UUIDs during parsing while preserving the intended option contract. Add a browser or focused schema test proving that case-variant forms of one UUID reject the whole payload.

### Important

1. **Malformed-category tests do not verify several required validation boundaries independently**
   - Severity: important
   - File: `tests/e2e/practice.spec.ts:112`
   - Problem: The single `malformed` fixture combines `questionCount: 0` with an unknown item field, so the test would remain green if positive-count validation were removed. No test exercises 101 categories, blank or untrimmed category strings, a non-integer count, or an extra top-level envelope field.
   - Why it matters: Strict maximum, string, count and envelope validation are explicit refinements of this task. The current tests establish generic rejection but do not protect those individual rules from regression.
   - Required correction: Add focused table-driven validation cases that isolate the 100/101 boundary, blank and untrimmed strings, zero/fractional counts, and strict top-level/item shapes. These can use focused schema tests if that keeps browser coverage concise, while retaining a browser malformed-response recovery test.

### Minor

None.

## Security review

- PASS. The new request uses the in-memory bearer token, same-origin explicit rewrite, and `cache: 'no-store'`; credentials are neither persisted nor rendered. 401 handling clears the session through the established callback, and late responses are ignored after navigation.

## Test review

- coverage inadequate
- missing scenarios: case-variant duplicate UUIDs; isolated array overflow; blank and untrimmed strings; isolated zero/fractional question counts; extra top-level envelope member

## Architecture review

- compliant. The implementation remains inside the web/browser boundary authorized by ADR-005 and adds no dependency, persistence, backend, or deployment change.

## Final reviewer statement

The selection, request, lifecycle, localization, navigation and existing answer/history/mistakes behavior are otherwise consistent with TASK-022, and all supplied authoritative checks pass. The response validator must reject semantically duplicate UUIDs, and the explicit validation rules need focused regression coverage before this task can receive `VERDICT: PASS`.
