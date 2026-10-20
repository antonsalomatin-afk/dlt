# TASK-071 production report

Report date: 2026-10-20. Author: Supervisor, acting as the approved content-publication operator through the existing authenticated SSH connection. Original host provisioning was performed by the server Admin; earlier Admin assertions are distinguished below from new independently collected evidence. No secrets or learner records are included.

## Release identity and approval

- Owner approved live launch on dlt.thauto.app / tele.thauto.app in TASK-070, reference use on2026-10-16, and explicitly approved publishing the reviewed starter bank on2026-10-19. No additional content authorization is pending.
- Runtime remains `/srv/thaidlt/releases/1d7eaa0671889ec82edc1b5cf149b4e7c495ffe3`, reached through `/srv/thaidlt/current`. No app code, dependencies, generated client, schema or service symlink changed during this content-only publication.
- Content release: `037ac0cbc07d8c2c8686e7dd77fcef2f36281281` on `codex/task-071`. This commit records Supervisor acceptance of the bounded independently reviewed release component. Builder manifests/checks commit: `d418f2cd228c2222d9d9d6dae525e69439cfca06`. Original reviewed candidate bytes: `65d1c1ade2c48fc4e82388db85da93faf7eee9d8`.
- Bundle SHA-256: `0d357f29e3be39aaa8f0075a7730b2353a303280319f37eeb943fc02ad3cb7bf`;63,357 bytes;16 explicitly selected files. Hash checked on host and inside guest before extraction. Contains content and review/approval evidence only.
- Installed content artifact directory: `/srv/thaidlt/content-releases/037ac0cbc07d8c2c8686e7dd77fcef2f36281281`.
- Independent source/content/final-wording/release reviews: `.agent/reviews/TASK-071-reference-review-01.md`, `TASK-071-content-review-01.md`, `TASK-071-content-review-02.md`, `TASK-071-release-review-01.md`. Earlier `.agent/reviews/TASK-071-review-01.md` is explicitly retracted as non-independent and is not acceptance evidence.

## Host and service boundary

- Infrastructure: owner-managed Proxmox host `ns536000`, configured SSH alias `ovh`, public139.99.8.128; running QEMU guest100 `ubuntu-apps`. Provider billing/account details were not accessed. Admin reported Ubuntu24.04; no new provider or paid service added.
- Both DNS A records independently resolve to139.99.8.128. Admin configured Cloudflare DNS-only.
- Trusted TLS handshake independently passed for both hosts. Let's Encrypt certificates expire2027-01-12T16:14:36Z (web) and2027-01-12T16:14:51Z (API).
- Guest listener inspection confirms127.0.0.1:3060,127.0.0.1:3061 and127.0.0.1:5434. PostgreSQL runs as container `thaidlt_postgres`, image `postgres:18`, exposing5432 only through127.0.0.1:5434.
- nginx routes the web and approved API paths. Fresh HTTPS smoke: web200; GET/me401 with `Cache-Control: no-store`; unknown API route404. Admin's original report states HTTP redirects to HTTPS and limits public API exposure to auth/telegram, me, practice and exam prefixes. No webhook added.
- `thaidlt-web`, `thaidlt-api`, `thaidlt-bot` are active/running, User=thaidlt and Restart=always. API and bot execute `/opt/node24/bin/node`; verified runtime version24.22.0. Exactly one production bot unit is used; no local polling worker was started.
- EnvironmentFile references are `/etc/thaidlt/app.env`, `database.env`, `bot.env` as applicable. Secrets remained server-side; files were not printed or copied into the repo. Transient database operations inject only database.env and execute as thaidlt. Read-only Telegram diagnostic used the same three EnvironmentFiles as the bot.

## Migrations and content publication

