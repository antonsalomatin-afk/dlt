> Current disposition (2026-10-20): owner approved publication and the exact100-question bank is now active in production. The preparation snapshot below is retained as historical review material. See TASK-071-report.md for current deployment evidence and TASK-071-owner-smoke-check.md for real Telegram testing.

# TASK-071 launch content handoff — 2026-10-16

## Prepared release

- Branch: `codex/task-071`; exact candidate revision: `65d1c1ade2c48fc4e82388db85da93faf7eee9d8`.
- Original English starter learning set: 50 CAR and 50 MOTORCYCLE questions, four choices each; 12 categories and 53 concepts. Other question languages remain null.
- The approved artslob bank was used for topic discovery only. Its raw text, images and answer keys are not republished. Every proposed answer has a page-specific DLT handbook citation.
- Reviewable questions: `TASK-071-content-review-pack.md` in this directory. This starter set does not claim to be an official bank, complete syllabus or proof of exam readiness.
- Full factual review: `.agent/reviews/TASK-071-content-review-01.md` and its all-100 SUPPORTED observations in `.agent/reviews/TASK-071-content-decisions-01.json`. Targeted final-wording review: `.agent/reviews/TASK-071-content-review-02.md`.
- Authoritative final-file evidence: `.agent/checks/TASK-071-launch-checks-02.txt`. Both schema validations and isolated PostgreSQL taxonomy/import/replay/conflict checks passed. Real API exam creation returned 50 distinct questions for each vehicle without exposing correctness. Review/activation in that disposable test was explicitly simulated and is not production approval.
- Intake/tool implementation checks: lint, typecheck and 323 tests passed; independent reference-intake review PASS. The Builder reran all three after the final editorial changes. Supervisor's source checks and final data checks are separate evidence.

## Pending gates

The Product Owner must decide whether to release this concrete English starter learning set. Source-use authorization is already recorded; do not ask again to use the artslob reference. The outstanding decision concerns publishing these newly written drafts as reviewed production content.

No production taxonomy, questions or learner data have been changed. No real review or activation manifests have been issued. After content release approval, issue immutable manifests from the actual independent all-100 decisions for the exact final candidate bytes, validate them through the existing pipeline, and give the Admin the accepted release SHA. Follow `content/sources/launch-20261016.md` for additive taxonomy and separate DRAFT import, review and activation. Do not substitute development fixtures or simulated rehearsal decisions.

The Admin must apply the accepted content release on the server with secrets injected there, report exactly 50 active VERIFIED questions per vehicle without drift, and test both real vehicle exams. Production deployment remains within the previously approved dlt.thauto.app / tele.thauto.app boundary.

Whole TASK-071 is not accepted. The final redacted Admin report for `.agent/admin/TASK-071-report.md`, including explicit bot polling/scheduler evidence and the original operational acceptance criteria, is still outstanding. Owner-reported live login and the recorded unauthenticated API smoke test passed. Do not claim that login alone proves scheduler operation. Main remains on accepted history until the full task passes independent acceptance review.

The Supervisor-created local PostgreSQL instance was stopped after the disposable rehearsal; its temporary test database was removed. User-owned untracked files and the starter ZIP were preserved.
