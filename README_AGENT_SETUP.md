# ThaiDLT Agent-Driven Development Starter

This repository starter defines the operating model for building **ThaiDLT** with a supervisor-led, commit-by-commit development workflow.

The intended model is:

```text
Product Owner
    |
    v
Supervisor / Tech Lead
    |
    +--> Builder --> tests --> commit
    |                    |
    |                    v
    +--------------> Reviewer
                         |
                   PASS / FAIL
                         |
             +-----------+-----------+
             |                       |
            FAIL                    PASS
             |                       |
             v                       v
          Builder fix          accept task
                                     |
                                     v
                                next task
```

The key rule is simple:

> No task is accepted until automated checks pass and an independent review returns PASS.

## Files

- `AGENTS.md` — non-negotiable repository rules for all coding agents.
- `.agent/PROJECT.md` — product scope and product decisions.
- `.agent/ARCHITECTURE.md` — target technical architecture.
- `.agent/WORKFLOW.md` — exact Supervisor → Builder → Reviewer loop.
- `.agent/DEFINITION_OF_DONE.md` — global quality gates.
- `.agent/ROADMAP.md` — epics and ordered development plan.
- `.agent/STATE.json` — machine-readable current state.
- `.agent/tasks/` — task specifications.
- `.agent/reviews/` — reviewer output.
- `.agent/decisions/` — Architecture Decision Records.
- `.agent/prompts/` — role prompts for Supervisor, Builder and Reviewer.
- `.agent/templates/` — task/review/ADR templates.
- `tools/orchestrator/SPEC.md` — specification for the deterministic orchestration harness that can later automate the loop.

## Operating philosophy

1. Work on exactly one task at a time.
2. The Builder implements only the current task.
3. The Reviewer reviews without trusting the Builder's conclusions.
4. CI/test results and reviewer approval are separate gates.
5. `main` should always represent an accepted, working state.
6. State belongs in the repository, not only in an agent conversation.
7. Architecture changes require an ADR.
8. Product-owner interruptions should be rare and reserved for real product, cost, credential, production, or irreversible architecture decisions.
