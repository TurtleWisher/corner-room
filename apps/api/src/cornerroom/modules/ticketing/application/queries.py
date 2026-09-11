"""Read-only ticketing queries for other modules (application interface)."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.modules.ticketing.domain.models import TicketType


async def has_on_sale_ticket_type(session: AsyncSession, event_id: UUID) -> bool:
    count = (
        await session.execute(
            select(func.count())
            .select_from(TicketType)
            .where(
                TicketType.event_id == event_id,
                TicketType.status == "ON_SALE",
                TicketType.deleted_at.is_(None),
            )
        )
    ).scalar_one()
    return int(count) >= 1
