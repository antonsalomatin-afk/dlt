# Product Owner Decision Log

Use this file only for decisions that genuinely require the Product Owner.

Do not fill it with routine engineering choices.

## Pending

### 2026-10-16 — Release the reviewed original English starter question bank

Prepared at `65d1c1ade2c48fc4e82388db85da93faf7eee9d8`: 50 CAR and 50 MOTORCYCLE original questions, each with a DLT handbook citation. Independent factual and final-wording reviews PASS; final-batch schema/import/replay/conflict checks and both 50-question exam rehearsals PASS.

Decision requested: approve publication of this concrete English starter learning set through the existing reviewed-content pipeline. It is not an official DLT bank or complete exam syllabus. Review `admin/TASK-071-content-review-pack.md`; technical handoff is `admin/TASK-071-launch-handoff.md`.

This is a production-content decision under PROJECT.md and WORKFLOW.md. No production content has changed and no real review/activation manifests have been issued. Existing live-launch and reference-bank authorizations remain valid and are not being reopened.

## Resolved

### 2026-09-07 — Development operating model

Decision:

Use Supervisor → Builder → Reviewer workflow with repository-persisted state and commit-by-commit acceptance.

### 2026-09-07 — Initial product architecture

Decision:

TypeScript pnpm monorepo with Next.js, Fastify, grammY, PostgreSQL and Prisma.

### 2026-10-16 — Reference bank use

The Product Owner approved use of `artslob/thailand-driving-exam-questions` ("yes, use it"). The recovered planning strategy uses it for topic discovery and authors original wording corroborated against SafeDriveDLT, rather than republishing unlicensed source text/images or trusting its answer keys. The pinned intake and original candidates are prepared; this source-use decision is resolved.
