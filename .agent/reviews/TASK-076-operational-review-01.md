# TASK-076 Operational Review 01

## Verdict

`VERDICT: PASS`

## Scope reviewed

- Task: `.agent/tasks/TASK-076.yaml`, current STATE, owner deployment decision, repository workflow/definition-of-done constraints, accepted ADR-004/005/006 boundaries and review template.
- Exact release: `611a5592ccf4f38612e56dd4c1bb9d906c32bef8`; independently resolved `thaidlt-compact-20261021^{}` to that SHA. Reviewed source is original `e0bb5c8a94bf6ff9ffb780105c67f913d05adfc2` plus correction `726550f507bd664ec4e752b0917b9a3f959c2683`, approved by code review02 before release selection.
- Operational evidence: Admin report/log commits `9d0672c` and `a990b14`, Supervisor independent live evidence `ca606a7`; `.agent/admin/TASK-076-production-report.md`, `.agent/admin/TASK-076-deploy-handoff.md`, `.agent/checks/TASK-076-admin-01.txt`, `.agent/checks/TASK-076-production-checks-01.txt`, and accepted source checks02/review02.
- Administrative scripts inspected: exact-archive staging and unchanged-backend comparisons, full-table preservation/cutover, safe final HTTP/config/Telegram checks, Supervisor archive/raw-source checks and strict known-host SSH/QEMU helper. No application/source change exists after the pinned release; subsequent branch differences are `.agent` records only.
- Reviewer independently performed read-only live verification at `2026-10-21T12:29:33Z`, plus local archive/source proof. No application/configuration change, service restart, database write, scheduler tick, Telegram send or second bot was performed.

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| Owner-authorized reviewed compact UI reaches existing hosts | PASS | Owner decision includes real compact implementation/publication. Independent code PASS and source gates precede accepted immutable release selection and staging. |
| Exact release, frozen installation, generated client and build | PASS | Accepted SHA/tag, verified archive, pinned pnpm11.19.0 frozen install, sequential Prisma generation and production web build all pass. No schema/dependency change. |
| Compact public shell replaces promotional layout | PASS | Reviewer independently observes web200, `<main class="compact-app">`, absence of both former headline strings and road-art hero. Authenticated interaction/visual behavior is established by reviewed code and local browser tests, not inferred from public HTML. |
| Preserve all content, preferences, learning and reminders | PASS | Complete before/after fingerprints of all 16 tables match with no field exclusions while API/bot are stopped. Reviewer read-only overlay check independently reports 100 matched with zero would-apply/applied. |
| Backup and safe cutover/rollback | PASS | Fresh backup completes successfully before cutover; reviewer confirms 101,812-byte artifact. Prior accepted runtime/dependencies retained; rollback guidance does not reverse content or learner data. |
| Healthy three-service release and single enabled bot | PASS | Reviewer verifies exact symlink and raw source identity, active/running web/API/bot, zero restarts/exit0, one bot process and existing strict public rollout values. |
| Authentication/cache/proxy and Main Mini App boundaries | PASS | Independent API/web presentation POST401/no-store, protected `/me`401/no-store and unknown API404. Expected bot's Main Mini App available, no webhook; destination URL evidence remains correctly qualified. |
| Scope/security and honest evidence limits | PASS | Deployment changes only accepted web source; API/bot/packages/content/tools/manifests unchanged. No auto opt-in, forced sends, fake signed auth, native quiz or fabricated owner journey. |
| Independent operational gate before whole-task acceptance | PASS | This verdict supplies the independent operational gate; Supervisor acceptance/state/history integration remains separate. |

## Independent release and live proof

The reviewer independently recomputed retained archive SHA256 `fd66ac1d44a97dc714ed9dfd5730bd2122c5ebef69ca16f7b3e82d9539a44f3d` and compared every regular entry with a fresh pinned `git -c core.autocrlf=false archive` of release `611a5592ccf4f38612e56dd4c1bb9d906c32bef8`. All 581 files agree; 576 differ only by checkout CRLF conversion. No untracked/working-tree file is part of this proof.

