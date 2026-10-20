# TASK-072 Preview Review 01

## Verdict

`VERDICT: FAIL`

This verdict concerns the isolated design-preview component only, not the original owner Telegram smoke task or approval to implement/deploy a design.

## Scope reviewed

- Task: TASK-072, design-preview scope amendment and acceptance criteria.
- Commit(s): Builder `c5a575264d98447c2eccec5163f8beb193ae8ef3`; its two added preview files. Supervisor evidence `706c91a` is supporting evidence, not Builder implementation.
- Relevant ADR(s): ADR-001 workflow, ADR-002 stack, ADR-005 Mini App boundary; no runtime boundary changes.
- Checks supplied: `.agent/checks/TASK-072-preview-checks-01.txt`; reports Builder lint/typecheck and 57 test files/323 tests passing, plus Supervisor static/browser checks.
- Independent inspection: repository instructions, task, relevant ADRs, full visualize skill and tweak.md, complete fragment/script and notes, Builder change scope, exact canonical/copy SHA256, script compilation, unique IDs and control counts. Browser measurements/appearance are attributed to the Supervisor's supplied independent evidence; this Reviewer did not repeat browser QA.

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| Compact English question, four answers, quiet chrome and feedback/Next action | PASS | Single-column product surface; four native answer buttons per variant; contextual explanation and one Next action. Sample progress explicitly labeled. |
| Question, feedback and menu local interactions | PASS | Direct and confirmation state transitions, selection changes, reset/Next and menu focus restoration inspected. Supplied final browser QA covers these paths. Menu destinations are explicitly unlinked. |
| Compare direct submission and explicit confirmation | PASS | Named host-carousel variants preserve their own DOM and closure state; confirmation does not reveal correctness before checking. No exam code changes. |
| Complete visualize-skill compliance and exact conversation copy | FAIL | Canonical/copy hashes match `51db964ba508808d418d4be3416014fffa006692c5e890f3e5c17ab2d07b2d36`, but required host interaction-state restore/save behavior is missing; see blocker 1. |
| No network, backend, persistent browser storage, secrets, assets or production changes | PASS | No such calls/resources in the fragment. Runtime paths have no diff against accepted runtime baseline `60e38bd`. Host state snapshots can be implemented without browser storage or network calls. |
| Markup/script, interactions, themes and responsive layout down to 320px | PASS | Reviewer compiled the actual script; 25,691-byte fragment has unique IDs, two variants and eight answer controls. Supervisor browser evidence reports zero errors and no overflow at actual 320/390/736px frame widths, stable shared floors and both themes. |
| Original real-owner Telegram smoke criteria | OUTSTANDING | Not exercised by this mockup and not eligible for task acceptance through this review. |

## Findings

### Blockers

1. **Required inline interaction-state lifecycle is absent**
   - Severity: blocker
   - File: `.agent/admin/TASK-072-compact-preview.html:208` (closure-local state initialization and subsequent event handlers).
   - Problem: Every render starts with fresh defaults. The fragment never reads `window.openai.widgetState`, handles `openai:set_globals`, or calls `window.openai.setWidgetState` after meaningful interactions. These are explicit requirements in the full visualize skill's “Remembering inline interaction state” section, which the task explicitly requires the fragment to follow.
   - Why it matters: The selected/answered question, illustrative vehicle/topic choice and favorite state disappear when the host restores/recreates the preview, and interaction choices useful in follow-up discussion never enter a host snapshot. Ordinary carousel switching works because its DOM survives; that does not satisfy host lifecycle restoration.
   - Required correction: Add a small guarded, validated, versioned host snapshot for each flow, restore compatible snapshots initially and on the host state event, and save meaningful user changes with the required `{ modelContent, privateContent }` shape and rejected-Promise handling. Use safe defaults when the host is absent or state is incompatible; do not save on initial render/state events. Keep snapshots below 16 KiB and keep browser storage/network/backend calls absent. Recopy the canonical fragment byte-for-byte and verify restoration, absent-host operation and no save loop.

### Important

None.

### Minor

None.

## Security review

- PASS for inspected isolated preview: no credentials, auth integration, production access, dynamic HTML insertion, network calls or browser persistence. Text content is local illustrative data. Any added host state must be validated as untrusted input before choosing indices or rendering state.

## Test review

- Existing primary-interaction, responsive and appearance coverage is adequate for this isolated preview component, apart from the missing host-state behavior.
- Missing scenarios: compatible/incompatible host snapshots; late `openai:set_globals` restoration; meaningful-interaction snapshots; absent host; no saves on initial/state-driven rendering. Repeating application integration/Prisma tests is unnecessary for this documentation-only change.

## Architecture review

- Compliant. Builder modifies only the two allowed administrative preview files. No app implementation, dependency, deployment, identity, persistence or content-publication boundary changed.

## Final reviewer statement

`VERDICT: FAIL` on exact Builder commit `c5a575264d98447c2eccec5163f8beb193ae8ef3` for the single complete-skill-compliance blocker above. Other inspected preview criteria pass. Fix and independently review the preview before presentation; original TASK-072 acceptance and owner approval to implement/deploy remain separate gates.
