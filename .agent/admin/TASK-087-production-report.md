# TASK-087 bilingual Telegram teaching production publication

Date: 2026-10-24 UTC. Admin result: DEPLOYED; guarded publication and read-only operational probes PASS. Supervisor independent live verification and independent operational review are required before task acceptance/main integration.

## Release, compatible fallback and exact source

- Live release `c472c06b94252f170d9971bca70d4fef322b6f6f`, tag `thaidlt-bilingual-chat-20261024`; `/srv/thaidlt/current` resolves to its exact `/srv/thaidlt/releases/<SHA>` directory.
- Compatible application fallback `d54f2d60252830d850b70b5803d6a35aa6a0a571` is fully staged in its own release directory with frozen dependencies, generated client and successful production web build. It was built and inspected before any disruption. The previous `f17b9ef8b7db1e9a69546736e0ecc26ba47ea66c` release remains retained.
- Release archive: 1053222 bytes, 657 regular files, SHA256 `3646b0301368469e54cafa0eb2c2bd365bd22491935c8737062230183602dca7`.
- Fallback archive: 1040785 bytes, 651 regular files, SHA256 `ab6a8ab3179c5dbab91532f57fbaf596715789fa9785869421c8728f53d8bf34`.
- Exact guest archives are retained at `/var/tmp/TASK-087-release.tar.gz` and `/var/tmp/TASK-087-rollback.tar.gz`, with the same named files on the SSH host. Local files are `.local-content/TASK-087-{release,rollback}.tar.gz`; the Supervisor's independent pinned Git LF archive proof precedes this publication.
- Every installed raw regular source file was compared byte-for-byte with its exact archive before builds, after both builds and after publication: 657/657 and 651/651. This includes the actual TASK-084 independent review, teaching pack, candidate sources and accepted Russian stems. No working-tree or starter files entered the archives.
- All 29 selected installed schema/migration/package/lock/workspace contract files match across actual f17, release and fallback directories. No migration, seed, content overlay, reset, DDL, dependency upgrade or data repair was run.

## Preflight and staging

Strict known-host batch SSH alias `ovh`, QEMU guest100, verified actual f17 at 07:01:27Z. Three established web/API/bot units were active/running as User/Group thaidlt, with precisely one bot entry point; Node24.22.0/pnpm11.19.0, loopback ports3060/3061/5434, 19 completed/0 unfinished/0 rolled-back migrations, 20 application tables and 50 active VERIFIED Russian-stem questions per vehicle matched the expected baseline. Existing settings remained root/root0600. Protected hashes of the four configuration files and full effective unit definitions were retained without printing their values.

Both new release directories were installed and built as thaidlt using pinned pnpm11.19.0, `pnpm install --frozen-lockfile --prod=false`, mandatory `pnpm db:generate`, then `pnpm build` with the existing application EnvironmentFile. Actual guest exit0 and systemd successful process exits were observed for both complete staging sequences. No not-found transient-unit default status was treated as completion evidence.

Before cutover, read-only repeatable-read database inspections using each built runtime independently produced 100 exact source/accepted-stem eligible teaching snapshots in memory, 400 Russian choices and two bounded section33 examples, with 50 questions per vehicle. Each snapshot passed that runtime's strict parser. No bank/history row was written.

### Observed staging failures and recovery

The initial release transfer failed because Proxmox `--pass-stdin` limits input to1MiB; 1053222 release bytes exceed that limit. The fallback archive transferred successfully. The initial local sequential shell continued after the failed release transfer: extraction/source proof failed on the missing release archive, then fallback install failed systemd status200 because its release WorkingDirectory had not been extracted. No install ran in the live current directory and no runtime disruption occurred. These actual nonzero results remain in the transcript.

Corrected transfer used three bounded chunks (524288/524288/4646 bytes), reassembled on the guest with exact size/SHA256 verification before extraction. Subsequent local execution hard-stopped on unexpected nonzero guest results. Both archives were then extracted, source-verified and staged successfully.

Each owned staging command encountered one exec-status transport failure. The original guest PID was retained and polled to recovered actual exit0; no duplicate install/build was started. Optional concurrent read-only staging-status start calls failed at transport and supplied no claimed evidence. The recovered original staging output is authoritative. Ignored PID tracking and task087 helpers remain local.

