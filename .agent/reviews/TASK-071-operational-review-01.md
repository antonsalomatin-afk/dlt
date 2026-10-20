# TASK-071 Operational Review 01

## Verdict

`VERDICT: PASS`

This final review covers TASK-071 production preparation, its approved content scope amendments, and the actual starter-bank publication. It does not claim that an owner has completed a post-publication practice/exam journey or received a scheduled notification.

## Scope reviewed

- Task: `.agent/tasks/TASK-071.yaml`, including original operational criteria, source intake, original candidates and approved release criteria. Mandatory repository instructions, project, architecture, workflow, definition of done, state and relevant prior reviews were read across the release and operational reviews.
- Commit(s): operational report/transcript at `de7a8cc`, supplemented by root-only secret-permission evidence at `9df8c3076667aeac32c1eaff8483dd8e0ba5d9e1`; production content artifact `037ac0cbc07d8c2c8686e7dd77fcef2f36281281`; unchanged production runtime `1d7eaa0671889ec82edc1b5cf149b4e7c495ffe3`. Earlier bounded review covers manifests/check scripts at `d418f2cd228c2222d9d9d6dae525e69439cfca06`, final candidates at `65d1c1ade2c48fc4e82388db85da93faf7eee9d8`, and the publication plan.
- Relevant ADR(s): ADR-001, ADR-002, ADR-005 and ADR-006. The deployed authentication design is unchanged.
- Checks supplied: `.agent/checks/TASK-071-production-release-01.txt`, `.agent/checks/TASK-071-release-checks-01.txt`, earlier deployment/intake/final-candidate check records and corresponding independent reviews. Earlier non-independent review 01 is explicitly retracted and is not acceptance evidence.
- Independent reviewer work: inspected the report and production transcript, actual stage/status/replay results and backup/restore evidence; read bot entry point, lifecycle and scheduler implementation against ADR-006; retained the prior independently rerun exact release validator and runtime/source comparisons. Independently resolved both DNS A records to `139.99.8.128`. An optional direct reviewer Node-fetch HTTPS request timed out locally after eight seconds, so I do not claim reviewer-reproduced HTTP success; the supplied fresh Supervisor HTTP/TLS observations are the authoritative evidence inspected. `git diff --check` passed. No production writes, environment-file reads, user messages, polling calls or learner-data reads were performed by this reviewer.

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| Intended DNS and valid HTTPS for both hosts | PASS | Independent reviewer DNS matches intended address. Supplied trusted TLS checks and certificate expiry evidence support both hosts; HTTP-to-HTTPS redirects and post-publication HTTPS checks are recorded. |
| Deployed web and correct web/API configuration | PASS | Existing release and symlink are unchanged; web responds 200. Report identifies approved production origins and server environment injection. Web unit is active/running as the dedicated unprivileged user. No content publication step replaced the runtime or build. |
| Safe API exposure, binding and secrets | PASS | Loopback 3061 and intended nginx route boundary documented; HTTPS `/me` returns 401/no-store, unknown API path 404. EnvironmentFile references and root-owned 0600 permissions are observed without contents. No token or database URL appears in supplied report/transcript. |
| Bot polling/scheduler lifecycle supervised with shared production configuration | PASS | Bot unit active/running under Node24 and User=thaidlt, Restart=always; same configured server secret injection used by successful read-only getMe. No webhook is configured. Accepted entry point creates the scheduler and runBot starts it after Telegram initialization, with shutdown coupled to polling. Fixed scheduler/startup failure audit is zero after restart. No extra local polling instance was launched. |
| Private PostgreSQL, migrations and backups | PASS | Container port is bound only to 127.0.0.1:5434. Seventeen completed migrations match the Admin's migrate-deploy evidence; no schema changes are introduced by this release. Daily database backup timer and VM backup configuration documented. Fresh pre-publication backup succeeds, and that exact dump is independently restored into an isolated owned database and checked before test cleanup. |
| Logs, restart/health checks, restore evidence and safe rollback documented | PASS | Dedicated service identity, active states, restart policy, fixed safe error audit, HTTP/Telegram diagnostics, backup metadata/restore results and data-aware recovery instructions are recorded. Restoring learner data is not an automatic rollback. Corrected workspace/Node diagnostic failure is disclosed rather than hidden. |
| Complete secret-free production report | PASS | Report identifies host/VM and existing provider context, DNS/TLS, service and migration results, exact artifact/hash, backup policy/evidence, publication stages, recovery and remaining human-testing limitations. Original Admin assertions are distinguished from freshly collected Supervisor observations. |
| Reference intake and original-candidate amendments | PASS | Prior independent source/content reviews establish pinned offline source intake, original wording, traceable primary evidence, correct applicability/concepts, English-only fields and safe content boundaries. Final candidate bridge preserves substantive facts and keys. No official-bank/completeness/readiness claim is made. |
| Authorized, independently reviewed and hash-verified publication | PASS | Owner approval predates release; bounded independent release PASS and recorded acceptance precede writes. Hash-verified 16-file content bundle uses unchanged accepted runtime/tools. Fresh successful backup precedes additive taxonomy and stage-separated inactive import, review and activation. |
| Exact final published status per vehicle | PASS | Both production batches report total 50 / exact 50 / verifiedActive 50; missing, drifted and all other lifecycle counts are zero. Node24 activation replay reports 0 applied / 50 matched per vehicle and preserves those exact statuses. |
| Required automated checks | PASS | Authoritative deployment checks include install/generate, lint/typecheck/tests, build and Prisma validation. Latest release checks pass lint/typecheck and all 323 tests; actual-file disposable PostgreSQL rehearsal verifies lifecycle replay/status, preservation, conflict rollback, both real API 50-distinct-question exam constructions, hidden correctness and cleanup. No runtime changes followed those checks. |

