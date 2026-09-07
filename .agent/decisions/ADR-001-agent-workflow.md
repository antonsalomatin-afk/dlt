# ADR-001 — Supervisor / Builder / Reviewer workflow

Status: Accepted

Date: 2026-09-07

## Context

Long-running coding-agent sessions can accumulate errors, lose state, mix unrelated work, and accept their own incorrect assumptions.

ThaiDLT should be developed incrementally with auditable state and independent review.

## Decision

Use a three-role model:

- Supervisor: plans, writes/refines tasks, guards architecture and accepts work.
- Builder: implements exactly one task and commits.
- Reviewer: independently reviews the implementation and returns PASS/FAIL.

No task is accepted until:

1. authoritative automated checks pass;
2. Reviewer returns PASS;
3. Supervisor records acceptance.

Project state is stored under `.agent/`, not only in conversation context.

Maximum normal review failures per task: 3.

## Alternatives considered

### One autonomous coding agent

Pros:
- simple;
- low coordination overhead.

Cons:
- self-review bias;
- scope drift;
- weaker auditability;
- context degradation over long runs.

### Multiple builders with no supervisor

Pros:
- parallelism.

Cons:
- architectural divergence;
- merge conflicts;
- unclear ownership.

## Consequences

Positive:

- clear ownership;
- atomic progress;
- independent review;
- recoverable state;
- safer long-running development.

Tradeoffs:

- more tokens/agent calls;
- slightly slower per task;
- requires disciplined task specification.

## Revisit when

Revisit if orchestration overhead becomes materially larger than implementation work or if repository tooling provides stronger native guarantees.