## Fresh backup and full preservation across cutover

- Fresh backup `/srv/thaidlt-db/dumps/thaidlt-20261024-070903.dump`, 125228 bytes; actual custom `PGDMP` header confirmed.
- Established backup service started07:09:02Z, completed07:09:06Z, Result success/ExecMainStatus0. Protected `/var/tmp/TASK-087-backup-proof.json` retains path, size and actual service timestamps.
- API and bot gracefully quiesced at07:09:07Z. Atomic shared symlink switch occurred at `2026-10-24T07:09:07.885483+00:00`, after backup completion.
- All20 actual public application tables were enumerated. Each fingerprint includes count and every full row/field using ordered `to_jsonb(row)::text` aggregation and MD5, with no exclusions. Every before/after fingerprint matched. All19 complete migration rows, sorted by migration_name, also matched exactly.
- Distinct before and after artifacts were written under thaidlt/0077 as0600, and compared before any writer restart. Paths are `/var/tmp/TASK-087-preservation-before.json`, `/var/tmp/TASK-087-preservation-after.json`, `/var/tmp/TASK-087-migrations-before.json` and `/var/tmp/TASK-087-migrations-after.json`. Preservation files are arrays of `{table,count,digest}`; migration files retain all full rows. Private raw learner rows were never printed or exported.
- Artifact mtimes independently establish before-file < atomic switch < after-file. Equality was confirmed at07:09:08Z before restarting services. This covers saved private/group rounds, snapshots, votes, answers, settings and other history. Normal learner activity may subsequently change mutable tables.

The failure guard would quiesce writers, atomically select the fully staged compatible d54f fallback and restart the existing services, retaining all schema/data. It was not needed. After enriched snapshots can exist, f17's older strict reader must never be blindly restored; no snapshot rewrite or database restore is part of rollback.

## Live read-only verification

At07:09:13Z and through actual publication guest exit0:

- WebPID708500, API708495, bot708496: active/running as thaidlt, ExecMainStatus0/NRestarts0. Actual process CWDs resolve to exact c472 release (web under apps/web). Precisely one bot entry point exists.
- All four protected `/etc/thaidlt/{app,database,bot,question-posts}.env` files and effective service/unit definitions remain byte-identical to the protected preflight baseline `/var/tmp/TASK-087-settings-before.json`. Modes remain root/root0600. Existing enabled question posts, public bot username and unset short name are preserved.
- Public compact web200; former marketing headline/road hero absent. Public/local `/me`, local/API-host/same-origin POST `/practice/presentation` return401 with no-store; unknown public API route404.
- Read-only Telegram getMe/getWebhookInfo: expected `thauto_dlt_bot`, Main Mini App available, group joining enabled, no webhook, zero pending updates, configured Mini App URL expected. These metadata checks cannot prove the actual BotFather launch target or a user's journey.
- Exact installed rich private/group handlers, per-line Russian spoiler entities, bounded expandable explanations, same-scope per-voter ephemeral receiver and own-answer Explain recovery are present. Normal message/callback_query/poll_answer subscription remains, with no drop_pending_updates. Full archive proof binds all implementation details to the accepted source.
- Live read-only coverage again proves100 exact eligible source/stem matches,100 enriched snapshots in memory only,400 Russian choices, two bounded section33 examples,50 active VERIFIED questions per vehicle. Source bank stays unchanged.19 migrations remain complete; existing native/group migrations occur once. PostgreSQL18.6 and two existing native sessions were observed without claiming a new journey.
- Recent bot journal contained zero failure messages; journal bodies were not printed. Both release/fallback archives and installed source identities were rechecked after publication.

No real Telegram send/poll/vote, diagnostic getUpdates, second bot, explicit scheduler tick, synthetic signed identity, permission/configuration edit, public explanation fallback or unsolicited DM was performed. Actual owner/private/group answer-and-Explain journeys and signed Mini App practice/exam remain unobserved unless separately reported. Existing historical posts and snapshots were retained.

Safe evidence transcript: `.agent/checks/TASK-087-admin-01.txt`. Admin commits only this report and transcript, then stops. Supervisor owns independent verification, operational review, state and acceptance/main integration.
