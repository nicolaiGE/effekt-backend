#!/usr/bin/env bash
# Puts a Sanity token for the Claude user on the clipboard, for the cloud environment's network
# secret (docs/claude-cloud.md#setting-up-the-sanity-secret). Run on a Mac, from the repo root:
#
#   bash scripts/cloud/sanity-token.sh [provider]      provider: sanity (default, e-mail +
#                                                        password), google or github
#
# Logs in with Sanity's own CLI under a throwaway HOME, so your own Sanity login is untouched
# (the CLI ignores XDG_CONFIG_HOME). It prints the login link instead of opening your browser:
# open it in a private window, where you're not signed in to Sanity as yourself. The token is
# only accepted if it belongs to $EXPECTED_EMAIL, is never printed, and the temp folder is removed.
set -euo pipefail

EXPECTED_EMAIL="${EXPECTED_EMAIL:-claude@gieffektivt.no}"
provider="${1:-sanity}"
cd "$(dirname "$0")/../.."
sanity_bin="$PWD/apps/web/node_modules/.bin/sanity"
[ -x "$sanity_bin" ] || {
  echo "Run pnpm install first (apps/web's Sanity CLI is missing)." >&2
  exit 1
}

tmp_home="$(mktemp -d)"
trap 'rm -rf "$tmp_home"' EXIT

echo "Open the link below in a PRIVATE browser window and log in as ${EXPECTED_EMAIL}."
HOME="$tmp_home" "$sanity_bin" login --provider "$provider" --no-open

token="$(node -e 'try { process.stdout.write(require(process.argv[1]).authToken || "") } catch { }' \
  "$tmp_home/.config/sanity/config.json")"
[ -n "$token" ] || {
  echo "No token was stored; the login didn't complete." >&2
  exit 1
}

# The header comes from stdin (-H @-), so the token isn't in curl's arguments, where `ps` sees it
email="$(printf 'Authorization: Bearer %s\n' "$token" |
  curl -fsS -H @- https://api.sanity.io/v2021-06-07/users/me |
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).email||""))')"
if [ "$email" != "$EXPECTED_EMAIL" ]; then
  echo "That login is ${email:-unknown}, not ${EXPECTED_EMAIL}; the token was discarded." >&2
  echo "Use a private window, where you're not signed in to Sanity." >&2
  exit 1
fi

printf %s "$token" | pbcopy
echo "Token for ${email} copied to the clipboard. Paste it as the network secret's value, then"
echo "copy something else so it doesn't stay on the clipboard."
