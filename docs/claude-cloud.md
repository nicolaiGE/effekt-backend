# Claude in the cloud

Claude Code on the web (claude.ai/code) and Claude Tag (Claude in Slack) run in an
Anthropic-hosted VM: Ubuntu 24.04, about 4 vCPUs, 16 GB RAM and 30 GB disk. The VM starts from a
fresh clone of this repository. Two pieces make it ready to work in this repo within a minute or
two of starting:

| Piece                                                                 | Where                                     | Runs                                   | Does                                                                          |
| --------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------- |
| [`scripts/cloud/setup.sh`](../scripts/cloud/setup.sh)                 | the environment's **Setup script** field  | once; the result is cached for ~7 days | Node 24 + pnpm, Docker images, a warm pnpm store, the API dev image           |
| [`scripts/cloud/session-start.sh`](../scripts/cloud/session-start.sh) | `.claude/settings.json` SessionStart hook | every session start and resume         | Node 24 on PATH, dockerd, `pnpm install`, `pnpm dev:env:up` in the background |

The hook exits immediately outside the cloud (`CLAUDE_CODE_REMOTE` isn't `true`), so it doesn't
affect local Claude Code sessions. [CLAUDE.md](../CLAUDE.md) tells Claude how to work here.

## The environment (Owner, once)

claude.ai → **Admin settings → Cloud environments → Anthropic-hosted → Create**:

- **Name:** `effekt-platform`
- **Who can use it:** the organization. Claude Tag can only use organization-shared environments.
- **Network access:** **Custom**, with **Also include default list of common package managers**
  checked (npm, GitHub, Docker Hub, ghcr.io and so on), plus:

  ```
  nodejs.org
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

Optionally make it the organization default under Admin settings → Claude Code.

## Trying it

At claude.ai/code, pick the `stiftelsen-effekt/effekt-platform` repository and the
`effekt-platform` environment (under **Organization**), then ask for something small and
end-to-end, for example:

> In the admin, add a "Copy KID" button next to the KID on the donation details page. Check it
> in the running admin, add a test, and open a PR with the preview label.

The first session runs the setup script; the session log shows its `[setup +Ns]` timings.
Later sessions start from the cache. If something is off, ask Claude to run
`cat /tmp/dev-env.log`, `node -v`, `docker compose -f compose.dev.yml ps` or `check-tools`.

## When it misbehaves

- **"Node 24 is missing"** at session start: the setup script failed or wasn't saved. Check the
  setup output in the session log.
- **Setup took over ~5 minutes:** then it isn't cached, and every session pays for it. Look at
  the `[setup +Ns]` lines to see which step is slow.
- **Docker doesn't start:** see `/var/log/dockerd.log`. The docs list Docker and
  `docker compose` as supported, but don't say how the daemon is started; both scripts start
  `dockerd` if it isn't running.
- **A domain is blocked:** add it to the allowed domains above, and to this page.
