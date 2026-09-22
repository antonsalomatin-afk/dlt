# TASK-042 Review 01

## Verdict

`VERDICT: PASS`

## Scope reviewed

- Task: TASK-042 — Practise the weakest concept from the Mini App
- Commit(s): `2d20cbc3a9846d5c6fb22ceae15592bc9df5155e`
- Relevant ADR(s): ADR-002 core TypeScript monorepo stack; ADR-004 opaque bearer API sessions; ADR-005 Mini App boundary
- Checks supplied: `.agent/checks/TASK-042-checks-01.txt`
- Independent checks: `pnpm exec playwright test tests/e2e/weakest-concept.spec.ts` PASS (10 tests); full `pnpm test:e2e` PASS (166 tests); full `pnpm test:integration` PASS (116 tests)

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| Weakest-rule scope offered with name and accuracy | PASS | Taken as `concepts[0]` from the validated weakest-first array with no browser reordering; the label carries the localized name and the server's percentage. |
| Exactly `{ conceptId }` on first and continued requests, scope locking unchanged | PASS | Both request bodies are asserted; the scope group stays disabled while a presented question is unanswered, and the three scopes are mutually exclusive in both directions. |
| Unavailable or empty concept progress leaves practice working; 401 still clears | PASS | Transport, HTTP, malformed and empty cases all hide the option, raise no alert and still deliver an unfiltered question with body `{}`. The 401 case clears the session before practice renders, which the test asserts directly rather than through the practice view. |
| A concept with nothing eligible names the rule and keeps the scope | PASS | The guidance names the localized rule, the radio stays checked, and a retry succeeds. |

## Findings

### Blockers

None.

### Important

None.

### Minor

None. The auxiliary request deliberately produces no error banner on failure, so a category-loading error is never masked or duplicated by it. That trade-off is documented in the README.

## Security review

- PASS: the bearer token stays in memory and appears only in the Authorization header. The concept ID sent back to the API came from a strictly validated response, and the endpoint applies its own eligibility and privacy rules regardless. Nothing is written to browser storage, asserted in the first test.

## Test review

- Coverage adequate: request bodies, exclusivity, locking, localization, four degradation modes, the private 404 path, session expiry and departure with a late response.

## Architecture review

- Compliant. Reuses the rewrite added in TASK-040, no new endpoint, no dependency, no backend change. No mastery, readiness or scheduling was introduced, matching the accepted Product Owner decision of 2026-09-22.

## Final reviewer statement

Epic 6 now closes the loop it set out to close: the learner sees which rule is weakest and can practise exactly that rule, with no inferred readiness claim anywhere.

VERDICT: PASS
