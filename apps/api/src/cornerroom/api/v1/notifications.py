"""In-app notification routes for the current user. Phase 1 paths preserved."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from cornerroom.api.deps import get_auth_context, notification_service
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.pagination import clamp_limit
from cornerroom.modules.notifications.application.service import NotificationService
from cornerroom.modules.notifications.domain.models import Notification

router = APIRouter(tags=["notifications"])


class NotificationOut(BaseModel):
    id: UUID
    type: str
    status: str
    title: str
    body: str
    locale: str
    read_at: datetime | None
    category: str | None = None
    organization_id: UUID | None = None
    correlation_id: str | None = None
    aggregate_type: str | None = None
    aggregate_id: UUID | None = None


class PreferenceIn(BaseModel):
    notification_type: str
    in_app: bool = True
    email: bool = True
    push: bool = False
    sms: bool = False


class PreferenceOut(PreferenceIn):
    channel_availability: dict[str, str]


def _notification_out(row: Notification) -> NotificationOut:
    return NotificationOut(
        id=row.id,
        type=row.type,
        status=row.status,
        title=row.title,
        body=row.body,
        locale=row.locale,
        read_at=row.read_at,
        category=row.category,
        organization_id=row.organization_id,
        correlation_id=row.correlation_id,
        aggregate_type=row.aggregate_type,
        aggregate_id=row.aggregate_id,
    )


@router.get("/me/notifications", response_model=list[NotificationOut])
async def list_notifications(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[NotificationService, Depends(notification_service)],
    limit: int = Query(default=50, ge=1, le=100),
) -> list[NotificationOut]:
    rows = await svc.list_for_user(ctx.user_id, limit=clamp_limit(limit))
    return [_notification_out(r) for r in rows]


@router.post("/me/notifications/{notification_id}/read", response_model=NotificationOut)
async def mark_read(
    notification_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[NotificationService, Depends(notification_service)],
) -> NotificationOut:
    row = await svc.mark_read(ctx.user_id, notification_id)
    return _notification_out(row)


@router.get("/me/notification-preferences", response_model=list[PreferenceOut])
async def get_preferences(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[NotificationService, Depends(notification_service)],
) -> list[PreferenceOut]:
    availability = svc.channel_availability()
    rows = await svc.get_preferences(ctx.user_id)
    return [
        PreferenceOut(
            notification_type=r.notification_type,
            in_app=r.in_app,
            email=r.email,
            push=r.push,
            sms=r.sms,
            channel_availability=availability,
        )
        for r in rows
    ]


@router.put("/me/notification-preferences", response_model=PreferenceOut)
async def put_preference(
    body: PreferenceIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[NotificationService, Depends(notification_service)],
) -> PreferenceOut:
    row = await svc.upsert_preference(
        ctx.user_id,
        body.notification_type,
        in_app=body.in_app,
        email=body.email,
        push=body.push,
        sms=body.sms,
    )
    return PreferenceOut(
        notification_type=row.notification_type,
        in_app=row.in_app,
        email=row.email,
        push=row.push,
        sms=row.sms,
        channel_availability=svc.channel_availability(),
    )
