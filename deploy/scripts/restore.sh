#!/usr/bin/env bash
# Restore Corner Room from a backup (deploy readiness, 2026-10-23). Practise first with
# deploy/scripts/restore-rehearsal.sh, which checks a backup without touching the live database.
#   deploy/scripts/restore.sh db-20261023T033000Z.dump       database from R2 (or a local path)
#   deploy/scripts/restore.sh db-...dump --with-files         also bring the stored files back
# Stops the app, replaces the database with the dump, then starts the live colour again.
set -euo pipefail

cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
ENV_FILE=".env.production"
# A missing key is empty (its default applies), never a failure under `set -o pipefail`.
envval() { { grep -E "^$1=" "$ENV_FILE" || true; } | tail -n1 | cut -d= -f2- | tr -d '\r'; }
PROJECT="$(envval COMPOSE_PROJECT_NAME)"; PROJECT="${PROJECT:-cornerroom}"
COMPOSE=(docker compose -p "$PROJECT" -f deploy/compose.prod.yml --env-file "$ENV_FILE")

NAME="${1:?usage: restore.sh <dump file name or path> [--with-files]}"
R2_REMOTE="$(envval R2_REMOTE)"
PG_USER="$(envval POSTGRES_USER)"; PG_DB="$(envval POSTGRES_DB)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

# The live colour and its release (deploy.sh keeps them in .deploy-state).
state() { { grep -E "^$1=" .deploy-state 2>/dev/null || true; } | cut -d= -f2; }
ACTIVE="$(state ACTIVE)"; ACTIVE="${ACTIVE:-blue}"
export BLUE_RELEASE GREEN_RELEASE RELEASE
BLUE_RELEASE="$(state BLUE_RELEASE)"; BLUE_RELEASE="${BLUE_RELEASE:-none}"
GREEN_RELEASE="$(state GREEN_RELEASE)"; GREEN_RELEASE="${GREEN_RELEASE:-none}"
if [ "$ACTIVE" = blue ]; then RELEASE="$BLUE_RELEASE"; else RELEASE="$GREEN_RELEASE"; fi

if [ -f "$NAME" ]; then
  cp "$NAME" "$WORK/restore.dump"
else
  rclone copyto "$R2_REMOTE/db/$NAME" "$WORK/restore.dump"
fi
[ -s "$WORK/restore.dump" ] || { echo "dump not found" >&2; exit 1; }

read -r -p "This REPLACES the live database with $NAME. Type RESTORE to continue: " answer
[ "$answer" = "RESTORE" ] || { echo "Stopped. Nothing changed."; exit 0; }

"${COMPOSE[@]}" stop api-blue api-green web-blue web-green worker
"${COMPOSE[@]}" up -d postgres
"${COMPOSE[@]}" exec -T postgres pg_restore -U "$PG_USER" -d "$PG_DB" --clean --if-exists --no-owner < "$WORK/restore.dump"

if [ "${2:-}" = "--with-files" ]; then
  VOLUME="$(docker volume inspect -f '{{ .Mountpoint }}' "${PROJECT}_storage")"
  rclone sync "$R2_REMOTE/storage/" "$VOLUME"
  # The API and worker run as uid 10001 (apps/api/Dockerfile) and must own their files.
  chown -R 10001:10001 "$VOLUME"
fi

"${COMPOSE[@]}" up -d --no-build "api-$ACTIVE" "web-$ACTIVE" worker
echo "Restored $NAME. Check the site, then run deploy.sh if the code version should change."
