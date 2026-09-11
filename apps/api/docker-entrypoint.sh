#!/bin/sh
set -e

if [ "$1" = "api" ]; then
  alembic upgrade head
  exec uvicorn cornerroom.main:app --host 0.0.0.0 --port 8000
fi

if [ "$1" = "worker" ]; then
  exec arq cornerroom.worker.WorkerSettings
fi

if [ "$1" = "migrate" ]; then
  exec alembic upgrade head
fi

exec "$@"
