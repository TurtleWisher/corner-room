"""In-app notification routes for the current user."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.api.deps import db_session, get_current_user
from cornerroom.modules.identity.domain.models import User
from cornerroom.modules.notifications.application.service import NotificationService

router = APIRouter(tags=["notifications"])


class NotificationOut(BaseModel):
    id: UUID
    type: str
    status: str
    title: str
    body: str
    locale: str
    read_at: datetime | None


class PreferenceIn(BaseModel):
    notification_type: str
    in_app: bool = True
    email: bool = True
    push: bool = False
    sms: bool = False


class PreferenceOut(PreferenceIn):
    pass


@router.get("/me/notifications", response_model=list[NotificationOut])
async def list_notifications(
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(db_session)],
) -> list[NotificationOut]:
    rows = await NotificationService(session).list_for_user(user.id)
    return [
        NotificationOut(
            id=r.id,
            type=r.type,
            status=r.status,
            title=r.title,
            body=r.body,
            locale=r.locale,
            read_at=r.read_at,
        )
        for r in rows
    ]


@router.post("/me/notifications/{notification_id}/read", response_model=NotificationOut)
async def mark_read(
    notification_id: UUID,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(db_session)],
) -> NotificationOut:
    row = await NotificationService(session).mark_read(user.id, notification_id)
    return NotificationOut(
        id=row.id,
        type=row.type,
        status=row.status,
        title=row.title,
        body=row.body,
        locale=row.locale,
        read_at=row.read_at,
    )


@router.get("/me/notification-preferences", response_model=list[PreferenceOut])
async def get_preferences(
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(db_session)],
) -> list[PreferenceOut]:
    rows = await NotificationService(session).get_preferences(user.id)
    return [
        PreferenceOut(
            notification_type=r.notification_type,
            in_app=r.in_app,
            email=r.email,
            push=r.push,
            sms=r.sms,
        )
        for r in rows
    ]


@router.put("/me/notification-preferences", response_model=PreferenceOut)
async def put_preference(
    body: PreferenceIn,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(db_session)],
) -> PreferenceOut:
    row = await NotificationService(session).upsert_preference(
        user.id,
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
    )
