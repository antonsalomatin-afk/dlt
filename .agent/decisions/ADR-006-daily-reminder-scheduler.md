# ADR-006 — Bot-owned daily reminder scheduler

Status: Accepted
Date: 2026-10-12

## Context

TASK-065 defines an enabled daily Telegram reminder at 11:00 Thailand time
(ICT, UTC+07:00). The reminder remains eligible after the learner completes the
daily question because it also invites additional training. The existing
architecture assigns notifications to `apps/bot`, keeps Redis/BullMQ as later
work, and already persists the learner's reminder and language preferences in
PostgreSQL.

## Decision

Run the daily reminder scheduler inside the server-only bot process. It uses
the existing Prisma/PostgreSQL connection, checks the fixed ICT clock, and
claims one delivery per learner and ICT calendar date through a unique delivery
ledger before sending the grammY message. The ledger makes repeated ticks and
multiple bot instances idempotent at the database boundary; a failed send is
recorded as retryable without exposing credentials or learner data in logs.

The scheduler is started explicitly by the bot entry point, uses an injected
clock and interval seam in tests, and stops with bot shutdown. It sends only to
users with the persisted reminder preference enabled, uses the persisted
preferred language, and includes the configured HTTPS Mini App button. The bot
token and database URL remain server-only. No Redis, BullMQ, API proxy, browser
storage or Mini App delivery logic is introduced.

## Tradeoffs

This keeps the first delivery slice within the existing services and avoids a
new paid or operational dependency. A bot-process restart can delay a tick
until the next scheduler observation, while the delivery ledger prevents
duplicate sends once a date is claimed. Durable queueing and broader production
hardening remain separate work.

## Validation

Unit tests cover ICT rollover, the exact 11:00 boundary, disabled users,
preferred-language message selection, completion not suppressing delivery,
duplicate/concurrent claims, retryable send failures and shutdown. Isolated
PostgreSQL tests cover the ledger uniqueness and preservation of existing user,
preference and learning data. Bot tests use injected grammY transports and no
real Telegram token.
