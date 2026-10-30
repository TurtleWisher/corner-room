#!/usr/bin/env bash
# Deploy Corner Room on the server (deploy readiness, 2026-10-23; zero downtime, 2026-10-30).
#   deploy/scripts/deploy.sh               deploy the latest main from GitHub
#   deploy/scripts/deploy.sh v1.2.0        deploy a tag (or any commit)
#   deploy/scripts/deploy.sh --rollback    switch back to the previous release (its containers
#                                          are kept stopped, so this takes seconds)
# Run inside the repo clone on the server as a user in the docker group.
#
# Steps: fetch -> build -> database backup -> migrate -> start the new release in the idle colour
# (blue or green) next to the live one -> health check it -> switch the edge proxy to it -> restart
# the worker on it -> stop the old colour after its open requests finish. Visitors never see a
# gap: the edge container keeps the ports open and nginx reloads gracefully. If the new release
# fails its health check, it is stopped and the live one was never touched. Migrations are
# additive only (CLAUDE.md), so the old release keeps working on the new schema while both run.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
ENV_FILE=".env.production"
STATE_FILE=".deploy-state"
LEGACY_STATE_FILE=".deployed-release"
KEEP_RELEASES=5
# Seconds the old colour keeps serving requests it already accepted (long audio streams).
DRAIN_SECONDS=30

say() { printf '\n== %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
# A missing key is empty (its default applies), never a failure under `set -o pipefail`.
envval() { { grep -E "^$1=" "$ENV_FILE" || true; } | tail -n1 | cut -d= -f2- | tr -d '\r'; }

[ -f "$ENV_FILE" ] || die "$ENV_FILE is missing (copy deploy/env.production.example and fill it in)."
if grep -nE '^[A-Z_]+=.*CHANGE_ME' "$ENV_FILE" | cut -d= -f1; then
  die "$ENV_FILE still has CHANGE_ME values (listed above). Fill them in first."
fi
[ -z "$(git status --porcelain --untracked-files=no)" ] || die "The server copy has local edits. Changes go through GitHub, not the server."

PROJECT="$(envval COMPOSE_PROJECT_NAME)"; PROJECT="${PROJECT:-cornerroom}"
API_PORT="$(envval EDGE_API_PORT)"; API_PORT="${API_PORT:-8000}"
WEB_PORT="$(envval EDGE_WEB_PORT)"; WEB_PORT="${WEB_PORT:-3000}"
COMPOSE=(docker compose -p "$PROJECT" -f deploy/compose.prod.yml --env-file "$ENV_FILE")
EDGE_DIR="deploy/edge/conf.d"

# --- state: which colour is live, and which release each colour runs ---------------------------
ACTIVE=""; BLUE_RELEASE=""; GREEN_RELEASE=""
if [ -f "$STATE_FILE" ]; then
  stateval() { { grep -E "^$1=" "$STATE_FILE" || true; } | cut -d= -f2; }
  ACTIVE="$(stateval ACTIVE)"
  BLUE_RELEASE="$(stateval BLUE_RELEASE)"
  GREEN_RELEASE="$(stateval GREEN_RELEASE)"
fi
save_state() {
  printf 'ACTIVE=%s\nBLUE_RELEASE=%s\nGREEN_RELEASE=%s\n' "$ACTIVE" "$BLUE_RELEASE" "$GREEN_RELEASE" > "$STATE_FILE.tmp"
  mv "$STATE_FILE.tmp" "$STATE_FILE"
  release_of "$ACTIVE" > "$LEGACY_STATE_FILE"
}
release_of() { if [ "$1" = blue ]; then echo "$BLUE_RELEASE"; else echo "$GREEN_RELEASE"; fi; }
other() { if [ "$1" = blue ]; then echo green; else echo blue; fi; }
# Every compose call carries both colours' releases, so neither colour is ever recreated by accident.
compose() { BLUE_RELEASE="${BLUE_RELEASE:-none}" GREEN_RELEASE="${GREEN_RELEASE:-none}" RELEASE="${RELEASE:-none}" "${COMPOSE[@]}" "$@"; }

# Old single-colour layout (services "api" and "web" on the ports), before 2026-10-30.
legacy_running() {
  [ -n "$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=api")" ]
}

colour_healthy() {
  local colour="$1"
  for _ in $(seq 1 45); do
    if compose exec -T "api-$colour" python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)" >/dev/null 2>&1 &&
       compose exec -T "web-$colour" wget -qO- http://127.0.0.1:3000/ >/dev/null 2>&1; then
      return 0
    fi
    sleep 4
  done
  return 1
}

