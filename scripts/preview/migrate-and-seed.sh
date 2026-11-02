#!/usr/bin/env bash
# Runs inside the preview image (apps/api/Dockerfile.preview) as a Cloud Run Job, or locally
# against a throwaway MySQL:
#
#   migrate-and-seed.sh          (re)create DB_NAME for a PR preview: clone the newest suitable
#                                template database, apply the PR's newer migrations and top the
#                                data up to today; if there's no template or anything fails,
#                                drop + create, apply every migration and seed from scratch
#   migrate-and-seed.sh full     always the from-scratch path
#   migrate-and-seed.sh template seed a template database for main (DB_NAME is derived here,
#                                preview_tpl_<seed key>_<TEMPLATE_ID>); skipped if one with the
#                                same seed key and migrations exists; prunes old templates
#   migrate-and-seed.sh drop     drop DB_NAME (preview teardown)
#
# Every step starts with the preview startup guard: it only ever touches a preview_* database
# on the effekt-previews instance, with no production integration configured.
# Templates: docs/preview-environments.md#database-templates.
set -euo pipefail

# Works in the API package (apps/api): its dist/, dist-seed/, node_modules/ and prisma/ are used
cd "$(dirname "$0")/../../apps/api"
command="${1:-reset}"
cli=(node dist/custom_modules/preview/databaseCli.js)
seed_key="$(cat dist-seed/SEED_KEY 2>/dev/null || true)"
started=$(date +%s)
took() { echo "$(($(date +%s) - started))s"; }

if [[ "$command" == template ]]; then
  [[ "$seed_key" =~ ^[a-f0-9]{12}$ ]] || {
    echo "No seed key in this image (dist-seed/SEED_KEY)" >&2
    exit 1
  }
  [[ "${TEMPLATE_ID:-}" =~ ^[a-z0-9]{1,16}$ ]] || {
    echo "TEMPLATE_ID must be 1-16 lowercase letters/digits" >&2
    exit 2
  }
  export DB_NAME="preview_tpl_${seed_key}_${TEMPLATE_ID}"
fi

"${cli[@]}" guard

prisma_url() { "${cli[@]}" url prisma; }
mysql2_url() { "${cli[@]}" url mysql2; }

# Drop + create DB_NAME, apply every migration, seed synthetic data.
full_seed() {
  "${cli[@]}" reset
  DB_URL="$(prisma_url)" node_modules/.bin/prisma migrate deploy
  # The seed uses mysql2, which takes the Cloud SQL socket as `socketPath`
  DB_URL="$(mysql2_url)" node dist-seed/prisma/seed.js
  # DB_URL (the Prisma one) reaches the CLI through prisma.config.ts
  DB_URL="$(prisma_url)" node_modules/.bin/prisma db execute --file prisma/dev/fulltext-search.sql
  "${cli[@]}" analyze
}

# Clone a template into DB_NAME, add this branch's newer migrations, top the data up to today.
# Returns non-zero on any failure (errexit doesn't apply inside a function used in a condition).
from_template() {
  local template="$1"
  "${cli[@]}" clone "$template" || return 1
  DB_URL="$(prisma_url)" node_modules/.bin/prisma migrate deploy || return 1
  DB_URL="$(mysql2_url)" node dist-seed/prisma/devdata/topup.js || return 1
  "${cli[@]}" analyze || return 1
}

case "$command" in
  reset)
    template=""
    if [[ "$seed_key" =~ ^[a-f0-9]{12}$ ]]; then
      template="$("${cli[@]}" find-template "$seed_key" || true)"
    fi
    if [[ -n "$template" ]] && from_template "$template"; then
      echo "Preview database ${DB_NAME} cloned from ${template} in $(took) at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    else
      if [[ -n "$template" ]]; then
        echo "::warning::Cloning ${template} failed; seeding ${DB_NAME} from scratch"
      else
        echo "No template database for seed key ${seed_key:-?} and these migrations; seeding from scratch"
      fi
      full_seed
      echo "Preview database ${DB_NAME} migrated and seeded in $(took) at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    fi
    ;;
  full)
    full_seed
    echo "Preview database ${DB_NAME} migrated and seeded in $(took) at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    ;;
  template)
    if existing="$("${cli[@]}" find-template "$seed_key" --exact)" && [[ -n "$existing" ]]; then
      echo "Template ${existing} already has seed key ${seed_key} and these migrations; nothing to do"
    else
      full_seed
      "${cli[@]}" mark-template
      echo "Template ${DB_NAME} seeded in $(took)"
    fi
    "${cli[@]}" prune-templates 3
    ;;
  drop)
    "${cli[@]}" drop
    ;;
  *)
    echo "Usage: $0 [reset|full|template|drop]" >&2
    exit 2
    ;;
esac
