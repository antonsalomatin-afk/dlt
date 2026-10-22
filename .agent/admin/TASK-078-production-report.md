# TASK-078 native private-chat quiz production report

Date:2026-10-22. Operator: Admin/Builder `/root/admin_075`, acting under TASK-078's approved existing-host rollout and the owner's native-chat request. TASK-077 code acceptance and exact immutable release selection preceded archive/server mutation. No additional approval, provider, credential or forced Telegram test was introduced.

Status: the accepted native private-chat release is active. Admin live checks and Supervisor independent live checks pass. Formal independent operational review and Supervisor task acceptance remain separate gates. An actual owner-triggered quiz answer/feedback/Next journey and real signed Mini App practice/exam journey have not been observed by this operation.

## Release and accepted evidence

- Exact immutable release: `0a4d7b3291f346581174aa5ac3ffe7d5404f73be`, tag `thaidlt-native-quiz-20261022`.
- Current directory: `/srv/thaidlt/releases/0a4d7b3291f346581174aa5ac3ffe7d5404f73be`, reached through `/srv/thaidlt/current`.
- Previous accepted runtime `/srv/thaidlt/releases/611a5592ccf4f38612e56dd4c1bb9d906c32bef8` and its dependencies remain available for rollback. No application source changed during deployment.
- Accepted implementation: initial Builder `362624c272e43561f5fa727313ab6e0f6fc99693` and correction `bf32e5ae2b9034d42882a7a151a6ad3937150096`, with independent TASK-077 review02 PASS. Fresh Supervisor checks02 passed lint/typecheck,356 unit tests and15 targeted native/practice integration tests. Under the explicit task amendment, checks01's218 full integration tests, Prisma validation and build remain inherited for unchanged associated source; accepted TASK-076's229 browser tests remain inherited. Production installation/generation/build/migration and live checks below are additional fresh evidence.
- ADR-007 governs durable owned sessions, shared atomic answer/concept accounting, uncertain-delivery and received-vote recovery. Native practice adds `/quiz` and `/practice` in private chat; existing Mini App confirmation, reminders and summaries remain. Coherent English is the current quiz fallback because the production Russian overlay supplies stems but not complete Russian choices/explanations. No runtime translation or content edit occurred.

## Exact archive, source and staging

- Git archive `.local-content/TASK-078-0a4d7b3.tar.gz`:873,297 bytes; SHA256 `1fab1eb2d0c3f160e26e07d3ad1600c8230203879d075886ea181997f599008d`.
- All599 regular entries match a separate pinned LF Git archive of that same release after CRLF-only normalization;594 entries contain checkout line-ending conversions. The archive came from Git, never the working tree. Original untracked web instruction files and starter ZIP were preserved and excluded.
- Strict known-host SSH `ovh` and QEMU guest100 were used. Exact raw archive SHA was verified on the Proxmox host and inside the guest before extraction. Every guest exit code was checked separately from outer SSH success.
-91 unchanged web/content/tools/dependency/old-migration files raw-match both the previous installed release and the selected archive.19 critical native API/bot/shared-answer/schema/new-migration/content/web/dependency files raw-match the transferred archive. Supervisor independently checked21 critical raw files and the full archive proof.
- Node24.22.0, pinned pnpm11.19.0. Frozen `pnpm install --frozen-lockfile --prod=false`, mandatory `pnpm db:generate`, and production `pnpm build` all ran sequentially as User/Group `thaidlt` and exited0. Build used the existing application EnvironmentFile. No dependency policy bypass or lockfile edit was used; credentials/full environment were not printed.

## Backup, additive migration and preservation

- Preflight confirmed prior runtime611a559,17 completed migrations,0 unfinished and absent ChatQuizSession. Existing owned QuestionPresentation composite-unique FK target was present. All100 reviewed Russian stems matched the accepted overlay.
- A fresh `thaidlt-dbdump.service` backup began06:10:47UTC and completed06:10:49UTC, `Result=success`, `ExecMainStatus=0`, before migration. Artifact: `/srv/thaidlt-db/dumps/thaidlt-20261022-061047.dump`,101,812 bytes. Existing backup retention/scheduling remained unchanged.
- API and the single bot were paused. Complete before-state fingerprints covered all16 existing application tables with **no field exclusions**. No learner records or row contents were printed.
- Only accepted `pnpm prisma migrate deploy` ran from the selected release with DATABASE_URL injected by the existing protected systemd EnvironmentFile. It exited0 and applied `20261021140000_chat_quiz_session` once. Full private migration diagnostics were retained server-side at `/var/tmp/TASK-078-migration-private.log`; only the safe outcome was logged to the repository.
- Database now has18 completed migrations,0 unfinished, and exactly one finished row for the new migration. New ChatQuizSession was empty before native runtime activation. All16 complete old-table fingerprints still matched the before-state after migration and again immediately before cutover: content/review metadata, choices/correctness, preferences/users, presentations/answers, concept counters, sessions/exams, reports and delivery ledgers were unchanged.
- The new table has the named delivery check, primary key, user FK and owned `(presentationId,userId,questionId)` FK, all validated; allfour unique indexes are valid. Six required columns are NOT NULL, with nullable poll/message columns. No reset, seed, drop, resolve command, manual row update, content apply or preference mutation occurred.

