# Starting ThaiDLT in Codex

## First session

Open the project root in Codex and give it the contents/intent of `.agent/prompts/SUPERVISOR.md`.

Recommended initial instruction:

```text
Act as the Supervisor for this repository.

Read AGENTS.md and all files under .agent that are relevant to the current state.
Do not implement feature code yourself.

Begin from .agent/STATE.json and TASK-001.
Refine TASK-001 only if necessary, then delegate implementation to a Builder.
Require the Builder to run the task's checks and commit.
Then run authoritative checks independently and delegate an independent review.
Do not accept the task until checks pass and the Reviewer returns VERDICT: PASS.
After acceptance, update .agent/STATE.json and continue task-by-task until blocked by a decision that genuinely requires me.

Persist all important state in the repository, not only in conversation.
```

## If your Codex environment does not support true child-agent orchestration

Use three parallel/separate Codex sessions or agent threads:

1. `Supervisor`
2. `Builder`
3. `Reviewer`

The Supervisor owns `.agent/STATE.json`.

The Builder gets only the current task.

The Reviewer gets the task + diff/commit and must use the Reviewer prompt.

You can still follow the workflow manually until `tools/orchestrator` is automated.

## First human checkpoint

You should not need to intervene until Codex asks for something truly external, such as:

- Telegram bot token;
- a paid provider;
- production deployment approval;
- a legal/content-source decision.

For the first repository/data tasks, no credentials should be necessary.
