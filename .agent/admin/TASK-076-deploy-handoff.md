# TASK-076 compact Mini App rollout

Code release gate: initial implementation `e0bb5c8a94bf6ff9ffb780105c67f913d05adfc2` plus correction `726550f507bd664ec4e752b0917b9a3f959c2683` accepted after Supervisor checks02 and independent review02 PASS. Exact immutable tag `thaidlt-compact-20261021` is selected at the Supervisor code-acceptance metadata commit; no later code changes are included. Whole-task acceptance remains pending rollout and independent operational validation. The owner approved the real compact design and its publication under the existing-host deployment scope in OWNER_DECISIONS.md. Do not ask for that approval again. Native in-chat quiz practice remains separate TASK-077.

## Release boundary

Only six web application files and browser tests change. Preserve all API/bot/database/content/dependency source, protected environment files, signed Telegram auth, saved user preferences/history and the enabled private EN/RU scheduler. No migrations, seeds, content overlay or forced messages are required. Current accepted runtime is `b38618f13765ec41ac51421327c1cbbfa347f245`; keep it for rollback.

After code PASS, Supervisor records acceptance of the bounded code release component and creates `thaidlt-compact-20261021`, then provides its exact resolved SHA to Admin. No unreviewed code may enter the production archive.

## Execution after release selection

1. Use existing strict known-host SSH alias `ovh` and QEMU guest100. Confirm current symlink, units/users/ports, available storage and absence of another deployment. Do not expose environment or credentials.
2. Create an exact Git archive of the selected release, transfer with SHA256 verification on host and guest, and extract into a new `/srv/thaidlt/releases/<fullSHA>` directory. Preserve current release and its dependencies. Git on this Windows workspace may apply CRLF conversion: prove all regular archive entries agree with a pinned `git -c core.autocrlf=false archive` after CRLF-only normalization; bind remote raw source hashes to the exact transferred archive.
3. Compare backend/bot/schema/migration/dependency source with the current accepted runtime. Stop on unexpected drift; do not migrate or change the database. Install with pinned pnpm11.19.0, frozen lockfile and `--prod=false` under User/Group `thaidlt`; run mandatory `pnpm db:generate`, then production `pnpm build` using the existing application EnvironmentFile and Node24.
4. Require a fresh successful existing `thaidlt-dbdump.service` backup before cutover. No content or preference writes occur in this rollout.
5. Switch the shared current symlink atomically to the built verified release and restart the established web/API/single bot services so their release identity remains consistent. Keep root-only files and the bot-only dedicated rollout configuration, including `DAILY_QUESTION_POSTS_ENABLED=true`, public username and unset short name.
6. Verify exact symlink/source identity, three active services, one healthy polling bot, effective allowlisted bot settings and Main Mini App readiness. Web200, protected API and same-origin web presentation POST401/no-store, unknown public API404. Verify returned public HTML has the new compact shell and lacks the old marketing headline. Read-only overlay check may verify100 matched; never reapply content for this UI rollout.
7. Report safe release/archive/build/backup/config/service/HTTP evidence and any failures in `.agent/admin/TASK-076-production-report.md` and `.agent/checks/TASK-076-admin-01.txt`. Root independently verifies live state, then an operational Reviewer inspects before whole-task acceptance/main integration.

## Evidence limits and rollback

Local browser screenshots use the isolated mocked auth harness, not an owner's real Telegram identity. Real-owner practice/exam and actual scheduled-message observations remain TASK-072/manual follow-up. A user must reopen the Mini App to load the new production client. Reminder opt-in is explicit and must not be enabled automatically.

For failed cutover, retain records and diagnose; restore the previous runtime symlink and restart established services if necessary. Do not reverse the reviewed Russian content, delete learner data, weaken auth or restore the database as part of a web rollback. Existing enriched-image snapshot compatibility caveat still applies.
