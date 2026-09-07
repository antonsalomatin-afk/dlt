# Orchestrator

This folder is reserved for the deterministic Supervisor/Builder/Reviewer harness.

Read `SPEC.md`.

Do not implement a large orchestration framework before ThaiDLT development can start.

The repository workflow works manually from day one:

1. run Supervisor prompt;
2. run Builder;
3. run authoritative checks;
4. run Reviewer;
5. update state;
6. repeat.

Automation can then replace the manual transitions incrementally.
