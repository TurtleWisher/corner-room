#!/usr/bin/env bash
# Deploy Corner Room on the server (deploy readiness, 2026-10-23).
#   deploy/scripts/deploy.sh            deploy the latest main from GitHub
#   deploy/scripts/deploy.sh v1.2.0     deploy a tag (or any commit)
# Run inside the repo clone on the server as a user in the docker group.
# Steps: fetch -> build -> database backup -> migrate -> start -> health check. If the new
# version fails its health check, the previous release's images are started again. Migrations
# are additive only (CLAUDE.md), so the previous release still runs on the new schema.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
REF="${1:-origin/main}"
ENV_FILE=".env.production"
STATE_FILE=".deployed-release"
KEEP_RELEASES=5
COMPOSE=(docker compose -f deploy/compose.prod.yml --env-file "$ENV_FILE")

say() { printf '\n== %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[ -f "$ENV_FILE" ] || die "$ENV_FILE is missing (copy deploy/env.production.example and fill it in)."
[ -z "$(git status --porcelain --untracked-files=no)" ] || die "The server copy has local edits. Changes go through GitHub, not the server."

PREVIOUS_RELEASE="$(cat "$STATE_FILE" 2>/dev/null || true)"

say "Fetching $REF"
git fetch --tags --prune origin
git checkout --quiet --detach "$REF"
export RELEASE
RELEASE="$(git rev-parse --short HEAD)"
echo "release $RELEASE (previous: ${PREVIOUS_RELEASE:-none})"

say "Building images"
"${COMPOSE[@]}" build --pull api web

say "Starting the database and Redis"
"${COMPOSE[@]}" up -d postgres redis

if [ -n "$PREVIOUS_RELEASE" ]; then
  say "Backing up the database before migrating"
  deploy/scripts/backup.sh --db-only
fi

say "Migrating the database"
"${COMPOSE[@]}" run --rm --no-deps api migrate

say "Starting release $RELEASE"
"${COMPOSE[@]}" up -d --remove-orphans api worker web

healthy() {
  for _ in $(seq 1 30); do
    if curl -fsS -o /dev/null http://127.0.0.1:8000/health && curl -fsS -o /dev/null http://127.0.0.1:3000/; then
      return 0
    fi
    sleep 4
  done
  return 1
}

say "Waiting for health checks"
if healthy; then
  echo "$RELEASE" > "$STATE_FILE"
  say "Release $RELEASE is live"
  # Keep the last few releases' images for rollback; remove older ones.
  for repo in cornerroom-api cornerroom-web; do
    docker image ls "$repo" --format '{{.Tag}} {{.CreatedAt}}' | sort -k2 -r | awk 'NR>'"$KEEP_RELEASES"' {print $1}' |
      while read -r tag; do [ "$tag" != "$RELEASE" ] && docker image rm "$repo:$tag" >/dev/null 2>&1 || true; done
  done
  exit 0
fi

say "Release $RELEASE failed its health checks"
"${COMPOSE[@]}" logs --tail 80 api web || true
if [ -n "$PREVIOUS_RELEASE" ]; then
  say "Rolling back to $PREVIOUS_RELEASE"
  RELEASE="$PREVIOUS_RELEASE" "${COMPOSE[@]}" up -d --no-build api worker web
  git checkout --quiet --detach "$PREVIOUS_RELEASE" || true
fi
die "Deploy of $RELEASE failed (see the logs above)."