## Findings

### Blockers

None against the task's defined acceptance criteria.

### Important

None requiring correction before operational acceptance.

### Minor

None requiring implementation changes. Retain these explicit validation limitations in the acceptance/handoff:

- Owner reported real signed Mini App login on 2026-10-16. A new owner practice/exam journey through Telegram after publication is unobserved; local actual-manifest real API exam construction is different evidence. Human launch testing remains appropriate as a separate follow-up and must not be marked passed by this review.
- No genuine scheduled Telegram notification was observed. Zero opt-in recipients and empty delivery ledgers are consistent, so empty ledgers are not evidence of scheduler failure or delivery success. Service supervision, accepted lifecycle code and zero fixed scheduler failure messages support the task's startup/scheduler health check, but do not certify delivery to a real recipient. Such delivery would require a consenting eligible user and the scheduled boundary.

These are limits of end-user acceptance testing, not missing original host-preparation or approved-publication criteria; requiring fabricated production identities or unsolicited messages to close them would exceed this task.

## Security review

- PASS. Private service/database listeners, unprivileged service account, root-only secret files, separate server-side secret injection and explicit public API boundaries are evidenced. Publication preserves the accepted runtime/authentication model. No fabricated production identity, forced notification, destructive restore or unrelated learner-data mutation is claimed or required. The pre-publication backup's empty question count is correctly distinguished from the now-published bank.

## Test review

- Coverage/evidence adequate for TASK-071 acceptance. Independent bounded reviews, authoritative automated checks, real-file isolated rehearsal and actual production lifecycle/status/health/restore observations collectively cover the defined criteria.
- Missing scenarios: post-publication human Telegram practice/exam journey and real scheduled delivery remain unobserved, as documented above. They are not silently converted to PASS and are not required as additional criteria for this operational task.

## Architecture review

- Compliant. The approved production topology and bot-owned scheduler preserve the accepted architecture. Content-only execution changes no deployment boundary, persistence system, paid dependency or authentication design. Supervisor must still record task acceptance and accepted commit before updating main or starting the next task.

## Final reviewer statement

`VERDICT: PASS` for TASK-071 at the reviewed operational evidence revision `9df8c3076667aeac32c1eaff8483dd8e0ba5d9e1`, incorporating previously independently reviewed implementation/content/release components and actual publication evidence. No task acceptance blocker remains. The Supervisor may accept TASK-071 and record its accepted commit/state; genuine owner journey testing and actual notification delivery retain their explicitly unobserved status.
