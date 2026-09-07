# Agent Development Workflow

## Roles

### Product Owner

Owns:

- product direction;
- major scope changes;
- pricing;
- paid providers;
- legal/content decisions;
- production credentials;
- production deployment approval.

The Product Owner should not be asked to decide routine engineering details.

### Supervisor

Acts as:

- technical lead;
- planner;
- task writer;
- architecture guardian;
- acceptance gatekeeper.

The Supervisor normally does not implement feature code.

### Builder

Acts as:

- implementation engineer.

The Builder implements exactly one current task, runs required checks, and commits.

### Reviewer

Acts as:

- independent senior engineer;
- QA/security reviewer as relevant.

The Reviewer does not modify the implementation during normal review. It produces findings and a verdict.

## State machine

```text
PLANNED
  |
  v
READY
  |
  v
BUILDING
  |
  v
CHECKING
  |
  +--> checks fail ------> BUILDING
  |
  v
REVIEW
  |
  +--> FAIL -------------> BUILDING
  |
  +--> PASS -------------> ACCEPTING
                               |
                               v
                            ACCEPTED
```

Exceptional:

```text
BUILDING / REVIEW
      |
      v
   BLOCKED
```

## Task loop

### Step 1 — Supervisor selects/refines task

Supervisor:

1. reads project, architecture, roadmap and state;
2. selects highest-priority unblocked task;
3. ensures task acceptance criteria are exact;
4. ensures required tests/checks are listed;
5. sets task status to `READY`;
6. updates `.agent/STATE.json`.

### Step 2 — Builder implements

Builder:

1. reads current task and repository instructions;
2. changes only necessary files;
3. adds/updates tests;
4. runs required checks;
5. fixes local failures;
6. commits;
7. stops.

Builder output should include:

- commit SHA;
- files changed;
- checks executed;
- check results;
- any assumptions.

### Step 3 — Automated checks

The orchestration layer or Supervisor runs the authoritative checks.

Builder claims are not sufficient.

If checks fail:

- record the failure;
- return the task to Builder;
- do not review as PASS.

### Step 4 — Independent review

Reviewer receives:

- current task;
- relevant ADRs;
- commit/diff;
- repository;
- authoritative check results.

Reviewer must inspect for:

- acceptance criteria;
- correctness;
- security;
- data integrity;
- regressions;
- missing tests;
- maintainability;
- architecture violations;
- scope creep.

Reviewer writes a review file under:

```text
.agent/reviews/TASK-XXX-review-NN.md
```

### Step 5A — Review FAIL

Supervisor:

1. records review attempt;
2. sets state back to `BUILDING`;
3. sends only concrete findings to Builder;
4. prohibits starting another task.

Builder fixes findings in a new commit.

Then checks and review run again.

### Step 5B — Review PASS

Supervisor verifies:

- authoritative checks pass;
- review verdict is PASS;
- no unresolved blockers;
- task acceptance criteria are satisfied.

Then Supervisor:

1. accepts/cherry-picks/merges work according to repo workflow;
2. marks task `ACCEPTED`;
3. records accepted commit;
4. updates roadmap;
5. updates state;
6. selects/refines the next task.

## Review-loop limit

Normal maximum:

```text
3 independent review failures
```

After that:

1. mark task `BLOCKED`;
2. Supervisor diagnoses whether the issue is:
   - unclear requirements;
   - architecture flaw;
   - poor task decomposition;
   - persistent implementation defect;
3. Supervisor may rewrite/split the task;
4. Product Owner is contacted only if a real owner-level decision is required.

## Worktree model

Preferred model:

```text
main
  |
  +-- worktree/branch task-001
  +-- worktree/branch task-002
```

Only the current task should normally be active for sequential development.

`main` receives accepted work only.

## Supervisor coding restriction

Supervisor should avoid feature implementation because independence matters.

Allowed Supervisor changes:

- `.agent/**`;
- task files;
- review state;
- ADRs;
- tiny merge-conflict resolutions when semantics are unambiguous;
- emergency build metadata corrections only when they do not replace proper Builder work.

If feature code must be changed, delegate it to Builder.

## Reviewer coding restriction

Reviewer should not fix what it reviews.

A Reviewer may suggest a patch conceptually but should return findings to Builder.

This preserves independence.

## Human escalation matrix

Escalate to Product Owner for:

| Situation | Escalate? |
|---|---|
| naming a local variable | no |
| choosing a test helper | no |
| API path naming | normally no |
| minor UI spacing | no |
| add a paid SaaS | yes |
| request Telegram Bot Token | yes |
| deploy production | yes |
| destructive production migration | yes |
| legal reuse of content | yes |
| major database replacement | yes |
| change monetization | yes |
| repeated review deadlock caused by product ambiguity | yes |
