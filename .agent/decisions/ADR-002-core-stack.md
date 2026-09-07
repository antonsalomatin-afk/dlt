# ADR-002 — Core TypeScript monorepo stack

Status: Accepted

Date: 2026-09-07

## Context

ThaiDLT needs a Telegram Mini App, API, Telegram bot and shared domain code. The stack should be easy for humans and coding agents to navigate.

## Decision

Use:

- TypeScript
- pnpm workspace
- Next.js + React for web/Mini App
- Fastify for API
- grammY for Telegram bot
- PostgreSQL
- Prisma

Later, only when required:

- Redis + BullMQ
- S3-compatible object storage

## Alternatives considered

### NestJS API

Pros:
- strong framework conventions;
- mature dependency injection.

Cons:
- more framework weight than currently required.

### Separate repositories

Pros:
- independent service lifecycle.

Cons:
- poorer shared-type ergonomics;
- more coordination overhead for a small team/agent workflow.

## Consequences

- one language across most of the system;
- shared validation/types are easier;
- local setup remains manageable;
- future services can still be deployed independently.

## Revisit when

Revisit if scale, team boundaries or operational requirements justify service separation or a framework change.
