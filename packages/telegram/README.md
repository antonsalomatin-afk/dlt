# Telegram authentication validator

Server-only Node package; its export is available only under the `node` condition.
Pass raw `Telegram.WebApp.initData`, a server-held bot token, and optional
`{ now: () => integerUnixSeconds, maxAgeSeconds, futureSkewSeconds }` to
`validateInitData`. It returns only validated `id` (exact decimal string),
`first_name`, and optional string `last_name`, `username`, `language_code`.
Unknown user properties are discarded. Never use `initDataUnsafe` as proof.

Per ADR-003, defaults are 300 seconds maximum age and 30 seconds future skew,
with inclusive boundaries. Age must be a positive safe integer; skew and clock
must be nonnegative safe integers. The default clock is the server Unix time.
Authentication failures throw `InvalidInitDataError` with a fixed message.
Invalid server configuration throws a fixed configuration error.

Raw input is capped at 16 KiB UTF-8. Strict query decoding rejects duplicate
decoded keys, invalid percent encoding/UTF-8, malformed pairs and lone Unicode
surrogates. As a stricter parsing safeguard, decoded CR/LF in keys or values,
and equals signs in keys, are rejected to avoid ambiguous check strings.
Unknown signed fields, including `signature`, remain in the HMAC calculation.
User JSON is read only after constant-time digest verification. IDs must be
positive integers no greater than 2^52-1, and first names must be nonblank strings.

The algorithm follows [Telegram's bot-token validation protocol](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
The freshness durations are ThaiDLT policy. This helper does not establish a
session or prevent replay within that window. It has no network, persistence,
environment loading or logging. Tests use synthetic credentials and a pinned
signature independently generated with .NET HMACSHA256.
