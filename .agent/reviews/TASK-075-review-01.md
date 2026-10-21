# TASK-075 Review 01

## Verdict

`VERDICT: PASS`

## Scope reviewed

- Task: `.agent/tasks/TASK-075.yaml`, current STATE, owner decision log, core engineering/workflow/definition-of-done documents and review template.
- Commits: Admin final report/log `a3fb356`, its deployment audit chain, and dispatch metadata through `11c4137`. Exact accepted deployed source is `b38618f13765ec41ac51421327c1cbbfa347f245`; independently resolved annotated tag `thaidlt-bilingual-20261021^{}` to that commit. Branch diff against `main` changes only seven `.agent` records, with no application, package, schema, source-content or tool edit.
- Relevant ADRs: existing core/session boundaries and ADR-005/006 Mini App API routing/private opt-in scheduler decisions. This is deployment of accepted behavior, without a new architecture/provider boundary.
- Evidence inspected: `.agent/admin/TASK-074-production-report.md`, `.agent/admin/TASK-074-deploy-handoff.md`, `.agent/checks/TASK-075-admin-01.txt`, `.agent/checks/TASK-075-checks-01.txt`; accepted TASK-073 review/checks02 and TASK-074 review02/checks03/checks04, including actual-independent-manifest isolated proof.
- Administrative code inspected: ignored TASK-075 staging, transfer, backup/overlay/preservation/cutover, readiness, enablement and final verification scripts, plus Supervisor read-only checks and strict known-host SSH/QEMU helper. Compared the preservation table list with all 16 Prisma models and inspected accepted bot configuration/entry point and post construction.

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| Owner approval before production mutation/rollout | PASS | Explicit deployment decision recorded at `6660b3252da0bcc960b7341c9ed25cab1d0b5210` before staging/content mutation. It includes 100 reviewed Russian stems, exact runtime and private reminder enablement. |
| Fresh successful backup before content application | PASS | Transcript records fresh dump service completion at 07:28:34 UTC, success/exit0 and a 92,170-byte dump before overlay. Script gates on the successful service result before proceeding. |
| Initial guarded state, approved apply and final 100 matched | PASS | Actual manifest and accepted guarded CLI: 100 would apply, then 100 applied, then 100 matched, each exit0. Subsequent independent Supervisor read-only check also reports 100 matched. |
| Exact release/client/configuration and three active services | PASS | Frozen pinned-pnpm installation, client generation and production build succeed; schema/migration files unchanged, 17 completed migrations. Live reviewer checks confirm exact symlink, all three services healthy, effective enabled configuration and one bot. |
| HTTPS/authentication/cache/proxy boundaries | PASS | Reviewer independently observes web200, public API and same-origin web presentation POST401/no-store, unknown public API404. Supervisor evidence additionally verifies loopback/protected `/me` checks. |
| Safe report, Main Mini App setup and manual evidence boundaries | PASS | Readiness was explicitly false and held enrichment off; fresh true checks preceded enablement. Report distinguishes actual process settings from older-file probe output and explicitly leaves real-owner/scheduled-message observations pending. |
| Scope/data preservation/security | PASS | Only permitted Russian/review fields change. All 16 table fingerprints match while API/bot are stopped, excluding only four allowed Question fields; snapshots/learning/user state preserved. No forced sends, fake auth, new provider/channel/webhook or unrelated redesign. |
| Independent operational review before Supervisor acceptance | PASS | This review supplies independent PASS; acceptance/state/accepted commit updates remain the Supervisor's responsibility. |

## Independent verification

The reviewer independently recomputed archive SHA256 `2514ab52411459cc93d8da53ff0fb97eab737b15ec54dac4c58ac14aa8d9c2b4` and compared all 566 regular entries with a fresh `git -c core.autocrlf=false archive` of pinned commit `b38618f13765ec41ac51421327c1cbbfa347f245`. All agree: 561 differ only by checkout CRLF conversion; remaining bytes agree exactly. The supplied Supervisor evidence additionally binds eight critical remote raw files to that verified archive, including the actual independent manifest. No working-tree source or secret was included in the verified archive.

