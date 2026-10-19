# Product Owner Decision Log

Use this file only for decisions that genuinely require the Product Owner.

Do not fill it with routine engineering choices.

## Pending

None. Starter bank publication approved on 2026-10-19.

## Resolved

### 2026-09-07 — Development operating model

Decision:

Use Supervisor → Builder → Reviewer workflow with repository-persisted state and commit-by-commit acceptance.

### 2026-09-07 — Initial product architecture

Decision:

TypeScript pnpm monorepo with Next.js, Fastify, grammY, PostgreSQL and Prisma.

### 2026-10-16 — Reference bank use

The Product Owner approved use of `artslob/thailand-driving-exam-questions` ("yes, use it"). The recovered planning strategy uses it for topic discovery and authors original wording corroborated against SafeDriveDLT, rather than republishing unlicensed source text/images or trusting its answer keys. The pinned intake and original candidates are prepared; this source-use decision is resolved.

### 2026-10-19 — Publish reviewed original English starter bank

The Product Owner explicitly approved: "Approve publishing this starter bank" and instructed "continue". This authorizes release of the exact reviewed 50 CAR and 50 MOTORCYCLE English candidates at `65d1c1ade2c48fc4e82388db85da93faf7eee9d8` through the existing independent-review and activation pipeline. The bounded independent content reviews remain the factual evidence; owner approval does not substitute for those reviews. Prepare exact review and activation manifests, validate and independently review the release chain, and hand the approved release to the server Admin. Do not request this approval again.
