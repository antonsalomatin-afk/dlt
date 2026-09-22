# TASK-041 Review 01

## Verdict

`VERDICT: PASS`

## Scope reviewed

- Task: TASK-041 — Deliver practice questions for one learning concept
- Commit(s): `4473629e0befb415a9444610a13bc4124c92de06`
- Relevant ADR(s): ADR-002 core TypeScript monorepo stack; ADR-004 opaque bearer API sessions
- Checks supplied: `.agent/checks/TASK-041-checks-01.txt`
- Independent checks: `pnpm exec vitest run tests/presentation.test.ts` PASS (2 tests); isolated PostgreSQL `tests/practice-concept.integration.test.ts` PASS (6 tests); full `pnpm test:integration` PASS (115 tests)

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| Optional conceptId selector, mutually exclusive with categoryId, no regression | PASS | The schema refinement rejects both selectors together; the unit test covers twelve rejected shapes. Absent body, `{}` and a category selector still resolve to the same questions as before. |
| Vehicle and eligibility enforced, snapshot contract retained | PASS | `conceptId` joins the one existing `Question` predicate, so the repeatable-read transaction, injected offset, snapshot creation and response boundary are untouched. |
| Uniform private 404 with no metadata disclosure | PASS | A motorcycle-only concept, an inactive/draft/rejected concept, an empty concept and a random UUID all return the same 404 with no presentation written. The success body is asserted free of correctness, explanations, source, image and even the concept ID. |
| Integration coverage of isolation, exclusivity, privacy and regression | PASS | Six cases including the raw duplicate-member payload and unauthorized precedence with a concept selector. |

## Findings

### Blockers

None.

### Important

None.

### Minor

None. No concept list endpoint was added: the Mini App already receives `conceptId` values from `GET /me/progress/concepts`, so no new disclosure surface was created for this slice.

## Security review

- PASS: authentication precedes body validation, which precedes the vehicle check. The selector is a validated UUID placed in a Prisma predicate, never interpolated. Concept existence is never probed separately, so the endpoint cannot be used to enumerate concepts or another vehicle's content.

## Test review

- Coverage adequate. Not covered: repeat-avoidance or weakest-concept selection on the server, both explicitly out of scope; the Mini App scope control is TASK-042.

## Architecture review

- Compliant. No migration, no dependency, one predicate field and one schema refinement.

## Final reviewer statement

Concept-scoped practice reuses the accepted category-filter shape exactly, including its privacy rule, so a learner can drill one rule without any new disclosure.

VERDICT: PASS