## Retained inspection failure and safe recovery

The migration succeeded, but the first operator post-migration inspection exited1 because it incorrectly expected exactly four total pg_constraint rows. PostgreSQL18 also exposes six NOT NULL constraints as `contype='n'`, producing ten valid catalog rows. This was an administrative assertion error, not a failed migration or application/schema defect.

The guard prevented the symlink switch and resumed the old611a559 API/bot. The failure, migrate exit0 and temporary old-runtime gap remain in `.agent/checks/TASK-078-admin-01.txt`. Read-only diagnosis at06:12:21UTC confirmed18/0, empty native table, allcorrect constraint/index definitions and all16 old-table fingerprints still equal. A suspected SQL alias was explicitly tested and parsed successfully; it was not the cause.

Only the ignored administrative inspector changed: it now checks the exact required p/c/f constraints and separately verifies the six NOT NULL columns and four unique indexes. Corrected read-only proofs passed at06:13/06:14UTC. Supervisor accepted the diagnosis and authorized continuing only the already-approved cutover. Migration was **not replayed**, no migration was manually resolved and no database data/DDL was reversed.

## Runtime activation and protected settings

- Cutover-only execution began06:14:56UTC, paused the prior API/single bot again, repeated the corrected18/0/empty-table/constraint/preservation proof, then atomically switched the shared current symlink and restarted the established web/API/bot services.
- Allthree services are active/running as User/Group `thaidlt`, with0 automatic restarts and ExecMainStatus0. Observed MainPIDs: web2918710, API2918705, bot2918709.
- Actual process working directories, not merely systemd's symlink strings, resolve to the exact selected release: web `/srv/thaidlt/releases/0a4d7b3291f346581174aa5ac3ffe7d5404f73be/apps/web`; API and bot `/srv/thaidlt/releases/0a4d7b3291f346581174aa5ac3ffe7d5404f73be`.
- Existing root-owned0600 `/etc/thaidlt/{app,database,bot,question-posts}.env` files and the bot-only drop-in were retained. Effective safe allowlisted settings remain `DAILY_QUESTION_POSTS_ENABLED=true`, public username `thauto_dlt_bot`, no short name. Exactly one process has the precise bot entry-point argument and matches the systemd bot MainPID. No second/local/test polling instance was started.
- Web/API/database retain127.0.0.1:3060/3061/5434. No nginx route, host, webhook, provider, environment key or credential change was required.

## Fresh live read-only verification

Admin checks at06:16:51UTC passed:

- Compact public web200 with compact-app shell, old marketing headline/road hero absent.
- Local/public protected `/me`401/no-store; unauthenticated API-host and same-origin-web POST `/practice/presentation`401/no-store; unknown public API404. No nonexistent health route or synthetic signed Telegram identity was assumed.
- Bot is a single healthy process with expected enabled public settings and0 recent failure messages. Read-only getMe confirms `thauto_dlt_bot`, Main Mini App availability, no configured webhook and0 pending updates; the server retains the expected Mini App URL.
- Exact installed source contains native `/quiz` and `/practice` handlers, poll_answer handling, and explicit `allowed_updates: ['message','callback_query','poll_answer']`; no drop_pending_updates is present. This binds update-subscription behavior to the active exact source; the operator did not issue diagnostic getUpdates calls or intercept credentials/in-flight polling.
- Guarded Russian overlay default read-only check returns `0 would apply, 0 applied, 100 matched`. No production translation/content write was made. Native session count remained0 at the observed check; real user activity may legitimately change it later.
- PostgreSQL version observed18.6;18 completed/0 unfinished migrations and the new migration finished exactly once. Actual process CWDs remain the selected release.

Admin transcript: `.agent/checks/TASK-078-admin-01.txt`. Supervisor independently reported live PASS at06:16:01UTC in `.agent/checks/TASK-078-checks-01.txt`, including full archive proof,21 raw critical files, exact runtime/CWDs, three healthy units, one bot, protected modes/enabled settings,100 exact Russian stems, HTTP boundaries and independent18-migration/catalog validation including allten PostgreSQL18 constraint rows and four unique indexes. Formal independent operational review remains pending before whole-task acceptance.

## Evidence limits and rollback

No forced quiz/reminder/message, scheduler tick, BotFather message, getUpdates diagnostic, fabricated user or signed initData was used. Native correctness/feedback/Next and actual Telegram usability remain an owner-triggered manual observation; source tests use injected transports and isolated databases. Existing Mini App practice/exam and scheduled-message observations remain distinct follow-ups. Current11:00ICT opt-in bilingual reminder format and summaries were preserved; nobody was opted in or had vehicle/language changed by the operator.

Retain611a559 and the fresh backup. For an unhealthy runtime, restore the prior symlink and restart established services after diagnosis; the additive table is compatible with the old runtime and must be retained with any later learning history. Do not drop ChatQuizSession, mark migrations resolved, restore the database, reverse Russian publication, delete records or change secrets as routine rollback. A real production database restore remains a separate approved decision because it can discard subsequent learner activity.
