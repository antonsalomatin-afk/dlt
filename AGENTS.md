# ThaiDLT Engineering Rules

These instructions apply to every coding agent working in this repository.

## 1. Source of truth

Before changing code, read:

1. `.agent/PROJECT.md`
2. `.agent/ARCHITECTURE.md`
3. `.agent/WORKFLOW.md`
4. `.agent/DEFINITION_OF_DONE.md`
5. `.agent/STATE.json`
6. the current task under `.agent/tasks/`
7. any ADRs relevant to the files or architecture being changed

If instructions conflict, use this precedence:

1. current task acceptance criteria
2. `AGENTS.md`
3. accepted ADRs
4. architecture document
5. roadmap

Do not invent product requirements that are not supported by these sources.

## 2. One task at a time

Never implement more than one task in a single work cycle.

A task is complete only when:

- its acceptance criteria are satisfied;
- required automated checks pass;
- an independent reviewer returns `VERDICT: PASS`;
- the Supervisor updates `.agent/STATE.json`;
- the accepted commit is recorded.

Do not begin the next task after committing. Stop and return control to the Supervisor.

## 3. Scope discipline

Only modify files necessary for the current task.

If a task specification includes `files_allowed`, treat it as a hard boundary unless the task is impossible without expanding scope.

If additional files are required:

1. stop implementation;
2. explain why;
3. request that the Supervisor amend the task.

Do not perform opportunistic refactors unrelated to the current task.

## 4. Architecture

Do not make a material architecture change silently.

An architecture change includes, for example:

- changing database technology;
- changing API framework;
- changing authentication model;
- introducing a new persistence system;
- changing the monorepo toolchain;
- changing the deployment boundary between apps;
- introducing a new external paid dependency;
- changing the user identity model.

A material change requires a new or amended ADR in `.agent/decisions/`.

## 5. TypeScript quality

Use strict TypeScript.

Do not use these without explicit justification in the current task or ADR:

- `any`
- `@ts-ignore`
- `@ts-nocheck`
- broad `eslint-disable`
- unsafe type assertions that bypass runtime validation

External input must be runtime-validated.

## 6. Security

Treat all external input as untrusted.

Never:

- log secrets;
- commit credentials;
- expose Telegram bot tokens client-side;
- trust Telegram Mini App `initDataUnsafe`;
- accept unsigned or unvalidated Telegram auth data;
- interpolate untrusted input into SQL or shell commands;
- weaken security controls merely to make tests pass.

Use constant-time comparison where authentication signature comparisons require it.

## 7. Tests

Every behavior change must have appropriate automated coverage.

At minimum, before a Builder commit:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

When relevant:

```bash
pnpm build
pnpm test:integration
pnpm test:e2e
pnpm prisma validate
```

Never:

- delete a failing test merely to make the suite green;
- skip failing tests without documenting a real, approved reason;
- reduce assertions to hide a defect.

## 8. Commits

Each task should produce an atomic commit or a small review-fix sequence of commits.

Preferred messages:

```text
feat(auth): validate Telegram Mini App initData
fix(auth): address Telegram auth review findings
test(question): cover duplicate submission
docs(agent): record auth architecture decision
```

A Builder must not squash or rewrite accepted history unless explicitly instructed.

## 9. Review independence

A Reviewer must inspect:

- the task;
- the diff;
- the relevant surrounding code;
- tests;
- architectural constraints.

The Reviewer must not rely on the Builder's self-assessment.

Review output must use the format defined in `.agent/templates/REVIEW_TEMPLATE.md`.

## 10. Blocked decisions

Escalate to the Supervisor when blocked.

The Supervisor should escalate to the Product Owner only for:

- real product decisions;
- credentials/secrets that must be supplied;
- spending or adding a paid dependency;
- production deployment;
- destructive data migration;
- irreversible architecture changes;
- legal/compliance decisions;
- repeated Builder/Reviewer disagreement after the review-loop limit.

Do not ask the Product Owner about routine implementation details that can be decided safely from repository context.

## 11. Review loop limit

Maximum normal review loops per task:

```text
3
```

After three failed independent reviews, mark the task `BLOCKED` and require Supervisor diagnosis before further implementation.

## 12. Main branch rule

`main` must represent accepted work only.

Prefer task worktrees or task branches.

Do not merge/cherry-pick a task into `main` until:

- checks are green;
- Reviewer verdict is PASS;
- Supervisor accepts the task.

## 13. Repository state

Repository state must be updated after each accepted task.

Do not rely on conversation memory alone.

`.agent/STATE.json` is the machine-readable status source.
