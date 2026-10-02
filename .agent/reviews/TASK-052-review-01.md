# TASK-052 Review 01

## Verdict

`VERDICT: FAIL`

## Scope reviewed

- Task: `TASK-052` — Submit authenticated reports for presented practice questions
- Commit(s): Builder commit `905e04865d96270daea7cc1a668b2c6cce0fac91` against parent `864d692897dc9ba04c56146769d8d3e561fb576e`
- Relevant ADR(s): ADR-001, ADR-002, ADR-004
- Checks supplied: `.agent/checks/TASK-052-checks-01.txt` (`pnpm check` with 226 tests, `pnpm prisma validate`, and `pnpm test:integration` with 152 tests all passed)

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| Persisted report integrity | PASS | The additive migration binds the report to its user, question and owned presentation tuple, enforces one report per presentation, provides the required chronological indexes, cascades user deletion, and restricts presentation/question deletion. Isolated migration coverage exercises the defaults, unique/composite constraints and deletion behavior. |
| Authenticated strict request boundary | FAIL | Authentication precedes the practice JSON parser, duplicate top-level members and unknown fields are rejected, ownership/snapshot consistency are enforced, and documented bounds are otherwise covered. However, `details` accepts unpaired UTF-16 surrogate code units, which are not valid Unicode scalar values and do not round-trip exactly through the PostgreSQL UTF-8 client. |
| Idempotency and concurrency | FAIL | Normal and concurrent valid-text retries converge correctly and different details return 409 without mutation. For an accepted detail containing an unpaired surrogate escape, the first persistence changes that code unit to U+FFFD, so the identical retry compares unequal and returns 409 instead of the original 200 response. |
| Privacy, snapshot and response boundary | PASS | Unknown and foreign presentations share the private 404 response; corrupt/mismatched snapshots fail closed; current activation/verification is not required; response validation exposes only reportId, presentationId and createdAt under no-store. |
| Automated coverage and documentation | FAIL | The supplied gates are green and coverage is broad, including request ordering, duplicate JSON keys, concurrency and database constraints. Coverage does not include malformed Unicode scalar sequences or prove exact UTF-8 persistence/retry behavior for every accepted string. The CLI-test timeout edits only increase wrapper timeouts and retain subprocess bounds and assertions. |

## Findings

### Blockers

1. **Accepted report details can change during UTF-8 persistence and break exact retry semantics**
   - Severity: blocker
   - File: `packages/database/src/report.ts:10`
   - Problem: The details schema counts ECMAScript code points and excludes only Unicode category `Cc` at lines 10–17. An unpaired surrogate such as the JSON value `"x\ud800y"` is category `Cs`, so the schema accepts it. Node's PostgreSQL encoding converts the unpaired surrogate to U+FFFD. A focused read-only `SELECT $1::text` check against the configured PostgreSQL database confirmed input code points `78,d800,79` round-trip as `78,fffd,79`.
   - Why it matters: TASK-052 requires details to be stored exactly after validation and an exact retry to return the original report. After the first accepted request stores U+FFFD, the same JSON request parses back to U+D800; `classifyExisting` compares the two strings as different and returns `409 Report already submitted`. Thus accepted external input violates both exact storage and idempotency requirements.
   - Required correction: Reject unpaired UTF-16 surrogates (or otherwise require a lossless valid-Unicode-scalar UTF-8 round trip) in the shared request schema before persistence. Add contract and PostgreSQL integration tests using lone high and low surrogate JSON escapes, including an identical retry assertion, while retaining valid supplementary-plane characters such as emoji.

### Important

None.

### Minor

None.

## Security review

- PASS for authentication ordering, ownership privacy, bounded bodies, no-store handling, precise unique-conflict classification and response secrecy; the data-integrity blocker is listed above.

## Test review

- coverage inadequate due to the blocker above
- missing scenarios: lone high-surrogate and lone low-surrogate request values at the schema/API boundary, PostgreSQL persistence round-trip, and identical retry behavior for those inputs

## Architecture review

- compliant. The implementation stays within the accepted Fastify/Prisma/PostgreSQL architecture, uses an additive migration, changes only `files_allowed`, introduces no external dependency or administration surface, and preserves the untracked starter ZIP.

## Final reviewer statement

`VERDICT: FAIL`

TASK-052 requires one review-fix pass to make every accepted details string lossless in PostgreSQL and preserve exact-retry idempotency.
