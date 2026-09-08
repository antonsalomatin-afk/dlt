# ThaiDLT Roadmap

This roadmap is intentionally coarse beyond the next few tasks.

The Supervisor should keep:

- current task: exact;
- next 2–3 tasks: detailed;
- later roadmap: coarse.

## Epic 0 — Agent Harness

Goal: make repository-driven development reliable.

- `TASK-001` — ACCEPTED — initialize repository and pnpm workspace
- `TASK-002` — ACCEPTED — add deterministic project checks
- `TASK-003` — ACCEPTED — create basic local development environment

## Epic 1 — Data Foundation

- `TASK-004` — ACCEPTED — Prisma/PostgreSQL foundation and initial user model
- User persistence and Telegram id uniqueness verified
- `TASK-005` — ACCEPTED — category/vehicle/question models
- fixture import format
- initial 25 fixture questions

## Epic 2 — Telegram Entry and Authentication

- Telegram bot skeleton
- `/start`
- Mini App launch
- signed initData server validation
- auth freshness validation
- user upsert/session behavior

## Epic 3 — Question Vertical Slice

- choose vehicle type
- fetch next question
- hide correctness before submission
- submit answer
- persist answer
- return result/explanation
- continue to next question

At the end of this epic the core end-to-end flow must work.

## Epic 4 — Learning

- categories
- random practice
- history
- mistakes
- favorites
- basic progress

## Epic 5 — Mock Exam

- 50-question snapshot
- timer
- one answer per question
- completion
- score
- pass/fail
- mistake review
- exam history

## Epic 6 — Concept Learning

- concept/variant groups
- mastery
- repeat mistakes intelligently
- spaced repetition
- readiness score

## Epic 7 — Content Operations

- source metadata
- bulk import
- review status
- content admin
- user reports
- auditability

## Epic 8 — Telegram Engagement

- question of the day
- reminders
- daily/weekly summaries
- deep links

## Epic 9 — Commercial

Requires Product Owner approval before implementation.

Potential scope:

- free limits
- Telegram Stars
- access entitlement
- refunds
- referrals
- affiliates

## Epic 10 — Production Hardening

- deployment ADR
- observability
- backup strategy
- rate limiting
- abuse controls
- production migrations
- security review
- load sanity checks