-17 successfully finished migrations independently counted before publication, matching the Admin's prior `prisma migrate deploy` report. No new schema migrations required by this content-only release. Existing generated Prisma client and accepted candidate tools were used; their source is unchanged against the runtime commit.
- Fresh pre-publication bank independently read as empty. There was no existing production bank to overwrite.
- At07:06UTC, verified bundle staged and fresh database backup succeeded. API/bot were briefly stopped during partial publication; web remained running.
- Exact additive taxonomy SQL committed its own transaction/assertions:12 categories and53 concepts. No taxonomy overwrites, deletions or broad development seed.
- Both batches imported separately:50 new inactive DRAFT questions /200 choices each. Status asserted50 exact DRAFT each, zero missing/drift/invalid lifecycle.
- Actual independently supported review manifests then applied:50 VERIFIED each, still inactive. Both intermediate statuses checked before activation.
- Activation applied50 each. Final production status: each batch has total50, exact50, verifiedActive50; missing, drifted, draftInactive, verifiedInactive, rejectedInactive and invalidLifecycle all0.
- API and bot resumed at07:07:25UTC; unchanged runtime symlink and all three services active verified. Node24 exact activation replay later matched50 each with0 applied and unchanged exact final statuses.
- All100 are original English safety-practice questions,50 CAR +50 MOTORCYCLE, each with primary DLT handbook page evidence. No source-bank wording/images/keys republished. Other question-language fields remain null. This is a starter learning set, not an official DLT bank, complete syllabus or readiness certification.

## Bot, scheduler and learner checks

- Read-only Telegram getMe succeeded: public username `thauto_dlt_bot`. getWebhookInfo returned no configured webhook and0 pending updates. No getUpdates call, test notification or user message was sent by the Supervisor.
- Bot startup initializes Telegram, starts the scheduler and enters polling under the accepted lifecycle code. Scheduler observes every30 seconds; reminders and daily summaries send at11:00ICT; weekly summaries on Monday at11:00ICT. Delivery ledgers and opt-in preference govern recipients; completion does not suppress eligible reminders.
- Production reminder and summary ledgers were empty in the read-only audit. This does not prove a real notification was delivered. No forced delivery or preference changes were performed.
- Owner previously confirmed real Mini App login with "login ok" on2026-10-16; retained as human-reported evidence in TASK-071-login-evidence.md. A new owner interaction through real Telegram after content publication has not been observed.
- Local authoritative actual-manifest rehearsal used a disposable database and real API handlers to construct50 distinct questions for each vehicle and reject pre-submit correctness leakage. No fabricated Telegram identity, production test session, exam record or learner data was inserted. Thus real owner end-to-end practice/exam acceptance after publication remains a human testing item, rather than an independently completed check.

## Backups, restoration and rollback

- Existing `thaidlt-dbdump.timer` is active; observed daily trigger01:30UTC. Fresh pre-publication backup at2026-10-20T07:06:07Z completed Result=success /ExecMainStatus=0.
- Backup artifact: `/srv/thaidlt-db/dumps/thaidlt-20261020-070607.dump`,55,781 bytes. This backup intentionally precedes publication and therefore contains0 production questions. Original Admin policy retains14 dumps.
- Supervisor independently restored this exact dump using PostgreSQL18 pg_restore into a newly created isolated owned database, checked17 migrations and the expected0-question pre-publication bank, then removed only that test database. Production database was not restored or reset; learner data were not read into tool output.
- Proxmox backup configuration independently confirms enabled02:00 job, storage `pbs-backup`, VM list100,101. Admin previously reported successful VM backups. No PBS credentials accessed.
- There is no code rollback needed for this content-only change because current symlink is unchanged. Do not blindly reimport/review after activation, delete taxonomy, overwrite immutable review fields or assume a code symlink reverses data publication.
- If content must be withdrawn, stop API/bot and prepare a separately reviewed explicit correction. Retain artifact and pre-publication backup. Restoring production would discard subsequent learner changes and needs a separate approved restoration decision; never perform that as routine automated cleanup.

## Checks and limitations

Authoritative release evidence: `.agent/checks/TASK-071-release-checks-01.txt` (offline exact-chain validation, lint/typecheck,323 tests, strict check-script TypeScript, actual-manifest PostgreSQL replay/status/conflict/preservation/exam rehearsal and cleanup PASS).

Production transcript: `.agent/checks/TASK-071-production-release-01.txt`. It includes one failed read-only diagnostic: importing grammy from the monorepo root using `/usr/bin/node` failed because grammy is a bot-workspace dependency. Corrected diagnostic used bot workspace and `/opt/node24/bin/node`, then succeeded. Initial content CLI execution used the system Node22 executable, which completed successfully; exact Node24 replay and read-only status subsequently passed. The supervised application services use Node24 throughout. Neither diagnostic failure changed content, bypassed review or interrupted the resumed services.

The fresh content-count blocker is resolved. Remaining human check: open the real bot and exercise practice and both mock-exam vehicles. No claim is made that this human journey or a real scheduled notification has already passed. Whole TASK-071 acceptance awaits the final independent operational review of this report and evidence.