edge_healthy() {
  for _ in $(seq 1 15); do
    if curl -fsS -o /dev/null "http://127.0.0.1:$API_PORT/health" && curl -fsS -o /dev/null "http://127.0.0.1:$WEB_PORT/"; then
      return 0
    fi
    sleep 2
  done
  return 1
}

# Point the edge at a colour. The file is replaced in one step and nginx reloads gracefully:
# requests already in flight finish on the old colour.
switch_edge() {
  local colour="$1"
  mkdir -p "$EDGE_DIR"
  sed "s/@COLOUR@/$colour/g" deploy/edge/edge.conf.template > "$EDGE_DIR/default.conf.tmp"
  mv "$EDGE_DIR/default.conf.tmp" "$EDGE_DIR/default.conf"
  if [ -n "$(compose ps -q --status running edge)" ]; then
    compose exec -T edge nginx -t >/dev/null 2>&1 || return 1
    compose exec -T edge nginx -s reload
  else
    compose up -d edge
  fi
}

prune_images() {
  for repo in cornerroom-api cornerroom-web; do
    docker image ls "$repo" --format '{{.Tag}} {{.CreatedAt}}' | sort -k2 -r | awk 'NR>'"$KEEP_RELEASES"' {print $1}' |
      while read -r tag; do
        [ "$tag" != "$BLUE_RELEASE" ] && [ "$tag" != "$GREEN_RELEASE" ] && docker image rm "$repo:$tag" >/dev/null 2>&1 || true
      done
  done
}

# --- rollback -------------------------------------------------------------------------------------
if [ "${1:-}" = "--rollback" ]; then
  [ -n "$ACTIVE" ] || die "Nothing to roll back to yet (no previous colour recorded)."
  BACK="$(other "$ACTIVE")"; BACK_RELEASE="$(release_of "$BACK")"
  [ -n "$BACK_RELEASE" ] && [ "$BACK_RELEASE" != none ] || die "The $BACK colour has never run a release."
  say "Rolling back to $BACK_RELEASE ($BACK)"
  compose up -d --no-build "api-$BACK" "web-$BACK"
  colour_healthy "$BACK" || die "The previous release $BACK_RELEASE is not healthy; nothing switched."
  switch_edge "$BACK" || die "The edge proxy refused the switch; still on $(release_of "$ACTIVE")."
  edge_healthy || die "The site is not answering through the edge after the switch."
  OLD="$ACTIVE"; ACTIVE="$BACK"; save_state
  RELEASE="$BACK_RELEASE" compose up -d --no-build --no-deps worker
  sleep "$DRAIN_SECONDS"
  compose stop "api-$OLD" "web-$OLD"
  say "Rolled back: $BACK_RELEASE is live"
  exit 0
fi

# --- deploy ---------------------------------------------------------------------------------------
REF="${1:-origin/main}"
say "Fetching $REF"
git fetch --tags --prune origin
git checkout --quiet --detach "$REF"
export RELEASE
RELEASE="$(git rev-parse --short HEAD)"
LIVE_RELEASE="$(release_of "${ACTIVE:-blue}")"
[ -n "$ACTIVE" ] || LIVE_RELEASE="$(cat "$LEGACY_STATE_FILE" 2>/dev/null || true)"
echo "release $RELEASE (live: ${LIVE_RELEASE:-none})"

