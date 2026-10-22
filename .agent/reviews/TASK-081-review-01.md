# TASK-081 Review 01

## Verdict

`VERDICT: PASS`

## Scope reviewed

- Task: `.agent/tasks/TASK-081.yaml` and `.agent/admin/TASK-080-group-rollout-plan.md`; operational publication of accepted group support only.
- Commits: exact accepted release `3cbcbac2976014f4d3bf6346341b6667f14b44d1`, tag `thaidlt-group-quiz-20261022`; Admin evidence `8c7a5ef03af5b5c8032d7529b000c0ad66ea01f0`; Supervisor independent checks `6643de1`. Source remains the implementation independently reviewed PASS in TASK-080.
- Relevant ADRs: ADR-007/008 and established deployment/authentication/reminder boundaries. Inspected Admin report/transcript, actual migration/cutover/preservation helpers and corrected read-only inspection helper.
- Checks supplied: `.agent/checks/TASK-081-admin-01.txt`, `.agent/admin/TASK-081-production-report.md`, `.agent/checks/TASK-081-checks-01.txt`.
- Independent verification: strict known-host batch SSH through existing `ovh` / QEMU guest100 helper, checking actual guest exit0. Fresh read-only proof at **2026-10-22T13:33:39Z**. Reviewer wrote no application source, configuration, runtime or production data; only this review is committed.

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| Strict preflight and approved deployment boundary | PASS | Admin transcript establishes prior exact 0a4 runtime, three healthy unprivileged services, one bot, protected config and18 completed migrations with group tables absent. Fresh verification confirms the established boundary remains intact. |
| Exact archive/source and pinned install/generate/build | PASS | Independently verified913168-byte archive SHA256 `638599537516b0448f53a2d6958aa7ef45df42c69fe479e0a9bd21d578c18112`; all619 regular members are raw-byte exact to a separately generated pinned Git LF archive. Independently checked the guest archive hash and every619 installed regular source file. Admin retained successful unprivileged frozen install with pnpm11.19.0, mandatory generated client and production build. |
| Fresh backup, additive migration and old-data preservation | PASS | Independent PGDMP header/size and backup service result/timing precede the independently queried migration. Exactly19 finished/0 unfinished/0 rolled-back migration rows, new migration once;13 named validated constraints,10 valid unique indexes and19 required non-null columns. All17 old-table full count/content fingerprints independently match the pre-migration baseline with no field exclusions. |
| Exact runtime, healthy services and protected settings | PASS | Current symlink and actual process CWDs match release3cbcbac; three active/running User/Group thaidlt units, exit0 and zero restarts. Exactly one precise bot entry-point process. Root/root0600 envfiles, enabled question posts, expected public username and absent short name preserved; prior runtime/dependencies retained. |
| Read-only HTTP, Telegram readiness, content and handlers | PASS | Independently verified compact web200, local/public/same-origin protected routes401/no-store and unknown API404; expected bot/Main Mini App/can_join_groups/no webhook;100 exact Russian stems and50 active VERIFIED per vehicle. Full installed-source proof includes accepted group/private dispatcher and explicit update subscription. |
| Safe evidence and honest observation limits | PASS | Report/transcript and independent proofs agree. Administrative diagnostic issues are retained and resolved below. No forced send, synthetic signed identity, getUpdates diagnostic, group permission change or owner journey is claimed. |

## Findings

### Blockers

None.

### Important

None.

### Minor

None.

## Security review

PASS. Fresh Reviewer probes used only strict existing-host transport, read-only database transactions, aggregate fingerprints and allowlisted public runtime metadata. No credentials, learner rows or full environment were printed. Independently verified four root/root0600 environment files and three unprivileged services. Telegram calls were only getMe/getWebhookInfo; no message/poll/vote/send, diagnostic polling, scheduler tick, second bot, permission change, synthetic identity or production write was performed.

## Test review

Operational coverage adequate; unchanged accepted application suites were not repeated. Fresh independent evidence:

- All619 installed regular source files match the hash-verified archive, whose members independently match pinned Git bytes with zero line-ending conversions. Path checks reject symlink/escape substitutions.
- Exact process CWDs and active units: web3219524, API3219519, bot3219523; each User/Group thaidlt, exit0, NRestarts0. Precisely one bot entry point matches systemd.
- Backup `/srv/thaidlt-db/dumps/thaidlt-20261022-132604.dump` has110421 bytes and PGDMP header; dump service Result success/ExecMainStatus0, completed13:26:05Z. New migration independently started13:26:12.740Z and finished13:26:13.050Z, after backup. Restore was neither attempted nor claimed.
- In one read-only repeatable-read snapshot, all17 old application tables including ChatQuizSession match the retained pre-migration full count/content fingerprints. Exact current inventory contains20 application tables. New group counts are0/0/0; existing private sessions2. No field exclusions or learner-row export.
- Independently queried13 named validated p/c/f constraints, composite current-round and owned vote/presentation foreign-key definitions,10 valid unique indexes and19 required non-null columns;19 completed migrations and exactly one group migration.
- Independent guarded Russian overlay inspection reports100 matched/0 would apply/0 applied. Content remains50 active VERIFIED questions and50 Russian stems for each vehicle.
- Independent public compact web200, local/public `/me`401/no-store, API-host and same-origin presentation401/no-store, unknown API404, expected Telegram bot/Main Mini App/group-join readiness/no webhook.

Missing observations remain explicit: actual two-member group answering/finish/Next, fresh post-rollout private usability, signed owner Mini App practice/exam and scheduled-message receipt. Neither unauthenticated probes nor local tests establish those journeys.

## Architecture review

Compliant. Only the accepted additive three-model migration and accepted runtime were published. Existing content, private sessions, learner history/preferences and opt-in reminder configuration are preserved. The prior0a4 runtime/dependencies and fresh backup remain available for the approved non-destructive application rollback.

Two retained inspection issues do not establish an application or migration failure. Admin's first all-file raw-proof argument exceeded Windows command-line length before SSH dispatch; seven bounded batches then verified every file before cutover. Reviewer independently avoided the limit by comparing installed files to the hash-verified guest archive. Supervisor's first read-only catalog projection failed with Prisma P2010; its isolated diagnosis reproduced failure selecting native `contype` and success casting it to text. Only the inspector projection changed, and the full root proof then passed. Reviewer's fresh pg read-only schema queries and full raw-source verification independently confirm the accepted schema/runtime. No migration replay/resolve, data repair, reset, seed or rollback was involved.

## Final reviewer statement

`VERDICT: PASS`. Exact accepted group support is live and the bounded operational acceptance criteria are satisfied without unresolved findings. Supervisor may accept TASK-081 and integrate its evidence/state. The real owner group journey remains unobserved; the owner must grant bot administrator status in the intended group and exercise the documented command/answer/finish/Next flow.
