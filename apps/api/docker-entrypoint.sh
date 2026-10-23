#!/bin/sh
set -e

if [ "$1" = "api" ]; then
  # Production deploys migrate in their own step first (deploy/scripts/deploy.sh, RUN_MIGRATIONS=0).
  if [ "${RUN_MIGRATIONS:-1}" = "1" ]; then
    alembic upgrade head
  fi
  # WEB_CONCURRENCY: API worker processes (3 on the 6-vCPU server). Proxy headers are handled in
  # the app (FORWARDED_ALLOW_IPS), not here.
  exec uvicorn cornerroom.main:app --host 0.0.0.0 --port 8000 \
    --workers "${WEB_CONCURRENCY:-1}" --timeout-graceful-shutdown 20 --no-server-header
fi

if [ "$1" = "worker" ]; then
  exec arq cornerroom.worker.WorkerSettings
fi

if [ "$1" = "migrate" ]; then
  exec alembic upgrade head
fi

exec "$@"
