# TASK-085 Review 01

## Verdict

`VERDICT: PASS`

## Scope reviewed

- Task: `.agent/tasks/TASK-085.yaml`, including the explicit practice opt-in clarification and evidence-based daily concurrency diagnosis amendment.
- Commit(s): accepted base `859b679` through source `57732549f90a52d5b9aca7ed6579471477c20f74`; implementation `f3a17d39f58457b297b68162ab3be7aaa8282a20` and diagnosed conflict correction `57732549f90a52d5b9aca7ed6579471477c20f74`. Reviewed at HEAD `4cd615e`; no additional implementation diff exists between the source tip and that HEAD.
- Relevant ADR(s): ADR-009, with the existing immutable practice/exam, authentication and transaction boundaries in the architecture document. Read repository instructions, project, workflow, definition of done and current state independently.
- Checks supplied: fresh Supervisor `.agent/checks/TASK-085-checks-02.txt` records PASS for lint, typecheck, 375 unit tests across 63 files, database readiness, 238 integration tests across 45 files, build and diff checks. The original failed gate remains in `TASK-085-checks-01.txt`. Builder diagnosis, forced-conflict regression red proof and subsequent full gates are preserved in `.agent/checks/TASK-085-builder-fix-checks-02.txt`.
- Independent inspection: implementation diff, complete teaching loader and schemas, snapshot/public response boundaries, API practice/retry/exam call sites, private/group practice consumers, shared answer accounting, extracted identity/hash helpers, existing compatibility tests, new teaching tests and daily conflict tests. TASK-084's accepted linguistic/content review was treated as the accepted input, not repeated or synthesized.

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| Validate actual shipped pack, three sources and independent review before use | PASS | Five fixed module-relative reads have regular-file/2 MiB bounds, fatal UTF-8 decoding and no network or caller path. Strict schemas and pinned canonical pack/review hashes bind complete source, entry, entire stem-record and review identities. Unique cardinalities, semantic PASS/read declarations, UTC chronology, source answers/citations and exact optional-statute status are checked. |
| Preserve accepted stable IDs/hashes and public tool exports | PASS | The existing canonical JSON and candidate UUID algorithms were extracted unchanged to a server-only helper. Original tool exports are re-exported, existing golden UUID tests remain, and packages do not depend on tools at runtime. No dependency or lockfile change. |
| Enrich only exact eligible source matches | PASS | Active VERIFIED rows must match stable question/choice identities, vehicle, wording, flags, original explanation/trap content, source metadata/date/citation, image absence and accepted Russian stem. Missing choice/explanation translations receive accepted text; populated conflicting translations and drift retain the original snapshot behavior. |
| Preserve immutable version-1 snapshots and database history | PASS | Teaching is optional strict metadata. Snapshot construction copies reviewed translations and hidden bilingual teaching/provenance; it writes no bank rows. Integration coverage verifies unchanged bank rows and historical presentations, persistent new snapshots and unchanged concept answer credit. Choice order and correct answer are preserved. |
| Preserve HTTP secrecy, default/exam payload and unrelated flows | PASS | Practice selection, daily assignment and mistake retry explicitly opt in. The exam call remains `snapshotQuestion(question)` and the direct-call default remains unenriched. Public response builders select only the existing question fields; hidden teaching, answers, explanations and legal/distractor/safety metadata stay excluded. Post-answer shape and accounting are unchanged. Bot/web transport, schema, preferences and reminders have no implementation edits. |
| Meaningful positive, negative and compatibility coverage; full gates | PASS | Real 100-entry/400-choice/two-statute and actual review coverage, malformed/tampered/duplicate/missing/status/time cases, drift/conflicting translations, legacy/default snapshots, persistence and HTTP non-disclosure are covered. Existing golden IDs and tool compatibility coverage remain. Authoritative full gates are green. |
| Narrow diagnosed daily conflict correction within existing bounds | PASS | The retained failure and safe diagnostic identify raw `DriverAdapterError` SQLSTATE `40001` at COMMIT. The added classifier requires an Error, the exact adapter name, `TransactionWriteConflict` and only `40001`/`40P01`. Existing P2002/P2034 handling, eight-attempt limit and delays remain intact. Negative classification cases and a real synchronized PostgreSQL commit-conflict regression are covered; existing concurrency assertions were strengthened without suppressing failures. |

The Reviewer also ran one bounded, read-only Node inspection independently of the supplied test results. An independently implemented canonical serializer reproduced pack SHA-256 `1465c7a1b6800b53a5172bf26dea7dffbc787ff6887dcd5894a9a31e23165c29` and review SHA-256 `c791ec616ab3e74f9c1c6f478c1c44260e120aa6f0dba73e6139e65719dbdd51`. All 100 source records enriched, yielding 400 choices and two statutory examples. Assertions verified the unenriched default, unchanged answers/option order, no source-object mutation and strict public metadata exclusion. Broad generators/tests were not repeated because fresh authoritative full-gate evidence was supplied.

## Findings

### Blockers

None.

### Important

None.

### Minor

None.

## Security review

- PASS. Runtime content is bounded and validated before enrichment, accepted artifacts and reviews are hash-bound, and pre-answer HTTP responses remain explicit strict projections. No new authentication path, secret exposure, external fetch, runtime AI or untrusted SQL/shell interpolation was introduced. The conflict correction does not retry unrelated errors or expand retry bounds.

## Test review

- Coverage adequate. Reviewed test assertions and retained red/green evidence independently; no skipped/deleted failing regression or reduced assertion was found.
- Missing scenarios: none blocking this task. Production publication and Telegram teaching rendering remain separate task gates.

## Architecture review

- Compliant with TASK-085 and ADR-009. Server-only static content, existing database model and immutable presentation boundaries are preserved. No schema migration, source/history rewrite, provider, toolchain or deployment change. README records artifact packaging and the older strict-reader rollback consideration.

## Final reviewer statement

`VERDICT: PASS`. No unresolved blockers. The reviewed implementation meets TASK-085 acceptance criteria and the supplied fresh authoritative checks pass. This is source acceptance evidence only; Supervisor acceptance/state recording and later publication remain separate. The three original untracked files were preserved; this review commits only this report.
