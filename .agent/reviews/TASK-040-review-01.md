# TASK-040 Review 01

## Verdict

`VERDICT: PASS`

## Scope reviewed

- Task: TASK-040 — Show concept progress in the Mini App
- Commit(s): `96fcd5c6fcf63a57b9b230a8ad7f32a2d8f971dc`
- Relevant ADR(s): ADR-002 core TypeScript monorepo stack; ADR-004 opaque bearer API sessions; ADR-005 Mini App boundary
- Checks supplied: `.agent/checks/TASK-040-checks-01.txt`
- Independent checks: `pnpm exec playwright test tests/e2e/concepts.spec.ts` PASS (19 tests); full `pnpm test:e2e` PASS (156 tests)

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| Reachable from setup before a vehicle is chosen and from practice; Back returns to origin | PASS | Wired through the same `feedReturn` origin record as the accepted Progress view; both origins are tested, including the clean practice remount. |
| Exactly one validated request per mount | PASS | A synchronous `busy` guard plus a mount-scoped `active` ref; the fetch recorder asserts one GET with no body and `no-store`, and the overlap test proves a double retry click issues one request. |
| Total, weakest-first rows, ungrouped bucket, empty state | PASS | Rows render name, accuracy and correct-of-answered; the bucket appears only with answers; zero answers show zero totals, an em dash and guidance with no rows. |
| Lifecycle, 401, malformed, stale and departure behavior with green suites | PASS | Eight strict rejections including bad ordering, duplicate IDs, a mismatched total and a zero-answer row; transport, HTTP and malformed retry; 401 clears the session; departure ignores a late outcome; storage asserted empty. |

## Findings

### Blockers

None.

### Important

None.

### Minor

None. The accuracy bar is decorative and marked `aria-hidden`, with the percentage and counts carried in text, so no figure is conveyed by colour or width alone.

## Security review

- PASS: the bearer token stays in memory and only ever appears in the Authorization header; the response is validated by a strict schema before rendering; no question wording, answer or explanation is exposed by this endpoint; nothing is written to browser storage.

## Test review

- Coverage adequate. The browser contract duplicates the server invariants deliberately, and the ordering and reconciliation rejections prove the browser does not trust the server blindly.

## Architecture review

- Compliant. One explicit same-origin rewrite, no dependency, no backend change. No mastery label, readiness figure or schedule was added, matching the accepted Product Owner decision of 2026-09-22.

## Final reviewer statement

Learners can now see which rules they are weakest at, in their own language, without any inferred readiness claim.

VERDICT: PASS
