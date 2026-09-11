"""RoyaltyPosted → ROYALTY_ACCRUAL journal in the same transaction as POSTED."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.modules.finance.application.recognition import RecognitionService
from cornerroom.modules.royalties.application.accrual import OutboxRoyaltyAccrual


class FinanceRoyaltyAccrual:
    def __init__(
        self,
        session: AsyncSession,
        clock: Clock | None = None,
        organization_id: UUID | None = None,
    ) -> None:
        self.session = session
        self.clock = clock or SystemClock()
        self.organization_id = organization_id
        self.outbox = OutboxRoyaltyAccrual(session, self.clock)
        self.recognition = RecognitionService(session, clock=self.clock)

    def bind(self, organization_id: UUID) -> FinanceRoyaltyAccrual:
        return FinanceRoyaltyAccrual(self.session, clock=self.clock, organization_id=organization_id)

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
        org_id = self.organization_id
        if org_id is not None and amount_minor > 0:
            await self.recognition.accrue_royalty(
                None,
                royalty_id=royalty_id,
                organization_id=org_id,
                amount_minor=amount_minor,
                currency_code=currency_code,
                revenue_pool_id=revenue_pool_id,
            )
        await self.outbox.accrue(
            royalty_id=royalty_id,
            revenue_pool_id=revenue_pool_id,
            amount_minor=amount_minor,
            currency_code=currency_code,
            actor_id=actor_id,
            correlation_id=correlation_id,
            payload=payload,
        )
