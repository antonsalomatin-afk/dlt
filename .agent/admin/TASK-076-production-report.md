# TASK-076 compact Mini App production report

Date:2026-10-21. Operator: Admin/Builder `/root/admin_075`. The Product Owner authorized the real compact UI and its existing-host publication in OWNER_DECISIONS.md; no further deployment approval was requested. Code component acceptance and immutable release selection preceded every archive/server mutation.

Status: the reviewed compact UI is live on `https://dlt.thauto.app`. Admin deployment checks and Supervisor independent live checks pass. Whole-task acceptance remains with Supervisor after independent operational review. No real-owner signed Telegram practice/exam journey or scheduled-message delivery is represented as completed.

## Exact release and scope

- Immutable tag: `thaidlt-compact-20261021`.
- Exact deployed release: `611a5592ccf4f38612e56dd4c1bb9d906c32bef8`, Supervisor's bounded code-acceptance commit.
- Reviewed implementation: initial `e0bb5c8a94bf6ff9ffb780105c67f913d05adfc2` plus correction `726550f507bd664ec4e752b0917b9a3f959c2683`. Supervisor checks02 pass lint/typecheck,338 unit tests, production build and all229 browser tests; independent code review02 PASS precedes release selection. Later metadata does not change application source.
- Only the accepted six web application files and browser tests change. Remote source comparisons against the previous accepted runtime proved API, bot, packages/schema/migrations, content, tools and dependency manifests unchanged, excluding only node_modules/generated outputs. No API contract, authentication, scoring, user identity, reminder policy or deployment boundary changed.
- Current symlink resolves to `/srv/thaidlt/releases/611a5592ccf4f38612e56dd4c1bb9d906c32bef8`. Previous accepted runtime `/srv/thaidlt/releases/b38618f13765ec41ac51421327c1cbbfa347f245` and its dependencies were retained for rollback.

## Archive identity, installation and build

- Exact Git archive:832,953 bytes, SHA256 `fd66ac1d44a97dc714ed9dfd5730bd2122c5ebef69ca16f7b3e82d9539a44f3d`. Local artifact `.local-content/TASK-076-611a559.tar.gz` is ignored and retained for audit.
- All581 regular entries were compared with a separate pinned `git -c core.autocrlf=false archive` of the same commit. Every entry matches after CRLF-only normalization;576 have checkout line-ending conversions. No working-tree or untracked files entered the archive. Canonical content/review hashes remain unaffected.
- Strict known-host SSH through the established `ovh` alias and QEMU guest100 was used. Host and guest verified the exact archive SHA before extraction into a new release directory. Guest exit codes, rather than outer SSH success alone, were checked throughout.
- Admin additionally verified raw hashes of16 critical installed files against the exact transferred archive, including allsix changed web files and unchanged API/bot/schema/dependency/content/review artifacts. Supervisor independently checked13 critical remote raw hashes as part of its live check.
- Runtime Node24.22.0. Installation explicitly required the release's pinned pnpm11.19.0, then ran `pnpm install --frozen-lockfile --prod=false` as User/Group `thaidlt`. It reused the existing package store without weakening build approvals or lockfile checks.
- Mandatory `pnpm db:generate` completed successfully, followed sequentially by the production `pnpm build` under the existing application EnvironmentFile. Both exited0; Next compiled successfully, completed TypeScript and generated the production pages. No secret values or full environment were printed.
- Schema and migration source were unchanged and database inspection still counted17 completed migrations. No migration, seed, reset, content application, preference change or new dependency was run for this UI rollout.

## Backup, preservation and cutover

- Fresh existing `thaidlt-dbdump.service` backup began12:18:53UTC and completed12:18:55UTC with `Result=success` and `ExecMainStatus=0` before cutover.
- Backup artifact: `/srv/thaidlt-db/dumps/thaidlt-20261021-121853.dump`,101,812 bytes. Existing retention/nightly and VM backup policies were retained.
- API and the single bot unit were stopped for the brief symlink switch. While they were stopped, complete before/after fingerprints of all16 application tables matched with **no field exclusions**. This includes all question content/review metadata, user preferences, saved presentations, answers, learning state, reports, sessions, exams and delivery ledgers. Only aggregate equality was printed, never learner records. Cutover made no database write.
- The shared `/srv/thaidlt/current` symlink was switched atomically to the verified built release. Established web/API/bot services were restarted to align all runtime working directories. No second bot or local test bot was started.
- Allthree services were observed active/running as User/Group `thaidlt`, with ExecMainStatus0 and0 automatic restarts. Observed MainPIDs: web2196006, API2196001, bot2196005. They retain the established127.0.0.1:3060/3061 service boundary; PostgreSQL remains127.0.0.1:5434.
- Existing `/etc/thaidlt/{app,database,bot,question-posts}.env` remain root-owned0600. The bot-only dedicated drop-in and effective `DAILY_QUESTION_POSTS_ENABLED=true`, public username `thauto_dlt_bot` and unset short name were preserved. No secret file, rollout setting or unrelated service configuration changed.

## Live verification

Admin final checks at12:25:29UTC passed:

- Public web200; returned HTML contains `<main class="compact-app">`. The old `A little practice.` / `A clearer road.` promotional headline and road-art hero are absent.
- Public API `/me` and loopback API `/me` return401 with `Cache-Control: no-store`.
- Unauthenticated POST `/practice/presentation` through both API host and same-origin web rewrite returns401/no-store. Unknown public API path remains404. No nonexistent dedicated health endpoint was assumed and no new nginx prefix was opened.
- Exactly one process has the precise bot entry-point argument and matches the systemd bot MainPID. An explicit process-environment allowlist verifies flagtrue, expected public username and absent short name; no full environment was logged. No bot failure message appeared in the recent three-minute check.
- Read-only Telegram getMe confirms `thauto_dlt_bot` has Main Mini App availability; no webhook,0 pending updates and the existing expected Mini App URL. This does not independently reveal the private BotFather target URL or establish real-owner UI success.
- The guarded translation CLI was used only in default read-only mode and returned `0 would apply, 0 applied, 100 matched`. No translation or old saved daily snapshot was rewritten. Existing opt-in11:00ICT scheduling, generic fallbacks and summary policy remain.

Admin transcript: `.agent/checks/TASK-076-admin-01.txt`. Supervisor independently reported live-check PASS in `.agent/checks/TASK-076-production-checks-01.txt`, evidence commit `ca606a7`, covering full archive proof, critical raw source identity, exact current release, services, effective enabled settings,100 matched Russian stems, compact public HTML and protected-route boundaries. No production command failure required rollback during this execution.

## Evidence limits and rollback

The source's browser tests/screenshots use isolated mocked Telegram/API fixtures. Deployment verification inspects real public HTML, protected unauthenticated boundaries, read-only server state and Telegram bot metadata. It does not fabricate a production learner, signed initData, practice session or exam. No forced Telegram message, scheduler tick, reminder opt-in, BotFather message or user interaction was performed. Real-owner practice/exam and actual scheduled-post observations remain separate manual follow-ups; TASK-072 is not accepted through this report. Native in-chat quiz work remains TASK-077.

The owner must fully close/reopen the Mini App to load the new production client. Existing preferences and learning history remain intact; reminder opt-in remains explicit. For a runtime failure, retain evidence, restore the previous runtime symlink and restart the established services as appropriate. Do not reverse Russian publication, delete learner records, weaken authentication or restore the database as a UI rollback. The existing enriched-image snapshot compatibility caveat still applies; no image or snapshot mutation occurred in this rollout.
