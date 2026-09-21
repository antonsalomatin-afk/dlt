# Product Owner Decision Log

Use this file only for decisions that genuinely require the Product Owner.

Do not fill it with routine engineering choices.

## Pending

### 2026-09-21 — Epic 6 scope: spaced repetition and readiness score

Question:

`.agent/ROADMAP.md` lists "spaced repetition" and "readiness score" under Epic 6, but `.agent/PROJECT.md` lists "sophisticated readiness scoring" and "spaced repetition" under Later capabilities that are not part of the first implementation slice. Should Epic 6 include them now, or stop at concept grouping, concept-aware progress and simple mistake repetition?

Supervisor recommendation:

Proceed with the parts PROJECT.md supports (concept grouping, concept-aware progress, repeating recently missed concepts) and defer spaced-repetition scheduling and any readiness score until the Product Owner confirms scope. No implementation of the deferred items has started.

## Resolved

### 2026-09-07 — Development operating model

Decision:

Use Supervisor → Builder → Reviewer workflow with repository-persisted state and commit-by-commit acceptance.

### 2026-09-07 — Initial product architecture

Decision:

TypeScript pnpm monorepo with Next.js, Fastify, grammY, PostgreSQL and Prisma.
