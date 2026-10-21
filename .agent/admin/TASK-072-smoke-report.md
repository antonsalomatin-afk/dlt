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

## Owner observation and scope clarification — 2026-10-21

Owner supplied a fresh Telegram Mini App screenshot showing the existing promotional ThaiDLT onboarding screen and reported seeing no chat updates. This establishes rendering of that screen only, not practice/exam/scheduled-message success. Read-only production diagnosis at08:50:15UTC found the bot active/running with0 restarts,3 users,0 reminder opt-ins,0 opted-in users with a selected vehicle and no delivery rows for the current ICT date. No user identifiers, credentials or preferences were changed. The11:00 ICT send window preceded deployment; next normal window is2026-10-22 at11:00 ICT for opted-in learners.

The owner explicitly clarified they expected both real chat-question messages and the compact Mini App design. TASK-076 implements the approved real interface and corrects the obsolete reminder settings claim that delivery is inactive. User opt-in remains required; no forced/test message is inferred from this feedback. Original real-owner learning smoke remains unpassed.