NEXT="$(other "${ACTIVE:-green}")"   # first deploy goes to blue
if [ "$NEXT" = blue ]; then BLUE_RELEASE="$RELEASE"; else GREEN_RELEASE="$RELEASE"; fi

say "Building images"
docker build --pull -f apps/api/Dockerfile -t "cornerroom-api:$RELEASE" .
docker build --pull --build-arg "NEXT_PUBLIC_API_URL=$(envval NEXT_PUBLIC_API_URL)" -t "cornerroom-web:$RELEASE" apps/web

say "Starting the database and Redis"
compose up -d postgres redis

if [ -n "$LIVE_RELEASE" ]; then
  say "Backing up the database before migrating"
  deploy/scripts/backup.sh --db-only
fi

say "Migrating the database"
compose run --rm --no-deps worker migrate

say "Starting release $RELEASE in $NEXT (the live site keeps running)"
compose up -d --no-build --force-recreate "api-$NEXT" "web-$NEXT"

if ! colour_healthy "$NEXT"; then
  say "Release $RELEASE failed its health checks; the live release was not touched"
  compose logs --tail 80 "api-$NEXT" "web-$NEXT" || true
  compose stop "api-$NEXT" "web-$NEXT" || true
  [ -n "$LIVE_RELEASE" ] && git checkout --quiet --detach "$LIVE_RELEASE" || true
  die "Deploy of $RELEASE failed (see the logs above)."
fi

LEGACY_CONTAINERS=""
if legacy_running; then
  # One time only: the old layout holds the ports itself. Stop it (kept until the edge answers) and
  # let the edge take the ports over straight away: a gap of a few seconds, once.
  say "Moving from the old single-colour layout to the edge proxy"
  mkdir -p "$EDGE_DIR"
  sed "s/@COLOUR@/$NEXT/g" deploy/edge/edge.conf.template > "$EDGE_DIR/default.conf"
  LEGACY_CONTAINERS="$(for service in web api; do
    docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$service"
  done | tr '\n' ' ')"
  # shellcheck disable=SC2086
  docker stop -t 2 $LEGACY_CONTAINERS >/dev/null
  if ! compose up -d edge; then
    # shellcheck disable=SC2086
    docker start $LEGACY_CONTAINERS >/dev/null || true
    compose stop "api-$NEXT" "web-$NEXT" || true
    die "The edge proxy did not start; the old layout was started again."
  fi
else
  say "Switching the edge proxy to $NEXT"
  switch_edge "$NEXT" || {
    compose stop "api-$NEXT" "web-$NEXT" || true
    die "The edge proxy refused the new config; the live release was not touched."
  }
fi

if ! edge_healthy; then
  say "The site is not answering through the edge after the switch"
  compose logs --tail 40 edge || true
  if [ -n "$LEGACY_CONTAINERS" ]; then
    compose rm -sf edge || true
    # shellcheck disable=SC2086
    docker start $LEGACY_CONTAINERS >/dev/null || true
    compose stop "api-$NEXT" "web-$NEXT" || true
    die "The edge proxy did not answer; the old layout was started again."
  fi
  if [ -n "$ACTIVE" ]; then
    switch_edge "$ACTIVE" || true
    compose stop "api-$NEXT" "web-$NEXT" || true
    die "Switched back to $LIVE_RELEASE ($ACTIVE)."
  fi
  die "Deploy of $RELEASE failed after the switch (see the edge logs above)."
fi

if [ -n "$LEGACY_CONTAINERS" ]; then
  # shellcheck disable=SC2086
  docker rm $LEGACY_CONTAINERS >/dev/null || true
fi

OLD="$ACTIVE"; ACTIVE="$NEXT"; save_state

say "Restarting the worker on $RELEASE"
compose up -d --no-build --no-deps --force-recreate worker

if [ -n "$OLD" ]; then
  say "Letting $OLD finish its open requests, then stopping it (kept for --rollback)"
  sleep "$DRAIN_SECONDS"
  compose stop "api-$OLD" "web-$OLD"
fi

prune_images
say "Release $RELEASE is live ($ACTIVE)"
