"""Notification integration: event → outbox → consumer, isolation, delivery, no fan-out."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

import pytest

from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.infra.outbox_dispatch import dispatch_outbox
from cornerroom.kernel.events import (
    ACCOUNT_LOCKED,
    CAMPAIGN_STARTED,
    EVENT_CANCELLED,
    EVENT_POSTPONED,
    PASSWORD_CHANGED,
    REFRESH_TOKEN_REPLAY_DETECTED,
    USER_REGISTERED,
)
from cornerroom.modules.notifications.application.service import NotificationService
from cornerroom.modules.notifications.domain.models import Notification, NotificationDelivery
from cornerroom.modules.notifications.domain.policy import (
    CATEGORY_SECURITY,
    CATEGORY_TRANSACTIONAL,
    CHANNEL_EMAIL,
    CONSUMER_NOTIFICATIONS,
)
from tests.integration.phase13.graph import FrozenClock, Phase13Graph, domain_event, p13_time


class FailingEmailSender:
    async def send(self, *, to: str, subject: str, body: str, locale: str = "en") -> str | None:
        del to, subject, body, locale
        raise RuntimeError("qa_p13_stub_email_fail")


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_notification_from_user_registered_outbox(
    pg_session: AsyncSession,
    p13_graph: Phase13Graph,
) -> None:
    g = p13_graph
    event = domain_event(
        event_type=USER_REGISTERED,
        producer="identity",
        aggregate_type="User",
        aggregate_id=g.user_a.id,
        payload={"email": g.user_a.email, "user_id": str(g.user_a.id)},
        actor_id=g.user_a.id,
    )
    row = await enqueue_outbox(pg_session, event)
    await dispatch_outbox(pg_session, row)
    note = (
        await pg_session.execute(
            select(Notification).where(
                Notification.user_id == g.user_a.id,
                Notification.type == "user.registered",
                Notification.source_event_id == row.id,
                Notification.consumer == CONSUMER_NOTIFICATIONS,
            )
        )
    ).scalar_one()
    assert note.status == "UNREAD"
    assert note.category == CATEGORY_TRANSACTIONAL
    deliveries = (
        (
            await pg_session.execute(
                select(NotificationDelivery).where(NotificationDelivery.notification_id == note.id)
            )
        )
        .scalars()
        .all()
    )
    channels = {row.channel for row in deliveries}
    assert "in_app" in channels
    assert CHANNEL_EMAIL in channels
    other = (
        (await pg_session.execute(select(Notification).where(Notification.user_id == g.user_b.id)))
        .scalars()
        .all()
    )
    assert other == []


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_security_notifications_target_intended_user(
    pg_session: AsyncSession,
    p13_graph: Phase13Graph,
) -> None:
    g = p13_graph
    specs = (
        (PASSWORD_CHANGED, "password.changed", g.user_a.id, None),
        (ACCOUNT_LOCKED, "account.locked", g.user_a.id, None),
        (REFRESH_TOKEN_REPLAY_DETECTED, "refresh_token.replay_detected", g.user_a.id, g.user_a.id),
    )
    for event_type, ntype, aggregate_id, actor_id in specs:
        event = domain_event(
            event_type=event_type,
            producer="identity",
            aggregate_type="User",
            aggregate_id=aggregate_id,
            payload={},
            actor_id=actor_id,
        )
        row = await enqueue_outbox(pg_session, event)
        await dispatch_outbox(pg_session, row)
        notes = (
            (
                await pg_session.execute(
                    select(Notification).where(
                        Notification.source_event_id == row.id,
                        Notification.type == ntype,
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(notes) == 1
        assert notes[0].user_id == g.user_a.id
        assert notes[0].category == CATEGORY_SECURITY
        assert notes[0].user_id != g.user_b.id


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_no_fan_out_for_cancelled_postponed_or_campaign(
    pg_session: AsyncSession,
    p13_graph: Phase13Graph,
) -> None:
    g = p13_graph
    before = (await pg_session.execute(select(func.count()).select_from(Notification))).scalar_one()
    for event_type, aggregate_type, aggregate_id in (
        (EVENT_CANCELLED, "Event", g.event_a.id),
        (EVENT_POSTPONED, "Event", g.event_a.id),
        (CAMPAIGN_STARTED, "Campaign", g.campaign_a.id),
    ):
        event = domain_event(
            event_type=event_type,
            producer="events" if "Event" in event_type else "campaigns",
            aggregate_type=aggregate_type,
            aggregate_id=aggregate_id,
            payload={"organization_id": str(g.org_a.id)},
            organization_id=g.org_a.id,
        )
        row = await enqueue_outbox(pg_session, event)
        await dispatch_outbox(pg_session, row)
    after = (await pg_session.execute(select(func.count()).select_from(Notification))).scalar_one()
    assert after == before


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_stub_email_failure_sets_retry_and_is_idempotent(
    pg_session: AsyncSession,
    p13_graph: Phase13Graph,
) -> None:
    g = p13_graph
    clock = FrozenClock(p13_time())
    event = domain_event(
        event_type=USER_REGISTERED,
        producer="identity",
        aggregate_type="User",
        aggregate_id=g.user_a.id,
        payload={"email": g.user_a.email},
        actor_id=g.user_a.id,
        occurred_at=clock.now(),
    )
    row = await enqueue_outbox(pg_session, event)
    await dispatch_outbox(pg_session, row)
    note = (
        await pg_session.execute(select(Notification).where(Notification.source_event_id == row.id))
    ).scalar_one()
    service = NotificationService(pg_session, email=FailingEmailSender(), clock=clock)
    sent = await service.process_pending_email_deliveries()
    assert sent == 0
    delivery = (
        await pg_session.execute(
            select(NotificationDelivery).where(
                NotificationDelivery.notification_id == note.id,
                NotificationDelivery.channel == CHANNEL_EMAIL,
            )
        )
    ).scalar_one()
    assert delivery.status == "FAILED"
    assert delivery.next_attempt_at == clock.now()
    assert delivery.last_error
    assert "secret" not in (delivery.last_error or "").lower()
    assert delivery.attempt >= 1
    first_attempt = delivery.attempt
    sent_again = await service.process_pending_email_deliveries()
    assert sent_again == 0
    await pg_session.refresh(delivery)
    assert delivery.status == "FAILED"
    assert delivery.attempt == first_attempt + 1
    count = (
        await pg_session.execute(
            select(func.count())
            .select_from(NotificationDelivery)
            .where(
                NotificationDelivery.notification_id == note.id,
                NotificationDelivery.channel == CHANNEL_EMAIL,
            )
        )
    ).scalar_one()
    assert count == 1
