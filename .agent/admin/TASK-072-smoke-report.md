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

## Current handoff — 2026-10-22

The historical design discussion above has been resolved by the accepted compact Mini App (TASK-076). Native private-chat quizzes (TASK-077) and their production rollout (TASK-078) are also accepted after authoritative checks and independent PASS. Live release is `0a4d7b3291f346581174aa5ac3ffe7d5404f73be`; operational evidence is `.agent/admin/TASK-078-production-report.md`, with independent review `.agent/reviews/TASK-078-review-01.md`. No further deployment approval is pending.

The owner can send `/quiz` (or `/practice`) to `@thauto_dlt_bot`, choose a vehicle if needed, answer the native quiz, read its explanation and use Next in the same private chat. Current Russian content contains translated stems only, so a coherent complete quiz uses English. Saved preferences and reminder opt-in are preserved.

Owner-reported results since this rollout: none. Actual native answer/feedback/Next, fresh signed Mini App practice for CAR and MOTORCYCLE, and a 50-question exam with reopen/resume remain UNOBSERVED. Automated local tests and live read-only health checks have passed but do not establish these owner observations. Scheduled-message receipt is also unobserved and is not required to close this initial smoke task.

TASK-072 remains BLOCKED on real-owner interaction. Do not mark it passed, manufacture signed authentication or send a forced Telegram test message. Any concrete reported defect must receive a scoped Builder task, authoritative checks and independent review.

### Owner report — 2026-10-22

The owner states that the private chat works. This is an owner-reported positive observation, not independent observation or explicit confirmation of every answer/feedback/Next step. The supplied screenshot shows a group, where the accepted private-only implementation intentionally ignores quiz commands. The owner subsequently requested group support; TASK-079/080 address this new scope. Mini App practice/exam-resume observations remain outstanding.

## Group rollout owner handoff — 2026-10-22

TASK-080 implementation and TASK-081 production rollout are accepted after full authoritative checks and independent source/operational PASS. Live release is `3cbcbac2976014f4d3bf6346341b6667f14b44d1`; evidence is `.agent/admin/TASK-081-production-report.md` and `.agent/reviews/TASK-081-review-01.md`. All17 old tables, including private chat sessions, remained unchanged; fresh backup preceded the additive migration.

The owner must make @thauto_dlt_bot an administrator of the intended group and send `/quiz@thauto_dlt_bot` (or append `motorcycle`). Two real members should answer the shared native quiz; starter/admin uses Finish round, checks full explanation/aggregate accuracy and then Next. Current shared language is English. No automatic private message or group permission change was performed.

Owner-reported private-chat success predates this rollout. Actual group setup/two-member answer/finish/Next, fresh post-rollout private usability and signed Mini App practice/exam-resume remain unobserved. TASK-072 remains BLOCKED on owner interaction, not further deployment approval. Do not manufacture signed identities, send forced test messages or mark these observations passed. Any concrete reported defect needs a scoped Builder correction and independent review.
