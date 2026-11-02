#!/usr/bin/env bash
# Setup script for the Anthropic-hosted cloud environment "effekt-platform"
# (claude.ai → Admin settings → Cloud environments). Paste this file's contents into the
# environment's Setup script field; keep the two in sync. See docs/claude-cloud.md.
#
# Runs as root on Ubuntu 24.04 before Claude starts. The result is snapshotted and reused by
# later sessions (files and installed packages, not running processes) until this script or
# the allowed domains change, or after ~7 days. It must finish in ~5 minutes to be cached,
# so everything slow and repo-independent happens here, in parallel:
#   - Node 24 + pnpm (the image only has Node 20-22)
#   - the Docker images the dev stack uses
#   - every npm package in pnpm-lock.yaml (pnpm fetch, from a throwaway clone of main)
#   - the API dev image (effekt-backend-dev:local), so `pnpm dev:env:up` only starts containers
# Per-session work (PATH, dockerd, pnpm install, starting the stack) is scripts/cloud/session-start.sh.
set -euo pipefail

NODE_VERSION=24.22.1
PNPM_VERSION=12.15.0
REPO=https://github.com/stiftelsen-effekt/effekt-platform
WARM=/opt/effekt-warm
start=$(date +%s)
t() { echo "[setup +$(($(date +%s) - start))s] $*"; }

# --- Node 24 + pnpm ---------------------------------------------------------------------------
if [ ! -x /opt/node24/bin/node ]; then
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz" | tar -xz -C /opt
  rm -rf /opt/node24 && mv "/opt/node-v${NODE_VERSION}-linux-x64" /opt/node24
fi
export PATH=/opt/node24/bin:$PATH
npm install -g --silent "pnpm@${PNPM_VERSION}"
# For shells that don't get the session hook's PATH.
ln -sf /opt/node24/bin/node /opt/node24/bin/npm /opt/node24/bin/npx /opt/node24/bin/pnpm /usr/local/bin/
t "node $(node -v), pnpm $(pnpm -v)"

# --- Docker -----------------------------------------------------------------------------------
if ! docker info >/dev/null 2>&1; then
  (dockerd >/var/log/dockerd.log 2>&1 &)
  for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 1; done
fi
docker info >/dev/null 2>&1 || { echo "dockerd did not start; see /var/log/dockerd.log" >&2; exit 1; }
t "docker $(docker version --format '{{.Server.Version}}')"

# --- In parallel: images, npm packages, API dev image ------------------------------------------
pull_images() {
  for image in mysql:8.4.11 ghcr.io/navikt/mock-oauth2-server:6.0.4 node:24.22.1 nginx:1.29.3-alpine; do
    docker pull -q "$image" >/dev/null
  done
  t "images pulled"
}

warm_repo() {
  rm -rf "$WARM"
  git clone -q --depth 1 "$REPO" "$WARM"
  cd "$WARM"
  pnpm fetch --silent # fills the pnpm store from the lockfile; sessions then install offline-fast
  t "pnpm store warm"
}

pull_images &
pull_pid=$!
warm_repo &
warm_pid=$!
wait "$warm_pid"
# The dev image only needs node:24.22.1 and the package files; build it once the clone exists.
(cd "$WARM" && docker compose -f compose.dev.yml build -q migrate) &
build_pid=$!
wait "$pull_pid"
wait "$build_pid"
t "API dev image built"

rm -rf "$WARM" # the pnpm store and the Docker images stay
t "done"
