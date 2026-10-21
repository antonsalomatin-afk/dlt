# TASK-075 production report — accepted bilingual release

Date: 2026-10-21. Operator: Admin/Builder `/root/admin_075`, under the owner's explicit `deploy` approval recorded in `.agent/OWNER_DECISIONS.md` and task authorization commit `6660b32`.

Status: accepted runtime and all100 reviewed Russian stems are deployed. New bilingual reminder enrichment is deliberately **disabled**, pending production Main Mini App configuration in BotFather. This report does not claim completion of TASK-075's enablement criterion or real owner-session testing. Supervisor checks and independent operational review remain separate gates.

## Release and build

- Exact accepted release: `b38618f13765ec41ac51421327c1cbbfa347f245`, tag `thaidlt-bilingual-20261021`.
- Deployed directory: `/srv/thaidlt/releases/b38618f13765ec41ac51421327c1cbbfa347f245`; `/srv/thaidlt/current` now resolves there.
- Previous runtime retained at `/srv/thaidlt/releases/1d7eaa0671889ec82edc1b5cf149b4e7c495ffe3`; previous accepted content artifacts remain available. No unrelated application was changed.
- Git archive:797,219 bytes, SHA256 `2514ab52411459cc93d8da53ff0fb97eab737b15ec54dac4c58ac14aa8d9c2b4`. Exact archive hash verified on Proxmox and inside guest100 before extraction. The archive was created directly from the accepted commit, without working-tree files or secrets. All566 regular archive entries were independently compared with raw accepted Git blobs; all match after LF normalization. Git archive honored checkout CRLF conversion: raw archived text hashes differ from LF Git blobs, while normalized bytes agree. Canonical parsed-JSON pack/source hashes are independent of this formatting.
- Node24.22.0. Global pnpm currently reports12.4.2 outside the repository, while the release's pinned package manager correctly executes11.19.0. An explicit `pnpm --version` equality check succeeded before `pnpm install --frozen-lockfile --prod=false`.
- Installation, `pnpm db:generate`, and `pnpm build` all succeeded under the existing unprivileged `thaidlt` user. Development dependencies were retained for the Prisma CLI. Build used the existing application EnvironmentFile; secrets were not printed. No lockfile/policy bypass was used.
- Schema and migration directory compared byte-for-byte against the installed previous runtime and were unchanged. Database still has17 completed migrations. No migration, seed, reset, taxonomy edit or new dependency was introduced by this deployment.

## Backup and reviewed content application

- A fresh existing `thaidlt-dbdump.service` run completed at07:28:34UTC with `Result=success` and `ExecMainStatus=0`, before any content write. Backup: `/srv/thaidlt-db/dumps/thaidlt-20261021-072832.dump`,92,170 bytes. Existing nightly dump and VM backup policies remain.
- API and the single bot unit were stopped during the content update and cutover. Web remained available while its API was briefly unavailable.
- Actual independent manifest: `.agent/reviews/TASK-074-translation-review-01.json`; reviewed pack canonical SHA256 `c50e945d4f2371616ca5947a2551ec16ecbe8a6908d4b4c57fd8cf140f5e002d`. No synthetic review fixture was used in production.
- Guarded CLI executed as `User=thaidlt`, with only `/etc/thaidlt/database.env` injected by systemd. The unchanged loopback validator accepted the established PostgreSQL port5434.
- Initial read-only result: `100 would apply, 0 applied, 0 matched`.
- Explicit `--apply` result: `0 would apply, 100 applied, 0 matched`.
- Final read-only result: `0 would apply, 0 applied, 100 matched`.
- Every command exited0. Final active VERIFIED bank has50 CAR/50 Russian stems and50 MOTORCYCLE/50 Russian stems. IDs, English, choices, correctness, explanations and active verification lifecycle were preserved; only permitted Russian stem/review metadata and Prisma updatedAt changed.
- Before/after server-side fingerprints covered all16 application tables while API/bot were stopped. Question fingerprints excluded only the four permitted fields; all other fields and all other table contents matched. Fingerprints were not printed with learner data. Saved practice/exam presentations, answers, sessions, reports, user preferences, learning state and delivery ledgers were preserved. Earlier saved daily snapshots may stay English-only; none was rewritten.

## Runtime, configuration and health

