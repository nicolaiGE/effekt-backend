# effekt-platform

Gi Effektivt's platform in one pnpm workspace. [README.md](README.md) has the overview and
[docs/](docs) has the details; read the relevant doc before changing an area.

| Path           | What                                                                                 |
| -------------- | ------------------------------------------------------------------------------------ |
| `apps/api`     | API: Express + tRPC, payments, agreements, receipts, scheduled jobs. Prisma + MySQL. |
| `apps/admin`   | Internal admin for the ops team (Vite + React). Build rules: docs/admin-building.md. |
| `apps/web`     | Websites (NO/SE/DK) and Min Side. Next.js, content in Sanity, Studio built in.       |
| `packages/api` | `@effekt/api`: the API's tRPC types and shared schemas for the website.              |
| `functions`    | Small Cloud Functions.                                                               |

## Running things

```bash
pnpm install
pnpm dev:env:up        # MySQL with fake data, mock login, API :5050, admin :3001 (signed in)
pnpm web:dev           # website :3000 (cp apps/web/.env.example apps/web/.env.local first)
pnpm -s dev:token      # an API token for curl
pnpm lint && pnpm typecheck && pnpm test         # everything; or api:/web:/admin: test|typecheck
pnpm e2e:fullstack     # website Cypress specs against a real API + DB (docs/e2e.md)
```

All data is generated and fake; nothing local touches Auth0, payment providers or production.

## Cloud sessions (claude.ai/code, Claude Tag)

The `effekt-platform` cloud environment (docs/claude-cloud.md) has Node 24, pnpm, Docker and
warm caches. The SessionStart hook runs `pnpm install` and starts `pnpm dev:env:up` in the
background: check `/tmp/dev-env.ready` (or `tail /tmp/dev-env.log`) before using the API or
admin, and don't start a second stack. Use the Node 24 on PATH (`node -v`), not /opt/node22.

## Rules

- Only synthetic data. Never add secrets, real personal data or production configuration.
- Don't edit `.github/workflows/`, `scripts/preview/`, `scripts/deploy/`, Cloud Build files or
  migrations of production data unless the request is explicitly about them.
- Database changes are Prisma migrations in `apps/api/prisma/migrations`, plus seed data in
  `apps/api/prisma/devdata` (and `prisma/e2e` when e2e specs need it).
- Website copy and pages mostly live in Sanity, not in code. Content changes go through Sanity's
  dev dataset, never production.
- Verify your change in the running stack (and the browser where there is UI) and run the
  affected package's tests before opening a PR. Add tests for new behaviour.
- One pull request per request, against `main`, with a clear title. Add the `preview` label so
  the API and admin get a preview environment; the website gets a Vercel preview automatically.

## Working with non-technical colleagues

Requests often come from people at Gi Effektivt who don't code. Ask a short question when the
request is ambiguous rather than guessing. When you're done, reply in plain language (Norwegian
if they wrote Norwegian): what changed, how to try it (the preview links, where to click, who
to "continue as" in the admin), and anything they need to decide. Leave code details for the PR.

## Data questions

The `effekt-data` MCP connector (Claude Tag only) reads `EffektPseudoDB`, pseudonymised live
production data, and `EffektAnalysisDB` (docs/pseudo-db.md). Answers are read in shared
channels: give aggregates, not rows about individual donors. Many donors without an e-mail
have a placeholder `@gieffektivt.no` address; account for that in e-mail-domain questions.
