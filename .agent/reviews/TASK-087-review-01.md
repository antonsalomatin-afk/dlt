# TASK-087 Review 01

## Verdict

`VERDICT: PASS`

## Scope reviewed

- Task: `.agent/tasks/TASK-087.yaml`; established-host publication of accepted bilingual native Telegram teaching only.
- Commit(s): operational diff `c472c06b94252f170d9971bca70d4fef322b6f6f..527794f`; Admin evidence commit `8799f6599df7b6f7c98ed4fb6ef901cd87271dd2`. Published release is exactly `c472c06b94252f170d9971bca70d4fef322b6f6f`; staged compatible fallback is `d54f2d60252830d850b70b5803d6a35aa6a0a571`.
- Relevant ADR(s): ADR-002, ADR-007, ADR-008 including the asynchronous-practice correction, and ADR-009. Mandatory project, architecture, workflow, definition-of-done and state documents were read.
- Checks supplied: `.agent/checks/TASK-087-admin-01.txt` and authoritative independent Supervisor `.agent/checks/TASK-087-checks-01.txt`, including retained failures, diagnosis and targeted successful recheck. Reviewed the rollout plan, production report and ignored task087 transfer, guest-PID, preflight, source verification, install/build, content, cutover, preservation, backup and live-probe helpers.
- Accepted TASK-084 content and TASK-085/TASK-086 source reviews are prerequisites. This operational review does not repeat the linguistic review or reopen the accepted feature implementation. The source gates recorded in TASK-086 include lint, typecheck, 377 unit tests, 242 isolated integration tests and build PASS.

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| Strict existing-host baseline and preserved settings | PASS | Known-host batch SSH/QEMU guest100 preflight records actual f17 runtime, three active unprivileged units, one bot, loopback ports, Node24.22.0/pnpm11.19.0, 20 application tables and 19 completed migrations. Protected settings and effective unit hashes were retained and compared; root/root0600 remains unchanged. No unresolved baseline drift is reported. |
| Exact accepted archives, raw installed files and production builds | PASS | Reviewer independently regenerated pinned Git LF tar entries locally and compared every regular-file name and byte against both supplied archives: release657/1053222bytes/SHA256 `3646b0301368469e54cafa0eb2c2bd365bd22491935c8737062230183602dca7`, fallback651/1040785bytes/SHA256 `ab6a8ab3179c5dbab91532f57fbaf596715789fa9785869421c8728f53d8bf34`. Actual teaching/review/source artifacts are included. Admin and independent Supervisor live checks bind all657+651 raw installed files to those archives. Successful frozen install, mandatory client generation and production builds ran as thaidlt before cutover. All29 installed schema/migration/package/lock/workspace contract files match the prior runtime. |
| Compatible application rollback staged before disruption | PASS | d54f has exact source, dependencies, generated client and successful web build before API/bot quiescence; independent runtime inspection actually parses all100 enriched snapshots with its strict reader. f17 remains retained, while the failure guard selects d54f. No database restore or historical snapshot rewrite is present. |
| Fresh backup and full data preservation before writers resume | PASS | Fresh125228byte custom PGDMP backup completed successfully at07:09:06 before the07:09:07.885483 atomic switch. Reviewed SQL enumerates all20 application tables and fingerprints every full row/field without exclusions; all19 full migration rows are retained separately. Distinct0600 before/after artifacts match and were compared before writer restart. Supervisor independently verified the artifacts and ordering, then rechecked all four immutable content tables and all migration rows against the retained baseline. |
| Atomic runtime switch and healthy single-bot runtime | PASS | Atomic symlink replacement selects exact c472. Three units are active/running as thaidlt with matching actual process CWDs, zero observed restarts and precisely one bot. The guarded failure path quiesces API/bot and selects staged d54f without data/schema/configuration action; it was not needed during publication. |
| Read-only HTTP/Telegram checks and interaction boundaries | PASS | Public compact shell200, protected local/public/same-origin routes401 with no-store and unknown API404 are evidenced. Telegram inspection uses getMe/getWebhookInfo only and confirms expected bot, Main Mini App availability, group joining and no webhook. Reviewed probes contain no real send/poll/vote, diagnostic getUpdates, second polling process, scheduler tick or synthetic signed identity. The inherited Russian-stem CLI is invoked without --apply; its inspected default is read-only and reports0 applied/100 matched. |
| Exact runtime teaching and installed approved delivery | PASS | Both staged runtimes and live release produce100 eligible enriched snapshots in memory,400 Russian choices, two bounded section33 references and50 active VERIFIED questions per vehicle. Full source matching binds the accepted loader, rich private/group handlers, own-answer Explain and normal update subscription; no bank overlay was applied. Independent live proof confirms the source bank is unchanged. |
| Honest safe evidence and independent acceptance gates | PASS | Admin committed only its report/transcript, then stopped. Supervisor supplied separate live verification. This review supplies the independent operational verdict before Supervisor acceptance/main integration. The operational diff contains only .agent planning/state/evidence, with no implementation/content/env edits; Supervisor state/task bookkeeping is distinct from the Admin's allowed-file boundary. |

