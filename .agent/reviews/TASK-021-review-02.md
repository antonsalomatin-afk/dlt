# TASK-021 Review 02

## Verdict

`VERDICT: PASS`

## Scope reviewed

- Task: `.agent/tasks/TASK-021.yaml` — Deliver questions for a selected category, including every resolved Supervisor refinement.
- Commit(s): implementation commit `5caedc15b31b8bbf9f728b2b33b5b343cc073aea` and review-fix commit `07b421582a2b739dfde2dc5aa639aa07096474e8`, reviewed as the complete diff against pre-task parent `3d5bb6442d6cf94e0d77108b5de38d0998891030`. Later commits through the current HEAD modify only `.agent/**`; the implementation, tests and README still match the fix commit.
- Relevant ADR(s): ADR-001, ADR-002, ADR-003, ADR-004 and ADR-005, covering independent review, the Fastify/Prisma/PostgreSQL stack, validated Telegram identity, opaque bearer sessions and the Mini App/API boundary.
- Checks supplied: `.agent/checks/TASK-021-checks-01.txt` records the initial implementation gates passing with 13 files/119 tests and 9 files/35 integration tests. `.agent/checks/TASK-021-checks-02.txt` records the fix gates passing with 13 files/119 tests and 9 files/37 integration tests.
- Reviewer verification: reran `pnpm check` (13 files/119 tests) and `pnpm test:integration` (9 files/37 tests), both PASS. Also exercised duplicate keys with ordinary and escaped spellings, JSON content-type parameters, unsupported vendor JSON, nested values and malformed JSON under invalid authentication.
- Surrounding code inspected: Fastify lifecycle and content-type-parser implementation, parser encapsulation, bearer-session lookup and expiry handling, saved-vehicle enforcement, Prisma question/category/presentation models and indexes, response and snapshot schemas, prior delivery/answer tests, the focused unit and real-PostgreSQL integration coverage, and README endpoint documentation.

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| Optional strict `categoryId` selector with absent-body and `{}` compatibility | PASS | The request schema accepts only an absent body, `{}`, or one UUID `categoryId`. Null, arrays, malformed UUIDs and unknown keys return the stable 400. The route-scoped raw JSON parser rejects duplicate decoded top-level members before `JSON.parse` output reaches Zod, including escaped equivalent key spellings. |
| Authentication, body and saved-vehicle precedence | PASS | A route-scoped `onRequest` hook resolves the bearer session before Fastify body parsing. Missing, malformed, unknown and expired credentials therefore return the uniform 401 even for syntactically malformed JSON; authenticated malformed JSON returns 400; and only an authenticated valid body proceeds to the saved-vehicle check and its established 409. |
| Filtered database eligibility and deterministic delivery | PASS | The optional category UUID is added directly to the same Prisma `Question.findFirst` predicate as the saved vehicle, `active: true` and `verificationStatus: VERIFIED`, ordered deterministically by question ID. No category-existence query or application-memory eligibility filtering was added. |
| Uniform private 404 and no-presentation failure behavior | PASS | Unknown UUIDs, categories eligible only for another vehicle, and categories with only inactive, draft or rejected questions all return the identical `404 { error: "No questions available" }`. The transaction exits without creating a presentation when no eligible row matches. |
| Accepted response and immutable snapshot contract | PASS | Selection remains in the repeatable-read transaction. Snapshot creation and strict response validation retain the accepted contract, and before-answer responses omit correctness, explanations, source/image metadata and other hidden fields. PostgreSQL coverage proves that later wording, choice, answer-key, explanation, source and image edits do not alter the stored snapshot. |
| Unfiltered compatibility, answer regression safety, tests and documentation | PASS | Absent-body and `{}` requests still select the first eligible question by ID and return the exact safe response boundary. Encapsulation limits the custom parser and auth hook to `/practice/next`, leaving `/practice/answer` and other routes on their established behavior. Focused unit/integration coverage includes every required selector, eligibility, privacy, write-safety and snapshot scenario, and README documents selector semantics and uniform 404 privacy. |

## Findings

### Blockers

None.

### Important

None.

### Minor

None.

## Security review

- PASS — authentication now completes before body parsing at the Fastify lifecycle boundary; duplicate top-level members cannot shadow the selector; external body data is runtime-validated; category state remains private behind a uniform 404; responses expose no hidden answer or content metadata; cache prevention and sanitized errors remain intact; and credentials are neither logged nor returned.

## Test review

- coverage adequate
- missing scenarios: none required by the task. The review-fix tests directly reproduce both prior blockers, while the full passing suites cover absent body, `{}`, one UUID, invalid selectors, vehicle precedence, all eligibility dimensions, uniform 404 behavior, no-write failures, response leakage, unfiltered behavior, immutable snapshots and answer submission regression.

## Architecture review

- compliant — the route uses the accepted Fastify/Prisma/PostgreSQL architecture and opaque bearer-session strategy. Fastify encapsulation confines the pre-parse auth hook and unique-member parser to `/practice/next`; no schema, dependency, external service, deployment boundary or material architecture change was introduced.

## Final reviewer statement

`VERDICT: PASS` — TASK-021 satisfies every acceptance criterion and Supervisor refinement. The two prior blockers are fixed at the actual HTTP/Fastify boundary, the authoritative and independently rerun checks pass, and no unresolved findings remain. Acceptance, repository-state updates and recording the accepted commit remain the Supervisor's responsibility.
