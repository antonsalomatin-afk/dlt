# TASK-073 private question reminders — release candidate

Accepted source: `a1900d21fbc404b4e8810f47b51a813310ef74d8` on `codex/task-073`.
Status: Supervisor authoritative checks and independent review02 PASS. Final lint/typecheck331unit/12daily-integration tests PASS; unchanged web build222browser/203full integration results inherited from checks01 per task amendment. Not deployed or enabled by this handoff.

## Behavior and content readiness

Existing reminder opt-in and 11:00 Thailand time stay in effect. Enabled enrichment sends English and stored Russian question stems in one private message, with an approved associated photo when supported, and an Answer / Ответить link to the same saved owned presentation. Completed questions stay completed. Summaries retain their language policy.

The 100-question English starter bank has no Russian stems or image references in its accepted source artifacts. See `TASK-073-content-readiness.md`. Missing translations use the existing generic invitation, so enabling the flag alone does not create bilingual content. A separately reviewed, traceable Russian content update is needed. Existing saved presentations are immutable: a presentation created before translations were applied retains its original snapshot; a future day's assignment can use the updated content.

## Proposed deployment steps after acceptance and owner approval

1. Deploy the exact accepted source SHA; preserve existing secret files and service users/ports.
2. Run `pnpm install --frozen-lockfile`, `pnpm db:generate`, and the production web build using the established server environment. No new schema migration is introduced by TASK-073.
3. Keep `DAILY_QUESTION_POSTS_ENABLED=false` (or unset) until reviewed Russian content and Telegram direct-link setup are ready. On the bot service only, enable with the exact string `true` and `TELEGRAM_MINI_APP_BOT_USERNAME=thauto_dlt_bot` (no @).
4. Configure the bot's Main Mini App in BotFather with the existing `https://dlt.thauto.app` URL. Leave `TELEGRAM_MINI_APP_SHORT_NAME` unset for Main Mini App links. Only set it when deliberately using an already-configured named Mini App.
5. Restart API, web and bot through the established systemd units. The new `/practice/presentation` route fits the admin's existing `/practice/*` API proxy restriction; no new public path prefix or webhook is required.
6. Verify unauthenticated presentation requests return401 and all services are healthy. With the owner's real signed Telegram session, verify an opted-in reminder and exact-question navigation, answer confirmation, completion and an older link. Do not impersonate a user or infer real Telegram success from synthetic tests.

## Delivery and rollback limits

The existing delivery ledger prevents additional sends after recorded success. A transport exception after Telegram accepted a message can still lead to a duplicate on retry; a crash after claim can leave an uncompleted claim. No end-to-end exactly-once guarantee.

Text-only snapshots retain the old version-1 shape. Snapshots that contain the new optional internal image metadata cannot be read by an older runtime's strict parser. Turning the flag off does not rewrite saved snapshots. Check enriched-row existence before any older-runtime rollback; do not delete learning data to make a rollback work. The current accepted starter bank contains no image references.
