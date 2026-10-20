# TASK-072 compact learning preview

Scope: an isolated, English-first design discussion fixture approved by the owner on 2026-10-20. The canonical fragment is `.agent/admin/TASK-072-compact-preview.html`; the Supervisor copies it byte-for-byte to the conversation visualization directory after independent preview review. This does not satisfy the original live-owner Telegram smoke acceptance criteria.

The composition puts four large answers directly below one question. Vehicle selection and explicitly illustrative session metrics stay in quiet app chrome; a compact practice topic picker stays above the question. ThaiDLT uses its own styling and branding. The owner identified pravila.es as the density and learning-flow reference; this fixture uses only context provided for that reference, not copied source or assets.

Two proposals share the same compact single-column shell:

- **Tap to check:** tapping an answer immediately reveals the result, correct answer and short explanation. Next question resets the answer state and advances through two local examples.
- **Confirm answer:** a choice can be changed before the explicit Check answer action. The checked result then uses the same feedback and Next action.

Each proposal includes question, answered-feedback and menu states. Menu entries show the existing feature outline as static layout, visibly labeled as unlinked. Opening, closing and Escape preserve the underlying question state. Favorite is an in-memory preview toggle; Report explicitly says no report was sent. Vehicle and topic selectors are local demonstration controls. No browser persistence, backend request, auth, telemetry, deployment or application source is involved. Sample session totals are fixed illustrative values, not inferred readiness or real user progress. Two supplied educational examples are illustrative copy, not a content verification or publication decision.

The host supplies variant navigation and Lucide icons. Product colors are scoped light/dark pairs; the surrounding dot grid is preview chrome. Optional host Tweak controls change only answer padding and corner radius, after initial render. There is no second visible control panel. The two stages use the same responsive minimum height so host navigation remains stable; content can grow naturally if needed.

Builder validation passed: literal fragment and script compilation (`new Function`); file size below 1 MB; exactly two variants with four answers each; no document wrapper, network calls/URLs, browser storage or authored icon SVG. Repository minimum checks passed sequentially: `pnpm lint`, `pnpm typecheck` and `pnpm test` (57 files, 323 tests). Supervisor browser inspection passed the primary answer/feedback/Next/menu interactions in both variants and found no overflow at 320px. That inspection prompted a shared minimum-height adjustment to keep the host navigation stable; final browser reinspection and independent review remain Supervisor gates. The file intentionally contains no app integrations and must not be presented as implemented product behavior.
