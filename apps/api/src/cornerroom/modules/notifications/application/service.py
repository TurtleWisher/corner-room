"""Notification requests and outbox ingest. SMTP is never called here."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import NotFoundError
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import DomainEvent
from cornerroom.kernel.ports import NotificationPort
from cornerroom.modules.identity.application.services import IdentityService
from cornerroom.modules.notifications.application.ports import EmailSender, PushSender, SmsSender
from cornerroom.modules.notifications.application.recipients import resolve_recipient
from cornerroom.modules.notifications.domain.models import (
    Notification,
    NotificationDelivery,
    NotificationPreference,
    NotificationTemplate,
)
from cornerroom.modules.notifications.domain.policy import (
    CHANNEL_AVAILABILITY,
    CHANNEL_EMAIL,
    CHANNEL_IN_APP,
    CONSUMER_NOTIFICATIONS,
    DECISION_SEND,
    QuietHours,
    category_for_event,
    evaluate_channel,
    notification_type_for_event,
    render_template,
    title_for_event,
)
from cornerroom.modules.notifications.infra.stubs import StubEmailSender, StubPushSender, StubSmsSender


class NotificationService:
    def __init__(
        self,
        session: AsyncSession,
        email: EmailSender | None = None,
        sms: SmsSender | None = None,
        push: PushSender | None = None,
        clock: Clock | None = None,
    ) -> None:
        self.session = session
        self.email = email or StubEmailSender()
        self.sms = sms or StubSmsSender()
        self.push = push or StubPushSender()
        self.clock = clock or SystemClock()

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
        category: str | None = None,
        consumer: str | None = None,
        source_event_id: UUID | None = None,
        organization_id: UUID | None = None,
        correlation_id: str | None = None,
        create_email_delivery: bool = True,
    ) -> Notification:
        """Persist inbox + deliveries. Does not call SMTP/SMS/push."""
        del email_to  # resolved later by the delivery worker; never sent here
        row = Notification(
            user_id=user_id,
            type=notification_type,
            status="UNREAD",
            title=title,
            body=body,
            locale=locale,
            aggregate_type=aggregate_type,
            aggregate_id=aggregate_id,
            category=category,
            consumer=consumer,
            source_event_id=source_event_id,
            organization_id=organization_id,
            correlation_id=correlation_id,
        )
        self.session.add(row)
        await self.session.flush()
        self.session.add(
            NotificationDelivery(
                notification_id=row.id,
                channel=CHANNEL_IN_APP,
                status="DELIVERED",
                attempt=1,
            )
        )
        if create_email_delivery:
            self.session.add(
                NotificationDelivery(
                    notification_id=row.id,
                    channel=CHANNEL_EMAIL,
                    status="PENDING",
                    attempt=0,
                    next_attempt_at=self.clock.now(),
                )
            )
        await self.session.flush()
        return row

    async def ingest_event(self, event: DomainEvent) -> Notification | None:
        ntype = notification_type_for_event(event.event_type)
        if ntype is None:
            return None
        user_id = await resolve_recipient(self.session, event)
        if user_id is None:
            return None
        existing = (
            await self.session.execute(
                select(Notification).where(
                    Notification.consumer == CONSUMER_NOTIFICATIONS,
                    Notification.source_event_id == event.event_id,
                    Notification.type == ntype,
                    Notification.user_id == user_id,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            return existing
        category = category_for_event(event.event_type)
        preference = await self._preference(user_id, ntype)
        quiet = QuietHours(
            start=preference.quiet_hours_start if preference else None,
            end=preference.quiet_hours_end if preference else None,
            timezone=preference.quiet_hours_timezone if preference else None,
        )
        in_app = evaluate_channel(
            category=category, channel=CHANNEL_IN_APP, quiet_hours=quiet
        )
        email = evaluate_channel(
            category=category, channel=CHANNEL_EMAIL, quiet_hours=quiet
        )
        if in_app.action != DECISION_SEND and email.action != DECISION_SEND:
            return None
        title = title_for_event(event.event_type)
        locale, body, template_ok = await self._resolve_template(ntype, event)
        create_email = email.action == DECISION_SEND
        row = Notification(
            user_id=user_id,
            type=ntype,
            status="UNREAD",
            title=title,
            body=body,
            locale=locale,
            aggregate_type=event.aggregate_type,
            aggregate_id=event.aggregate_id,
            category=category,
            consumer=CONSUMER_NOTIFICATIONS,
            source_event_id=event.event_id,
            organization_id=event.organization_id,
            correlation_id=event.correlation_id,
        )
        self.session.add(row)
        try:
            async with self.session.begin_nested():
                await self.session.flush()
        except IntegrityError:
            replay = (
                await self.session.execute(
                    select(Notification).where(
                        Notification.consumer == CONSUMER_NOTIFICATIONS,
                        Notification.source_event_id == event.event_id,
                        Notification.type == ntype,
                        Notification.user_id == user_id,
                    )
                )
            ).scalar_one_or_none()
            return replay
        if in_app.action == DECISION_SEND:
            self.session.add(
                NotificationDelivery(
                    notification_id=row.id,
                    channel=CHANNEL_IN_APP,
                    status="DELIVERED",
                    attempt=1,
                )
            )
        if create_email:
            status = "PENDING" if template_ok else "FAILED"
            self.session.add(
                NotificationDelivery(
                    notification_id=row.id,
                    channel=CHANNEL_EMAIL,
                    status=status,
                    attempt=0 if template_ok else 1,
                    next_attempt_at=None,
                    last_error=None if template_ok else "template_missing",
                    provider_code="stub" if template_ok else None,
                )
            )
        elif email.action != DECISION_SEND:
            self.session.add(
                NotificationDelivery(
                    notification_id=row.id,
                    channel=CHANNEL_EMAIL,
                    status="SUPPRESSED",
                    attempt=0,
                    last_error=email.reason,
                )
            )
        await self.session.flush()
        return row

    async def _resolve_template(self, notification_type: str, event: DomainEvent) -> tuple[str, str, bool]:
        locale = "en"
        stmt = (
            select(NotificationTemplate)
            .where(
                NotificationTemplate.type == notification_type,
                NotificationTemplate.locale == locale,
            )
            .order_by(NotificationTemplate.version.desc())
        )
        template = (await self.session.execute(stmt)).scalars().first()
        title = title_for_event(event.event_type)
        if template is None:
            return locale, title, False
        values = {k: str(v) for k, v in (event.payload or {}).items() if v is not None}
        values.setdefault("title", title)
        rendered = render_template(template.body, values)
        if rendered is None:
            if "{" in template.body and "}" in template.body:
                return locale, title, False
            return locale, template.body, True
        return locale, rendered, True

    async def _preference(
        self, user_id: UUID, notification_type: str
    ) -> NotificationPreference | None:
        return (
            await self.session.execute(
                select(NotificationPreference).where(
                    NotificationPreference.user_id == user_id,
                    NotificationPreference.notification_type == notification_type,
                )
            )
        ).scalar_one_or_none()

    def channel_availability(self) -> dict[str, str]:
        return dict(CHANNEL_AVAILABILITY)

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
        if row.status == "READ" and row.read_at is not None:
            return row
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

    async def process_pending_email_deliveries(self, limit: int = 50) -> int:
        """Send PENDING/FAILED email deliveries. Never raises into the OLTP txn."""
        now = self.clock.now()
        stmt = (
            select(NotificationDelivery)
            .where(
                NotificationDelivery.channel == CHANNEL_EMAIL,
                NotificationDelivery.status.in_(("PENDING", "FAILED")),
                or_(
                    NotificationDelivery.next_attempt_at.is_(None),
                    NotificationDelivery.next_attempt_at <= now,
                ),
            )
            .order_by(NotificationDelivery.created_at.asc())
            .limit(limit)
        )
        rows = list((await self.session.execute(stmt)).scalars().all())
        sent = 0
        from cornerroom.infra.settings import get_settings

        identity = IdentityService(self.session, get_settings())
        for delivery in rows:
            notification = await self.session.get(Notification, delivery.notification_id)
            if notification is None:
                delivery.status = "FAILED"
                delivery.last_error = "notification_missing"
                delivery.attempt += 1
                continue
            template_ok = await self._template_exists(notification.type, notification.locale)
            if not template_ok:
                delivery.status = "FAILED"
                delivery.attempt += 1
                delivery.last_error = "template_missing"
                delivery.next_attempt_at = None
                continue
            try:
                user = await identity.get_user_row(notification.user_id)
            except NotFoundError:
                delivery.status = "SUPPRESSED"
                delivery.last_error = "no_recipient"
                continue
            to = user.email
            if not to:
                delivery.status = "SUPPRESSED"
                delivery.last_error = "no_email"
                continue
            delivery.attempt += 1
            try:
                ref = await self.email.send(
                    to=to,
                    subject=notification.title,
                    body=notification.body,
                    locale=notification.locale,
                )
            except Exception as exc:
                delivery.status = "FAILED"
                delivery.last_error = str(exc)[:2000]
                delivery.next_attempt_at = now
                continue
            delivery.status = "SENT"
            delivery.provider_ref = ref
            delivery.provider_code = "stub"
            delivery.last_error = None
            delivery.next_attempt_at = None
            sent += 1
        await self.session.flush()
        return sent

    async def _template_exists(self, notification_type: str, locale: str) -> bool:
        row = (
            await self.session.execute(
                select(NotificationTemplate.id).where(
                    NotificationTemplate.type == notification_type,
                    NotificationTemplate.locale == locale,
                )
            )
        ).first()
        return row is not None


class InboxNotificationPort:
    """NotificationPort bind: persist inbox, never SMTP. Domain modules may use this."""

    def __init__(self, session: AsyncSession) -> None:
        self._service = NotificationService(session)

    async def request(
        self,
        *,
        user_id: UUID,
        notification_type: str,
        title: str,
        body: str,
    ) -> None:
        await self._service.request(
            user_id=user_id,
            notification_type=notification_type,
            title=title,
            body=body,
            create_email_delivery=True,
        )


def as_notification_port(session: AsyncSession) -> NotificationPort:
    return InboxNotificationPort(session)
