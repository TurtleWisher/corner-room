"""Email delivery retries (BACKGROUND_JOBS: backoff until the attempt limit, then FAILED).

Before this pass a failed send was retried on every worker tick with no backoff and no limit, and
FAILED rows were picked again forever; 50 of them filled every batch and new mail never went out.
"""

from __future__ import annotations

from datetime import timedelta
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import async_sessionmaker

from cornerroom.infra.db import get_engine
from cornerroom.infra.settings import get_settings
from cornerroom.kernel.clock import SystemClock
from cornerroom.modules.notifications.application.service import NotificationService
from cornerroom.modules.notifications.domain.models import Notification, NotificationDelivery
from cornerroom.modules.notifications.infra.stubs import StubEmailSender
from tests.auth_helpers import register_and_login


class _DownEmail:
    async def send(self, *, to: str, subject: str, body: str, locale: str = "en") -> str | None:
        raise RuntimeError("provider unavailable")


async def _user_id(client: AsyncClient, email: str) -> UUID:
    me = await client.get("/api/v1/me", headers={"Authorization": f"Bearer {(await register_and_login(client, email))['access_token']}"})
    return UUID(me.json()["id"])


async def _notice(session, user_id: UUID, status: str = "PENDING") -> NotificationDelivery:
    row = Notification(user_id=user_id, type="order.paid", status="UNREAD", title="Order paid", body="Your order was paid.", locale="en")
    session.add(row)
    await session.flush()
    delivery = NotificationDelivery(notification_id=row.id, channel="email", status=status, attempt=0)
    session.add(delivery)
    await session.flush()
    return delivery


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase16_failed_email_backs_off_then_fails(client: AsyncClient) -> None:
    user_id = await _user_id(client, "mail-retry@example.com")
    settings = get_settings()
    factory = async_sessionmaker(get_engine(), expire_on_commit=False)
    async with factory() as session:
        delivery = await _notice(session, user_id)
        await session.commit()

        down = NotificationService(session, email=_DownEmail())
        assert await down.process_pending_email_deliveries() == 0
        await session.refresh(delivery)
        assert delivery.status == "PENDING" and delivery.attempt == 1
        assert delivery.next_attempt_at is not None and delivery.next_attempt_at > SystemClock().now()

        # Not due yet: the next tick leaves it alone.
        await down.process_pending_email_deliveries()
        await session.refresh(delivery)
        assert delivery.attempt == 1

        # The last allowed attempt fails for good.
        await session.execute(
            update(NotificationDelivery)
            .where(NotificationDelivery.id == delivery.id)
            .values(attempt=settings.outbox_max_attempts - 1, next_attempt_at=SystemClock().now() - timedelta(seconds=1))
        )
        await session.commit()
        await down.process_pending_email_deliveries()
        await session.refresh(delivery)
        assert delivery.status == "FAILED" and delivery.next_attempt_at is None
        assert delivery.last_error == "provider unavailable"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase16_failed_deliveries_do_not_block_new_mail(client: AsyncClient) -> None:
    user_id = await _user_id(client, "mail-queue@example.com")
    factory = async_sessionmaker(get_engine(), expire_on_commit=False)
    async with factory() as session:
        for _ in range(60):
            await _notice(session, user_id, status="FAILED")
        fresh = await _notice(session, user_id)
        await session.commit()

        assert await NotificationService(session, email=StubEmailSender()).process_pending_email_deliveries() == 1
        await session.refresh(fresh)
        assert fresh.status == "SENT"
        failed = (
            await session.execute(select(NotificationDelivery).where(NotificationDelivery.status == "FAILED"))
        ).scalars().all()
        assert len(failed) == 60 and all(row.attempt == 0 for row in failed)
