"""Liveness and readiness. Ready checks Postgres and Redis."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from cornerroom.infra.db import get_engine
from cornerroom.infra.redis import ping_redis

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict:
    db_ok, redis_ok = await _probes()
    status = "ok" if db_ok and redis_ok else "degraded"
    return {"status": status, "checks": {"database": db_ok, "redis": redis_ok}}


@router.get("/health/live")
async def live() -> dict:
    return {"status": "ok"}


@router.get("/health/ready")
async def ready() -> JSONResponse:
    db_ok, redis_ok = await _probes()
    ready_ok = db_ok and redis_ok
    body = {
        "status": "ok" if ready_ok else "unavailable",
        "checks": {"database": db_ok, "redis": redis_ok},
    }
    return JSONResponse(status_code=200 if ready_ok else 503, content=body)


async def _probes() -> tuple[bool, bool]:
    db_ok = False
    redis_ok = False
    try:
        async with get_engine().connect() as conn:
            await conn.execute(text("SELECT 1"))
            db_ok = True
    except Exception:
        db_ok = False
    try:
        redis_ok = await ping_redis()
    except Exception:
        redis_ok = False
    return db_ok, redis_ok
