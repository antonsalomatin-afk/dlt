# TASK-040 Review 01

## Verdict

`VERDICT: PASS`

## Scope reviewed

- Task: `TASK-040` — Persist immutable concept attribution for learning attempts, including every Supervisor refinement.
- Commit(s): Builder commit `11c6f77e5d654088c7592763ad11d82ebb679bc7` against parent `d9057b0`.
- Relevant ADR(s): ADR-001 agent workflow, ADR-002 TypeScript/PostgreSQL/Prisma stack and ADR-004 opaque bearer sessions. Accepted TASK-005, TASK-011, TASK-029 and TASK-030 specifications and reviews were inspected for the inherited concept, snapshot, ownership and exam invariants.
- Checks supplied: `.agent/checks/TASK-040-checks-01.txt` records `pnpm check` PASS (25 files, 172 tests), `pnpm prisma validate` PASS and `pnpm test:integration` PASS (21 files, 116 tests).
- Independent checks: focused `tests/concept-attribution.integration.test.ts` PASS (1 file, 3 tests); `git diff --check` PASS.
- Independently inspected the complete Builder diff, Prisma schema and migration chain, practice and exam creation transactions, surrounding history/mistakes/favorites/current-exam/completion/review response boundaries, integration coverage and README documentation.

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| Practice presentations and exam questions copy nullable source concept identity at creation | PASS | `/practice/next` copies `question.conceptId` from the same repeatable-read row used to construct its immutable snapshot. `/exam/start` copies each selected question's value alongside its snapshot in the existing serializable transaction. Grouped and ungrouped creation are covered against PostgreSQL. |
| Existing rows are safely backfilled from their referenced questions | PASS | The additive migration creates nullable columns, copies only the referenced `Question.conceptId`, and naturally retains null for ungrouped questions. The isolated upgrade fixture builds every prior migration, inserts grouped and ungrouped practice/exam rows, applies the new migration and verifies the exact results. Fresh full-chain deployment is exercised by the integration suite. |
| Stored attribution remains historically stable | PASS | No update path derives or rewrites historical concept fields. Focused tests reassign or remove source question concepts and prove grouped attribution remains the original ID while originally ungrouped rows remain null. |
| Foreign keys, indexes, deletion and inherited constraints preserve integrity | PASS | Both optional relations use explicit `ON DELETE RESTRICT`/`ON UPDATE CASCADE` foreign keys. Practice has a `(userId, conceptId)` aggregation index; exam attribution has a `conceptId` index while existing session ownership/join indexes remain intact. Tests move source questions away before proving the historical references independently reject concept deletion. Existing primary, ownership, question, position, answer-tuple and uniqueness constraints are unchanged. |
| Public contracts remain unchanged and private | PASS | No public schema or browser file changed. All affected endpoints continue returning explicit strict snapshot-derived DTOs; concept fields are used only in persistence writes. Practice and exam-start integration assertions exclude both the `conceptId` key and actual concept UUID, while the authoritative regression suite covers answer, current exam, completion, history, mistakes, favorites and review paths. |
| PostgreSQL coverage, documentation and scope satisfy the refinement | PASS | Tests cover upgrade backfill, fresh migration presence, grouped/ungrouped new rows, stability after regrouping/removal, deletion rejection, schema metadata and response privacy. README documents the server-only boundary and explicitly excludes mastery, scoring, selection, endpoint and UI changes. All Builder files are within `files_allowed`; no dependency, credential, deployment, content or architecture change was introduced. |

## Findings

### Blockers

None.

### Important

None.

### Minor

None.

## Security review

- PASS. Concept attribution is copied from server-selected database rows inside the existing authenticated transactions, accepts no client value, and is absent from strict public DTOs, logs, URLs and browser code. Existing ownership predicates and bearer-session behavior are unchanged.

## Test review

- Coverage adequate. The authoritative suite passes 172 regular tests and 116 isolated PostgreSQL integration tests. The independent focused upgrade run passes all 3 backfill/integrity tests.
- Missing scenarios: none material to TASK-040. The tests distinguish restriction through historical attribution from the pre-existing `Question.conceptId` restriction by first regrouping the source questions.

## Architecture review

- Compliant. The implementation extends the accepted Prisma/PostgreSQL model additively, preserves the established immutable snapshot and transaction boundaries, and introduces no learning-state model, scoring rule, endpoint, UI, external service or material architecture change.

## Final reviewer statement

TASK-040 satisfies every acceptance criterion and Supervisor refinement. The migration safely preserves legacy attribution, both creation paths persist exact nullable concept identity atomically with their snapshots, historical rows remain stable and referentially protected, and no public contract exposes the metadata. No unresolved finding remains.

`VERDICT: PASS`
