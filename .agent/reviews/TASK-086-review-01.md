# TASK-086 Review 01

## Verdict

`VERDICT: PASS`

## Scope reviewed

- Task: `.agent/tasks/TASK-086.yaml`; repository AGENTS.md, PROJECT, ARCHITECTURE, WORKFLOW, DEFINITION_OF_DONE and current STATE.
- Commit(s): accepted TASK-085 baseline `d54f2d6` through implementation `fee3b5694fa8adb2fe8d4262f454c68fefc0625b`; review checkout `c7b3435`. All eight implementation/test/README files were inspected, with surrounding snapshot, private/group transaction, dispatch, error and shutdown code/tests. Subsequent commits change only task/state/check evidence, not feature source.
- Relevant ADR(s): ADR-009 bilingual teaching/personal explanations, ADR-007 native private practice and ADR-008 shared group practice as superseded by TASK-082.
- Checks supplied: Supervisor `.agent/checks/TASK-086-checks-01.txt`: lint, typecheck, 377 unit tests in 64 files, local database readiness, 242 integration tests in 45 files, build and diff check all PASS. Its candidate `12306b1` contains the same reviewed implementation as `fee3b569`. Builder diagnosis, earlier failures and corrected green checks remain in `.agent/checks/TASK-086-builder-01.txt`; they were not substituted for the authoritative gates.
- Independent bounded verification: `pnpm exec vitest run tests/chat-quiz-format.test.ts tests/chat-quiz.test.ts tests/group-chat-quiz.test.ts --maxWorkers=2` passed all 27 tests in 3 files; `git diff --check` passed. Inspected installed grammY/@grammyjs types for message entities and ephemeral recipient parameters. No production, real Telegram, external content or deployment operation was performed.

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| Complete English cards and individual Russian spoilers before native immutable A-D quiz; preferences and legacy fallback preserved | PASS | Teaching mode explicitly selects English and preceding rich question/choice cards. Native key/index mapping follows stored choices; all no-revote/no-shuffle/no-extra-option restrictions remain. Legacy language selection and validated optional image path remain intact. The all100 formatter test checks all400 Russian choices and all three saved-language inputs. |
| Typed entities, complete bounded Unicode text and no pre-answer disclosure | PASS | Composer uses plain text and explicit spoiler/expandable-blockquote entities, with no HTML parse mode. Chunking preserves concatenated text, rebases intersecting entities and avoids splitting UTF-16 surrogate pairs at its4000-unit boundary. Pre-answer card reads question/options only; no explanation, safety/distractor guidance or source note enters it. Link previews are disabled. Long Unicode and literal markup coverage exercises entity/text preservation. |
| Full private teaching feedback, actual guidance/statute fields and recovery | PASS | Post-answer renderer includes result, immutable correct answer, explanations/traps, actual distractor and safety reasoning, DLT guidance and optional accepted statutory fields with unofficial-English label. Russian counterparts have spoilers and explanation content has an expandable block. No statute is fabricated when absent. Last chunk retains Next. Integration coverage proves committed feedback recovery through /quiz after delivery failure, preference preservation and subsequent Next. Legacy full feedback remains covered. |
| Personal group explanation only after committed vote in original group/topic | PASS | Successful answer transaction precedes the separate feedback read/send. Every feedback chunk uses stored group/topic, protect_content and typed ephemeral_message_parameters.receiver_user_id for the validated voter. No public or direct-message fallback exists. Ephemeral send responses are ignored and never passed to poll/control binders; transport tests return message_id0 and verify durable control identity is unchanged. |
| Explain is bound, own-answer-only, historical and read-only | PASS | Callback validates real actor, original bot sender, unforwarded group/topic origin and exact control message ID. Membership and bot administrator checks precede lookup. Database lookup requires exact round/scope/control, BOUND state, active VERIFIED question and that Telegram learner's own vote with committed answer; it parses the owned immutable presentation without writes. It intentionally does not require the current pointer, allowing recovery after Next. Tests reject unanswered/other-member/copied/foreign-topic/foreign-chat/foreign-bot/anonymous/nonmember/retired/migrated cases and confirm no vote/answer/User creation on recovery. |
| Accounting, failure isolation, replay, migration and shutdown safeguards preserved | PASS | Original atomic vote/presentation/attempt/counter transaction and lock order are unchanged. Binding/membership/accounting failures retain pre-acknowledgement sentinel handling. Postcommit feedback read/transport failures are caught outside that fatal boundary, leaving credit committed and Explain available. Existing rollback, changed-vote replay, concurrency, historical late votes, migration, dispatch and SIGTERM/SIGINT acknowledgement tests remain, alongside new send/read-failure coverage. Legacy f/n/r actions retain their existing behavior. |
| Meaningful tests and approved source boundary | PASS | New all100 layout checks plus private/group integration tests exercise both positive delivery and authorization/error recovery; prior accounting/shutdown regressions were inspected. Authoritative full suites pass. TASK-084 content review and TASK-085 loader are accepted prerequisites; this review verifies their delivery integration without reopening content/legal acceptance. |
| Required gates, scoped source changes and separate publication | PASS | Implementation commit changes only eight allowed files. No schema, content, source bank, historical data, dependency, provider or authentication boundary is changed. README documents delivery/recovery limits and separate TASK-087 publication. Supervisor task/state/evidence changes are distinguishable from Builder source. The three original untracked starter files remain untouched. |

## Findings

### Blockers

None.

### Important

None.

### Minor

None.

## Security review

- PASS. Group identity comes from validated Telegram updates and current membership; recipient, round, topic, original bot control and owned committed vote are checked before explanation recovery. Source text stays literal, source links retain disabled previews, and pre-answer cards disclose no teaching/correctness. No token exposure, unsafe TypeScript bypass, raw API transport or new authentication path was introduced.
- Group feedback is ephemeral best effort. Its failure neither publishes an answer to other members nor poisons the committed vote acknowledgement. Read-only recovery cannot create practice credit.

## Test review

- Coverage adequate for this task. The reviewer independently inspected assertions and negative cases and reran27 focused unit tests; supplied independent full gates cover377 unit and242 isolated PostgreSQL integration tests plus lint/types/build.
- Missing scenarios: none blocking source acceptance. Actual client rendering and ephemeral receipt were not exercised against Telegram; those remain transport limitations/publication observations, not evidence of guaranteed delivery. No real messages or synthetic authenticated identities were used.

## Architecture review

- Compliant with ADR-009 and the private/group safeguards in ADR-007/008. Reuses accepted immutable teaching snapshots and practice accounting with a small read-only group recovery helper. Telegram sends remain outside transactions; no migration, new persistence system, external provider or production change is included.

## Final reviewer statement

`VERDICT: PASS`. TASK-086 source acceptance criteria are satisfied with no unresolved blockers. This verdict covers the reviewed source and supplied local gates; Supervisor acceptance/state recording and separate TASK-087 production publication remain their respective gates.
