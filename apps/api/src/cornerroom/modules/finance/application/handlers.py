"""Outbox consumers for finance facts. Idempotent with in-process posting."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.outbox_dispatch import register_handler
from cornerroom.kernel.events import DomainEvent, PAYMENT_CAPTURED, REFUND_COMPLETED, ROYALTY_POSTED
from cornerroom.modules.finance.application.recognition import RecognitionService
from cornerroom.modules.finance.domain.models import Payment, Refund


async def handle_payment_captured(event: DomainEvent, session: AsyncSession) -> None:
    payment_id = event.payload.get("payment_id")
    if not payment_id:
        return
    payment = await session.get(Payment, UUID(str(payment_id)))
    if payment is None:
        return
    await RecognitionService(session).ingest_captured_payment(None, payment)


async def handle_refund_completed(event: DomainEvent, session: AsyncSession) -> None:
    refund_id = event.payload.get("refund_id") or event.aggregate_id
    refund = await session.get(Refund, UUID(str(refund_id)))
    if refund is None:
        return
    await RecognitionService(session).reverse_refund(None, refund)


async def handle_royalty_posted(event: DomainEvent, session: AsyncSession) -> None:
    org_id = event.organization_id
    amount = event.payload.get("amount_minor")
    currency = event.payload.get("currency_code")
    if org_id is None or amount is None or currency is None:
        return
    if int(amount) <= 0:
        return
    await RecognitionService(session).accrue_royalty(
        None,
        royalty_id=event.aggregate_id,
        organization_id=org_id,
        amount_minor=int(amount),
        currency_code=str(currency),
        revenue_pool_id=UUID(str(event.payload["revenue_pool_id"]))
        if event.payload.get("revenue_pool_id")
        else None,
    )


def register_finance_handlers() -> None:
    register_handler(PAYMENT_CAPTURED, handle_payment_captured)
    register_handler(REFUND_COMPLETED, handle_refund_completed)
    register_handler(ROYALTY_POSTED, handle_royalty_posted)
