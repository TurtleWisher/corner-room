"""Liveness and readiness. Ready checks Postgres and Redis only."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from cornerroom.infra.db import get_engine
from cornerroom.infra.redis import ping_redis
from cornerroom.infra.settings import get_settings
from cornerroom.kernel.health_status import (
    HEALTHY,
    UNAVAILABLE,
    overall_status,
    public_dependency_checks,
)

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict:
    db_ok, redis_ok = await _probes()
    return {
        "status": overall_status(
            database_ok=db_ok,
            redis_ok=redis_ok,
            treat_email_stub_as_degraded=get_settings().is_production,
        ),
        "checks": public_dependency_checks(database_ok=db_ok, redis_ok=redis_ok),
    }


@router.get("/health/live")
async def live() -> dict:
    return {"status": HEALTHY}


@router.get("/health/ready")
async def ready() -> JSONResponse:
    db_ok, redis_ok = await _probes()
    ready_ok = db_ok and redis_ok
    body = {
        "status": HEALTHY if ready_ok else UNAVAILABLE,
        "checks": public_dependency_checks(database_ok=db_ok, redis_ok=redis_ok),
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
