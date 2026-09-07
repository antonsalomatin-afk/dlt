# Definition of Done

A task is not done because code exists.

A task is `ACCEPTED` only when all applicable gates below pass.

## Gate 1 — Scope

- implementation matches the current task;
- no unrelated features;
- no silent architecture changes;
- no unauthorized external service added.

## Gate 2 — Acceptance criteria

Every acceptance criterion in the task is demonstrably satisfied.

## Gate 3 — Code quality

- strict TypeScript;
- no unjustified unsafe escapes;
- external input runtime validation where required;
- meaningful names;
- no obvious duplication that materially harms maintenance;
- no dead feature code added "for later".

## Gate 4 — Automated checks

Default mandatory checks:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Additional checks when relevant:

```bash
pnpm build
pnpm test:integration
pnpm test:e2e
pnpm prisma validate
```

## Gate 5 — Tests

- changed behavior has coverage;
- negative/error paths are covered when meaningful;
- security-sensitive code has explicit negative tests;
- tests do not depend unnecessarily on ordering or time;
- test failures are not suppressed.

## Gate 6 — Security

For security-sensitive tasks:

- secrets remain server-side;
- trust boundaries are explicit;
- replay/signature/auth validation is correct;
- logs do not leak sensitive data;
- error responses do not expose sensitive internals.

## Gate 7 — Data integrity

For persistence tasks:

- constraints match business invariants;
- duplicate behavior is defined;
- transactions are used when needed;
- migrations validate.

## Gate 8 — Independent review

A review exists with:

```text
VERDICT: PASS
```

and no unresolved blockers.

## Gate 9 — Documentation

Update documentation when the task changes:

- architecture;
- API contracts;
- environment variables;
- developer setup;
- important behavior.

Architecture changes require an ADR.

## Gate 10 — Repository state

Supervisor updates:

- task status;
- accepted commit;
- `.agent/STATE.json`;
- roadmap if necessary.

Only then is the next task allowed to start.
