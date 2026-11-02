#!/usr/bin/env bash
# SessionStart hook (.claude/settings.json): prepares a Claude Code cloud session (claude.ai/code,
# Claude Tag). Does nothing on a local machine. The heavy lifting (Node 24, pnpm store, Docker
# images) is cached by scripts/cloud/setup.sh; this does the per-session part:
#   1. Node 24 on PATH for Claude's shells
#   2. dockerd running
#   3. pnpm install (offline-fast from the warm store)
#   4. the dev stack (MySQL with fake data, mock login, API :5050, admin :3001) starting in the
#      background; progress in /tmp/dev-env.log, done when /tmp/dev-env.ready exists
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

if ! docker info >/dev/null 2>&1; then
  (dockerd >/var/log/dockerd.log 2>&1 &)
  for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 1; done
fi

pnpm install --frozen-lockfile --prefer-offline --reporter=silent ||
  echo "pnpm install failed; run it again before building or testing." >&2

rm -f /tmp/dev-env.ready
if docker info >/dev/null 2>&1; then
  nohup bash -c 'pnpm dev:env:up >/tmp/dev-env.log 2>&1 && touch /tmp/dev-env.ready' >/dev/null 2>&1 &
  echo "Dev stack starting in the background (log: /tmp/dev-env.log; ready when /tmp/dev-env.ready exists)."
else
  echo "Docker is not available; the dev stack was not started (see /var/log/dockerd.log)." >&2
fi
exit 0
