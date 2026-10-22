# TASK-079 implementation handoff

Date: 2026-10-22. Design only; ADR-008 requires independent PASS and Supervisor acceptance. Owner reports private chat works; group support is newly requested, not a defect in the private-only release.

## Bounded TASK-080 source scope

Expected files: packages/database/prisma/schema.prisma and one new additive migration; new packages/database/src/group-chat-quiz.ts; new apps/bot/src/group-chat-quiz.ts; existing apps/bot/src/chat-quiz.ts registration/dispatch and bot.ts group setup/help; README group usage. Reuse presentation.ts selection/snapshots, answer.ts transaction helper and private quiz renderer/text chunking without semantic rewrites. If exporting a renderer or adjusting the installed polling error boundary requires another existing file, Supervisor must list it explicitly before implementation. No web/API/content/dependency/env changes.

Tests: new group-chat-quiz unit and integration suites; extend bot-shutdown tests and private-chat registration/dispatch regression coverage only where required. Supervisor defines exact files_allowed before Builder starts. The existing one polling process and allowed update list already receive message/callback_query/poll_answer; no webhook or second bot.

## Required automated verification

* Runtime validation: group/supergroup negative IDs versus positive real users, anonymous/send-as-channel rejection, invalid/retracted/multi-option votes, foreign/stale callback chat/topic/message/round, proper /quiz@bot syntax and private/group routing.
* Delivery: unconfigured/default CAR, motorcycle argument, no profile changes, two participants receive one shared poll, separate topics/groups, command allocation races, exact response binding, timeout/ambiguous send/lease expiry/explicit replacement, restart reuse and stale Next replay. Closed feedback recovers after stopPoll/send failure; no answer is broadcast on an ordinary vote.
* Membership: bot administrator prerequisite, member/creator/admin/restricted-in versus left/kicked/anonymous, nonmember forwarded poll rejection, known limitation for a member's forwarded vote, transient API failure retry and terminal privilege loss. No private outbound messages.
* Isolated PostgreSQL: additive migration and named constraints, same round copied into two owned presentations, exactly one AnswerAttempt and concept increment for each distinct user, changed-option replay/concurrent same-user vote, rollback after counter write, user/round/question FK mismatch, no mutation of personal preferences/private sessions, deactivation/unverification and close/vote races.
* Real grammY injected transport: pending successful/failed group scoring under both SIGTERM and SIGINT, precommit lookup or membership failure retains offset, commit-before-crash replay stays one-credit, postcommit feedback failure is not retried as an unclaimed vote. Retain all TASK-077 shutdown regressions.
* Full lint, typecheck, unit, Prisma validate, isolated integration and build; relevant existing practice/exam regressions. No real token, real Telegram send or synthetic signed production identity in tests.

## Review and publication boundary

Independent code review must inspect source/diff/tests and these invariants, then PASS before acceptance. Subsequent deployment must pin the accepted exact release, create a fresh backup, quiesce API/bot, apply only the additive migration, compare all old-table data fingerprints, verify generated client/build, one healthy bot and private/Mini App regressions. Preserve credentials/content/reminders. Do not force a production group test message. Owner tests group command, two real participants' answers and finish/Next after publication; distinguish those observations from automated/operational checks.

Documentation-only checks for TASK-079: git diff --check, direct source/interface comparison and independent architecture review. Source suites are not claimed run for this documentation-only task.
