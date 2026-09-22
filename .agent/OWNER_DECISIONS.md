# Product Owner Decision Log

Use this file only for decisions that genuinely require the Product Owner.

Do not fill it with routine engineering choices.

## Pending

None.

## Resolved

### 2026-09-22 — Epic 6 scope: spaced repetition and readiness score

Decision:

Defer both. Epic 6 stops at concept grouping, concept-aware progress, a Mini App concept
view and practice that targets the learner's weakest concepts. Spaced-repetition
scheduling, any exam readiness score and concept mastery labelling are recorded as
deferred scope in `.agent/FOLLOW_UPS.md` and are not to be started without a new
decision.

### 2026-09-22 — Epic ordering after Epic 6

Decision:

Epic 7 (Content Operations) is next: source metadata, bulk import, review status, content
admin, user-reported problems and auditability. Epic 8 (Telegram Engagement), Epic 9
(Commercial) and Epic 10 (Production Hardening) follow later and keep their existing
approval requirements.

### 2026-09-22 — Production content source

Decision:

Production questions are original in-house content. Author questions, choices and
explanations ourselves and cite public Thai traffic law for the underlying rule. Do not
copy any third-party question bank's wording, do not scrape, and do not ingest official
Department of Land Transport material into the product without a separate decision.
Licensing a third-party bank is not approved.

Consequence for Epic 7:

Build import, review-status, provenance and audit tooling that enforces original
authorship and a citable legal reference per question. Volume comes from authored
content over time, not a bulk acquisition.

### 2026-09-22 — Telegram live verification and bot token

Decision:

No live bot token is supplied to the development environment. Continue verifying the bot
and Mini App against mocked Telegram transport plus the local full-stack gate. Live
Telegram verification remains an explicit later step performed by the Product Owner with
their own credentials. Never commit or log a token.

### 2026-09-07 — Development operating model

Decision:

Use Supervisor → Builder → Reviewer workflow with repository-persisted state and commit-by-commit acceptance.

### 2026-09-07 — Initial product architecture

Decision:

TypeScript pnpm monorepo with Next.js, Fastify, grammY, PostgreSQL and Prisma.
