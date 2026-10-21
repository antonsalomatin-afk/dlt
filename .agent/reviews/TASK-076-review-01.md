# TASK-076 Review 01

## Verdict

`VERDICT: FAIL`

## Scope reviewed

- Task: `.agent/tasks/TASK-076.yaml`, current STATE, owner decision superseding the earlier preview-only scope, core repository/workflow constraints, nested `apps/web/AGENTS.md`, and review template.
- Commit: `e0bb5c8a94bf6ff9ffb780105c67f913d05adfc2`, compared with accepted `main` checkpoint `194c800`. All 21 changed files inspected: six application files and 15 browser test/helper files. Later branch changes are `.agent` metadata only.
- Relevant ADRs: ADR-004 session strategy, ADR-005 browser/API boundary and ADR-006 private reminder policy. Installed Next.js client-component/CSS guidance and the selected compact-preview design notes were consulted.
- Checks supplied: `.agent/checks/TASK-076-checks-01.txt`: sequential lint, typecheck, all 338 unit tests with the task-approved two-worker limit, production web build, all 226 browser tests and whitespace PASS. Backend/schema/contracts/dependencies are unchanged, supporting explicit inheritance of accepted integration evidence.
- Independent checks: `pnpm test:e2e tests/e2e/compact-app.spec.ts tests/e2e/deep-link.spec.ts tests/e2e/daily.spec.ts --workers=2`: 29 passed in 16.2 seconds; source diff whitespace check passed. Inspected actual mocked-local-app screenshots at 320/390px and desktop, including long Russian text, selected question, feedback and expanded menu. These are not real-owner Telegram observations.
- Deployment handoff inspected: `.agent/admin/TASK-076-deploy-handoff.md`. No deployment or production mutation was performed by this reviewer. Native chat quiz behavior remains outside this task.

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| Quiet compact shell, prompt saved-vehicle practice entry and real auth | PASS | Promotional hero/road removed; practice entry visible in mobile/desktop evidence. Existing signed Telegram authentication path is unchanged. |
| Question-first layout, compact topic/language/vehicle context and real menu destinations | FAIL | Readable answers, topic disclosure, language controls and functional destinations pass; vehicle context is absent from both learning components (blocker 1). |
| Explicit choice/change, Check answer, contextual result and Next | PASS | Handlers retained, selection does not submit; focused tests verify one authoritative submission. Duplicate/retry and old owned links retain existing behavior. Exam handlers remain unchanged. |
| Menu preservation, keyboard focus/Escape and genuine favorite/report | PASS | Disclosure does not unmount learning state. Opening focuses first action; Escape restores trigger focus. Existing safeguards and real functions retained. |
| Language default/preference/fallback and accurate explicit reminder opt-in | PASS | Existing behavior retained. Copy now states private questions at 11:00 Thailand time and no immediate message on save; preference contracts/checkbox unchanged. |
| Readable responsive 320/390px and desktop layout | PASS | Screenshot inspection and browser overflow/viewport assertions pass; long Russian stem wraps without clipping. No external assets/dependency introduced. |
| Non-target functionality/security/scope preserved | PASS | API/bot/schema/content/environment/dependency files unchanged. Tests retain behavior assertions while using real disclosure navigation and new CTA labels. |
| Meaningful browser coverage and full suite | FAIL | Existing and new coverage passes, including menu/selection/confirmation and deep links; no assertion covers the missing required vehicle context. |

## Findings

### Blockers

1. **Show the required vehicle context on practice and daily/linked screens**
   - Severity: blocker (P2 acceptance gap).
   - Files: `apps/web/app/practice.tsx:215` and `apps/web/app/daily.tsx:148`.
   - Problem: Acceptance criterion 2 explicitly requires compact topic/language/vehicle context. Neither learning component renders the saved vehicle selection: the ordinary practice chrome displays only PRACTICE, generic heading, language and topic; daily/linked chrome displays date/mode and language. The menu offers only generic Change vehicle or Vehicle setup. Neither component references `session.user.selectedVehicleType` for visible context. Reviewed question/feedback screenshots confirm no Car/Motorcycle/current-selection label.
   - Why it matters: Once inside the learning surface, learners cannot identify their saved vehicle context without leaving the question. The implemented compact composition therefore omits one of the expressly required context elements.
   - Required correction: Add a small, accessible, clearly labeled current/saved-profile vehicle value in both learning surfaces, including an honest unset state. Use existing validated session state without changing requests or answer logic. For historical linked questions, do not imply that the current preference identifies the original snapshot's vehicle; label it as the current/saved selection. Add browser assertions for CAR/MOTORCYCLE context and linked/null-vehicle behavior, retaining exact old-link retrieval and unsubmitted-choice preservation.

### Important

None beyond blocker 1.

### Minor

None.

## Security review

- PASS for inspected changes. The new disclosure is local client state; it adds no persistence, identity trust, raw HTML, credential handling or external requests. Existing signed authentication, in-memory bearer sessions, response validation and answer/exam correctness boundaries remain unchanged.
- Reminder preference remains explicitly user-controlled; this UI change does not enable users automatically or send a message on save.

## Test review

- Coverage is adequate for the other criteria: full authoritative suite passes and the independent focused rerun verifies compact viewport behavior, menu focus/Escape, unchanged choice/presentation, explicit confirmation, daily duplicate/error behavior and exact historical/foreign/malformed/auth-gated links.
- Existing test changes follow actual menu/topic disclosures and rename the intended controls; inspected behavioral assertions are retained. Obsolete inactive-delivery assertions are replaced with accurate schedule/no-immediate-send assertions.
- Missing scenario: visible, correctly qualified vehicle context, including a linked presentation with a cleared/changed current preference.
- Initial helper-import/resource-contention/browser failures are documented in the Builder checkpoint and corrected; no test/timeout/assertion suppression is represented as a fix.

## Architecture review

- Compliant. Shared client disclosure and scoped web styling remain within the accepted service/API boundary. No backend, schema, paid dependency or material architectural change. Planned production release requires code PASS and subsequent independent operational verification; real-owner smoke and scheduled-post evidence remain separate.

## Final reviewer statement

`VERDICT: FAIL` for exact candidate `e0bb5c8a94bf6ff9ffb780105c67f913d05adfc2` solely for blocker 1. All other reviewed criteria pass. Return the bounded context-label correction and regression coverage to Builder before code-component acceptance or deployment. This reviewer changed only this review file; implementation, state, production and accepted history remain untouched.
