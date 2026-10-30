#!/usr/bin/env bash
# Restore rehearsal (owner, 2026-10-30): prove the newest backup can really be brought back,
# without touching the live database or sending anything to anyone.
#   deploy/scripts/restore-rehearsal.sh                 newest backup (R2 if set up, else this server)
#   deploy/scripts/restore-rehearsal.sh db-<stamp>.dump a particular backup
# Restores the dump into a throwaway Postgres container with no network, compares row counts of
# key tables with the live database, prints counts only (no personal data), records the result in
# /var/backups/<project>/rehearsals.log and removes the container. Exit code 0 means it passed.
set -euo pipefail

cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
ENV_FILE=".env.production"
# A missing key is empty (its default applies), never a failure under `set -o pipefail`.
envval() { { grep -E "^$1=" "$ENV_FILE" || true; } | tail -n1 | cut -d= -f2- | tr -d '\r'; }
PROJECT="$(envval COMPOSE_PROJECT_NAME)"; PROJECT="${PROJECT:-cornerroom}"
COMPOSE=(docker compose -p "$PROJECT" -f deploy/compose.prod.yml --env-file "$ENV_FILE")
R2_REMOTE="$(envval R2_REMOTE)"
PG_USER="$(envval POSTGRES_USER)"; PG_DB="$(envval POSTGRES_DB)"
LOCAL_DIR="/var/backups/$PROJECT"
LOG="$LOCAL_DIR/rehearsals.log"
NAME="${1:-}"
WORK="$(mktemp -d)"
TARGET="$PROJECT-restore-rehearsal"
cleanup() { docker rm -f "$TARGET" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

say() { printf '\n== %s\n' "$*"; }
fail() { printf 'FAILED: %s\n' "$*" >&2; record "FAILED" "$*"; exit 1; }
record() { mkdir -p "$LOCAL_DIR" && printf '%s %s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "${NAME:-?}" "$2" >> "$LOG" || true; }

# --- which backup ---------------------------------------------------------------------------------
if [ -z "$NAME" ]; then
  if [ -n "$R2_REMOTE" ]; then
    NAME="$(rclone lsf "$R2_REMOTE/db/" --include 'db-*.dump' | sort | tail -n1)"
    SOURCE="R2"
  else
    NAME="$( (ls -1 "$LOCAL_DIR"/db-*.dump 2>/dev/null || true) | sort | tail -n1 | xargs -r basename)"
    SOURCE="this server"
  fi
fi
[ -n "$NAME" ] || fail "no backup found"
say "Rehearsing $NAME (from ${SOURCE:-the name given})"

if [ -f "$LOCAL_DIR/$NAME" ] && [ "${SOURCE:-}" != "R2" ]; then
  cp "$LOCAL_DIR/$NAME" "$WORK/restore.dump"
  cp "$LOCAL_DIR/$NAME.sha256" "$WORK/restore.dump.sha256" 2>/dev/null || true
else
  rclone copyto "$R2_REMOTE/db/$NAME" "$WORK/restore.dump"
  rclone copyto "$R2_REMOTE/db/$NAME.sha256" "$WORK/restore.dump.sha256" 2>/dev/null || true
fi
[ -s "$WORK/restore.dump" ] || fail "the backup file is empty or missing"
if [ -s "$WORK/restore.dump.sha256" ]; then
  expected="$(cut -d' ' -f1 "$WORK/restore.dump.sha256")"
  actual="$(sha256sum "$WORK/restore.dump" | cut -d' ' -f1)"
  [ "$expected" = "$actual" ] || fail "checksum does not match (the file changed after the backup)"
  echo "checksum ok"
else
  echo "no checksum file next to the backup; skipping that check"
fi
echo "size $(du -h "$WORK/restore.dump" | cut -f1)"

# --- restore into a throwaway database --------------------------------------------------------------
say "Restoring into a throwaway database (no network, removed afterwards)"
docker rm -f "$TARGET" >/dev/null 2>&1 || true
docker run -d --name "$TARGET" --network none \
  -e POSTGRES_USER=rehearsal -e POSTGRES_DB=rehearsal -e POSTGRES_PASSWORD="$(head -c 18 /dev/urandom | od -An -tx1 | tr -d ' \n')" \
  postgres:16-alpine >/dev/null
for _ in $(seq 1 30); do docker exec "$TARGET" pg_isready -U rehearsal -d rehearsal >/dev/null 2>&1 && break; sleep 2; done
docker exec "$TARGET" pg_isready -U rehearsal -d rehearsal >/dev/null || fail "the throwaway database did not start"
started=$(date +%s)
if ! docker exec -i "$TARGET" pg_restore -U rehearsal -d rehearsal --no-owner --no-privileges --exit-on-error < "$WORK/restore.dump"; then
  fail "pg_restore stopped with an error"
fi
echo "restored in $(( $(date +%s) - started )) s"

# --- compare with the live database -----------------------------------------------------------------
count() {  # $1 = rehearsal|live, $2 = table
  local sql="SELECT count(*) FROM $2"
  if [ "$1" = rehearsal ]; then
    docker exec "$TARGET" psql -U rehearsal -d rehearsal -tAc "$sql" 2>/dev/null || echo "-"
  else
    "${COMPOSE[@]}" exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -tAc "$sql" 2>/dev/null || echo "-"
  fi
}
version() {
  local sql="SELECT version_num FROM alembic_version"
  if [ "$1" = rehearsal ]; then
    docker exec "$TARGET" psql -U rehearsal -d rehearsal -tAc "$sql" 2>/dev/null || echo "-"
  else
    "${COMPOSE[@]}" exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -tAc "$sql" 2>/dev/null || echo "-"
  fi
}

say "Rows in the backup compared with the live database now"
printf '%-34s %12s %12s\n' "table" "backup" "live"
printf '%-34s %12s %12s\n' "database version" "$(version rehearsal)" "$(version live)"
problems=0
for table in identity.users identity.delivery_addresses music.releases music.tracks \
             commerce.orders commerce.order_items commerce.offers finance.payments \
             commerce.entitlements streaming.listens audit.audit_log; do
  b="$(count rehearsal "$table")"; l="$(count live "$table")"
  printf '%-34s %12s %12s\n' "$table" "$b" "$l"
  # A backup is older than the live data, so it may have fewer rows, never more.
  if [ "$b" = "-" ] && [ "$l" != "-" ]; then problems=$((problems + 1)); fi
  if [ "$b" != "-" ] && [ "$l" != "-" ] && [ "$b" -gt "$l" ]; then problems=$((problems + 1)); fi
done
users="$(count rehearsal identity.users)"
[ "$users" != "-" ] && [ "$users" -gt 0 ] || fail "the restored database has no user accounts"
[ "$problems" -eq 0 ] || fail "$problems table(s) missing from the backup or larger than live"

record "PASSED" "restored and compared"
say "Rehearsal passed: $NAME restores cleanly"
