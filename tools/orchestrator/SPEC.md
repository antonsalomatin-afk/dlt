# Deterministic Agent Orchestrator — Specification

## Purpose

The orchestrator is a small deterministic harness that coordinates AI roles without relying on one long conversational session.

It should eventually be able to:

1. read `.agent/STATE.json`;
2. load the current task;
3. invoke a Builder agent;
4. record the produced commit;
5. run authoritative checks itself;
6. invoke an independent Reviewer agent;
7. parse `VERDICT: PASS|FAIL`;
8. return failed findings to Builder;
9. stop after the configured review-loop limit;
10. update state;
11. proceed to the next task only after Supervisor acceptance.

The orchestrator is deliberately separate from ThaiDLT product code.

## Important design principle

LLMs make judgment calls.

Deterministic code controls the process.

Do not let an LLM decide that a command passed when the command actually returned a non-zero exit status.

## Conceptual interfaces

```ts
type TaskId = `TASK-${string}`;

interface AgentResult {
  stdout: string;
  stderr?: string;
  metadata?: Record<string, unknown>;
}

interface CheckResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface ReviewResult {
  verdict: "PASS" | "FAIL";
  reviewFile: string;
  raw: string;
}

interface OrchestratorState {
  currentTask: TaskId | null;
  status:
    | "PLANNED"
    | "READY"
    | "BUILDING"
    | "CHECKING"
    | "REVIEW"
    | "ACCEPTING"
    | "ACCEPTED"
    | "BLOCKED";
  reviewAttempt: number;
  maxReviewAttempts: number;
}
```

Conceptual adapter methods:

```ts
interface AgentAdapter {
  runSupervisor(prompt: string): Promise<AgentResult>;
  runBuilder(prompt: string): Promise<AgentResult>;
  runReviewer(prompt: string): Promise<AgentResult>;
}

interface GitAdapter {
  currentBranch(): Promise<string>;
  latestCommit(): Promise<string>;
  diffForCommit(commit: string): Promise<string>;
  isClean(): Promise<boolean>;
}

interface CheckRunner {
  run(commands: string[]): Promise<CheckResult[]>;
}
```

## Main loop pseudocode

```text
load state

while state is not BLOCKED and project is not complete:
    supervisor refines/selects current task
    set BUILDING

    builder implements current task
    capture builder commit

    set CHECKING
    run authoritative required checks

    if any check fails:
        send exact check failures to builder
        continue

    set REVIEW
    reviewer independently reviews task + diff + repository

    save review artifact

    if review == FAIL:
        increment reviewAttempt

        if reviewAttempt >= maxReviewAttempts:
            set BLOCKED
            ask Supervisor to diagnose
            stop if owner decision is required

        else:
            set BUILDING
            send review findings to Builder
            continue

    if review == PASS:
        set ACCEPTING
        supervisor verifies acceptance
        merge/cherry-pick according to repository strategy
        update state:
            lastAcceptedTask
            lastAcceptedCommit
            reviewAttempt = 0
        select/refine next task
```

## State updates

State writes must be atomic.

Prefer:

1. write temporary state file;
2. validate JSON;
3. rename into `.agent/STATE.json`.

## Verdict parsing

Reviewer output must contain exactly one final verdict token:

```text
VERDICT: PASS
```

or

```text
VERDICT: FAIL
```

If verdict is absent or ambiguous, treat as FAIL and request corrected review output.

## Check execution

Never trust a Builder's claimed test results as authoritative.

The orchestrator must execute the commands listed in the task.

Default fallback if the task omits checks:

```text
pnpm lint
pnpm typecheck
pnpm test
```

## Git safety

Before Builder starts:

- repository/worktree should be clean;
- current task branch/worktree should be known.

After Builder returns:

- capture exact new commit(s);
- detect uncommitted changes;
- do not accidentally include unrelated working-tree modifications.

## Worktrees

Preferred later implementation:

```text
main
worktrees/TASK-XXX
```

The orchestrator can:

1. create task worktree from accepted main;
2. run Builder there;
3. run checks/review there;
4. merge/cherry-pick only after PASS;
5. remove completed worktree.

## Environment abstraction

Do not hard-code a single LLM execution mechanism.

Implement adapters.

Possible adapters later:

- Codex CLI/session invocation;
- another local agent runner;
- an API-based agent runner.

The repository workflow must remain useful even before this programmatic orchestrator is implemented.

## First version scope

The first orchestrator implementation should be intentionally small.

Version 1 may only:

- read state/task files;
- print the exact role prompt;
- run checks;
- validate review files;
- update state.

Agent invocation itself can remain manual until the execution adapter is proven.

This allows the project to start immediately while avoiding premature coupling to one agent interface.
