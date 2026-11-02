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
- **A container needs npm packages:** it can't install them in the VM. Run that process from
  the VM's install instead, as `compose.cloud.yml` does.
