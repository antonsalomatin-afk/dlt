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
- `TASK-006` — ACCEPTED — validated fixture import and 25 development questions
- Development fixtures remain inactive drafts

## Epic 2 — Telegram Entry and Authentication

- `TASK-007` — ACCEPTED — Telegram bot entry point
- Private /start and Mini App button verified with mocked transport
- Live Telegram launch remains unverified until credentials/UI are available
- `TASK-008` — ACCEPTED — signed initData server validation
- Freshness policy validated under ADR-003
- TASK-009 — ACCEPTED — authenticated user upsert and opaque sessions

## Epic 3 — Question Vertical Slice

- TASK-010 — ACCEPTED — authenticated vehicle selection
- TASK-011 — ACCEPTED — present eligible question with server-owned snapshot
- hide correctness before submission
- TASK-012 — ACCEPTED — submit one snapshot-scored answer with persisted result
- persist answer
- return result/explanation
- continue to next question

- TASK-013 — ACCEPTED — Mini App authentication and vehicle onboarding
- TASK-014 — ACCEPTED — Mini App practice, results and continuation
- TASK-015 — ACCEPTED — local full-stack browser/API/database verification

At the end of this epic the core end-to-end flow must work.

## Epic 4 — Learning

- TASK-016 — ACCEPTED — authenticated answer history API
- TASK-017 — ACCEPTED — Mini App answer history UI
- TASK-018 — ACCEPTED — authenticated mistakes feed API
- TASK-019 — ACCEPTED — Mini App mistakes review UI
- TASK-020 — ACCEPTED — list eligible practice categories
- TASK-021 — ACCEPTED — category-filtered question delivery
- TASK-022 — ACCEPTED — Mini App category practice selection
- categories
- TASK-023 — ACCEPTED — random eligible practice delivery
- history
- mistakes
- TASK-024 — ACCEPTED — persist favorite presented questions
- TASK-025 — ACCEPTED — authenticated favorites feed API
- TASK-026 — ACCEPTED — Mini App favorite save and review UI
- TASK-027 — ACCEPTED — authenticated basic progress summary API
- TASK-028 — READY — Mini App basic progress view

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
