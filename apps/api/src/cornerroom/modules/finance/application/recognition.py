"""Revenue recognition. Facts from events/ports; Finance posts the books."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, ConflictError, NotFoundError
from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import DomainEvent, REVENUE_RECOGNIZED
from cornerroom.kernel.money import Money
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.commerce.domain.models import Order, OrderItem, TaxLine
from cornerroom.modules.events.domain.models import Event
from cornerroom.modules.finance.application.ledger import LedgerLineInput, LedgerService
from cornerroom.modules.finance.domain.coa import (
    CODE_CONTRA_REVENUE,
    CODE_DEFERRED_REVENUE,
    CODE_MUSIC_REVENUE,
    CODE_PLATFORM_INCOME,
    CODE_PSP_CLEARING,
    CODE_ROYALTY_EXPENSE,
    CODE_ROYALTY_LIABILITY,
    CODE_SUBSCRIPTION_REVENUE,
    CODE_TICKET_REVENUE,
)
from cornerroom.modules.finance.domain.lifecycle import revenue_transition_action
from cornerroom.modules.finance.domain.models import FinanceTransaction, Payment, Refund, Revenue
from cornerroom.modules.identity.domain.models import Organization
from cornerroom.modules.subscriptions.domain.models import SubscriptionPeriod
from cornerroom.modules.ticketing.domain.models import TicketHold, TicketType


class RecognitionService:
    def __init__(self, session: AsyncSession, clock: Clock | None = None) -> None:
        self.session = session
        self.clock = clock or SystemClock()
        self.audit = AuditService(session)
        self.ledger = LedgerService(session, clock=self.clock)

    async def _org_share_bps(self, organization_id: UUID) -> int:
        org = await self.session.get(Organization, organization_id)
        if org is None or org.share_bps is None or org.share_bps <= 0:
            return 0
        return org.share_bps

    def _split_take(self, amount_minor: int, share_bps: int) -> tuple[int, int]:
        if share_bps <= 0:
            return amount_minor, 0
        take = (amount_minor * share_bps) // 10_000
        return amount_minor - take, take

    async def _upsert_revenue(
        self,
        *,
        organization_id: UUID,
        category: str,
        source_type: str,
        source_id: UUID,
        amount_minor: int,
        currency_code: str,
        transaction_id: UUID,
        actor_id: UUID | None,
        event_id: UUID | None = None,
        track_id: UUID | None = None,
        period_start: datetime | None = None,
        period_end: datetime | None = None,
    ) -> Revenue:
        existing = (
            await self.session.execute(
                select(Revenue).where(
                    Revenue.source_type == source_type,
                    Revenue.source_id == source_id,
                    Revenue.category == category,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            return existing
        now = self.clock.now()
        row = Revenue(
            organization_id=organization_id,
            status="DRAFT",
            category=category,
            source_type=source_type,
            source_id=source_id,
            amount_minor=amount_minor,
            currency_code=currency_code,
            recognized_at=now,
            transaction_id=transaction_id,
            event_id=event_id,
            track_id=track_id,
            period_start=period_start,
            period_end=period_end,
            created_by=actor_id,
            updated_by=actor_id,
        )
        self.session.add(row)
        try:
            await self.session.flush()
        except IntegrityError as exc:
            current = (
                await self.session.execute(
                    select(Revenue).where(
                        Revenue.source_type == source_type,
                        Revenue.source_id == source_id,
                        Revenue.category == category,
                    )
                )
            ).scalar_one_or_none()
            if current is not None:
                return current
            raise ConflictError("Duplicate revenue recognition") from exc
        revenue_transition_action(row.status, "RECOGNIZED")
        row.status = "RECOGNIZED"
        await self.session.flush()
        return row

    async def ingest_captured_payment(self, ctx: AuthContext | None, payment: Payment) -> list[Revenue]:
        if payment.status != "CAPTURED" or payment.order_id is None:
            return []
        order = await self.session.get(Order, payment.order_id)
        if order is None:
            return []
        items = list(
            (await self.session.execute(select(OrderItem).where(OrderItem.order_id == order.id))).scalars()
        )
        recognized: list[Revenue] = []
        if order.purpose == "TICKET":
            recognized.extend(await self._recognize_ticket_items(ctx, payment, order, items))
        elif order.purpose == "TRACK":
            recognized.extend(await self._recognize_music_items(ctx, payment, order, items))
        elif order.purpose == "SUBSCRIPTION":
            await self._post_subscription_deferral(ctx, payment, order)
        return recognized

    async def _event_for_ticket_order(self, order: Order) -> tuple[UUID | None, UUID | None]:
        hold = (
            await self.session.execute(select(TicketHold).where(TicketHold.order_id == order.id))
        ).scalar_one_or_none()
        if hold is None:
            return None, None
        ticket_type = await self.session.get(TicketType, hold.ticket_type_id)
        if ticket_type is None:
            return None, None
        event = await self.session.get(Event, ticket_type.event_id)
        if event is None:
            return ticket_type.event_id, None
        return event.id, event.organization_id

    async def _recognize_ticket_items(
        self,
        ctx: AuthContext | None,
        payment: Payment,
        order: Order,
        items: list[OrderItem],
    ) -> list[Revenue]:
        event_id, org_id = await self._event_for_ticket_order(order)
        if org_id is None:
            return []
        share_bps = await self._org_share_bps(org_id)
        out: list[Revenue] = []
        for item in items:
            if item.item_type != "TICKET":
                continue
            if item.amount_minor <= 0:
                continue
            key = f"ticket-sale:{item.id}"
            existing = (
                await self.session.execute(
                    select(Revenue).where(
                        Revenue.source_type == "ORDER_ITEM",
                        Revenue.source_id == item.id,
                        Revenue.category == "TICKET",
                    )
                )
            ).scalar_one_or_none()
            if existing is not None:
                out.append(existing)
                continue
            net, take = self._split_take(item.amount_minor, share_bps)
            lines = [
                LedgerLineInput(CODE_PSP_CLEARING, "DEBIT", item.amount_minor, event_id=event_id),
                LedgerLineInput(CODE_TICKET_REVENUE, "CREDIT", net, event_id=event_id),
            ]
            if take > 0:
                lines.append(LedgerLineInput(CODE_PLATFORM_INCOME, "CREDIT", take, event_id=event_id))
            journal = await self.ledger.post(
                ctx,
                organization_id=org_id,
                journal_type="TICKET_SALE",
                source_module="TICKETING",
                source_type="ORDER_ITEM",
                source_id=item.id,
                currency_code=item.currency_code,
                idempotency_key=key,
                lines=lines,
            )
            row = await self._upsert_revenue(
                organization_id=org_id,
                category="TICKET",
                source_type="ORDER_ITEM",
                source_id=item.id,
                amount_minor=net,
                currency_code=item.currency_code,
                transaction_id=journal.id,
                actor_id=ctx.user_id if ctx else None,
                event_id=event_id,
            )
            await self._emit_recognized(ctx, row, org_id)
            out.append(row)
        return out

    async def _recognize_music_items(
        self,
        ctx: AuthContext | None,
        payment: Payment,
        order: Order,
        items: list[OrderItem],
    ) -> list[Revenue]:
        org_id = None
        from cornerroom.modules.commerce.domain.models import Offer, Product

        out: list[Revenue] = []
        for item in items:
            if item.item_type != "TRACK":
                continue
            if item.amount_minor <= 0:
                continue
            offer = await self.session.get(Offer, item.ref_id)
            product = await self.session.get(Product, offer.product_id) if offer is not None else None
            org_id = product.organization_id if product is not None else org_id
            if org_id is None:
                continue
            key = f"music-purchase:{item.id}"
            existing = (
                await self.session.execute(
                    select(Revenue).where(
                        Revenue.source_type == "ORDER_ITEM",
                        Revenue.source_id == item.id,
                        Revenue.category == "MUSIC_PURCHASE",
                    )
                )
            ).scalar_one_or_none()
            if existing is not None:
                out.append(existing)
                continue
            share_bps = await self._org_share_bps(org_id)
            net, take = self._split_take(item.amount_minor, share_bps)
            track_id = product.subject_id if product is not None and product.product_type == "TRACK" else None
            lines = [
                LedgerLineInput(CODE_PSP_CLEARING, "DEBIT", item.amount_minor, track_id=track_id),
                LedgerLineInput(CODE_MUSIC_REVENUE, "CREDIT", net, track_id=track_id),
            ]
            if take > 0:
                lines.append(LedgerLineInput(CODE_PLATFORM_INCOME, "CREDIT", take, track_id=track_id))
            journal = await self.ledger.post(
                ctx,
                organization_id=org_id,
                journal_type="MUSIC_PURCHASE",
                source_module="COMMERCE",
                source_type="ORDER_ITEM",
                source_id=item.id,
                currency_code=item.currency_code,
                idempotency_key=key,
                lines=lines,
            )
            row = await self._upsert_revenue(
                organization_id=org_id,
                category="MUSIC_PURCHASE",
                source_type="ORDER_ITEM",
                source_id=item.id,
                amount_minor=net,
                currency_code=item.currency_code,
                transaction_id=journal.id,
                actor_id=ctx.user_id if ctx else None,
                track_id=track_id,
            )
            await self._emit_recognized(ctx, row, org_id)
            out.append(row)
        return out

    async def _post_subscription_deferral(
        self,
        ctx: AuthContext | None,
        payment: Payment,
        order: Order,
    ) -> None:
        from cornerroom.modules.subscriptions.domain.models import SubscriptionPlan

        items = list(
            (await self.session.execute(select(OrderItem).where(OrderItem.order_id == order.id))).scalars()
        )
        org_id = None
        for item in items:
            plan = await self.session.get(SubscriptionPlan, item.ref_id)
            if plan is not None:
                org_id = plan.organization_id
                break
        if org_id is None or payment.amount_minor <= 0:
            return
        key = f"subscription-defer:{payment.id}"
        await self.ledger.post(
            ctx,
            organization_id=org_id,
            journal_type="SUBSCRIPTION",
            source_module="SUBSCRIPTIONS",
            source_type="PAYMENT",
            source_id=payment.id,
            currency_code=payment.currency_code,
            idempotency_key=key,
            lines=[
                LedgerLineInput(CODE_PSP_CLEARING, "DEBIT", payment.amount_minor),
                LedgerLineInput(CODE_DEFERRED_REVENUE, "CREDIT", payment.amount_minor),
            ],
        )

    async def recognize_subscription_period(
        self,
        ctx: AuthContext | None,
        period_id: UUID,
        *,
        organization_id: UUID,
    ) -> Revenue:
        period = await self.session.get(SubscriptionPeriod, period_id)
        if period is None:
            raise NotFoundError("Subscription period not found")
        if period.status not in {"PAID", "CLOSED"}:
            raise AppError(
                "PERIOD_NOT_RECOGNIZABLE",
                "Subscription period is not paid",
                409,
                "Q-P0-06 recognizes over the period from period facts, not the full subscription.",
            )
        existing = (
            await self.session.execute(
                select(Revenue).where(
                    Revenue.source_type == "SUBSCRIPTION_PERIOD",
                    Revenue.source_id == period.id,
                    Revenue.category == "SUBSCRIPTION",
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            return existing
        money = Money(period.amount_minor, period.currency_code)
        journal = await self.ledger.post(
            ctx,
            organization_id=organization_id,
            journal_type="SUBSCRIPTION",
            source_module="SUBSCRIPTIONS",
            source_type="SUBSCRIPTION_PERIOD",
            source_id=period.id,
            currency_code=money.currency_code,
            idempotency_key=f"sub-period:{period.id}",
            lines=[
                LedgerLineInput(CODE_DEFERRED_REVENUE, "DEBIT", money.amount_minor),
                LedgerLineInput(CODE_SUBSCRIPTION_REVENUE, "CREDIT", money.amount_minor),
            ],
        )
        row = await self._upsert_revenue(
            organization_id=organization_id,
            category="SUBSCRIPTION",
            source_type="SUBSCRIPTION_PERIOD",
            source_id=period.id,
            amount_minor=money.amount_minor,
            currency_code=money.currency_code,
            transaction_id=journal.id,
            actor_id=ctx.user_id if ctx else None,
            period_start=period.starts_at,
            period_end=period.ends_at,
        )
        await self._emit_recognized(ctx, row, organization_id)
        return row

    async def accrue_royalty(
        self,
        ctx: AuthContext | None,
        *,
        royalty_id: UUID,
        organization_id: UUID,
        amount_minor: int,
        currency_code: str,
        revenue_pool_id: UUID | None = None,
    ) -> FinanceTransaction:
        del revenue_pool_id
        money = Money(amount_minor, currency_code)
        if money.amount_minor == 0:
            raise AppError("INVALID_AMOUNT", "Royalty accrual amount must be > 0", 422)
        return await self.ledger.post(
            ctx,
            organization_id=organization_id,
            journal_type="ROYALTY_ACCRUAL",
            source_module="ROYALTIES",
            source_type="ROYALTY",
            source_id=royalty_id,
            currency_code=money.currency_code,
            idempotency_key=f"royalty-accrual:{royalty_id}",
            lines=[
                LedgerLineInput(CODE_ROYALTY_EXPENSE, "DEBIT", money.amount_minor),
                LedgerLineInput(CODE_ROYALTY_LIABILITY, "CREDIT", money.amount_minor),
            ],
        )

    async def reverse_refund(self, ctx: AuthContext | None, refund: Refund) -> None:
        payment = await self.session.get(Payment, refund.payment_id)
        if payment is None or payment.order_id is None:
            return
        order = await self.session.get(Order, payment.order_id)
        if order is None:
            return
        org_id: UUID | None = None
        event_id: UUID | None = None
        contra = CODE_CONTRA_REVENUE
        if order.purpose == "TICKET":
            event_id, org_id = await self._event_for_ticket_order(order)
        elif order.purpose == "TRACK":
            from cornerroom.modules.commerce.domain.models import Offer, Product

            item = (
                await self.session.execute(select(OrderItem).where(OrderItem.order_id == order.id))
            ).scalars().first()
            if item is not None:
                offer = await self.session.get(Offer, item.ref_id)
                product = await self.session.get(Product, offer.product_id) if offer else None
                org_id = product.organization_id if product else None
        elif order.purpose == "SUBSCRIPTION":
            from cornerroom.modules.subscriptions.domain.models import SubscriptionPlan

            item = (
                await self.session.execute(select(OrderItem).where(OrderItem.order_id == order.id))
            ).scalars().first()
            if item is not None:
                plan = await self.session.get(SubscriptionPlan, item.ref_id)
                org_id = plan.organization_id if plan else None
            contra = CODE_DEFERRED_REVENUE
        if org_id is None or refund.amount_minor <= 0:
            return
        await self.ledger.post(
            ctx,
            organization_id=org_id,
            journal_type="REFUND",
            source_module="FINANCE",
            source_type="REFUND",
            source_id=refund.id,
            currency_code=refund.currency_code,
            idempotency_key=f"refund:{refund.id}",
            lines=[
                LedgerLineInput(contra, "DEBIT", refund.amount_minor, event_id=event_id),
                LedgerLineInput(CODE_PSP_CLEARING, "CREDIT", refund.amount_minor, event_id=event_id),
            ],
        )

    def _manual_credit_code(self, source_type: str) -> str:
        if source_type == "STREAMING_SUB":
            return CODE_SUBSCRIPTION_REVENUE
        if source_type == "MUSIC_PURCHASE":
            return CODE_MUSIC_REVENUE
        return CODE_TICKET_REVENUE

    async def record_manual(
        self,
        ctx: AuthContext | None,
        *,
        organization_id: UUID,
        source_type: str,
        period_start: datetime,
        period_end: datetime,
        amount_minor: int,
        currency_code: str,
        idempotency_key: str,
        source_id: UUID | None = None,
    ) -> Revenue:
        from uuid import NAMESPACE_URL, uuid5

        money = Money(amount_minor, currency_code)
        target_id = source_id or uuid5(NAMESPACE_URL, f"cornerroom:rev:{idempotency_key}")
        journal = await self.ledger.post(
            ctx,
            organization_id=organization_id,
            journal_type="OTHER_INCOME",
            source_module="FINANCE",
            source_type=source_type,
            source_id=target_id,
            currency_code=money.currency_code,
            idempotency_key=f"manual-rev:{idempotency_key}",
            lines=[
                LedgerLineInput(CODE_PSP_CLEARING, "DEBIT", money.amount_minor),
                LedgerLineInput(self._manual_credit_code(source_type), "CREDIT", money.amount_minor),
            ],
        )
        row = await self._upsert_revenue(
            organization_id=organization_id,
            category=source_type,
            source_type=source_type,
            source_id=target_id,
            amount_minor=money.amount_minor,
            currency_code=money.currency_code,
            transaction_id=journal.id,
            actor_id=ctx.user_id if ctx else None,
            period_start=period_start,
            period_end=period_end,
        )
        await self._emit_recognized(ctx, row, organization_id)
        return row


    async def _emit_recognized(self, ctx: AuthContext | None, row: Revenue, organization_id: UUID) -> None:
        event = DomainEvent(
            event_type=REVENUE_RECOGNIZED,
            producer="finance",
            aggregate_type="Revenue",
            aggregate_id=row.id,
            payload={
                "source_type": row.source_type,
                "source_id": str(row.source_id),
                "category": row.category,
                "amount_minor": row.amount_minor,
                "currency_code": row.currency_code,
            },
            occurred_at=self.clock.now(),
            actor_id=ctx.user_id if ctx else None,
            organization_id=organization_id,
            correlation_id=ctx.request_id if ctx else None,
        )
        await enqueue_outbox(self.session, event)
        await self.audit.record_from_auth(
            ctx,
            action="revenue.recognized",
            entity_type="Revenue",
            entity_id=row.id,
            new_state={"status": row.status, "amount_minor": row.amount_minor, "category": row.category},
            organization_id=organization_id,
            actor_id=str(ctx.user_id) if ctx else "system:finance",
            actor_type="user" if ctx else "system",
        )

    async def unused_tax_lines(self, parent_id: UUID) -> list[TaxLine]:
        """Tax lines are data. rate_bps 0 is unset — not a legal zero (Q-P0-04)."""
        return list(
            (
                await self.session.execute(
                    select(TaxLine).where(TaxLine.parent_id == parent_id, TaxLine.kind == "TAX")
                )
            ).scalars()
        )
