# Follow-ups and technical debt

Items here are known, accepted and deliberately not done yet. Each one names what
would be built, what it depends on, and why it is deferred. Nothing here blocks the
current task. The Supervisor promotes an item to a task when its dependency clears.

## Deferred scope (Product Owner decision 2026-09-22)

### Spaced repetition scheduling

Deferred. `.agent/PROJECT.md` lists spaced repetition under later capabilities and the
Product Owner confirmed it stays out of Epic 6.

Would build: a per-concept next-review timestamp that moves further out after a correct
answer and back after a miss, plus practice delivery that prefers due concepts.

Needs first: an interval policy from the Product Owner (or an explicitly provisional
ladder), and a decision on whether due dates are visible to the learner.

Already in place to build on: `Question.conceptId`, deterministic fixture concepts, and
`GET /me/progress/concepts` per-concept accuracy.

### Exam readiness score

Deferred. Listed under later capabilities in `.agent/PROJECT.md`; the Product Owner
confirmed it stays out of Epic 6.

Would build: one aggregate readiness figure from concept accuracy and coverage.

Needs first: the Product Owner's definition of "ready" and the exact wording, because a
readiness percentage implies a claim about passing the real DLT examination. Do not ship
an inferred threshold.

### Concept mastery labelling

Deferred with the two items above, for the same reason: calling a concept "mastered"
needs a threshold policy and carries an implied promise. Per-concept accuracy is already
exposed numerically without a label, which covers the learning need for now.

## Engineering follow-ups

### Windows-only local database runner (raised in TASK-033 checks)

`tools/database/local.ts` rejects non-Windows platforms before running its
directory-safety checks, so the three reset-safety cases in
`tests/database-lifecycle.test.ts` always fail on Linux and macOS. Make the safety
checks platform-independent and guard only the native binary invocation, or skip those
cases behind a documented platform guard. Pre-existing since TASK-003.

### Concurrent exam start under load (raised in TASK-037/038 checks)

`tests/exam-start.integration.test.ts` "serializes concurrent starts per learner" failed
in 2 of 9 full integration runs, both times when the suite started immediately after the
CPU-heavy `pnpm check` unit run. It passed 3/3 alone and in 6 other full runs. Suspect
the six-attempt serializable retry budget in `EXAM_START_MAX_ATTEMPTS` (about 230ms of
total backoff) is exhausted under load. Capture the failing response body in the test,
widen or jitter the retry budget, and prove it with a load-injected test.

### grammY shutdown paths (raised in TASK-007 review 01)

Add mocked cancellation during the `deleteWebhook` polling setup and await shutdown
cleanup when start rejects. No acceptance blocker. See
`.agent/reviews/TASK-007-review-01.md`.

### Duplicate-parser test strength (raised in TASK-008 review 01)

Strengthen the duplicate-parser tests as described in
`.agent/reviews/TASK-008-review-01.md`. Non-blocking.

## Resolved

- TASK-012 review 01 minor: resolved by accepted TASK-013; the stale README
  answer-submission statement was removed.
