"""ROYALTY_ACCRUAL port. Phase 11 posts the ledger; this phase emits the obligation fact."""

from __future__ import annotations

from typing import Any, Protocol
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.kernel.clock import Clock
from cornerroom.kernel.events import DomainEvent, ROYALTY_POSTED


class RoyaltyAccrualPort(Protocol):
    async def accrue(
        self,
        *,
        royalty_id: UUID,
        revenue_pool_id: UUID,
        amount_minor: int,
        currency_code: str,
        actor_id: UUID | None,
        correlation_id: str | None,
        payload: dict[str, Any],
    ) -> None: ...


class OutboxRoyaltyAccrual:
    def __init__(self, session: AsyncSession, clock: Clock) -> None:
        self.session = session
        self.clock = clock

    async def accrue(
        self,
        *,
        royalty_id: UUID,
        revenue_pool_id: UUID,
        amount_minor: int,
        currency_code: str,
        actor_id: UUID | None,
        correlation_id: str | None,
        payload: dict[str, Any],
    ) -> None:
        event = DomainEvent(
            event_type=ROYALTY_POSTED,
            producer="royalties",
            aggregate_type="Royalty",
            aggregate_id=royalty_id,
            payload={
                "revenue_pool_id": str(revenue_pool_id),
                "amount_minor": amount_minor,
                "currency_code": currency_code,
                "accrual": "ROYALTY_ACCRUAL",
                **payload,
            },
            occurred_at=self.clock.now(),
            actor_id=actor_id,
            correlation_id=correlation_id,
        )
        await enqueue_outbox(self.session, event)