- Services `thaidlt-web`, `thaidlt-api`, and `thaidlt-bot` are active/running as User/Group `thaidlt`, with0 restarts since cutover and ExecMainStatus0. Units retain their established commands/working directories through `/srv/thaidlt/current`; web remains127.0.0.1:3060, API127.0.0.1:3061, database127.0.0.1:5434.
- Existing `/etc/thaidlt/{app,database,bot}.env` were observed root-owned0600 and retained. Credentials were never copied into the release or repo.
- New root-owned0600 `/etc/thaidlt/question-posts.env` contains only the non-secret rollout keys: `DAILY_QUESTION_POSTS_ENABLED=false` and `TELEGRAM_MINI_APP_BOT_USERNAME=thauto_dlt_bot`.
- A root-owned0644 `/etc/systemd/system/thaidlt-bot.service.d/75-question-posts.conf` reads that file after the established files and uses `UnsetEnvironment=TELEGRAM_MINI_APP_SHORT_NAME`. The actual bot process environment was checked using an explicit safe allowlist: flagfalse, expected public username and no short name. No full environment was logged.
- Exactly one process has the exact `apps/bot/src/main.ts` argument, matching the bot unit MainPID. No local/test polling process was started.
- HTTPS web returns200. API `/me` and local API `/me` return401 with `Cache-Control: no-store`. Unauthenticated POST `/practice/presentation` returns401/no-store through both `https://tele.thauto.app` and the web's same-origin rewrite. Unknown public API path remains404. No nonexistent `/health` endpoint was assumed.
- Fixed bot startup/update failure-message count since cutover is0. This is process/configuration evidence, not proof of a real scheduled message or owner UI journey.

## Telegram setup dependency

- Read-only Telegram API calls returned public username `thauto_dlt_bot`, `has_main_web_app=false`, no configured webhook,0 pending updates, and default menu type `commands`.
- Therefore a Main Mini App has not yet been configured for the exact-question `https://t.me/thauto_dlt_bot?startapp=question_<presentationId>` links. Existing ordinary Mini App entry remains configured with `https://dlt.thauto.app` in the app environment, but this does not establish Main Mini App readiness.
- The owner must configure the production bot's Main Mini App in BotFather to `https://dlt.thauto.app`. Supervisor has requested that setup. After read-only `getMe` confirms Main Mini App availability, enable the approved enrichment by changing only the new non-secret flag to `true`, restart the single bot unit, and verify its effective configuration and services again. No second deployment approval is needed for that already-approved remaining step.
- Until then the existing generic localized opt-in reminder and summaries remain operational; new bilingual enrichment stays off. No forced scheduler tick, test Telegram message, BotFather message, user impersonation or fake signed initData was used.
- Remaining manual evidence: owner opens the real bot/Mini App and exercises an actual scheduled post, exact-question link including an older link, answer selection/change followed by Check answer, and completion handling. These observations are not inferred from synthetic tests. TASK-072's original broader design/smoke scope is not accepted by this deployment.
- Final bounded read-only readiness recheck at2026-10-21T07:34:08Z still returned `has_main_web_app=false`, menu type `commands`, no webhook and0 pending updates for `thauto_dlt_bot`. No flag, service, content or Telegram message changed during this recheck. Waiting for owner Main Mini App setup; the dedicated process rollout flag remains false as previously verified.

## Evidence and rollback

Admin transcript: `.agent/checks/TASK-075-admin-01.txt`. Accepted source checks/reviews remain TASK-073 checks02/review02 and TASK-074 checks03/checks04/review02. This deployment-only task inherits those lint/typecheck/unit/browser/integration gates under the Supervisor's explicit validation scope; it additionally ran production install/generation/build and the safe checks above. Supervisor independently reported read-only checks PASS in `.agent/checks/TASK-075-checks-01.txt`, verifying the explicit false rollout state, source/archive identity, content replay, services and HTTP boundaries. Its first hash attempt compared LF blobs with CRLF archived files; the retained diagnostic was resolved by proving all566 archive entries match accepted source after line-ending normalization and checking remote critical-file raw hashes against the archive. Independent operational review and the remaining enablement/setup gate still precede whole-task acceptance.

One staging transfer attempt exceeded QEMU's1MiB stdin limit after base64 encoding; no extraction, service or content change occurred. A raw797,219-byte transfer then succeeded and was verified against the exact SHA256. One local search referenced a nonexistent helper filename and was corrected by inspecting the actual reminder module; it did not affect server operations.

To disable enrichment, keep/set the dedicated flagfalse and restart the bot. Runtime rollback can restore the retained previous release symlink, but must not reverse reviewed Russian content, delete learner records or restore the database without a separate approved restoration decision. Older strict readers cannot parse enriched image snapshots; the current starter bank has no images, and no enriched image snapshot was introduced by this rollout. Inspect actual snapshot state before any future older-runtime rollback. Telegram transport ambiguity still prevents an end-to-end exactly-once guarantee.
