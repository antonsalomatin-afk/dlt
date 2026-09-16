# TASK-021 Review 01

## Verdict

`VERDICT: FAIL`

## Scope reviewed

- Task: `.agent/tasks/TASK-021.yaml` — Deliver questions for a selected category, including every resolved Supervisor refinement.
- Commit(s): implementation commit `5caedc15b31b8bbf9f728b2b33b5b343cc073aea` against parent `3d5bb6442d6cf94e0d77108b5de38d0998891030`. The later checked HEAD modifies only `.agent/**`; the implementation, tests and README reviewed match the implementation commit.
- Relevant ADR(s): ADR-001, ADR-002 and ADR-004. ADR-005 was checked for browser/API boundary consistency; this task does not change the browser route or session strategy.
- Checks supplied: `.agent/checks/TASK-021-checks-01.txt` records `pnpm check` PASS (13 files, 119 tests) and `pnpm test:integration` PASS (9 files, 35 tests) for implementation commit `5caedc15b31b8bbf9f728b2b33b5b343cc073aea`.
- Surrounding code inspected: Fastify parsing and error handling, bearer-session lookup, saved-vehicle enforcement, Prisma question/category/presentation models and index, response and snapshot schemas, prior practice delivery/answer tests, the new unit and real-PostgreSQL integration coverage, and README endpoint documentation.
- Reviewer diagnostics: a raw authenticated JSON body containing two `categoryId` members returned 404 and reached selection instead of returning 400; a syntactically malformed JSON body with an invalid bearer token returned 400 before session authentication instead of the required 401.

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| Optional strict `categoryId` selector with absent-body and `{}` compatibility | FAIL | Absent body, `{}`, one UUID, null, array, malformed scalar and unknown parsed fields behave correctly. Duplicate raw JSON object members are collapsed by Fastify/`JSON.parse` before the Zod schema sees the body, so a body with two `categoryId` members is accepted using the last UUID rather than rejected with 400. |
| Authentication, body and saved-vehicle precedence | FAIL | For schema-invalid but syntactically valid JSON, the handler authenticates before Zod validation and checks the vehicle last. Fastify parses JSON before entering the handler, however, so syntactically malformed JSON with invalid credentials returns 400 rather than the required uniform 401 regardless of body. |
| Filtered database eligibility and deterministic delivery | PASS | The optional category UUID is spread directly into the same Prisma `Question.findFirst` predicate as saved `vehicleType`, `active: true` and `verificationStatus: VERIFIED`, with deterministic ID ordering. There is no category-existence query or application-side filtering. |
| Uniform private 404 and no-presentation failure behavior | PASS | Unknown UUIDs, a category eligible only for another vehicle, and a category containing only inactive/draft/rejected questions all receive the same `404 { error: "No questions available" }`; the transaction creates no presentation when no question matches. |
| Accepted response and immutable snapshot contract | PASS | Selection remains in the repeatable-read transaction, snapshot construction and strict response parsing are unchanged, and the response exposes only the accepted question DTO. Focused integration coverage demonstrates that later question, choice, answer-key, explanation, source and image edits do not alter the stored snapshot. |
| Integration coverage for selector, isolation, compatibility and safety | FAIL | The real-PostgreSQL suite adequately covers parsed-object strictness, eligibility dimensions, unfiltered behavior, uniform 404s, no-write failures, response leakage and snapshot immutability. It constructs bodies with `JSON.stringify`, so it omits duplicate raw object members and syntactically malformed JSON under invalid authentication; both missing cases expose the two failing boundary behaviors above. |

## Findings

### Blockers

1. **Duplicate `categoryId` members are accepted at the HTTP boundary**
   - Severity: blocker
   - File: `apps/api/src/index.ts:209`; `packages/database/src/presentation.ts:18`; `tests/practice-category.integration.test.ts:179`
   - Problem: Strict Zod validation runs only after Fastify has parsed the JSON. Standard parsing collapses duplicate object members, so an authenticated raw body such as `{"categoryId":"22222222-2222-4222-8222-222222222222","categoryId":"33333333-3333-4333-8333-333333333333"}` becomes a valid one-field object. A reviewer diagnostic reached question selection and returned the empty-bank 404 rather than the required 400.
   - Why it matters: The Supervisor refinement explicitly requires duplicate selector values to receive the established 400. The current request boundary is not strict for the wire representation and permits ambiguous selector shadowing.
   - Required correction: Detect and reject duplicate JSON object members before they are collapsed, while retaining the exact absent-body, `{}` and single-UUID behavior. Add an authenticated raw-body integration test that would succeed if a first- or last-value parser silently wins.

2. **Malformed JSON bypasses the required authentication-first precedence**
   - Severity: blocker
   - File: `apps/api/src/index.ts:206`; `tests/practice-category.integration.test.ts:156`
   - Problem: Although authentication is the first statement in the route handler, Fastify's JSON parser executes before the handler. With an invalid bearer token and payload `{`, the current endpoint returns `400 { "error": "Bad Request" }`; it never reaches the session check that should return the uniform 401. The new precedence test uses only syntactically valid JSON and therefore does not expose this lifecycle ordering.
   - Why it matters: The resolved task contract says to authenticate first and that invalid credentials remain 401 regardless of body. The current behavior reveals whether the body is syntactically parseable before authentication and violates the specified stable precedence.
   - Required correction: Move or duplicate the route's bearer-session authentication into a lifecycle stage that runs before body parsing, then reuse the authenticated user for body and vehicle validation. Add a raw malformed-JSON test for missing, unknown and expired credentials, plus an authenticated malformed-JSON assertion for the established 400.

### Important

None.

### Minor

None.

## Security review

- Findings listed above. The category predicate and uniform no-match 404 correctly avoid category/content-state disclosure, the response omits correctness and hidden metadata, caching is disabled, credentials are not logged, and failures are sanitized. The pre-authentication JSON parse result remains an observable boundary leak contrary to the task's explicit precedence rule.

## Test review

- coverage inadequate
- missing scenarios: an authenticated raw body with duplicate `categoryId` object members; syntactically malformed JSON with missing, malformed, unknown and expired bearer credentials; and authenticated syntactically malformed JSON confirming the established 400 after authentication.

## Architecture review

- compliant apart from the acceptance failures above. The implementation remains within the accepted Fastify/Prisma/PostgreSQL architecture and opaque bearer-session model, introduces no schema/dependency/service change, and stays within the task's allowed implementation paths.

## Final reviewer statement

`VERDICT: FAIL` — the category/vehicle/active/VERIFIED predicate, privacy-preserving 404, response boundary and immutable snapshot behavior are correct, and the supplied checks pass. TASK-021 cannot be accepted because duplicate raw selector members are accepted and malformed JSON is processed before authentication, with the focused tests missing both required wire-level cases.
