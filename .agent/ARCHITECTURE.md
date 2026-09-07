# ThaiDLT — Target Architecture

## Architecture goals

The system must be:

- simple enough for a small product;
- strongly typed;
- easy for coding agents to understand;
- testable locally;
- suitable for incremental development;
- deployable as independent web/API/bot services if needed.

## Monorepo

Use a `pnpm` TypeScript monorepo.

Target structure:

```text
thai-dlt/
├── apps/
│   ├── web/                  # Telegram Mini App / web UI
│   ├── api/                  # HTTP API
│   └── bot/                  # Telegram bot
│
├── packages/
│   ├── database/             # Prisma client/schema helpers
│   ├── shared/               # shared types, validation, constants
│   ├── question-engine/      # question selection/scoring behavior
│   ├── telegram/             # Telegram initData validation helpers
│   └── ui/                   # shared UI components when justified
│
├── content/
│   ├── fixtures/
│   ├── imports/
│   └── sources/
│
├── tools/
│   └── orchestrator/
│
├── .agent/
├── AGENTS.md
└── package.json
```

The exact creation order is controlled by tasks. Do not create unused packages prematurely unless required by the current task.

## Technology choices

### Language

- TypeScript
- strict mode

### Package manager

- pnpm

### Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS
- Telegram Mini App JavaScript SDK/API as appropriate

### API

- Node.js
- Fastify

Reason: small surface area, high performance, straightforward typed API implementation.

### Telegram bot

- grammY

### Database

- PostgreSQL

### ORM

- Prisma

### Queue / scheduled work

Later:

- Redis
- BullMQ

Do not add until a task requires background/scheduled jobs.

### Object storage

Later:

- S3-compatible storage such as Cloudflare R2 or AWS S3

Do not add until real question images require it.

## Service responsibilities

### `apps/web`

Responsible for:

- Mini App user interface;
- onboarding;
- vehicle type selection;
- practice screens;
- explanation/result screens;
- exam screens later;
- making authenticated requests to API.

Must not contain secrets or Telegram bot token.

### `apps/api`

Responsible for:

- authentication;
- Telegram Mini App initData validation;
- user persistence;
- question delivery;
- answer submission;
- progress/history;
- exam state later;
- admin APIs later.

### `apps/bot`

Responsible for:

- `/start`;
- Mini App launch button;
- deep links later;
- user notifications later;
- Telegram payment events later.

It should not duplicate business logic from the API.

## Authentication

Telegram Mini App authentication is based on signed `initData`.

Rules:

1. Client sends raw Telegram `initData` to API.
2. API validates the signature server-side.
3. API validates required fields.
4. API checks `auth_date` freshness according to policy.
5. API extracts Telegram user identity only after successful validation.
6. API creates or updates local user.
7. API issues/establishes application auth according to the chosen session strategy.

Never trust `initDataUnsafe` as authentication proof.

## Initial data model direction

The exact Prisma schema is implemented by tasks, but it should be able to represent:

### User

- internal id
- Telegram user id
- username
- first name
- language preference
- selected vehicle type
- createdAt
- updatedAt
- lastSeenAt

### Category

- id
- slug
- names/translations
- sort order

### Concept

Represents an underlying rule or learning concept.

### Question

- id
- vehicle type
- category
- concept/variant group
- original Thai
- exam-style English
- normalized English
- Russian
- explanation(s)
- source metadata
- verification status
- image reference optional

### QuestionChoice

- question id
- stable choice key
- localized text
- correct boolean or equivalent answer key

Prefer an answer-key model that makes it difficult for client code to infer correctness before submission.

### AnswerAttempt

- user
- question
- presented/session context
- selected choice
- correct
- createdAt

### LearningState

Long-term user/concept state.

Not necessarily required in first vertical slice.

### ExamSession

Later:

- user
- startedAt
- expiresAt
- completedAt
- score
- pass/fail
- selected question ids snapshot

### Favorite

Later.

### Report

Later user reports on questionable content.

### Source

Optional normalized source entity for traceability.

## API design principles

- validate every request;
- return stable typed response shapes;
- never return hidden correctness metadata in "get next question" responses;
- enforce duplicate-submission rules server-side;
- persist authoritative score server-side;
- use database transactions when a multi-write operation must be atomic.

## Question delivery security

Before answer submission, the API response must not expose:

- `correctChoiceId`;
- `isCorrect` flags;
- hidden answer metadata.

Correctness is returned only after submission.

## Testing layers

### Unit

Examples:

- Telegram initData validation;
- question answer evaluation;
- score calculations;
- pure selection functions.

### Integration

Examples:

- API + Postgres user upsert;
- answer persistence;
- duplicate answer handling.

### E2E

Examples:

- Mini App onboarding;
- question flow;
- mock exam flow.

E2E should be added when UI exists.

## Deployment

Deployment is intentionally not decided yet.

Do not lock the system to one vendor prematurely.

A future ADR may select:

- Vercel for web;
- Fly.io/Render/Railway/Cloud Run/etc. for API/bot;
- managed Postgres.

No production deployment without Product Owner approval.
