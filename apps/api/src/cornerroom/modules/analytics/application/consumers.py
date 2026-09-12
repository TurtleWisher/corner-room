"""Outbox consumer for analytics ingest."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.kernel.events import DomainEvent
from cornerroom.modules.analytics.application.service import AnalyticsService


async def consume_analytics_event(event: DomainEvent, session: AsyncSession) -> None:
    await AnalyticsService(session).ingest_event(event)
