#!/usr/bin/env bash
# Back up Corner Room to Cloudflare R2 (deploy readiness, 2026-10-23).
#   deploy/scripts/backup.sh            database dump + stored files (audio, covers, posters)
#   deploy/scripts/backup.sh --db-only  database dump only (deploy.sh runs this before migrating)
# Needs rclone with a remote for R2 (`rclone config`, type s3, provider Cloudflare); the remote
# and bucket come from R2_REMOTE in .env.production. Scheduling: see the private runbook.
set -euo pipefail

cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
ENV_FILE=".env.production"
COMPOSE=(docker compose -f deploy/compose.prod.yml --env-file "$ENV_FILE")
LOCAL_DIR="/var/backups/cornerroom"

# Read one value from .env.production (values may contain spaces, so it is not sourced).
envval() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d '\r'; }

R2_REMOTE="$(envval R2_REMOTE)"
KEEP_DAYS="$(envval BACKUP_KEEP_DAYS)"; KEEP_DAYS="${KEEP_DAYS:-14}"
PG_USER="$(envval POSTGRES_USER)"; PG_DB="$(envval POSTGRES_DB)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$LOCAL_DIR"
chmod 700 "$LOCAL_DIR"

echo "[$STAMP] database dump"
DUMP="$LOCAL_DIR/db-$STAMP.dump"
"${COMPOSE[@]}" exec -T postgres pg_dump -U "$PG_USER" -d "$PG_DB" -Fc > "$DUMP"
[ -s "$DUMP" ] || { echo "empty dump" >&2; exit 1; }
sha256sum "$DUMP" > "$DUMP.sha256"

if [ -n "$R2_REMOTE" ]; then
  rclone copy "$DUMP" "$R2_REMOTE/db/" && rclone copy "$DUMP.sha256" "$R2_REMOTE/db/"
  rclone delete --min-age "${KEEP_DAYS}d" "$R2_REMOTE/db/" || true
else
  echo "R2_REMOTE is empty: the dump stays on this server only" >&2
fi
find "$LOCAL_DIR" -name 'db-*' -mtime +"$KEEP_DAYS" -delete

if [ "${1:-}" = "--db-only" ]; then exit 0; fi

echo "[$STAMP] stored files"
VOLUME="$(docker volume inspect -f '{{ .Mountpoint }}' cornerroom_storage)"
if [ -n "$R2_REMOTE" ]; then
  # Copies new and changed files; files deleted here move to storage-deleted/<date> instead of vanishing.
  rclone sync "$VOLUME" "$R2_REMOTE/storage/" --backup-dir "$R2_REMOTE/storage-deleted/$STAMP" --exclude "_upload_parts/**"
fi
echo "[$STAMP] done"
