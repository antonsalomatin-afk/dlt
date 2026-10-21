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

### 2026-10-21 — Deploy reviewed bilingual private reminders

The Product Owner explicitly replied "deploy" after the Supervisor presented accepted TASK-074, release tag thaidlt-bilingual-20261021, and requested approval to publish all100 reviewed Russian stems and enable private EN/RU question reminders at11:00 Thailand time. This authorizes TASK-075 on the existing dlt.thauto.app / tele.thauto.app infrastructure, including the reviewed content overlay, exact accepted runtime deployment and strict bot rollout settings. No forced test messages, new channel, paid service or unrelated design change is included. Do not request this deployment approval again.

### 2026-10-21 — Implement the compact app and chat-question experience

After seeing the still-promotional live landing screen, the owner explicitly selected "Оба изменения" when asked whether they expected daily question messages in the private bot chat, the compact Mini App design, or both. This authorizes implementing the previously discussed compact question/feedback/menu composition in the actual application, with the selected Confirm answer flow, and publishing the reviewed update on the already-approved production hosts. The private EN/RU scheduler is already deployed; preserve explicit user opt-in and11:00 ICT. No automatic preference changes, forced Telegram sends, new content source, provider, payment or unrelated feature is authorized. Earlier preview-only limits are superseded for this bounded app implementation; real-owner practice/exam smoke remains distinct.
