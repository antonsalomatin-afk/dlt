# ADR-009 — Reviewed bilingual teaching and personal group explanations

Status: Accepted for loader and practice snapshot enrichment (TASK-085 independent PASS); Telegram delivery remains proposed until TASK-086 implementation/review.
Date: 2026-10-23

## Owner-approved behavior

The owner approved the per-line spoiler preview: English question and four English choices, Russian translation individually hidden below each line, a native A-D quiz and a detailed bilingual explanation after answering. Preserve asynchronous group practice without Finish, vote thresholds, shared results or unsolicited private messages. Native quiz options cannot contain spoiler formatting; ordinary preceding messages hold the text/translations.

## Reviewed content and immutable snapshots

TASK-084 prepares an offline100-entry teaching pack and independent hash-bound per-entry review. English wording, option keys/order, answer keys, existing100 Russian stems and DLT guide citations remain exact. Additional Russian choices/explanations and bilingual distractor/safety notes require independent acceptance before runtime use. Guide citations are labeled DLT_GUIDANCE, never presented as statutes. A missing verified statutory clause remains missing rather than guessed.

Load the shipped accepted content, source JSON and actual independent review artifact on the server only. Runtime-validate schemas, complete100 coverage, canonical source/pack hashes and all per-entry PASS outcomes. No external source fetch, runtime translation or new provider. Reject corrupted/unreviewed artifacts safely. Bind each enrichment to stable original question/choice IDs, exact original question/choice/answer content and citation, and the accepted stem overlay. Reuse/extract the existing stable ID algorithm rather than introducing another identity system.

Enrich only newly created immutable presentation snapshots for exact eligible source matches. Preserve original Question/QuestionChoice rows and every historical snapshot/attempt. A source drift or unrelated question must not receive stale teaching; retain original behavior and make full100 match inspection a deployment gate. Do not overwrite a conflicting already-populated translation silently. No schema migration or database content overlay is needed.

Extend strict snapshot version1 with optional validated teaching metadata and provenance, preserving legacy snapshots. Accepted Russian choices/explanation may be copied into their existing snapshot translation fields; hidden teaching carries bilingual distractor/safety notes, source guidance and pack hash. Do not add teaching/correctness/explanations to pre-answer HTTP question DTOs. Existing post-answer response may combine the teaching with its explanation/trap fields without changing scoring/authentication semantics; any DTO shape change requires explicit task coverage. Mock-exam timing, secrecy, option mapping and results remain unchanged.

TASK-085 keeps direct snapshotQuestion(source) calls un-enriched by default because exam creation shares that function. Practice selection, new daily selection and mistake retry explicitly opt into teaching. Exam callers and their snapshot payloads remain untouched; source bank and historical snapshot preservation are independent guarantees.

## Telegram formatting

Use ordinary rich message entities for spoilers and bounded expandable explanation blocks. Preserve full meaning and UTF-16 entity ranges/surrogate pairs across4096-character Telegram limits; never slice raw HTML or discard long content. Exactly A-D native quiz options use the immutable stored order. English is primary for the approved bilingual mode; preserve saved personal preferences and coherent fallback for unrelated/legacy questions and Thai. Source URLs remain validated text/links with previews disabled, and source content is never interpreted as markup.

## Per-voter group feedback

The installed grammY1.46.0/@grammyjs/types5.0.0 support sendMessage.ephemeral_message_parameters and EphemeralMessageParameters.receiver_user_id/callback_query_id. Official Bot API documents administrator delivery to a current non-bot member and a callback15-second response path. Use those typed APIs; no raw token fetch, dependency upgrade or paid broadcast.

After a durable accepted group vote, send the complete rich explanation to that validated voter as ephemeral messages in the same stored group/topic. Other members receive no explanation broadcast or direct message. Native correctness remains immediate. Ephemeral delivery is not guaranteed or durable and may disappear; an Explain control recovers the stored result after answering. Full correctness/explanation must not be embedded in a pre-answer group spoiler.

Explain is a read-only capability for an already committed vote, bound to the historical BOUND round, the original bot control message, exact group/topic and validated member. Do not require the scope current pointer for historical explanation eligibility. Recheck bot administrator/member access and locate the requesting learner's own committed vote/presentation; another member's vote cannot unlock an unearned explanation. Reject copied/foreign/stale/anonymous/unanswered/retired capabilities without disclosing correctness. Do not reveal explanation through public callback alerts or silently fall back to a groupwide message.

All original group/private transaction, lock order, replay/idempotence, uncertain delivery, migration invalidation and polling/shutdown acknowledgement safeguards remain. Deliver feedback only after commit, outside the precommit fatal-error catch. A feedback send failure cannot roll back credit, repeat accounting or kill polling as an unclaimed vote. Recovery reads never write an answer. Ephemeral responses use message_id0 and must never be bound as durable poll/control IDs.

## Verification and publication

Require strict content/manifest negative tests, all100 exact source matches, conflicting/drift rejection, legacy snapshot compatibility and pre-answer secrecy. Bot tests cover spoiler text/Unicode/long chunks, identical A-D mapping, per-voter ephemeral receiver/topic binding, own-answer-only Explain before/after Next, denial/error recovery and no public/DM fallback; existing accounting/concurrency/shutdown regression gates remain. Publication is a separate exact-release existing-host backup/runtime-only cutover, full20-table/19-migration preservation and independent operational PASS; no test messages or synthetic signed identity.

Sources checked 2026-10-23: https://core.telegram.org/bots/api#sendpoll, https://core.telegram.org/bots/api#inputpolloption, https://core.telegram.org/bots/api#formatting-options, https://core.telegram.org/bots/api#ephemeral-messages-and-commands, https://core.telegram.org/bots/api#ephemeralmessageparameters. No new product/provider/persistence boundary is introduced.
