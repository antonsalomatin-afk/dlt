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
- TASK-056 — ACCEPTED — inspect learner question reports offline
- TASK-057 — ACCEPTED — apply explicit report triage decisions offline
- TASK-058 — ACCEPTED — inspect report triage audit state offline

## Epic 8 — Telegram Engagement

- TASK-059 — ACCEPTED — present one stable daily practice question
- TASK-060 — ACCEPTED — use the daily question in the Mini App
- TASK-061 — ACCEPTED — persist a daily-question reminder preference
- TASK-062 — ACCEPTED — manage daily reminders in the Mini App
- TASK-063 — ACCEPTED — persist the learner's preferred language (English default)
- TASK-064 — ACCEPTED — manage preferred language in the Mini App
- TASK-065 — ACCEPTED — define daily Telegram reminder delivery policy (11:00 ICT; no completion suppression)
- TASK-066 — ACCEPTED — deliver daily Telegram reminders at 11:00 ICT
- TASK-067 — ACCEPTED — deliver daily and weekly learner summaries at 11:00 ICT
- TASK-068 — ACCEPTED — open the daily question from Telegram deep links
- TASK-073 — ACCEPTED — private opt-in11:00 ICT EN/RU question messages and exact owned links; runtime deployed and enrichment enabled in TASK-075
- TASK-074 — ACCEPTED — all100 Russian stems independently approved; guarded overlay and actual-manifest isolated proof PASS; production overlay applied and rechecked in TASK-075
- TASK-075 — ACCEPTED — approved runtime and100RUstems deployed; Main Mini App ready and private enrichment enabled; backup/preservation/rootchecks and independent operational review PASS; real-owner smoke remains TASK-072
- TASK-076 — ACCEPTED — compact Mini App deployed611a559; root checks, independent code/operational PASS, backup and data preservation. Owner smoke remains TASK-072.

## Epic 9 — Commercial

Requires Product Owner approval before implementation.

- TASK-069 — ACCEPTED — free-first launch; defer paywall and paid limits

Potential scope:

- free limits
- Telegram Stars
- access entitlement
- refunds
- referrals
- affiliates

## Epic 10 — Production Hardening

- TASK-070 — ACCEPTED — approve the production launch boundary (dlt.thauto.app / tele.thauto.app)
- TASK-071 — ACCEPTED — production hosts/services verified;50CAR +50MOTORCYCLE reviewed questions live; backup/restore and independent operational review PASS

- TASK-072 — BLOCKED — compact/private/group modes are accepted and live; owner reports private success. Await actual simple-group native correctness/optional Next and signed Mini App practice/exam-resume observations; no Finish or two-member contest requirement.

- deployment ADR
- observability
- backup strategy
- rate limiting
- abuse controls
- production migrations
- security review
- load sanity checks
- TASK-077 — ACCEPTED — native private-chat quizzes and safe shutdown/recovery; code review02 PASS, published through accepted TASK-078.
- TASK-078 — ACCEPTED — native quiz release0a4d7b3 live; fresh backup, migration18 once, old16 tables preserved; independent operations PASS.

- TASK-079 — ACCEPTED — shared group quiz architecture, per-user scoring and recovery; independent design PASS.
- TASK-080 — ACCEPTED — shared native group quizzes with individual credit, recovery and scoped controls; full authoritative checks and independent source review PASS. Published through accepted TASK-081.

- TASK-081 — ACCEPTED — exact group release3cbcbac live; backup beforemigration19, all17oldtables preserved, healthyonebot and independent operational PASS.

- TASK-082 — ACCEPTED — simple asynchronous group quizzes; no Finish/shared summary, native correctness and safe late answers; full checks and independent PASS. Published through accepted TASK-083.

- TASK-083 — ACCEPTED — exact simple-group release f17b9ef live; no migration, all20 tables/19 migration rows unchanged, fresh backup and healthy one-bot runtime; Supervisor and independent operational PASS.

- TASK-084 — ACCEPTED — all100 bilingual teaching entries and400 RU choices independently reviewed;100-entry hash manifest and authoritative gates PASS. Two bounded §33 examples; implementation/publication next.

- TASK-085 — ACCEPTED — reviewed static teaching loader and exact-source new practice/daily/retry/chat snapshot enrichment; full gates and independent PASS, no bank/history/exam change.

- TASK-086 — ACCEPTED — per-line EN/RU spoiler Telegram cards, native A-D polls and personal post-answer group explanations; see ADR009/deliveryplan.
- TASK-087 — READY — exact bilingual teaching release publication on established hosts, preservation checks and independent operations PASS.