Separate read-only SSH/QEMU verification observed:

- Current symlink: `/srv/thaidlt/releases/611a5592ccf4f38612e56dd4c1bb9d906c32bef8`. Nine critical installed raw hashes match the exact transferred archive, including all six changed web files, unchanged bot entry point/schema and the actual independent Russian review manifest.
- Web PID2196006, API PID2196001 and bot PID2196005, each active/running as User/Group `thaidlt`, NRestarts0 and ExecMainStatus0. Exactly one process has the precise bot entry-point argument and matches its systemd MainPID.
- Effective bot flag is the exact string `true`; username `thauto_dlt_bot`; short name absent; expected configured `MINI_APP_URL`. Four protected EnvironmentFiles remain root-owned0600 and the existing bot-only drop-in root-owned0644. Only allowlisted public values were emitted.
- Read-only `getMe` verifies expected username and Main Mini App availability; no webhook. Bot API metadata does not independently reveal the configured BotFather destination URL, and this is not treated as a real-owner Mini App journey.
- Fresh backup artifact `/srv/thaidlt-db/dumps/thaidlt-20261021-121853.dump` exists at the recorded 101,812 bytes. Supplied transcript records backup service success/exit0 at12:18:55UTC, before the cutover.
- Web200 and compact shell present; former marketing headline/road hero absent. API `/me` and loopback `/me`:401/no-store. API and same-origin web POST `/practice/presentation`:401/no-store. Unknown public API path:404.
- Accepted guarded content CLI invoked in its default read-only mode: `Russian stems: 0 would apply, 0 applied, 100 matched.` Diagnostic command and guest exit0.

## Findings

### Blockers

None.

### Important

None.

### Minor

None.

## Security review

- PASS. Known-host SSH retained; secrets remain in existing protected server files and memory during authenticated read-only Telegram queries. No credential, signed user data, raw environment or learner row was printed. No new public API prefix, webhook, provider, authentication model or paid dependency.
- Existing enabled private EN/RU scheduler, saved user opt-in and summary policy are preserved. This rollout and review do not enable users automatically, send a message or run a scheduler tick.

## Test review

- Coverage/evidence adequate. Accepted source gates include lint/typecheck, all338 unit tests, production build and all229 browser tests. Independent code review repeated32 relevant compact/daily/deep-link cases and inspected refreshed mobile layouts; no source changed after that review. This operational gate adds actual production build, source identity, service/configuration/content and HTTP evidence.
- Preservation script was inspected: all16 application tables use complete row JSON fingerprints, no Question-field exclusions, and before/after comparison occurs while API/bot are stopped. Schema/migrations are unchanged and completed migration count remains17. No content overlay apply, preference mutation, seed or reset is part of cutover.
- Missing required operational scenarios: none. Real-owner signed Telegram practice/exam journey, exact/old-link interaction and actual scheduled-message receipt remain explicitly unobserved manual evidence under parked TASK-072. Mocked screenshots, public HTML and bot metadata do not substitute for those observations. Native chat quiz remains separate TASK-077.

## Architecture review

- Compliant with accepted web/API/bot and server-side session boundaries. Previous runtime retained; rollback restores runtime only and preserves Russian publication/learner data. Existing image-snapshot compatibility caveat remains documented. No material architectural or persistence change.

## Final reviewer statement

`VERDICT: PASS` for TASK-076's observed production rollout of exact release `611a5592ccf4f38612e56dd4c1bb9d906c32bef8`, with Admin evidence through `a990b14` and independent Supervisor/reviewer live verification. The reviewed compact UI is served publicly and existing data/authentication/reminder boundaries are preserved. This verdict does not claim a real-owner Telegram journey or actual scheduled delivery. Supervisor retains whole-task acceptance; this reviewer changes and commits only this review file.
