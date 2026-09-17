# TASK-030 Review 01

## Verdict

`VERDICT: PASS`

## Scope reviewed

- Task: `TASK-030` — Start an authenticated timed mock exam, including every Supervisor refinement and the Product Owner-approved 60-minute/45-of-50 policy.
- Commit(s): Builder commit `baaaf76f38639d5368b84a1609c5544641eb40a1` against accepted TASK-029 governance state `0a45b0cdb91171369094788ed92e1c55adfeb72c`.
- Relevant ADR(s): ADR-002 core TypeScript/PostgreSQL/Prisma stack and ADR-004 opaque bearer sessions; `AGENTS.md`, project, architecture, workflow, Definition of Done, repository state, task, and review template were also inspected.
- Checks supplied: `.agent/checks/TASK-030-checks-01.txt` records `pnpm check` PASS (18 files, 141 tests), `pnpm prisma validate` PASS, and `pnpm test:integration` PASS (15 files, 75 tests).
- Independent checks: focused `tests/exam-start.test.ts` PASS (1 file, 4 tests); focused `tests/exam-start.integration.test.ts` against a newly created isolated PostgreSQL database PASS (1 file, 6 tests); `git diff --check` PASS.

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| Protected start creates exactly 50 unique eligible questions for the saved vehicle in one transaction | PASS | `POST /exam/start` authenticates through the accepted opaque bearer boundary, requires a saved vehicle, reads a stable ID-ordered pool of active `VERIFIED` questions for that vehicle, samples without replacement, re-fetches and validates all selected rows, then atomically creates one session and 50 positioned child rows. PostgreSQL tests cover vehicle/status exclusions, insufficient/oversized pools, corruption rollback, invalid randomness rollback, and exact persisted cardinality. |
| Session snapshots the approved policy and exposes only safe pre-answer data | PASS | One request timestamp is captured and persisted as `startedAt`; expiry is exactly 3,600,000 ms later and the pass mark is 45 of 50. The response schema enforces the exact shape, canonical timestamps, policy, ordered positions, and unique exam/source IDs. Only the safe presented question is returned; persisted answer fields start null. |
| Authentication, input, concurrency, privacy, and rollback behavior are deterministic | PASS | Scoped `onRequest` authentication runs before query/body parsing, retaining uniform 401 behavior. Only an empty query and exact JSON `{}` pass; malformed/null/array/duplicate-or-unknown-member/unsupported requests receive stable 400 after authentication. Serializable transactions with bounded Prisma `P2034` retry produce one success and one active-exam 409 for concurrent same-user starts while different users both succeed. Failures are sanitized and writes roll back. |
| Sampling is bounded, unique, and cryptographically random by default | PASS | The implementation reads at most 10,001 IDs, rejects pools outside 50..10,000, and applies a partial Fisher-Yates sample. Production offsets use Node `randomInt`; the exam-only injection seam checks every returned offset is a safe integer in `[0, remainingCount)`. Unit and PostgreSQL coverage exercise bounds, uniqueness, deterministic order, and invalid injected values. |
| Immutable snapshots and response privacy are preserved | PASS | Each selected question is converted through the established versioned presentation snapshot validator inside the serializable transaction, including exactly four unique choices and exactly one correct choice. The API maps its response back from the persisted snapshot. Tests prove later source edits leave the snapshot unchanged and inspect exact response keys while excluding ownership, correctness, explanations, selections, source/image metadata, and mutable source content. |
| Active/completed/expired behavior is correct and isolated from practice | PASS | An owned incomplete session with `expiresAt > startedAt` blocks with the stable active-exam 409. Completed sessions and sessions expiring exactly at request time do not block. The implementation writes only `ExamSession` and nested `ExamQuestion` records; it does not create practice presentations or attempts or affect history/progress paths. |
| Documentation and task scope are complete | PASS | README documents authentication and request precedence, approved policy, eligibility and bounds, transaction/concurrency behavior, immutable snapshots, privacy, and that isolated fixtures are synthetic rather than official DLT content. The Builder commit stays within allowed API, database-source, test, and README files and adds no schema migration, UI, answer/completion/read flow, dependency, credential, content, or deployment change. |

## Findings

### Blockers

None.

### Important

None.

### Minor

None.

## Security review

- PASS. Authentication precedes all request-shape feedback, bearer failures remain uniform, cache prevention covers the route and its errors, server-only correctness and explanation data are omitted from the strict response, input/random boundaries fail closed, and unexpected storage or transaction errors are sanitized.

## Test review

- Coverage adequate. Unit tests cover exact request/response contracts, canonical timing, fixed policy, strict safe fields, consecutive positions, unique identities, partial Fisher-Yates behavior, pool bounds, and all invalid random-offset classes. Isolated PostgreSQL tests cover authentication/query/body/vehicle precedence, eligibility exclusions, deterministic selection, policy/timing, exact stored snapshots and null answer state, source-edit immutability, insufficient and oversized pools, corruption and invalid-random rollback, active/completed/strict-expiry behavior, same-user concurrency, different-user independence, privacy, and error cache headers.
- Missing scenarios: none material to TASK-030. Practice-side-effect absence is direct from the transaction's only writes and existing authoritative regression coverage; later exam answer, completion, resume, history, review, and UI behavior are explicitly outside this task.

## Architecture review

- Compliant. The route follows ADR-004's opaque bearer strategy, uses the existing Fastify/Prisma/PostgreSQL boundaries from ADR-002, relies on PostgreSQL serializable isolation rather than process memory, reuses the accepted snapshot contract, and introduces no architecture or persistence-model change.

## Final reviewer statement

TASK-030 satisfies every acceptance criterion and Supervisor refinement. The authoritative suite and independent focused unit/PostgreSQL checks pass, the start transaction preserves cardinality and immutable content, concurrency has deterministic ownership behavior, and the response does not expose answer or source metadata. No unresolved finding remains.

VERDICT: PASS
