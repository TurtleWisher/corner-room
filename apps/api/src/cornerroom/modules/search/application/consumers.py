"""Outbox consumer for search projection."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.kernel.events import DomainEvent
from cornerroom.modules.search.application.service import SearchService


async def consume_search_event(event: DomainEvent, session: AsyncSession) -> None:
    await SearchService(session).ingest_event(event)
