"""Finance-authoritative recognized revenue. Phase 10 intake remains compatible."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.money import Money
from cornerroom.modules.finance.application.recognition import RecognitionService
from cornerroom.modules.finance.domain.models import Revenue
from cornerroom.modules.royalties.application.recognized import (
    IntakeRecognizedRevenue,
    RecognizedRevenueFact,
)


class FinanceRecognizedRevenue:
    """Posts Finance Revenue, then mirrors intake so freeze still works."""

    def __init__(
        self,
        session: AsyncSession,
        clock: Clock | None = None,
        organization_id: UUID | None = None,
        ctx: AuthContext | None = None,
    ) -> None:
        self.session = session
        self.clock = clock or SystemClock()
        self.organization_id = organization_id
        self.ctx = ctx
        self.intake = IntakeRecognizedRevenue(session)
        self.recognition = RecognitionService(session, clock=self.clock)

    def bind(self, *, organization_id: UUID, ctx: AuthContext | None) -> FinanceRecognizedRevenue:
        return FinanceRecognizedRevenue(
            self.session,
            clock=self.clock,
            organization_id=organization_id,
            ctx=ctx,
        )

    async def record(
        self,
        *,
        source_type: str,
        period_start: datetime,
        period_end: datetime,
        amount_minor: int,
        currency_code: str,
        idempotency_key: str,
        source_id: UUID | None = None,
        actor_id: UUID | None = None,
    ) -> RecognizedRevenueFact:
        del actor_id
        org_id = self.organization_id
        if org_id is None:
            return await self.intake.record(
                source_type=source_type,
                period_start=period_start,
                period_end=period_end,
                amount_minor=amount_minor,
                currency_code=currency_code,
                idempotency_key=idempotency_key,
                source_id=source_id,
            )
        revenue = await self.recognition.record_manual(
            self.ctx,
            organization_id=org_id,
            source_type=source_type,
            period_start=period_start,
            period_end=period_end,
            amount_minor=amount_minor,
            currency_code=currency_code,
            idempotency_key=idempotency_key,
            source_id=source_id,
        )
        fact = await self.intake.record(
            source_type=source_type,
            period_start=period_start,
            period_end=period_end,
            amount_minor=revenue.amount_minor,
            currency_code=revenue.currency_code,
            idempotency_key=idempotency_key,
            source_id=revenue.source_id,
            actor_id=self.ctx.user_id if self.ctx else None,
        )
        return fact

    async def amount_for(
        self,
        *,
        source_type: str,
        period_start: datetime,
        period_end: datetime,
        currency_code: str,
    ) -> RecognizedRevenueFact | None:
        code = currency_code.upper()
        stmt = select(Revenue).where(
            Revenue.category == source_type,
            Revenue.status == "RECOGNIZED",
            Revenue.currency_code == code,
            Revenue.period_start == period_start,
            Revenue.period_end == period_end,
        )
        if self.organization_id is not None:
            stmt = stmt.where(Revenue.organization_id == self.organization_id)
        rows = list((await self.session.execute(stmt)).scalars())
        if rows:
            total = sum(row.amount_minor for row in rows)
            first = rows[0]
            return RecognizedRevenueFact(
                intake_id=first.id,
                source_type=source_type,
                period_start=period_start,
                period_end=period_end,
                money=Money(total, code),
            )
        return await self.intake.amount_for(
            source_type=source_type,
            period_start=period_start,
            period_end=period_end,
            currency_code=code,
        )
