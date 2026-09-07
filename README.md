# ThaiDLT

A Telegram-first driving-theory learning product. Product scope and engineering
workflow are recorded in `.agent/`; read `AGENTS.md` before contributing.

## Developer setup

Install Node.js 24 LTS and pnpm 11.19.0 (the version pinned in `package.json`).
If pnpm is not installed, run `npm install --global pnpm@11.19.0`.

From the repository root:

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test
```

Use `pnpm install --frozen-lockfile` for reproducible installs in automated checks.
No database, credentials, or external services are needed for this foundation.

The root currently runs ESLint, a strict TypeScript check of the repository tests,
and a Vitest sanity test. Workspace packages will live in `apps/*` and
`packages/*` as their tasks require them; no application is implemented yet.
New TypeScript packages should extend `tsconfig.base.json` and connect their
checks to the root scripts when introduced.
