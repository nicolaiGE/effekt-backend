# Claude in the cloud

Claude Code on the web (claude.ai/code) and Claude Tag (Claude in Slack) run in an
Anthropic-hosted VM: Ubuntu 24.04, about 4 vCPUs, 16 GB RAM and 30 GB disk. The VM starts from a
fresh clone of this repository. Two pieces make it ready to work in this repo within a minute or
two of starting:

| Piece                                                                 | Where                                     | Runs                                   | Does                                                                      |
| --------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------- |
| [`scripts/cloud/setup.sh`](../scripts/cloud/setup.sh)                 | the environment's **Setup script** field  | once; the result is cached for ~7 days | Node 24 + pnpm, Docker images, a warm pnpm store                          |
| [`scripts/cloud/session-start.sh`](../scripts/cloud/session-start.sh) | `.claude/settings.json` SessionStart hook | every session start and resume         | Node 24 on PATH, dockerd, `pnpm install`, the dev stack in the background |

Containers in the hosted VM can pull images but can't install npm packages: the sandbox's proxy
only applies to the VM itself, so a `pnpm install` inside a container fails. Cloud sessions
therefore run only MySQL and the mock login in Docker. The API and the migrate/seed step run from
the plain Node image with the VM's own install mounted ([`compose.cloud.yml`](../compose.cloud.yml),
`pnpm cloud:env:up`, the same approach as CI's `compose.e2e-ci.yml`), and the admin runs on the VM
(`pnpm cloud:admin:dev`).

The hook exits immediately outside the cloud (`CLAUDE_CODE_REMOTE` isn't `true`), so it doesn't
affect local Claude Code sessions. [CLAUDE.md](../CLAUDE.md) tells Claude how to work here.

## The environment (Owner, once)

claude.ai → **Admin settings → Cloud environments** (claude.ai/admin-settings/cloud-environments)
→ **Anthropic-hosted environments → Create**. Environments created here belong to the
organization; the form has no sharing setting.

- **Name:** `effekt-platform`
- **Network access:** **Limited**, with **Allow package managers** checked (npm, GitHub, Docker
  Hub, ghcr.io and so on), and these allowed domains:

  ```
  nodejs.org
  pkg-containers.githubusercontent.com
  *.vercel.app
  gieffektivt.no
  geeffektivt.se
  giveffektivt.dk
  binaries.prisma.sh
  download.cypress.io
  cdn.cypress.io
  *.sanity.io
  fonts.googleapis.com
  fonts.gstatic.com
  ```

  Nothing in production is reachable or needed. Sessions use only the local stack and Sanity's
  `dev` dataset.

- **Environment variables:** none. Every user of the environment can read them, so no secrets
  go here.
- **Setup script:** the contents of [`scripts/cloud/setup.sh`](../scripts/cloud/setup.sh).
  Paste it again whenever that file changes; a change also rebuilds the cache.

On the same page, **Set a default** makes it the environment Claude Code sessions start with,
and **Set for Claude Tag** makes Claude Tag use it. Without that, Claude Tag uses a basic
environment with no setup script.

Created 2026-11-02: `effekt-platform`, Healthy, Limited (7 domains, package managers on), no
environment variables.

## Trying it

At claude.ai/code, pick the `stiftelsen-effekt/effekt-platform` repository and the
`effekt-platform` environment (under **Organization**), then ask for something small and
end-to-end, for example:

> In the admin, add a "Copy KID" button next to the KID on the donation details page. Check it
> in the running admin, add a test, and open a PR with the preview label.

The first session runs the setup script; the session log shows its `[setup +Ns]` timings.
Later sessions start from the cache. If something is off, ask Claude to run
`cat /tmp/dev-env.log`, `node -v`, `docker compose -f compose.dev.yml ps` or `check-tools`.

## Browsers and screenshots

Playwright can't download its browsers in the VM (their CDN isn't on the allowlist), and the
repository's Playwright wants a newer Chromium build than the one the image ships in
`/opt/pw-browsers`. The session hook therefore exports `PW_CHROMIUM_PATH`, the newest
`/opt/pw-browsers/chromium-*/chrome-linux*/chrome`, through `$CLAUDE_ENV_FILE`, and the admin's
Playwright configs launch that executable when the variable is set. It's unset locally and in CI,
where Playwright uses its own browser. Set it yourself to try another build; the hook leaves an
existing value alone.

The admin on :3001 uses dev auth: a fresh browser lands on /login and has to click **Sign in with
dev token** (the token comes from the mock login and lasts for that tab). To see a page:

```bash
pnpm cloud:shot /donors                # signed in, 1440×900, saved to /tmp/shot.png
pnpm cloud:shot "/donors?q=kari" a.png # SHOT_FULL_PAGE=1 for the whole page, ADMIN_URL for another admin
```

