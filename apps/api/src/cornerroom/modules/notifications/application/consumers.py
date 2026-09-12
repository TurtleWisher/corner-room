"""Outbox consumer for notifications. Independent of search/analytics."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.kernel.events import DomainEvent
from cornerroom.modules.notifications.application.service import NotificationService


async def consume_notification_event(event: DomainEvent, session: AsyncSession) -> None:
    await NotificationService(session).ingest_event(event)
