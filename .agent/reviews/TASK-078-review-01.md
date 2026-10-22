# TASK-078 Review 01

## Verdict

`VERDICT: PASS`

## Scope reviewed

- Task: `.agent/tasks/TASK-078.yaml`, current state and `.agent/admin/TASK-077-native-rollout-plan.md`; operational publication only.
- Commit(s): exact accepted release `0a4d7b3291f346581174aa5ac3ffe7d5404f73be`, tag `thaidlt-native-quiz-20261022`; Admin evidence `36624e74104179a4053cbc9eb08491e3bea7d9b9`; Supervisor evidence `6fc0276` and backup supplement `2cd9881`; current task/state `4098726`. Native implementation and shutdown correction were independently reviewed PASS in TASK-077 review 02 and were not changed during this rollout.
- Relevant ADR(s): ADR-004, ADR-005, ADR-006 and ADR-007; repository/project/architecture/workflow/definition-of-done rules previously read for the same release.
- Checks supplied: `.agent/checks/TASK-078-admin-01.txt`, `.agent/admin/TASK-078-production-report.md` and Supervisor `.agent/checks/TASK-078-checks-01.txt`. Inspected the administrative migration/cutover and corrected read-only inspection scripts, including the retained failed assertion and safe recovery.
- Independent verification: strict known-host, batch SSH through existing `ovh`/QEMU guest 100 helper; fresh read-only proof at `2026-10-22T06:23:37Z`. Reviewer changed no application source, production runtime, configuration or application data; only this review file is committed.

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| Immutable accepted archive, strict transport and installed source identity | PASS | Independently verified archive size 873297 and SHA256 `1fab1eb2d0c3f160e26e07d3ad1600c8230203879d075886ea181997f599008d`; all 599 members match a separate pinned Git LF archive, with 594 CRLF-only conversions. Guest archive SHA and every one of the 599 installed regular files independently match the transferred bytes. |
| Pinned frozen install, generated client and production build | PASS | Admin transcript records sequential unprivileged Node 24.22.0/pnpm 11.19.0 frozen prod=false install, db:generate and build, each exit 0. Source/dependency files independently match the accepted archive. |
| Fresh backup, additive migration once, exact schema and old-data preservation | PASS | Independent backup metadata/header proof and live database queries confirm the backup preceded migration; 18 finished/0 unfinished, new migration once, validated constraints/uniques and all 16 complete existing table fingerprints still equal the pre-migration baseline. |
| Atomic shared runtime switch, healthy services and protected settings | PASS | Exact current symlink and all actual process CWDs; three active/running thaidlt units, exit 0, zero restarts; exactly one bot. Root 0600 env files and enabled public settings preserved; prior runtime/dependencies retained. |
| Live HTTP, metadata, native subscription, migration and Russian-content boundaries | PASS | Independent compact web 200, protected local/public/same-origin routes 401/no-store, unknown route 404, getMe/Main Mini App/no webhook; full installed-source proof includes native handlers and explicit subscription. Admin and independent Supervisor report 100 exact Russian stems; full current content-table fingerprints independently remain unchanged. |
| Safe report/transcript, Supervisor independent verification and honest observation limits | PASS | Release, backup, schema, preservation, installation and runtime evidence agree. Failed administrative catalog assertion is retained and diagnosed below. No real-owner native or signed Mini App journey is claimed. |

## Findings

### Blockers

None.

### Important

None.

### Minor

None.

## Security review

- PASS. Reviewer used strict existing-host SSH and verified guest command exit 0 separately from the outer transport. Read-only probes emitted only aggregate database proofs and allowlisted public runtime settings; no credentials, learner rows or full environments were printed.
- Independently confirmed `/etc/thaidlt/{app,database,bot,question-posts}.env` are root-owned with mode 0600. Three services run as User/Group thaidlt; exactly one precise bot entry-point process matches systemd MainPID 2918709. Bilingual post flag remains true, public username is expected, and short name is absent.
- Reviewer issued no Telegram send, polling/getUpdates call, scheduler tick, synthetic signed identity, content apply, migration, reset, restart, configuration write or database write. Telegram probes called only getMe and getWebhookInfo.

## Test review

- Operational coverage adequate. Full application suites were not rerun for unchanged accepted code; TASK-077's authoritative checks and independent code PASS remain applicable.
- Independently verified all 599 raw installed archive files, exact release symlink, actual process CWDs and service health: web PID 2918710, API PID 2918705 and bot PID 2918709; each active/running, exit 0 and zero automatic restarts.
- Backup independently exists at `/srv/thaidlt-db/dumps/thaidlt-20261022-061047.dump`, 101812 bytes, custom-format PGDMP header. Backup service Result success/ExecMainStatus 0, started 06:10:47 UTC and completed 06:10:49 UTC. The new migration's independently queried started_at is 06:10:56.691 UTC, after backup completion. A restore was not attempted or claimed.
- In one read-only repeatable-read database snapshot, independently found 18 completed migrations, zero unfinished/rolled-back entries and the native migration exactly once; all ten catalog constraints validated, including six NOT NULL constraints and the four required p/c/f constraints; four valid unique indexes and the owned composite presentation foreign key. Native session count was 0 at observation.
- Independently recomputed full count/content fingerprints for all 16 old application tables with no field exclusions and compared them with the retained pre-migration baseline: all equal, no changed table names. This supplements the quiescent before/after/cutover equality in the retained Admin transcript.
- Independent live HTTP checks passed: compact public web 200, local/public /me 401/no-store, API-host and same-origin POST /practice/presentation 401/no-store, unknown public API 404. Read-only bot metadata confirmed thauto_dlt_bot, Main Mini App available, no configured webhook, zero pending updates and expected configured Mini App URL. Metadata does not expose or independently prove the BotFather target URL.
- Missing observations: actual owner-triggered /quiz answer/correctness/full-feedback/Next usability, signed Mini App practice/exam journey and observed scheduled-message delivery. These are explicitly unobserved and are not substituted with unauthenticated probes or synthetic local tests.

## Architecture review

- Compliant. Only the accepted additive ChatQuizSession migration and accepted native runtime were published; existing provider/service/authentication/reminder boundaries remain intact.
- The first operator post-migration inspection expected four total pg_constraint rows and failed after migrate deploy itself exited 0. PostgreSQL 18 exposes six additional NOT NULL catalog constraints. The guard retained the prior 611a559 runtime, resumed its API/bot, and retained the successful additive database state and diagnostics. Corrected read-only inspection checked four named p/c/f constraints separately from six required non-null columns and four unique indexes; it passed before cutover-only continuation. Reviewer independently confirmed this ten-constraint state and complete old-data equality. No migration replay, manual resolve, reversal, reset or data correction was needed or evidenced.
- Prior 611a559 runtime/dependencies and the fresh backup remain available. Retaining the additive table on application rollback matches the approved plan and avoids discarding later learner data.

## Final reviewer statement

`VERDICT: PASS`. Exact accepted source is live, the bounded operational acceptance criteria are satisfied, and no unresolved findings remain. The retained inspection failure was safely contained and correctly diagnosed. Supervisor may now perform task/state acceptance and accepted-history integration. Real-owner native and signed Mini App journeys remain unobserved. Only this review file was changed by Reviewer.