[`scripts/cloud/shot.mjs`](../scripts/cloud/shot.mjs) uses the admin's Playwright and works
locally too. The visual screenshot tests have macOS baselines only; skip `--project=visual` here
and run the specs for the area instead (admin-building.md › Which specs for which change).

## Reaching services

What a session can reach outside the repository, and how (CLAUDE.md has the short version).

| Service                         | How                                                                                                                                                                                               | Credential                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| GitHub (code, PRs, Actions)     | git and `gh` through Anthropic's GitHub proxy. REST works (`gh run list`, `gh run view --log-failed`, `gh api …`); GraphQL doesn't, so `gh pr` and `gh issue` fail: use the GitHub tools for PRs. | The proxy swaps in the session user's GitHub token; the Claude GitHub App must have access to this repository.                 |
| Vercel previews, the live sites | Plain HTTPS (`curl`, Playwright). Previews are public.                                                                                                                                            | None. `*.vercel.app` and the three sites are on the allowed domains.                                                           |
| Sanity: published content       | The HTTP API; every dataset is public.                                                                                                                                                            | None                                                                                                                           |
| Sanity: drafts and writes       | The HTTP API, as the Sanity user `claude@gieffektivt.no` (editor), so edits show up as Claude in the history.                                                                                     | A **network secret** on the environment: the proxy adds the token to requests for the project's hosts; it never enters the VM. |
| Vercel build logs               | The Vercel connector, when enabled for the session.                                                                                                                                               | The connector's claude.ai authorization.                                                                                       |

Sanity projects: `vf0df6h3` (NO: `production`, `dev`; also `production-se`, `dev-se`), `9reyurp9`
(geeffektivt.se) and `2k8sn9h2` (giveffektivt.dk). The secret is set up for `vf0df6h3` only.

### Setting up the Sanity secret (Owner, once per project)

1. Get a token for `claude@gieffektivt.no` without touching your own Sanity login:
   `bash scripts/cloud/sanity-token.sh` (needs `pnpm install`). It prints a login link; open it
   in a **private** browser window and log in as `claude@gieffektivt.no`. The script refuses a
   token for any other account, never prints it, and leaves it only on the clipboard.
2. claude.ai → Admin settings → Cloud environments → `effekt-platform` → **Network secrets → Add**:
   type **Bearer** (header `Authorization`, prefix `Bearer`), the token as the value, allowed
   websites `vf0df6h3.api.sanity.io` and `vf0df6h3.apicdn.sanity.io`.
3. Check in a session: a draft query
   (`curl -sG https://vf0df6h3.api.sanity.io/v2025-02-19/data/query/production --data-urlencode 'query=count(*[_id in path("drafts.**")])'`)
   returns a number above 0 only with the token.

Rules for writing (also in CLAUDE.md): anything in `dev`; in `production` only drafts, and
publishing or deleting only when the person asks explicitly, since publishing rebuilds the
live site. Revoke the token by logging `claude@gieffektivt.no` out of all sessions in Sanity.

## Pull requests

`gh` works for REST calls (`gh run …`, `gh api …`) but not `gh pr`/`gh issue`, which use GraphQL
that the GitHub proxy blocks. Claude pushes with git and uses its GitHub tools for the PR itself:

1. At the start of a task that changes code, `git push --dry-run origin HEAD:refs/heads/<branch>`.
   A 403 means the Claude GitHub App can't write to this repository; say so at once.
2. Push the branch and create the PR against `main`.
3. Add the `preview` label in a separate update of the PR (labels are set on the PR as an issue).
4. The preview workflow posts one "Preview environment" comment on the PR and edits it: Status
   **Building**, then **Ready** with the URL after a few minutes (or **Failed** with a link to
   the run). Read the PR's comments until it says Ready and give that URL in the reply. The
   website's Vercel preview is a separate comment.

## When it misbehaves

- **"Node 24 is missing"** at session start: the setup script failed or wasn't saved. Check the
  setup output in the session log.
- **Setup took over ~5 minutes:** then it isn't cached, and every session pays for it. Look at
  the `[setup +Ns]` lines to see which step is slow.
- **Docker doesn't start:** see `/var/log/dockerd.log`. The docs list Docker and
  `docker compose` as supported, but don't say how the daemon is started; both scripts start
  `dockerd` if it isn't running.
- **A domain is blocked:** add it to the allowed domains above, and to this page. Registries often
  redirect downloads to another host: ghcr.io serves image layers from
  `pkg-containers.githubusercontent.com`.
- **Playwright can't find or download a browser:** check `echo $PW_CHROMIUM_PATH` and
  `ls /opt/pw-browsers`. The hook prints "No Chromium in /opt/pw-browsers" when it found none.
- **A container needs npm packages:** it can't install them in the VM. Run that process from
  the VM's install instead, as `compose.cloud.yml` does.
