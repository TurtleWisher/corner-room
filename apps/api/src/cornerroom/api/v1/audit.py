"""Audit read API. Append-only — no update/delete."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.api.deps import db_session, require_permission
from cornerroom.modules.audit.application.service import AuditService

router = APIRouter(prefix="/audit", tags=["audit"])


class AuditOut(BaseModel):
    id: UUID
    occurred_at: datetime
    actor_id: str
    actor_type: str
    action: str
    entity_type: str
    entity_id: str
    previous_state: dict[str, Any] | None
    new_state: dict[str, Any] | None
    request_id: str | None
    organization_id: UUID | None


class AuditPage(BaseModel):
    items: list[AuditOut]
    next_cursor: str | None


@router.get("", response_model=AuditPage, dependencies=[Depends(require_permission("audit.read"))])
async def list_audit(
    session: Annotated[AsyncSession, Depends(db_session)],
    entity_type: str | None = None,
    entity_id: str | None = None,
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
) -> AuditPage:
    items, next_cursor = await AuditService(session).list_entries(
        entity_type=entity_type,
        entity_id=entity_id,
        cursor=cursor,
        limit=limit,
    )
    return AuditPage(
        items=[
            AuditOut(
                id=row.id,
                occurred_at=row.occurred_at,
                actor_id=row.actor_id,
                actor_type=row.actor_type,
                action=row.action,
                entity_type=row.entity_type,
                entity_id=row.entity_id,
                previous_state=row.previous_state,
                new_state=row.new_state,
                request_id=row.request_id,
                organization_id=row.organization_id,
            )
            for row in items
        ],
        next_cursor=next_cursor,
    )
