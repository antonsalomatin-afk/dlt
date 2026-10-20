# TASK-072 owner feedback and design review

Date: 2026-10-20. Status: PARTIAL / discussion only.

The owner reported that ThaiDLT's design has drifted too far from the original inspiration and asked to think through improvements before implementation. The owner confirmed that the reference is pravila.es. This is design feedback, not confirmation that the real post-publication Telegram smoke checklist passed.

## Observations

The public pravila.es example uses a centered question column, prominent answer cards, adjacent translations and contextual answer explanations. A public sample answer was inspected; the authenticated experience beyond its login prompt was not reviewed.

The current ThaiDLT public page and app source show a persistent promotional introduction/road illustration, a two-column desktop shell, ten practice navigation controls and language/category selectors ahead of the question. These compete with the core question/answer task. No authentication bypass or production interaction was used to inspect the protected ThaiDLT flow; those observations come from source.

## Proposals for discussion — not approved requirements

- Bring the question and four answers into the main visual focus; keep vehicle onboarding separate from returning-user practice.
- Move secondary navigation/settings into a compact menu and topic picker.
- Use the saved language preference, English by default, and make available translations secondary.
- Keep feedback/explanations contextual and show one clear Next action. Consider direct answer submission in practice as a separate interaction decision; preserve the mock exam's hidden correctness.
- Review compact before-answer, after-answer and menu sketches before implementation. Preserve ThaiDLT's own branding and the existing approved data/authentication/scoring behavior.

No UI code, runtime configuration, production content or deployment changed in this design discussion. Fresh owner Telegram practice/exam acceptance and scheduled delivery remain unobserved.
