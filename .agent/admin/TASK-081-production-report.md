# TASK-081 production group quiz rollout

Date: 2026-10-22. Admin result: DEPLOYED / operational probes PASS. Supervisor independent verification and independent operational review remain required before task acceptance.

## Release identity

- Accepted release: `3cbcbac2976014f4d3bf6346341b6667f14b44d1`, tag `thaidlt-group-quiz-20261022`.
- Current runtime: `/srv/thaidlt/releases/3cbcbac2976014f4d3bf6346341b6667f14b44d1`, selected by `/srv/thaidlt/current`.
- Prior `0a4d7b3291f346581174aa5ac3ffe7d5404f73be` release, generated/dependency tree and built web remain available for application rollback.
- Archive: `.local-content/TASK-081-3cbcbac.tar.gz`, 913168 bytes, SHA256 `638599537516b0448f53a2d6958aa7ef45df42c69fe479e0a9bd21d578c18112`.
- All 619 regular archive members exactly match an independently generated pinned Git LF archive (zero line-ending conversions). Exact archive hash verified on host and guest. All 619 installed regular source files raw-hash verified both after extraction and after install/generation/build, in seven bounded batches each. No working-tree, untracked or secret files entered the archive.

## Preflight and staging

Strict known-host, batch SSH `ovh` and QEMU guest100 checked actual guest exit status, independently of transport. Read-only preflight at13:20:17Z confirmed prior exact runtime, three unprivileged active/running services, zero restarts, exactly one bot, loopback3060/3061/5434, sufficient disk, Node24.22.0 and pinned pnpm11.19.0. Database baseline18 completed/0 unfinished, three group tables absent, 50 active VERIFIED questions per vehicle and100 matching Russian stems.

New release staging completed as User/Group thaidlt before disrupting old services: pinned `pnpm install --frozen-lockfile --prod=false`, mandatory `pnpm db:generate` (Prisma7.10.0), and production `pnpm build`, all exit0. No dependency/config approval was weakened. All raw source comparisons passed again after build.

One administrative inspection transport issue was safely contained: the first all619-file raw-proof shell argument exceeded Windows command-line length (WinError206) before an SSH/guest verification process was launched. No source mismatch or remote side effect resulted. The identical static comparisons were split into100-file batches, covering every member once; all seven batches passed before staging continued. This event is retained in the transcript. No production migration/runtime failure occurred.

## Fresh backup, migration and preservation

- Fresh dump: `/srv/thaidlt-db/dumps/thaidlt-20261022-132604.dump`, 110421 bytes; custom-format PGDMP header independently read by Admin. Backup service Result success / ExecMainStatus0, started13:26:03Z, completed13:26:05Z.
- Only new migration: `20261022100000_group_chat_quiz`, started13:26:12.740Z and finished13:26:13.050Z, after backup completion. `prisma migrate deploy` exited0; full diagnostics retained privately server-side.
- Exactly19 completed/0 unfinished/0 rolled-back migration rows afterward; new migration once. GroupQuizScope, GroupQuizRound and GroupQuizVote initially empty.
- API and the single bot were quiesced. Every one of the17 existing application tables, including live ChatQuizSession, was enumerated from the actual public schema and fully count/content fingerprinted in a read-only repeatable-read transaction before and after migration. All17 fingerprints equal, with no field exclusions. Only Prisma migration metadata was excluded, as intended.
- Baseline retained at `/var/tmp/TASK-081-preservation-before.json` as sorted `{table,count,digest}` records, owned by thaidlt with0600 under0077 umask. No learner rows were printed or exported.
- Schema inspection checked all13 exact named validated p/c/f constraints, composite scope/current-round and vote/round/question/owned-presentation foreign keys, required delivery check, ten exact valid unique indexes and19 required non-null columns. PostgreSQL18 NOT NULL catalog rows were handled separately; no misleading total-constraint assumption.
- No migration replay/resolve, reset, seed, content apply, database restore, preference rewrite or data correction. Prior native session data was retained; later read-only health observed two native sessions, without implying any new owner test.

## Activation and live verification

Shared symlink switched atomically after preservation/schema checks. Established web/API/bot restarted, each User/Group thaidlt, active/running, exit0 and NRestarts0. Actual process CWDs match the selected release (web under apps/web); PIDs web3219524, API3219519, bot3219523. Precisely one bot entry point exists. Four `/etc/thaidlt/{app,database,bot,question-posts}.env` files remain root/root0600; existing drop-in/config and enabled question-post flag/public username/absent short name retained.

Read-only final probes at13:26:43Z passed:

- Public compact web200; old marketing headline/road hero absent.
- Local/public `/me`, API-host and same-origin POST `/practice/presentation`:401 with Cache-Control no-store. Unknown public API404.
- `getMe`: expected `thauto_dlt_bot`, Main Mini App available, can_join_groups true; configured expected Mini App URL retained. `getWebhookInfo`: no webhook, zero pending updates. The metadata API does not expose the actual BotFather URL.
- Exact installed private/group registration/dispatch and explicit message/callback_query/poll_answer subscription, no drop_pending_updates; actual process release identities match. No diagnostic getUpdates or second polling process.
- Guarded Russian overlay inspection:100 matched,0 would apply,0 applied. Existing source/content data remain unchanged; PostgreSQL18.6,19 migrations and native/group migration cardinality verified.
- Recent bot journal contained zero failure messages; journal content itself was not printed. Prior runtime/dependencies and fresh dump retained.

## Observation limits and owner handoff

No forced Telegram message, poll, vote, scheduler tick, synthetic signed Mini App identity, group permission change or production learner interaction was performed. This rollout does not establish the actual two-member group answer/finish/Next or signed Mini App practice/exam journey. Existing owner report of private-chat success predates this rollout.

Owner can make the existing bot an administrator in the intended group (destructive privileges unnecessary), then send `/quiz@thauto_dlt_bot` or `/quiz@thauto_dlt_bot motorcycle`. Members answer the shared non-anonymous quiz; each accepted first vote counts once toward personal practice. Starter/admin uses Finish round, reads full explanation/aggregate accuracy, then Next. Shared language is currently English; personal vehicle/language/reminder settings are preserved.

Safe transcript: `.agent/checks/TASK-081-admin-01.txt`. Ignored helpers under `.local-content/task081*` preserve exact transport/staging/inspection/cutover steps. Admin changed only this report and transcript; Supervisor owns task/state/review acceptance.
