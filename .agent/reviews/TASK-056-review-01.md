# TASK-056 Review 01

## Verdict

`VERDICT: FAIL`

## Scope reviewed

- Task: `TASK-056` — Inspect learner question reports offline
- Commit(s): Builder commit `631f3b1f61ef5c72aa411e01e001bd88f8de0c62` against parent `feb4bc37420adf0b28e09e33c5181419ca90c4c5`
- Relevant ADR(s): ADR-001, ADR-002
- Checks supplied: `.agent/checks/TASK-056-checks-01.txt` (`pnpm check` with 244 tests, `pnpm prisma validate`, and `pnpm test:integration` with 161 tests all passed); focused reviewer run `pnpm exec vitest run tests/report-inspection.test.ts tests/content-inspect-reports-cli.test.ts` passed 8 tests

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| Zero-argument loopback CLI and lifecycle | FAIL | Argument validation precedes environment access and client creation, loopback configuration is enforced, and every created client enters a disconnect `finally`. However, successful JSON is written before `$disconnect()` completes, so a disconnect failure produces stdout despite the required fail-closed database-failure boundary. |
| Read-only consistent snapshot | PASS | The complete count and item inspection runs in one Prisma transaction with `RepeatableRead`, executes `SET TRANSACTION READ ONLY` before data queries, performs no mutation or locking read, and derives both summary and items from that transaction snapshot. |
| Bounded exact inventory and deterministic order | PASS | Separate practice/exam counts are validated, a combined total above 500 is rejected before item reads, count/item agreement is required, and items sort by canonical createdAt descending, reportId descending, then kind ascending. Empty, 500 and 501 boundaries are covered. |
| Strict persisted-data and tuple validation | PASS | Both report kinds use strict row projections with canonical UUIDs, canonical millisecond UTC dates and the shared exact details schema. Saved versioned snapshots are parsed through the accepted strict parser, all snapshot identities are canonical, snapshot/source identity is checked, duplicate IDs within each kind are rejected, and practice/exam anchor, session, owner and source-question tuples must agree. |
| Confidential evidence projection and privacy | PASS | Each output item contains exactly report identity, kind, creation time, allegation, source question, immutable anchor and saved snapshot. Queries and projection omit learner/profile/auth data, answer attempts and choices/outcomes, favorites/progress, exam timing/score/result and current mutable content/lifecycle/source/reviewer fields. |
| Safe failure boundary | FAIL | Validation/query/projection errors are buffered before output and receive the stable non-echoing message, but a rejected `$disconnect()` occurs after stdout has already been written. This violates the explicit requirement that every database failure write no stdout and risks consumers accepting an inventory from a command that exits nonzero. |
| Tests, documentation, scope and architecture | PASS | Unit, CLI and isolated PostgreSQL coverage exercise ordering, strict projection, privacy, bounds, corruption and unchanged database state; documentation correctly marks the output confidential and side-effect free. Changes remain within `files_allowed` and introduce no schema, dependency, service or architecture change. The missing disconnect-failure ordering case is listed below. |

## Findings

### Blockers

None.

### Important

1. **A database disconnect failure occurs after the CLI has emitted success output**
   - Severity: important
   - File: `tools/content/inspect-reports.ts:12-15`
   - Problem: The CLI calls `process.stdout.write()` inside the database `try` and only then awaits `database.$disconnect()` in `finally`. If disconnect rejects, the outer catch exits nonzero and prints the generic failure message, but the complete inventory is already present on stdout.
   - Why it matters: TASK-056 explicitly requires database failures to fail closed with no partial stdout. A caller can receive valid-looking confidential JSON from a command that ultimately failed, which breaks the atomic success/failure contract and can cause downstream tooling to consume an inventory that the CLI declared unsuccessful.
   - Required correction: Buffer the serialized inventory, always await disconnect, and write stdout only after inspection and disconnect have both succeeded. Add a focused lifecycle test with an injected/fake client whose inspection succeeds and whose disconnect rejects, asserting nonzero failure, empty stdout behavior at the runner boundary, and the stable stderr message.

### Minor

None.

## Security review

- Finding listed above. Data selection and projection otherwise preserve the intended confidential local boundary and expose no prohibited learner, credential, answer or current-content fields.

## Test review

- coverage inadequate for the CLI completion boundary
- missing scenarios: successful inventory construction followed by `$disconnect()` rejection must not emit stdout

## Architecture review

- compliant. The implementation remains a local content CLI over the accepted Prisma/PostgreSQL stack, uses the existing loopback configuration and snapshot contract, and introduces no material architecture or dependency change. The untracked `thai-dlt-agent-starter.zip` remains untouched.

## Final reviewer statement

`VERDICT: FAIL`

Builder commit `631f3b1f61ef5c72aa411e01e001bd88f8de0c62` must defer stdout until database disconnection succeeds and cover that failure path before TASK-056 can be accepted.