## Findings

### Blockers

None.

### Important

None.

### Minor

None.

The initial archive transfer exceeded the Proxmox1MiB stdin limit. The initial sequential wrapper then continued through missing-archive/source errors and a fallback WorkingDirectory status200 failure. These were real staging failures, occurred before live disruption and remain recorded. The corrected512KiB chunk transfer verifies the final exact archive size/hash; corrected staging is fail-fast. Each interrupted staging status observation resumed the original owned guest PID to actual exit0, rather than starting another build or treating transient-unit defaults as evidence.

The Supervisor's initial preservation timeline assertion also failed and remains recorded. Its human-formatted ActiveEnterTimestamp truncated seconds. The diagnostic and targeted --timestamp=us recheck establish after-artifact07:09:08.104487496 before API07:09:08.207735 and bot07:09:08.289701. The actual preservation equality checks passed; no runtime/data change was made to force this probe green. These resolved observational/staging failures do not leave a publication blocker.

## Security review

- PASS. Protected environment values, tokens and learner rows are not exposed in the committed report/transcripts inspected. Local pattern checks found no credential assignments or Telegram-token-shaped values in TASK-087 evidence.
- Production scripts preserve established settings and run application work as thaidlt. Database preservation/content inspections are read-only; full private row bodies are neither printed nor exported. SQL table interpolation is limited to enumerated/validated identifiers.
- Publication introduces no authentication/configuration change, dependency upgrade, public personal-explanation fallback or unsolicited DM. Exact installed accepted source and prior independent source review support the delivery boundary.

## Test review

- Coverage adequate for this operational task. Reviewed authoritative live evidence and the scripts generating it; independently repeated local exact archive/Git LF comparisons and `git diff --check` successfully. No additional broad live probes or builds were needed.
- No source behavior changed in TASK-087, so accepted TASK-085/TASK-086 automated source gates were reused rather than rerun against production. Deployment-specific frozen installs, generation, both production builds, preservation, fallback-reader, service, source, content, HTTP and Telegram metadata gates pass.
- Missing scenarios: actual owner private/group answer-and-Explain journeys and signed Mini App practice/exam journeys remain unobserved. Metadata cannot prove the actual BotFather launch target. The failure guard was inspected, not deliberately exercised against live production. None is claimed as observed or required as a forced production interaction by this task.

## Architecture review

- Compliant. Publication stays on established hosts with the accepted PostgreSQL/Prisma/Node/grammY boundary and one bot. No migration, DDL, content application, history rewrite, new provider or paid dependency is introduced. Compatible-reader rollback preserves ADR-009's immutable enriched snapshots.

## Final reviewer statement

`VERDICT: PASS`. TASK-087 operational acceptance criteria are satisfied with no unresolved blockers. This verdict covers the inspected exact-release publication evidence and safeguards; Supervisor acceptance, state update and main integration remain Supervisor actions. Only this review file is committed, and the three original untracked files are preserved.
