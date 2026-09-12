"""Staff ops visibility. Existing permissions only. No money mutation."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.api.deps import db_session, get_auth_context, require_permission, settings_dep
from cornerroom.api.health import _probes
from cornerroom.infra.settings import Settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.administration.application.ops_service import OpsService

router = APIRouter(prefix="/staff/ops", tags=["ops"])


class OutboxItemOut(BaseModel):
    id: UUID
    event_type: str
    status: str
    aggregate_type: str | None
    aggregate_id: UUID | None
    correlation_id: str | None
    attempts: int
    last_error: str | None
    created_at: datetime
    published_at: datetime | None
    next_attempt_at: datetime | None
    payload: dict[str, Any]


class OutboxPage(BaseModel):
    items: list[OutboxItemOut]
    next_cursor: str | None


@router.get("/overview", dependencies=[Depends(require_permission("audit.read"))])
async def ops_overview(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    session: Annotated[AsyncSession, Depends(db_session)],
    settings: Annotated[Settings, Depends(settings_dep)],
) -> dict[str, Any]:
    db_ok, redis_ok = await _probes()
    return await OpsService(session).overview(
        organization_id=ctx.organization_id,
        database_ok=db_ok,
        redis_ok=redis_ok,
        treat_email_stub_as_degraded=settings.is_production,
    )


@router.get(
    "/outbox",
    response_model=OutboxPage,
    dependencies=[Depends(require_permission("audit.read"))],
)
async def list_outbox(
    session: Annotated[AsyncSession, Depends(db_session)],
    status: str | None = None,
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
) -> OutboxPage:
    svc = OpsService(session)
    rows, next_cursor = await svc.list_outbox(status=status, cursor=cursor, limit=limit)
    return OutboxPage(
        items=[OutboxItemOut.model_validate(svc.serialize_outbox(row)) for row in rows],
        next_cursor=next_cursor,
    )
