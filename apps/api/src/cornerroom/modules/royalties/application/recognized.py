"""Recognized-revenue port. Finance (Phase 11) owns recognition; royalties consume facts."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, ConflictError
from cornerroom.kernel.money import Money
from cornerroom.modules.royalties.domain.models import RecognizedRevenueIntake


@dataclass(frozen=True, slots=True)
class RecognizedRevenueFact:
    intake_id: UUID
    source_type: str
    period_start: datetime
    period_end: datetime
    money: Money


class RecognizedRevenuePort(Protocol):
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
    ) -> RecognizedRevenueFact: ...

    async def amount_for(
        self,
        *,
        source_type: str,
        period_start: datetime,
        period_end: datetime,
        currency_code: str,
    ) -> RecognizedRevenueFact | None: ...


class IntakeRecognizedRevenue:
    """Stores royalty-side intake rows. Does not post LedgerEntry."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

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
        money = Money(amount_minor, currency_code)
        existing = (
            await self.session.execute(
                select(RecognizedRevenueIntake).where(
                    RecognizedRevenueIntake.idempotency_key == idempotency_key
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            return RecognizedRevenueFact(
                intake_id=existing.id,
                source_type=existing.source_type,
                period_start=existing.period_start,
                period_end=existing.period_end,
                money=Money(existing.amount_minor, existing.currency_code),
            )
        if period_end <= period_start:
            raise AppError("INVALID_PERIOD", "period_end must be after period_start", 422)
        row = RecognizedRevenueIntake(
            source_type=source_type,
            source_id=source_id,
            period_start=period_start,
            period_end=period_end,
            currency_code=money.currency_code,
            amount_minor=money.amount_minor,
            idempotency_key=idempotency_key,
            created_by=actor_id,
            updated_by=actor_id,
        )
        self.session.add(row)
        try:
            await self.session.flush()
        except IntegrityError as exc:
            raise ConflictError("Duplicate recognized-revenue intake") from exc
        return RecognizedRevenueFact(
            intake_id=row.id,
            source_type=row.source_type,
            period_start=row.period_start,
            period_end=row.period_end,
            money=money,
        )

    async def amount_for(
        self,
        *,
        source_type: str,
        period_start: datetime,
        period_end: datetime,
        currency_code: str,
    ) -> RecognizedRevenueFact | None:
        code = currency_code.upper()
        rows = (
            await self.session.execute(
                select(RecognizedRevenueIntake).where(
                    RecognizedRevenueIntake.source_type == source_type,
                    RecognizedRevenueIntake.period_start == period_start,
                    RecognizedRevenueIntake.period_end == period_end,
                    RecognizedRevenueIntake.currency_code == code,
                )
            )
        ).scalars().all()
        if not rows:
            return None
        total = sum(row.amount_minor for row in rows)
        first = rows[0]
        return RecognizedRevenueFact(
            intake_id=first.id,
            source_type=source_type,
            period_start=period_start,
            period_end=period_end,
            money=Money(total, code),
        )
