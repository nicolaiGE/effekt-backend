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
pnpm dev:env:up        # MySQL with fake data, mock login, API :5050, admin :3001 (dev login)
pnpm web:dev           # website :3000 (cp apps/web/.env.example apps/web/.env.local first)
pnpm -s dev:token      # an API token for curl
pnpm lint && pnpm typecheck && pnpm test         # everything; or api:/web:/admin: test|typecheck
pnpm e2e:fullstack     # website Cypress specs against a real API + DB (docs/e2e.md)
```

All data is generated and fake; nothing local touches Auth0, payment providers or production.
Lint is `pnpm lint` (oxlint) from the repo root; don't run eslint in `apps/admin`. The admin opens
on /login: a fresh browser has to click "Sign in with dev token" (`pnpm cloud:shot` does this).
For admin changes, run the specs for the area you touched (docs/admin-building.md › Which specs).
Leave Playwright's `test-results/`, `playwright-report/` and `blob-report/` alone (gitignored).

## Cloud sessions (claude.ai/code, Claude Tag)

The `effekt-platform` cloud environment (docs/claude-cloud.md) has Node 24, pnpm, Docker and
warm caches. The SessionStart hook runs `pnpm install` and starts the stack in the background:
`pnpm cloud:env:up` (MySQL and the mock login in Docker, the API on :5050 from the VM's install)
and then `pnpm cloud:admin:dev` (admin on :3001). Check `/tmp/dev-env.ready` (logs in
`/tmp/dev-env.log`, `/tmp/admin-dev.log`) before using them, and don't start a second stack. Use
`cloud:env:up` rather than `dev:env:up`: containers here can't install npm packages. Use the
Node 24 on PATH (`node -v`), not /opt/node22. For the website's full-stack e2e use
`E2E_BACKEND_FROM_HOST=1 pnpm e2e:fullstack` (as CI does), for the same reason. Playwright uses
the image's Chromium via `PW_CHROMIUM_PATH` (set by the hook). `pnpm cloud:shot /donors [out.png]`
saves a signed-in screenshot of an admin page (default `/tmp/shot.png`).

Outside the repo (details in docs/claude-cloud.md#reaching-services):

- **GitHub Actions:** `gh run list --branch <branch>`, `gh run view <id> --log-failed`, `gh api`
  (REST) work through Anthropic's GitHub proxy. `gh pr`/`gh issue` don't (GraphQL is blocked); use
  the GitHub tools for PRs, or `gh api repos/stiftelsen-effekt/effekt-platform/issues/<n>/comments`
  to read the preview comment.
- **Websites:** Vercel previews (`*.vercel.app`) and gieffektivt.no / geeffektivt.se /
  giveffektivt.dk are reachable with curl or Playwright: check your change on the preview.
- **Sanity:** projects `vf0df6h3` (NO; datasets `production`, `dev`), `9reyurp9` (SE) and
  `2k8sn9h2` (DK). Datasets are public, so published content can be queried without a token:
  `curl -sG https://vf0df6h3.api.sanity.io/v2025-02-19/data/query/production --data-urlencode 'query=*[_type=="organization"]{name}'`.
  Writes and drafts work where the environment has a Sanity token (added by the proxy; never
  put a token in a command or file).
- **Vercel build logs:** through the Vercel connector when it's enabled for the session.

## Rules

- Only synthetic data. Never add secrets, real personal data or production configuration.
- Don't edit `.github/workflows/`, `scripts/preview/`, `scripts/deploy/`, Cloud Build files or
  migrations of production data unless the request is explicitly about them.
- Database changes are Prisma migrations in `apps/api/prisma/migrations`, plus seed data in
  `apps/api/prisma/devdata` (and `prisma/e2e` when e2e specs need it).
- Website copy and pages mostly live in Sanity, not in code. Read freely. Write to the `dev`
  datasets as needed; in `production`, only create or edit **drafts** (`drafts.` ids) and never
  publish or delete unless the person explicitly asks (publishing rebuilds the live site).
- Verify your change in the running stack (and the browser where there is UI) and run the
  affected package's tests before opening a PR. Add tests for new behaviour.
- **Always finish a code change with a pull request.** You don't need to be asked: the people
  making requests here can't try a change any other way. Push the branch, open one PR per
  request against `main` with a clear title, and add the `preview` label, so the API and admin
  get a preview environment (the website gets a Vercel preview automatically). Open it as a draft
  if you have open questions. Then wait for the preview link in the PR comment and include it
  in your reply. In the cloud `gh pr` fails (GraphQL is blocked): open the PR with the GitHub
  tools, add the label as a separate update, and watch the preview workflow's PR comment go from Building to Ready (a few minutes;
  docs/claude-cloud.md › Pull requests).
- Before changing code, check push access: `git push --dry-run origin HEAD:refs/heads/<branch>`.
  On a 403 (now or later), tell the person right away, keep the work committed, and ask them to
  have Håkon (GitHub admin) give the Claude GitHub App access to this repository.

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
