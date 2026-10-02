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
- TASK-028 — ACCEPTED — Mini App basic progress view

## Epic 5 — Mock Exam

- TASK-029 — ACCEPTED — mock exam session and question persistence foundation
- TASK-030 — ACCEPTED — start an authenticated 50-question timed exam snapshot
- TASK-031 — ACCEPTED — submit one server-scored answer per exam question
- TASK-032 — ACCEPTED — complete an eligible exam and return score/pass result
- TASK-033 — ACCEPTED — review completed mock-exam mistakes
- TASK-034 — ACCEPTED — list authenticated completed-exam history
- TASK-035 — ACCEPTED — read and resume the current mock exam
- TASK-036 — ACCEPTED — Mini App mock-exam taking and result flow
- TASK-037 — ACCEPTED — Mini App exam history and mistake review
- TASK-038 — ACCEPTED — full-stack browser verification for the mock-exam flow

## Epic 6 — Concept Learning

- TASK-039 — ACCEPTED — group development question variants by stable concepts
- TASK-040 — ACCEPTED — persist immutable concept attribution for practice and exam attempts
- TASK-041 — ACCEPTED — accumulate exact practice and exam concept outcome counters
- TASK-042 — ACCEPTED — authenticated factual concept progress API
- TASK-043 — ACCEPTED — display concept mastery labels
- TASK-044 — ACCEPTED — create concept-varied practice from an owned mistake
- TASK-045 — ACCEPTED — start concept retry from the mistakes UI
- TASK-046 — DEFERRED — spaced repetition and readiness scoring deferred to prioritize launch-critical work
- readiness score — deferred with TASK-046

## Epic 7 — Content Operations

- TASK-047 — ACCEPTED — validate traceable content import batches
- TASK-048 — ACCEPTED — import validated candidate batches as inactive drafts
- TASK-049 — ACCEPTED — apply traceable candidate review decisions without activation
- TASK-050 — ACCEPTED — activate exact verified candidates through a traceable manifest
- TASK-051 — ACCEPTED — inspect candidate batch persistence and publication status
- content administration — initial offline import/review/activation/status workflow complete
- TASK-052 — ACCEPTED — submit authenticated reports for presented practice questions
- TASK-053 — ACCEPTED — submit practice-question reports in the Mini App
- TASK-054 — ACCEPTED — submit authenticated reports for owned exam questions
- TASK-055 — ACCEPTED — submit exam-question reports in the Mini App
- TASK-056 — PLANNED — inspect and triage reports offline
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
