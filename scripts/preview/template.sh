#!/usr/bin/env bash
# Seeds the preview template database for a main commit (docs/preview-environments.md#database-templates):
# runs migrate-and-seed.sh `template` from main's preview image as the Cloud Run Job
# effekt-preview-template. The job does nothing if a template with the same seed key and
# migrations exists, and keeps the newest three templates. Also deletes main-* preview images
# beyond the newest three.
#
#   template.sh <image> <sha>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=config.sh
source "${SCRIPT_DIR}/config.sh"

image="${1:?image}"
sha="${2:?sha}"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || {
  echo "Not a commit SHA: ${sha}" >&2
  exit 2
}
[[ "$image" == "${PREVIEW_IMAGE_BASE}:main-"* ]] || {
  echo "Image must be ${PREVIEW_IMAGE_BASE}:main-…" >&2
  exit 2
}

job="effekt-preview-template" # not a PR job: no `pr` label, so the janitor leaves it alone
R=(--project "$PREVIEW_PROJECT" --region "$PREVIEW_REGION")

echo "== Seeding the template database for main@${sha:0:7}"
# DB_NAME is a placeholder for the guard's checks; migrate-and-seed.sh derives the template's
# name (preview_tpl_<seed key>_<TEMPLATE_ID>) from the image itself.
gcloud run jobs deploy "$job" "${R[@]}" \
  --image "$image" \
  --service-account "$PREVIEW_RUN_SA" \
  --set-cloudsql-instances "$PREVIEW_SQL_CONNECTION" \
  --set-env-vars "PREVIEW_MODE=true,NODE_ENV=preview,DB_NAME=preview_tpl_pending,DB_USER=${PREVIEW_SQL_USER},CLOUD_SQL_CONNECTION_NAME=${PREVIEW_SQL_CONNECTION},PREVIEW_JWT_SECRET=$(openssl rand -hex 32),TEMPLATE_ID=${sha:0:7}" \
  --set-secrets "DB_PASS=${PREVIEW_DB_PASSWORD_SECRET}:latest" \
  --command /usr/src/app/scripts/preview/migrate-and-seed.sh \
  --args template \
  --labels "preview=true,template=true,sha=${sha:0:7}" \
  --cpu 1 --memory 1Gi --max-retries 0 --task-timeout 15m \
  --execute-now --wait

echo "== Deleting old main images"
old="$(gcloud artifacts docker images list "$PREVIEW_IMAGE_BASE" --project "$PREVIEW_PROJECT" \
  --include-tags --filter "tags ~ ^main-" --sort-by "~CREATE_TIME" --format 'value(version)' \
  2>/dev/null | tail -n +4 || true)"
for digest in $old; do
  gcloud artifacts docker images delete "${PREVIEW_IMAGE_BASE}@${digest}" \
    --project "$PREVIEW_PROJECT" --delete-tags --quiet || true
done
echo "Template step for main@${sha:0:7} done."