A separate reviewer read-only SSH/QEMU probe completed successfully before the clock-confirmed 2026-10-21 08:28:05 UTC checkpoint. It made no service/configuration/database change and sent no Telegram message. Observed:

- `/srv/thaidlt/current` resolves to `/srv/thaidlt/releases/b38618f13765ec41ac51421327c1cbbfa347f245`.
- Web PID 2001239, API PID 2001184 and bot PID 2037615: active/running, User `thaidlt`, NRestarts0 and ExecMainStatus0. The web/API PIDs agree with the pre-enable evidence.
- Exactly one process has the production bot entry-point argument and matches its unit MainPID. Effective flag is the exact string `true`, public username is `thauto_dlt_bot`, short name is absent and configured `MINI_APP_URL` matches `https://dlt.thauto.app`. Only explicitly allowlisted values were printed.
- Independent read-only Telegram `getMe` returns the expected username and `has_main_web_app=true`; `getWebhookInfo` reports no webhook. No polling, BotFather action or user/bot message was initiated.
- `https://dlt.thauto.app/`: 200. Unauthenticated POST `/practice/presentation` through both public API and web origin: 401 with `Cache-Control: no-store`. Unknown public API route: 404.

## Findings

### Blockers

None.

### Important

None.

### Minor

None.

## Security review

- PASS. Existing protected EnvironmentFiles remain server-side; new dedicated non-secret flag file is root0600 and bot-only drop-in is root0644. Safe environment checks disclose only allowlisted public configuration. Strict known-host SSH is retained, raw Telegram/database exceptions and credentials are suppressed, and no credential-bearing output appears in the inspected audit.
- Initial readiness false caused the enablement gate to hold. Explicit expected-identity/true/no-webhook assertions passed before changing the dedicated flag and restarting only the single bot. Authentication and no-store boundaries remain intact.
- Failed base64 transfer and initial LF-versus-CRLF hash comparison are retained, diagnosed and resolved in evidence. They are not represented as successful checks or hidden by the final verdict.

## Test review

- Coverage/evidence adequate for this deployment-only task. Accepted source validation is inherited under explicit task scope; production frozen installation/client generation/build and safe service/content/HTTP verification are additional observed gates. No runtime change requires rerunning unrelated suites here.
- The Admin preservation script covers every Prisma application table and compares complete row JSON fingerprints. It excludes exactly `textRussian`, `reviewer`, `reviewedAt` and `updatedAt` from Question; all other data is included. API/bot were stopped for before/after inspection, and the expected 17-migration count is asserted.
- Pending manual observations: genuine owner Mini App journey, an actual opted-in scheduled post, exact and older links, choice changes/Check answer and completion handling. These are expressly permitted pending observations in TASK-075, not claimed production E2E results. TASK-072 remains parked/unaccepted.
- `getMe` confirms Main Mini App availability, not its configured destination URL. The expected destination is owner-reported and agrees with server configuration; anonymous landing markup is not independent URL-resolution evidence. This documented limitation does not create an additional task acceptance criterion.

## Architecture review

- Compliant with accepted independent web/API/bot boundaries, server-only configuration, private opt-in scheduler and existing PostgreSQL persistence. No new service, paid dependency, channel, webhook, schema migration or identity/authentication change.
- Disable/rollback guidance preserves Russian content and learner data, retains the previous runtime, and warns about older strict image-snapshot readers and inherited ambiguous Telegram transport delivery.

## Final reviewer statement

`VERDICT: PASS` for TASK-075's observed deployment of accepted release `b38618f13765ec41ac51421327c1cbbfa347f245` and Admin report/log through `a3fb356`. Reviewed Russian content and approved enrichment are live with independently verified service/configuration/readiness/HTTP evidence. This verdict does not assert that an actual scheduled post or real-owner UI journey has occurred. Supervisor acceptance remains outstanding; this reviewer changed only this review file and made no production mutation.
