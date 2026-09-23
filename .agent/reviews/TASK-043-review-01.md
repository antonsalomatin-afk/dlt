# TASK-043 Review 01

## Verdict

`VERDICT: PASS`

## Scope reviewed

- Task: TASK-043 — Require authored provenance before a question can be verified
- Commit(s): `7e6e8d53a90a76e7384c72c6523155b2831abd8f`
- Relevant ADR(s): ADR-002 core TypeScript monorepo stack
- Product Owner decision: 2026-09-22, production content is original in-house work citing public Thai traffic law
- Checks supplied: `.agent/checks/TASK-043-checks-01.txt`
- Independent checks: `pnpm exec vitest run tests/provenance.test.ts` PASS (5 tests); isolated PostgreSQL `tests/question.integration.test.ts` PASS (3 tests); full `pnpm test:integration` PASS (116 tests)

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| A VERIFIED question cannot be stored without original authorship and a non-blank citation | PASS | Two CHECK constraints, proven on both insert and update. `BTRIM(COALESCE(...))` rejects null, empty and whitespace-only citations, which the test exercises with a tab and newline. |
| Drafts and rejected rows unaffected; fixtures remain storable | PASS | Only rows whose status is VERIFIED are constrained. The fixture importer still writes FIXTURE, inactive, DRAFT rows and its integration test passes untouched. |
| Shared validator with precise messages, unit tested | PASS | `questionProvenanceSchema` mirrors both rules with distinct messages and reports both at once; the assert helper joins them for tooling. |
| PostgreSQL tests prove each rejection and the accepted case; all suites green | PASS | Seven rejected inserts, two single-rule update rejections, one accepted promotion, plus an assertion that both constraints exist by name. |

## Findings

### Blockers

None.

### Important

None.

### Minor

None. Two deliberate scope choices are worth recording. The `active` flag is not constrained, so an active unverified row stays representable and the existing delivery tests keep proving that filtering depends on verification too. Reviewer identity and `reviewedAt` are not required here; they belong to the review workflow task and would otherwise couple two separate rules in one constraint.

## Security review

- N/A for request handling. The change reduces risk: content of unknown origin can no longer reach the verified state that every learner-facing query requires, which is the concrete protection the content decision was made for.

## Test review

- Coverage adequate. The fixture updates are mechanical but meaningful: every verified test row now carries a citation, so the suites exercise the same shape production content must have. The migration-chain test was extended with the new migration name.
- Not covered: an authoring or admin surface calling the validator, since none exists yet. That is the point of the following Epic 7 tasks.

## Architecture review

- Compliant. Raw CHECK constraints follow the convention established by the exam tables, which Prisma does not model. No dependency, no API change.

## Final reviewer statement

The content decision is now a database invariant rather than a paragraph, and the failure modes are proven one rule at a time.

VERDICT: PASS
