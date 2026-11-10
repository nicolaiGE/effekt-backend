#!/usr/bin/env bash
# SessionStart hook (.claude/settings.json): prepares a Claude Code cloud session (claude.ai/code,
# Claude Tag). Does nothing on a local machine. The heavy lifting (Node 24, pnpm store, Docker
# images) is cached by scripts/cloud/setup.sh; this does the per-session part:
#   1. Node 24 on PATH for Claude's shells, and PW_CHROMIUM_PATH (the image's Chromium)
#   2. dockerd running
#   3. pnpm install (offline-fast from the warm store)
#   4. the dev stack starting in the background: MySQL with fake data and the mock login in
#      Docker, the API from the VM's install (compose.cloud.yml, `pnpm cloud:env:up`), then the
#      admin on the VM (`pnpm cloud:admin:dev`). Progress in /tmp/dev-env.log and
#      /tmp/admin-dev.log; done when /tmp/dev-env.ready exists
# See docs/claude-cloud.md.
set -uo pipefail

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0

if [ -x /opt/node24/bin/node ]; then
  export PATH=/opt/node24/bin:$PATH
  # shellcheck disable=SC2016 # literal $PATH, expanded when Claude's shells source the file
  [ -n "${CLAUDE_ENV_FILE:-}" ] && echo 'export PATH=/opt/node24/bin:$PATH' >>"$CLAUDE_ENV_FILE"
else
  echo "Node 24 is missing: the environment's setup script didn't run (docs/claude-cloud.md)." >&2
fi

# Playwright can't download its browser here (the CDN isn't allowed), but the image ships some in
# /opt/pw-browsers. The admin's Playwright configs and `pnpm cloud:shot` use PW_CHROMIUM_PATH.
if [ -z "${PW_CHROMIUM_PATH:-}" ]; then
  chromium=$(compgen -G '/opt/pw-browsers/chromium-*/chrome-linux*/chrome' | sort -V | tail -n 1)
  if [ -n "$chromium" ] && [ -x "$chromium" ]; then
    [ -n "${CLAUDE_ENV_FILE:-}" ] && echo "export PW_CHROMIUM_PATH=$chromium" >>"$CLAUDE_ENV_FILE"
  else
    echo "No Chromium in /opt/pw-browsers; Playwright needs its own browser (docs/claude-cloud.md)." >&2
  fi
fi

# Runs a command as root: directly, or with passwordless sudo if the session isn't root.
as_root() {
  if [ "$(id -u)" = 0 ]; then "$@"; elif sudo -n true 2>/dev/null; then sudo -n "$@"; else return 1; fi
}

start_docker() {
  docker info >/dev/null 2>&1 && return 0
  # Pid files left by the snapshot (or an earlier session) make dockerd refuse to start.
  if ! pgrep -x dockerd >/dev/null; then
    as_root rm -f /var/run/docker.pid /var/run/docker/containerd/containerd.pid
  fi
  as_root sh -c 'dockerd >/var/log/dockerd.log 2>&1 &' || return 1
  for _ in $(seq 1 60); do
    if docker info >/dev/null 2>&1; then return 0; fi
    # A non-root session may need access to the socket
    [ -S /var/run/docker.sock ] && as_root chmod 666 /var/run/docker.sock 2>/dev/null
    sleep 1
  done
  return 1
}

if ! start_docker; then
  echo "Docker didn't start (session user: $(id -un)). Last lines of /var/log/dockerd.log:"
  tail -n 15 /var/log/dockerd.log 2>/dev/null || echo "(no log)"
fi

pnpm install --frozen-lockfile --prefer-offline --reporter=silent ||
  echo "pnpm install failed; run it again before building or testing." >&2

rm -f /tmp/dev-env.ready
if docker info >/dev/null 2>&1; then
  # shellcheck disable=SC2016 # the inner script expands its own variables
  nohup bash -c '
    pnpm cloud:env:up >/tmp/dev-env.log 2>&1 || exit 1
    nohup pnpm cloud:admin:dev >/tmp/admin-dev.log 2>&1 &
    for _ in $(seq 1 90); do curl -fs http://localhost:3001/ >/dev/null && break; sleep 2; done
    touch /tmp/dev-env.ready
  ' >/dev/null 2>&1 &
  echo "Dev stack starting in the background (log: /tmp/dev-env.log; ready when /tmp/dev-env.ready exists)."
else
  echo "Docker is not available, so the dev stack was not started. Try starting dockerd as above and then run the stack yourself (docs/claude-cloud.md); tell the person if it can't be fixed." >&2
fi
exit 0
