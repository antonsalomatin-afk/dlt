# TASK-083 simple group production rollout

Date: 2026-10-23 (actual UTC deployment date). Admin result: DEPLOYED / read-only operational probes PASS. Supervisor verification and independent operational review remain required before acceptance.

## Exact release and unchanged schema

- Release `f17b9ef8b7db1e9a69546736e0ecc26ba47ea66c`, immutable tag `thaidlt-simple-group-20261022` (tag date retained as selected).
- `/srv/thaidlt/current` now selects `/srv/thaidlt/releases/f17b9ef8b7db1e9a69546736e0ecc26ba47ea66c`.
- Prior `3cbcbac2976014f4d3bf6346341b6667f14b44d1` runtime, node_modules and built web retained for non-destructive application rollback.
- Archive `.local-content/TASK-083-f17b9ef.tar.gz`:928506 bytes; SHA256 `bd21ef83be8d8b477babcbc63a4d06014b77bc9720b694cd85b47d7f352dd786`.
- All629 regular source files exactly match a separately generated pinned Git LF archive, with zero CRLF conversions. Exact transferred archive hash checked on host/guest; short guest tarfile proof compared every installed regular file byte-for-byte before and after staging. No untracked, working-tree or secret files included.
- All21 schema/migration source files (schema,19 migration SQL files and lock file) identical between prior and selected Git releases; actual installed copies in both release directories independently SHA-checked against the accepted bytes. No migration is required or executed.

## Preflight and staging

Strict known-host batch SSH `ovh` / QEMU guest100 preflight at02:56:19Z confirmed prior3cb runtime, three healthy unprivileged services, exactly one bot, protected root0600 configuration, Node24.22.0/pnpm11.19.0, loopback3060/3061/5434,19 completed/0 unfinished/0 rolled-back migrations and all20 application tables.50 active VERIFIED questions per vehicle and100 Russian stems retained.

Unprivileged pinned frozen `pnpm install --frozen-lockfile --prod=false` followed by mandatory `pnpm db:generate`, then production build, completed in sequence before disruption. A strict SSH/QEMU exec-status transport poll failed while this staging command was in flight; its original wrapper completion output was not recovered and is not claimed as an observed guest exit. Current runtime remained3cb throughout diagnosis. No blind duplicate staging was executed.

Read-only diagnosis established actual completion using trusted PID1 systemd journal entries, matching unit/invocation boundaries, successful deactivation MESSAGE_ID `7ad2d189f7e94e70a38c781354912448`, generated client/dependencies/BUILD_ID and complete post-build raw-source proof:

- Install/generate invocation `ec0c191d9d344eeea74b5f80b2114d7d`: started02:58:36.040808Z, successfully deactivated02:59:07.680496Z. Its exact `/bin/bash -c` command uses `set -eu`, asserts pnpm11.19.0, frozen prod=false install and dbgenerate sequentially.
- Build invocation `e85696dcd25249ff8950f0c1b0393db8`: started02:59:07.704776Z, successfully deactivated02:59:44.984200Z; exact `/usr/bin/pnpm build` unit. No failed/main-process-exit error journal record.
- Collected transient units report not-found afterward, as expected; their default status0 was explicitly NOT used as completion proof. The interruption, diagnostic boundaries and all subsequent actual guest exit0 results remain in the safe transcript.

No package-manager/dependency approval, configuration or source was changed to bypass the transport issue.

## Fresh backup and runtime-only cutover

- Fresh dump `/srv/thaidlt-db/dumps/thaidlt-20261023-030610.dump`,122289 bytes, custom-format PGDMP header read and confirmed.
- Backup service Result success/ExecMainStatus0, started03:06:10Z and completed03:06:12Z.
- Runtime symlink switch timestamp03:06:13.956280Z, after successful backup completion.
- API and the single bot were quiesced. All20 actual public application tables were enumerated, including every group/private question and answer table, and full count/content fingerprints taken in read-only repeatable-read transactions before and after the atomic switch, before restarting writers. Every fingerprint equal, no field exclusions.
- Baseline `/var/tmp/TASK-083-preservation-before.json` contains sorted `{table,count,digest}` records; all19 complete migration rows were also serialized and compared unchanged, at `/var/tmp/TASK-083-migrations-before.json`. Both created by thaidlt with0600 under0077 umask. No raw learner rows were printed or exported.
- No `migrate deploy`, DDL, reset, seed, resolve, content apply, data repair, forced closure, historical message rewrite or group-permission edit. Existing group/private rows retained exactly, including their original delivery states.

Established web/API/bot restarted unprivileged and healthy: webPID3770683, API3770677, bot3770682, each active/running/exit0/NRestarts0. Actual process working directories match selected release (web apps/web). Four `/etc/thaidlt/{app,database,bot,question-posts}.env` files remain root/root0600; enabled question posts, expected public username, absent short name and established drop-in/config preserved. Precisely one bot entry point exists.

## Final read-only verification

At03:06:58Z all probes passed:

- Compact public web200; former marketing hero absent.
- Protected local/public `/me`, API-host and same-origin POST `/practice/presentation`:401 with no-store; unknown API404.
- getMe expected `thauto_dlt_bot`, Main Mini App and group joining available; getWebhookInfo no webhook/zero pending updates; expected configured Mini App URL retained. Bot metadata does not expose the actual BotFather target URL.
- Exact installed simple group runtime contains optional Next and safe legacy f/r/n routing, without Finish round, stopPoll or shared-results implementation. Existing private/group dispatch, explicit message/callback_query/poll_answer subscription, no drop_pending_updates and actual release identities verified.
- Guarded Russian stem inspection:100 matched,0 would apply,0 applied;19 completed migrations, native/group migrations once, PostgreSQL18.6 and two existing native sessions observed read-only. No claim that these counts establish a new owner journey.
- Recent bot journal has zero failure messages; journal content not printed. Fresh PGDMP backup and prior runtime/dependencies retained.

## Boundaries and owner handoff

No real test message/poll/vote, diagnostic getUpdates, second polling process, explicit scheduler tick, synthetic signed identity or group permission change was performed. Actual owner/group native interaction and signed Mini App practice/exam remain unobserved unless separately reported. Existing historical posts are retained, rather than silently deleted or rewritten.

Owner sends a fresh `/quiz@thauto_dlt_bot`, chooses an answer and receives Telegram-native correctness immediately. Next is optional, available to any current member. Earlier successfully bound questions remain answerable by another member later. No Finish round, shared accuracy summary or contest ceremony is required. The established bot-admin membership prerequisite remains; shared language currently English, personal settings unchanged.

Safe transcript: `.agent/checks/TASK-083-admin-01.txt`. Ignored administrative helpers `.local-content/task083*`; JavaScript syntax-check snippets use `.mjs.txt`, not lint-visible JavaScript extensions. Admin changed only this report and transcript; Supervisor owns acceptance/state integration.
