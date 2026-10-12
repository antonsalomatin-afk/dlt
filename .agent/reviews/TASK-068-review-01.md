# TASK-068 Review 01

## Verdict

`VERDICT: PASS`

## Scope reviewed

- Task: `TASK-068` — Open the daily question from Telegram deep links
- Commit(s): `8e909084eefe81d1208f2ea703b3166a64836149` and surrounding accepted bot/web code
- Relevant ADR(s): `ADR-006-daily-reminder-scheduler.md` (server-only Telegram/bot boundary remains applicable)
- Checks supplied: `.agent/checks/TASK-068-checks-01.txt` (`pnpm check`, `pnpm build`, and `pnpm test:e2e` all passed)
- Focused checks independently run: `pnpm exec vitest run tests/web-deep-link.test.ts tests/bot.test.ts tests/telegram.test.ts` (3 files, 85 tests passed)

## Acceptance criteria

| Criterion | Result | Notes |
|---|---|---|
| Private `/start` preserves the existing Mini App launch and supports a validated daily destination | PASS | The existing HTTPS `web_app` button is always present. Exact `daily` matching adds a separate `https://t.me/<bot>?startapp=daily` URL button; unknown, oversized or malformed matches receive only the existing launch button. Group behavior is unchanged. |
| The Mini App reads only Telegram-provided start data, validates the allowlisted daily destination, and routes an authenticated learner with a saved vehicle to daily | PASS | `loadTelegram` derives the parameter only from raw `WebApp.initData` through one bounded `start_param` parser. The explicit one-value `daily` allowlist is the only accepted destination, and page routing occurs only after the `/auth/telegram` response is parsed and the saved vehicle is present. |
| A valid deep link does not bypass authentication, vehicle selection or server-side daily authorization | PASS | The deep-link value is navigation intent only. Authentication still requires nonempty raw initData and the existing API session; routing remains on setup when `selectedVehicleType` is absent; `Daily` still calls the authenticated `/practice/daily` endpoint, which owns authorization and vehicle checks. |
| Unknown, malformed, oversized, unsupported or browser-query parameters safely fall back without changing API authorization, persisted state or browser storage | PASS | Parser rejects duplicate values, unknown values, `tgWebAppStartParam`, NUL content and oversized input. Page code ignores URL query parameters entirely. No persistence or browser storage writes were introduced; invalid intent leaves the normal setup view. |
| Bot-generated links and Telegram startapp links use the configured HTTPS Mini App/bot configuration without credential leakage or unsigned identity trust | PASS | The normal button uses validated `config.miniAppUrl`; the startapp URL uses the validated bot username and fixed allowlisted parameter. The Mini App sends the raw signed initData to the existing server authentication endpoint and never treats start data as identity or authorization. No token or database secret is exposed. |
| Existing `/start`, reminders, ordinary practice, daily practice, exam flows and authentication contracts remain unchanged without a valid parameter | PASS | The change is additive to the bot command and page authentication path. Existing launch button, reminder buttons, practice/daily/exam views and API auth contract remain intact; full unit/build/E2E checks pass. |
| Unit, browser and bot tests cover routing, fallback, gating, link construction, security boundaries and regressions | PASS | Bot tests assert exact daily link and invalid fallback; browser tests cover valid routing, vehicle-less fallback and browser-query/unknown fallback; parser tests cover duplicate, unsupported, malformed and oversized values; authoritative E2E suite reports 216 passed. |

## Findings

### Blockers

None.

### Important

None.

### Minor

None.

## Security review

PASS. Deep-link data is treated strictly as bounded navigation intent. Authentication continues through the existing signed Telegram initData server validation, no `initDataUnsafe` or browser query is trusted, and no secret configuration is included in URLs or logs.

## Test review

- coverage adequate
- independently reran parser, bot, and Telegram authentication focused tests; all passed
- authoritative `pnpm check`, `pnpm build`, and `pnpm test:e2e` results passed

## Architecture review

Compliant. The implementation stays in the existing bot and Mini App boundaries, adds no persistence system, dependency, credential or deployment integration, and keeps daily-question authorization in the API.

## Final reviewer statement

The implementation adds a bounded `/start daily` bot link and Telegram `start_param` handling while retaining the existing launch path. It routes only after the existing server authentication response confirms a saved vehicle, safely ignores invalid/browser parameters, preserves existing flows, and is covered by passing unit, build and browser checks.

`VERDICT: PASS`
