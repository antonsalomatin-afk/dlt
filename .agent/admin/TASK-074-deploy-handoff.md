# TASK-073/074 bilingual private reminders — production handoff

Status: TASK-073 and TASK-074 accepted; prepared for owner approval, not deployed. Exact release tag: `thaidlt-bilingual-20261021` (created only after Supervisor acceptance and main integration). TASK-074 implementation source: `e1f6935cd7341449ef3aa6cc7fd8048dd0061169`; actual manifest introduced at `173ad252818d7209112f97310243bd05cd90c6b9`. Authoritative checks03 pass lint/typecheck/338 unit tests/two isolated PostgreSQL tests; review02 is PASS; checks04 repeats both full-100 integration tests using the actual manifest and passes. TASK-073 runtime checks and inherited build/browser evidence are recorded in its accepted task. This document is not deployment authorization.

## Scope

Publish the reviewed Russian question stems for the existing 50 CAR and 50 MOTORCYCLE starter questions, then deploy the accepted private-question reminder feature. English and Russian appear together with an Answer / Ответить button opening that learner's saved question. Existing opt-in and 11:00 Thailand time remain in effect. No channel is required. Choices/explanations are unchanged; this is the reviewed learning starter bank, not an official government translation. No new images are supplied, so this bank produces text posts.

Content pack: `content/imports/launch-20261021-russian-stems.json`.
Canonical parsed-JSON SHA256: `c50e945d4f2371616ca5947a2551ec16ecbe8a6908d4b4c57fd8cf140f5e002d`.
Actual independent manifest: `.agent/reviews/TASK-074-translation-review-01.json` (required; no synthetic fixture may be used for release).

## Preflight after owner approval

1. Stage the exact accepted release in a new release directory using the established server deployment process; preserve the current release for rollback. Do not change secret files, ownership, ports or nginx boundaries. Confirm current unit definitions and paths against the previous TASK-071 report; they have not been freshly inspected during this task.
2. Run `pnpm install --frozen-lockfile`, `pnpm db:generate`, and `pnpm build` in that release with Node24 and the established environment. Prisma client generation is mandatory. TASK-073/074 add no schema migration. If other accepted migrations are pending since the installed runtime, apply them through the established reviewed deployment procedure, not a development reset or seed.
3. Start the existing `thaidlt-dbdump.service`; require `Result=success` and `ExecMainStatus=0` and retain the backup. Stop API and the single bot unit during content update/cutover; retain a recoverable service configuration. Do not start a second polling bot.

## Content check, application and verification

Run on the production guest only after approval, under `User=thaidlt`, with the root-owned database EnvironmentFile injected by systemd. Do not print credentials or source that file in a shell. The existing database port5434 passes the unchanged loopback guard.

The following is a command template: set `release_dir` to the verified staged release's absolute path. First run it without `--apply`:

```bash
sudo systemd-run --wait --collect --pipe \
  -p User=thaidlt -p Group=thaidlt \
  -p WorkingDirectory="$release_dir" \
  -p EnvironmentFile=/etc/thaidlt/database.env \
  /opt/node24/bin/node tools/content/overlay-russian-stems.ts \
  content/imports/launch-20261021-russian-stems.json \
  .agent/reviews/TASK-074-translation-review-01.json \
  content/imports/launch-20261016-car-candidates.json \
  content/imports/launch-20261016-motorcycle-candidates.json
```

Expected initial output: `Russian stems: 100 would apply, 0 applied, 0 matched.` Require exit0. If all100 already match the exact approved review, this is a safe replay. Any other state or failure requires investigation; do not weaken the guard or overwrite records manually.

For application, insert `--apply` immediately after `tools/content/overlay-russian-stems.ts` in the same command. Expected first application: `Russian stems: 0 would apply, 100 applied, 0 matched.` Then run the original read-only command again; require `Russian stems: 0 would apply, 0 applied, 100 matched.` and exit0. A command failure after commit may leave writes applied; verify state before retrying, and do not infer rollback from failure alone.

Original candidate-status tools intentionally report source-content drift after this overlay. Keep historical English manifests; use the overlay check for the new expected state. IDs, choices, answers, progress and saved snapshots must stay unchanged. Earlier daily snapshots may remain English-only until the next day's assignment; do not rewrite or delete them.

## Application rollout

1. In BotFather, verify the production bot `thauto_dlt_bot` has its Main Mini App configured to `https://dlt.thauto.app`. Its current configuration has not been independently observed. Do not set a named Mini App short name unless that named app is deliberately configured.
2. On the bot service only set `DAILY_QUESTION_POSTS_ENABLED=true` and `TELEGRAM_MINI_APP_BOT_USERNAME=thauto_dlt_bot`; leave `TELEGRAM_MINI_APP_SHORT_NAME` unset for Main Mini App links. Keep BOT_TOKEN and DATABASE_URL server-side in existing protected files.
3. Switch the established release symlink and restart `thaidlt-api`, `thaidlt-web`, and the single `thaidlt-bot`. Web remains127.0.0.1:3060; API3061. `/practice/presentation` fits the existing `/practice/*` proxy allowance. No webhook or additional public prefix is introduced.
4. Verify services are active, web returns200, unauthenticated POST `/practice/presentation` with JSON `{ "presentationId": "00000000-0000-4000-8000-000000000000" }` returns401/no-store, and unknown API paths remain404. Record only safe status/count metadata.
5. With the owner's real Telegram session, verify an opted-in scheduled message, EN/RU text, exact owned question navigation, selecting/changing an answer then Check answer, completed-question handling, and an older link. Tests do not establish real Telegram success. Do not send a forced production test message without owner authorization.

## Disable and rollback

Set `DAILY_QUESTION_POSTS_ENABLED=false` and restart the bot to disable enrichment while retaining the existing localized reminder. Do not reverse Russian content or remove learning data. Runtime rollback needs care: older strict snapshot readers cannot read enriched image snapshots. This bank has no images, but check actual enriched rows before an older-runtime rollback. The delivery ledger does not guarantee exactly-once delivery after ambiguous Telegram transport failures.

## Admin report

Record release SHA, backup result/time, content check/apply/recheck counts and exits, service statuses, HTTP statuses, public bot identity/Main Mini App confirmation, and real owner smoke observations in `.agent/admin/TASK-074-production-report.md`. Distinguish observed results from pending/manual checks. Include no tokens, database URLs, raw environment, signed initData or learner records. Supervisor commits the report after the approved operation; no production operation has occurred in TASK-074 preparation.
