"""Notification requests. Failures must not roll back domain transactions."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import NotFoundError
from cornerroom.kernel.events import ORGANIZATION_INVITATION_ISSUED, USER_REGISTERED, DomainEvent
from cornerroom.modules.notifications.application.ports import EmailSender, PushSender, SmsSender
from cornerroom.modules.notifications.domain.models import (
    Notification,
    NotificationDelivery,
    NotificationPreference,
)
from cornerroom.modules.notifications.infra.stubs import StubEmailSender, StubPushSender, StubSmsSender


class NotificationService:
    def __init__(
        self,
        session: AsyncSession,
        email: EmailSender | None = None,
        sms: SmsSender | None = None,
        push: PushSender | None = None,
    ) -> None:
        self.session = session
        self.email = email or StubEmailSender()
        self.sms = sms or StubSmsSender()
        self.push = push or StubPushSender()

    async def request(
        self,
        *,
        user_id: UUID,
        notification_type: str,
        title: str,
        body: str,
        locale: str = "en",
        aggregate_type: str | None = None,
        aggregate_id: UUID | None = None,
        email_to: str | None = None,
    ) -> Notification:
        row = Notification(
            user_id=user_id,
            type=notification_type,
            status="UNREAD",
            title=title,
            body=body,
            locale=locale,
            aggregate_type=aggregate_type,
            aggregate_id=aggregate_id,
        )
        self.session.add(row)
        await self.session.flush()
        self.session.add(
            NotificationDelivery(
                notification_id=row.id,
                channel="in_app",
                status="DELIVERED",
                attempt=1,
            )
        )
        if email_to:
            ref = await self.email.send(to=email_to, subject=title, body=body, locale=locale)
            self.session.add(
                NotificationDelivery(
                    notification_id=row.id,
                    channel="email",
                    status="SENT",
                    provider_ref=ref,
                    attempt=1,
                )
            )
        return row

    async def list_for_user(self, user_id: UUID, limit: int = 50) -> list[Notification]:
        stmt = (
            select(Notification)
            .where(Notification.user_id == user_id)
            .order_by(Notification.created_at.desc())
            .limit(limit)
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def mark_read(self, user_id: UUID, notification_id: UUID) -> Notification:
        row = await self.session.get(Notification, notification_id)
        if row is None or row.user_id != user_id:
            raise NotFoundError("Notification not found")
        row.status = "READ"
        row.read_at = datetime.now(timezone.utc)
        await self.session.flush()
        return row

    async def get_preferences(self, user_id: UUID) -> list[NotificationPreference]:
        stmt = select(NotificationPreference).where(NotificationPreference.user_id == user_id)
        return list((await self.session.execute(stmt)).scalars().all())

    async def upsert_preference(
        self,
        user_id: UUID,
        notification_type: str,
        *,
        in_app: bool,
        email: bool,
        push: bool,
        sms: bool,
    ) -> NotificationPreference:
        stmt = select(NotificationPreference).where(
            NotificationPreference.user_id == user_id,
            NotificationPreference.notification_type == notification_type,
        )
        row = (await self.session.execute(stmt)).scalar_one_or_none()
        if row is None:
            row = NotificationPreference(
                user_id=user_id,
                notification_type=notification_type,
                in_app=in_app,
                email=email,
                push=push,
                sms=sms,
            )
            self.session.add(row)
        else:
            row.in_app = in_app
            row.email = email
            row.push = push
            row.sms = sms
        await self.session.flush()
        return row


async def handle_user_registered(event: DomainEvent, session: AsyncSession) -> None:
    if event.event_type != USER_REGISTERED:
        return
    existing = (
        await session.execute(
            select(Notification).where(
                Notification.user_id == event.aggregate_id,
                Notification.type == "user.registered",
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return
    email = event.payload.get("email")
    service = NotificationService(session)
    await service.request(
        user_id=event.aggregate_id,
        notification_type="user.registered",
        title="Welcome to Corner Room",
        body="Your account was created.",
        aggregate_type="User",
        aggregate_id=event.aggregate_id,
        email_to=email,
    )


async def handle_organization_invitation_issued(event: DomainEvent, session: AsyncSession) -> None:
    if event.event_type != ORGANIZATION_INVITATION_ISSUED:
        return
    invited_user_id = event.payload.get("invited_user_id")
    if not invited_user_id:
        return
    user_id = UUID(str(invited_user_id))
    existing = (
        await session.execute(
            select(Notification).where(
                Notification.user_id == user_id,
                Notification.type == "organization.invitation_issued",
                Notification.aggregate_id == event.aggregate_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return
    service = NotificationService(session)
    await service.request(
        user_id=user_id,
        notification_type="organization.invitation_issued",
        title="Organization invitation",
        body="You were invited to a Corner Room organization.",
        aggregate_type="OrganizationInvitation",
        aggregate_id=event.aggregate_id,
    )
