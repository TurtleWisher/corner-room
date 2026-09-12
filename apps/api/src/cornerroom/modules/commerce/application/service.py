"""Ticket checkout. Controllers stay thin. Capture is not a checkout flag."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, NotFoundError
from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.infra.settings import Settings, get_settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import DomainEvent, ORDER_PAID, ORDER_PLACED, TRACK_PURCHASED
from cornerroom.kernel.money import Money
from cornerroom.kernel.pagination import clamp_limit, decode_cursor, encode_cursor
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.commerce.domain.lifecycle import order_transition_action
from cornerroom.modules.commerce.domain.models import (
    Offer,
    Order,
    OrderItem,
    Product,
    RefundEntitlementPolicy,
    TaxLine,
)
from cornerroom.modules.entitlements.application.service import EntitlementService
from cornerroom.kernel.ports import NullNotificationPort
from cornerroom.modules.events.domain.models import Event
from cornerroom.modules.finance.application.service import PaymentService
from cornerroom.modules.finance.domain.models import Payment, Refund
from cornerroom.modules.streaming.domain.models import LibraryItem
from cornerroom.modules.subscriptions.application.service import SubscriptionService
from cornerroom.modules.ticketing.application.service import TicketingService
from cornerroom.modules.ticketing.domain.models import TicketHold, TicketType

ORDER_PLACED_EVENT = ORDER_PLACED
ORDER_PAID_EVENT = ORDER_PAID


class CheckoutService:
    def __init__(
        self,
        session: AsyncSession,
        settings: Settings | None = None,
        clock: Clock | None = None,
    ) -> None:
        self.session = session
        self.settings = settings or get_settings()
        self.clock = clock or SystemClock()
        self.audit = AuditService(session)
        self.ticketing = TicketingService(session, settings=self.settings, clock=self.clock)
        self.payments = PaymentService(session, settings=self.settings, clock=self.clock)
        notifications = NullNotificationPort()
        self.entitlements = EntitlementService(session, clock=self.clock, notifications=notifications)
        self.subscriptions = SubscriptionService(session, clock=self.clock, notifications=notifications)

    async def _emit(
        self,
        ctx: AuthContext,
        *,
        event_type: str,
        aggregate_id: UUID,
        organization_id: UUID | None,
        payload: dict[str, Any],
    ) -> None:
        domain = DomainEvent(
            event_type=event_type,
            producer="commerce",
            aggregate_type="Order",
            aggregate_id=aggregate_id,
            payload=payload,
            occurred_at=self.clock.now(),
            actor_id=ctx.user_id,
            organization_id=organization_id,
            correlation_id=ctx.request_id,
        )
        await enqueue_outbox(self.session, domain)

    async def checkout_from_hold(
        self,
        ctx: AuthContext,
        *,
        hold_id: UUID,
        idempotency_key: str,
    ) -> tuple[Order, Payment]:
        existing = (
            await self.session.execute(select(Order).where(Order.idempotency_key == idempotency_key))
        ).scalar_one_or_none()
        if existing is not None:
            if existing.user_id != ctx.user_id:
                raise AppError("CONFLICT", "Idempotency-Key reused", 409)
            payment = (
                await self.session.execute(select(Payment).where(Payment.order_id == existing.id))
            ).scalar_one_or_none()
            if payment is None:
                raise AppError("CONFLICT", "Order exists without payment", 409)
            return existing, payment

        hold = await self.ticketing.get_active_hold_for_user(hold_id, ctx.user_id)
        ticket_type = await self.ticketing.get_ticket_type_row(hold.ticket_type_id)
        event = await self.session.get(Event, ticket_type.event_id)
        if event is None or event.deleted_at is not None:
            raise NotFoundError("Event not found")
        unit = Money(amount_minor=ticket_type.price_amount_minor, currency_code=ticket_type.currency_code)
        total = Money(amount_minor=unit.amount_minor * hold.quantity, currency_code=unit.currency_code)
        order = Order(
            user_id=ctx.user_id,
            status="PENDING_PAYMENT",
            total_amount_minor=total.amount_minor,
            currency_code=total.currency_code,
            idempotency_key=idempotency_key,
            purpose="TICKET",
            created_by=ctx.user_id,
            updated_by=ctx.user_id,
        )
        self.session.add(order)
        await self.session.flush()
        item = OrderItem(
            order_id=order.id,
            item_type="TICKET",
            ref_id=ticket_type.id,
            quantity=hold.quantity,
            unit_amount_minor=unit.amount_minor,
            amount_minor=total.amount_minor,
            currency_code=total.currency_code,
        )
        self.session.add(item)
        await self.session.flush()
        tax_bps = self.settings.tax_rate_bps
        self.session.add(
            TaxLine(
                parent_type="ORDER",
                parent_id=order.id,
                kind="TAX",
                rate_bps=tax_bps,
                amount_minor=0,
                currency_code=total.currency_code,
            )
        )
        await self.ticketing.attach_hold_to_order(hold, order.id, item.id)
        payment = await self.payments.create_intent(
            ctx,
            order=order,
            idempotency_key=f"pay:{idempotency_key}",
        )
        await self._emit(
            ctx,
            event_type=ORDER_PLACED_EVENT,
            aggregate_id=order.id,
            organization_id=event.organization_id,
            payload={
                "order_id": str(order.id),
                "hold_id": str(hold.id),
                "total_amount_minor": order.total_amount_minor,
                "currency_code": order.currency_code,
            },
        )
        await self.audit.record_from_auth(
            ctx,
            action="order.placed",
            entity_type="Order",
            entity_id=order.id,
            new_state={"status": order.status, "total_amount_minor": order.total_amount_minor},
            organization_id=event.organization_id,
        )
        return order, payment

    async def _existing_order(
        self, ctx: AuthContext, idempotency_key: str
    ) -> tuple[Order, Payment] | None:
        existing = (
            await self.session.execute(select(Order).where(Order.idempotency_key == idempotency_key))
        ).scalar_one_or_none()
        if existing is None:
            return None
        if existing.user_id != ctx.user_id:
            raise AppError("CONFLICT", "Idempotency-Key reused", 409)
        payment = (
            await self.session.execute(select(Payment).where(Payment.order_id == existing.id))
        ).scalar_one_or_none()
        if payment is None:
            raise AppError("CONFLICT", "Order exists without payment", 409)
        return existing, payment

    def _add_tax_line(self, order: Order) -> None:
        self.session.add(
            TaxLine(
                parent_type="ORDER",
                parent_id=order.id,
                kind="TAX",
                rate_bps=self.settings.tax_rate_bps,
                amount_minor=0,
                currency_code=order.currency_code,
            )
        )

    async def checkout_from_offer(
        self,
        ctx: AuthContext,
        *,
        offer_id: UUID,
        idempotency_key: str,
    ) -> tuple[Order, Payment]:
        found = await self._existing_order(ctx, idempotency_key)
        if found is not None:
            return found
        offer = await self.session.get(Offer, offer_id)
        if offer is None or offer.deleted_at is not None or offer.status != "ACTIVE":
            raise NotFoundError("Offer not found")
        product = await self.session.get(Product, offer.product_id)
        if product is None or product.deleted_at is not None or product.status != "ACTIVE":
            raise NotFoundError("Offer not found")
        if product.product_type == "SUBSCRIPTION_PLAN":
            raise AppError(
                "USE_SUBSCRIPTION_CHECKOUT",
                "Subscribe through POST /subscriptions",
                409,
            )
        money = Money(amount_minor=offer.amount_minor, currency_code=offer.currency_code)
        item_type = "TRACK" if product.product_type in {"TRACK", "CATALOG_ACCESS"} else "OTHER"
        order = Order(
            user_id=ctx.user_id,
            status="PENDING_PAYMENT",
            total_amount_minor=money.amount_minor,
            currency_code=money.currency_code,
            idempotency_key=idempotency_key,
            purpose="TRACK",
            created_by=ctx.user_id,
            updated_by=ctx.user_id,
        )
        self.session.add(order)
        await self.session.flush()
        self.session.add(
            OrderItem(
                order_id=order.id,
                item_type=item_type,
                ref_id=product.subject_id,
                quantity=1,
                unit_amount_minor=money.amount_minor,
                amount_minor=money.amount_minor,
                currency_code=money.currency_code,
            )
        )
        await self.session.flush()
        self._add_tax_line(order)
        payment = await self.payments.create_intent(
            ctx, order=order, idempotency_key=f"pay:{idempotency_key}"
        )
        await self._emit(
            ctx,
            event_type=ORDER_PLACED_EVENT,
            aggregate_id=order.id,
            organization_id=product.organization_id,
            payload={
                "order_id": str(order.id),
                "offer_id": str(offer.id),
                "total_amount_minor": order.total_amount_minor,
                "currency_code": order.currency_code,
            },
        )
        await self.audit.record_from_auth(
            ctx,
            action="order.placed",
            entity_type="Order",
            entity_id=order.id,
            new_state={"status": order.status, "purpose": order.purpose},
            organization_id=product.organization_id,
        )
        return order, payment

    async def checkout_from_plan(
        self,
        ctx: AuthContext,
        *,
        plan_id: UUID,
        idempotency_key: str,
        renew_subscription_id: UUID | None = None,
    ) -> tuple[Order, Payment]:
        found = await self._existing_order(ctx, idempotency_key)
        if found is not None:
            return found
        plan, version = await self.subscriptions.get_active_plan(plan_id)
        if renew_subscription_id is None:
            existing_sub = await self.subscriptions.active_for_user(ctx.user_id)
            if existing_sub is not None:
                raise AppError(
                    "SUBSCRIPTION_EXISTS",
                    "A non-terminal subscription already exists",
                    409,
                    "Family plans are P1 (Q-P1-27 / Q-P9-10)",
                )
        money = Money(amount_minor=version.price_amount_minor, currency_code=version.currency_code)
        order = Order(
            user_id=ctx.user_id,
            status="PENDING_PAYMENT",
            total_amount_minor=money.amount_minor,
            currency_code=money.currency_code,
            idempotency_key=idempotency_key,
            purpose="SUBSCRIPTION",
            created_by=ctx.user_id,
            updated_by=ctx.user_id,
        )
        self.session.add(order)
        await self.session.flush()
        self.session.add(
            OrderItem(
                order_id=order.id,
                item_type="SUBSCRIPTION",
                ref_id=version.id,
                quantity=1,
                unit_amount_minor=money.amount_minor,
                amount_minor=money.amount_minor,
                currency_code=money.currency_code,
            )
        )
        await self.session.flush()
        self._add_tax_line(order)
        payment = await self.payments.create_intent(
            ctx, order=order, idempotency_key=f"pay:{idempotency_key}"
        )
        await self._emit(
            ctx,
            event_type=ORDER_PLACED_EVENT,
            aggregate_id=order.id,
            organization_id=plan.organization_id,
            payload={
                "order_id": str(order.id),
                "plan_id": str(plan.id),
                "plan_version_id": str(version.id),
                "renew_subscription_id": str(renew_subscription_id) if renew_subscription_id else None,
                "total_amount_minor": order.total_amount_minor,
                "currency_code": order.currency_code,
            },
        )
        await self.audit.record_from_auth(
            ctx,
            action="order.placed",
            entity_type="Order",
            entity_id=order.id,
            new_state={"status": order.status, "purpose": "SUBSCRIPTION"},
            organization_id=plan.organization_id,
        )
        return order, payment

    async def fulfill_captured_payment(
        self,
        ctx: AuthContext | None,
        payment: Payment,
    ) -> Order:
        if payment.order_id is None:
            raise AppError("VALIDATION_ERROR", "Payment has no order", 422)
        order = await self.session.get(Order, payment.order_id)
        if order is None:
            raise NotFoundError("Order not found")
        if order.status == "FULFILLED":
            return order
        if order.status in {"REFUNDED", "PARTIALLY_REFUNDED", "CANCELLED"}:
            return order
        if payment.status != "CAPTURED":
            raise AppError("INVALID_TRANSITION", "Payment is not captured", 409)
        if order.status == "PENDING_PAYMENT":
            order_transition_action(order.status, "PAID")
            order.status = "PAID"
            await self.session.flush()
        organization_id = await self._fulfill_items(ctx, order)
        if order.status != "FULFILLED":
            order_transition_action(order.status, "FULFILLED")
            order.status = "FULFILLED"
            await self.session.flush()
        actor_ctx = ctx
        if actor_ctx is not None:
            await self._emit(
                actor_ctx,
                event_type=ORDER_PAID_EVENT,
                aggregate_id=order.id,
                organization_id=organization_id,
                payload={"order_id": str(order.id), "payment_id": str(payment.id)},
            )
            await self.audit.record_from_auth(
                actor_ctx,
                action="order.paid",
                entity_type="Order",
                entity_id=order.id,
                new_state={"status": order.status},
                organization_id=organization_id,
            )
        else:
            domain = DomainEvent(
                event_type=ORDER_PAID_EVENT,
                producer="commerce",
                aggregate_type="Order",
                aggregate_id=order.id,
                payload={"order_id": str(order.id), "payment_id": str(payment.id)},
                occurred_at=self.clock.now(),
                organization_id=organization_id,
            )
            await enqueue_outbox(self.session, domain)
        return order

    async def _fulfill_items(self, ctx: AuthContext | None, order: Order) -> UUID | None:
        items = list(
            (
                await self.session.execute(select(OrderItem).where(OrderItem.order_id == order.id))
            ).scalars()
        )
        organization_id = None
        hold = (
            await self.session.execute(select(TicketHold).where(TicketHold.order_id == order.id))
        ).scalar_one_or_none()
        if hold is not None:
            ticket_type = await self.session.get(TicketType, hold.ticket_type_id)
            if ticket_type is not None:
                event = await self.session.get(Event, ticket_type.event_id)
                organization_id = event.organization_id if event else None
            await self.ticketing.convert_hold_and_issue(
                ctx,
                hold_id=hold.id,
                organization_id=organization_id,
            )
            return organization_id
        for item in items:
            if item.item_type == "TRACK":
                product = (
                    await self.session.execute(
                        select(Product).where(
                            Product.subject_id == item.ref_id,
                            Product.deleted_at.is_(None),
                        )
                    )
                ).scalars().first()
                scope = "CATALOG" if product is not None and product.product_type == "CATALOG_ACCESS" else "TRACK"
                if product is not None:
                    organization_id = product.organization_id
                await self.entitlements.grant(
                    ctx,
                    user_id=order.user_id,
                    entitlement_type="PURCHASE",
                    ref_id=item.ref_id,
                    scope=scope,
                    expires_at=None,
                    source_type="ORDER_ITEM",
                    source_id=item.id,
                    organization_id=organization_id,
                    actor_id=order.user_id,
                )
                if scope == "TRACK":
                    existing_lib = (
                        await self.session.execute(
                            select(LibraryItem).where(
                                LibraryItem.user_id == order.user_id,
                                LibraryItem.item_type == "track",
                                LibraryItem.item_id == item.ref_id,
                                LibraryItem.kind == "PURCHASE_REF",
                            )
                        )
                    ).scalar_one_or_none()
                    if existing_lib is None:
                        self.session.add(
                            LibraryItem(
                                user_id=order.user_id,
                                item_type="track",
                                item_id=item.ref_id,
                                kind="PURCHASE_REF",
                                created_at=self.clock.now(),
                            )
                        )
                if ctx is not None:
                    await self._emit(
                        ctx,
                        event_type=TRACK_PURCHASED,
                        aggregate_id=order.id,
                        organization_id=organization_id,
                        payload={
                            "order_id": str(order.id),
                            "track_id": str(item.ref_id),
                            "user_id": str(order.user_id),
                        },
                    )
                else:
                    await enqueue_outbox(
                        self.session,
                        DomainEvent(
                            event_type=TRACK_PURCHASED,
                            producer="commerce",
                            aggregate_type="Order",
                            aggregate_id=order.id,
                            payload={
                                "order_id": str(order.id),
                                "track_id": str(item.ref_id),
                                "user_id": str(order.user_id),
                            },
                            occurred_at=self.clock.now(),
                            organization_id=organization_id,
                        ),
                    )
            elif item.item_type == "SUBSCRIPTION":
                existing = await self.subscriptions.active_for_user(order.user_id)
                if existing is not None:
                    await self.subscriptions.renew_from_fulfillment(
                        ctx,
                        subscription_id=existing.id,
                        plan_version_id=item.ref_id,
                        order_id=order.id,
                        organization_id=organization_id,
                    )
                else:
                    await self.subscriptions.start_from_fulfillment(
                        ctx,
                        user_id=order.user_id,
                        plan_version_id=item.ref_id,
                        order_id=order.id,
                        organization_id=organization_id,
                    )
        await self.session.flush()
        return organization_id

    async def sandbox_confirm(self, ctx: AuthContext, payment_id: UUID) -> tuple[Order, Payment]:
        payment = await self.payments.sandbox_confirm(ctx, payment_id)
        order = await self.fulfill_captured_payment(ctx, payment)
        return order, payment

    async def apply_provider_callback(
        self,
        payload: dict[str, object],
        signature: str | None,
    ) -> tuple[Order | None, Payment]:
        callback = self.payments.parse_callback(payload, signature)
        payment = await self.payments.apply_callback(callback)
        if payment.status != "CAPTURED":
            await self._on_payment_failed(payment)
            return None, payment
        order = await self.fulfill_captured_payment(None, payment)
        return order, payment

    async def _on_payment_failed(self, payment: Payment) -> None:
        if payment.order_id is None:
            return
        order = await self.session.get(Order, payment.order_id)
        if order is None or order.purpose != "SUBSCRIPTION":
            return
        existing = await self.subscriptions.active_for_user(order.user_id)
        if existing is not None:
            await self.subscriptions.mark_past_due(None, existing.id)

    async def get_order_row(self, order_id: UUID) -> Order:
        order = await self.session.get(Order, order_id)
        if order is None or order.deleted_at is not None:
            raise NotFoundError("Order not found")
        return order

    async def get_order(self, ctx: AuthContext, order_id: UUID) -> Order:
        order = await self.get_order_row(order_id)
        if order.user_id != ctx.user_id:
            raise NotFoundError("Order not found")
        return order

    async def list_my_orders(
        self,
        ctx: AuthContext,
        *,
        cursor: str | None = None,
        limit: int = 50,
    ) -> tuple[list[Order], str | None]:
        limit = clamp_limit(limit)
        stmt = (
            select(Order)
            .where(Order.user_id == ctx.user_id, Order.deleted_at.is_(None))
            .order_by(Order.created_at.desc(), Order.id.desc())
        )
        if cursor:
            data = decode_cursor(cursor)
            stmt = stmt.where(Order.created_at < data["t"])
        stmt = stmt.limit(limit + 1)
        rows = list((await self.session.execute(stmt)).scalars().all())
        next_cursor = None
        if len(rows) > limit:
            last = rows[limit - 1]
            next_cursor = encode_cursor(last.created_at.isoformat(), last.id)
            rows = rows[:limit]
        return rows, next_cursor

    async def payment_for_order(self, order_id: UUID) -> Payment | None:
        return (
            await self.session.execute(select(Payment).where(Payment.order_id == order_id))
        ).scalar_one_or_none()

    async def apply_completed_refund(self, ctx: AuthContext, refund: Refund) -> Order | None:
        payment = await self.payments.get_payment(refund.payment_id)
        if payment.order_id is None:
            return None
        order = await self.session.get(Order, payment.order_id)
        if order is None:
            return None
        remaining = await self.payments.remaining_refundable(payment)
        if remaining == 0:
            if order.status != "REFUNDED":
                order_transition_action(order.status, "REFUNDED")
                order.status = "REFUNDED"
        elif remaining < payment.amount_minor:
            if order.status not in {"PARTIALLY_REFUNDED", "REFUNDED"}:
                order_transition_action(order.status, "PARTIALLY_REFUNDED")
                order.status = "PARTIALLY_REFUNDED"
        order.updated_by = ctx.user_id
        await self.session.flush()
        mapping = (
            await self.session.execute(
                select(RefundEntitlementPolicy).where(
                    RefundEntitlementPolicy.reason_code == refund.reason_code
                )
            )
        ).scalars().first()
        if mapping is None or mapping.action != "REVOKE":
            return order
        items = list(
            (await self.session.execute(select(OrderItem).where(OrderItem.order_id == order.id))).scalars()
        )
        for item in items:
            granted = await self.entitlements.find_active_for_source(
                user_id=order.user_id, source_id=item.id
            )
            for ent in granted:
                await self.entitlements.revoke(ctx, ent.id)
        return order

    async def grant_staff_entitlement(
        self,
        ctx: AuthContext,
        *,
        user_id: UUID,
        entitlement_type: str,
        ref_id: UUID,
        scope: str,
        expires_at,
        organization_id: UUID | None = None,
    ):
        org_id = organization_id or ctx.organization_id
        if org_id is None:
            raise AppError("WORKSPACE_REQUIRED", "An active organization is required", 409)
        from cornerroom.modules.authorization.application.service import AuthorizationService

        authz = AuthorizationService(self.session, clock=self.clock)
        await authz.authorize(
            ctx.user_id,
            "commerce.grant",
            resource_type="organization",
            resource_id=org_id,
            scope_organization_id=org_id,
        )
        if entitlement_type not in {"ADMIN_GRANT", "PROMOTIONAL_GRANT"}:
            raise AppError("VALIDATION_ERROR", "Staff may only issue ADMIN_GRANT or PROMOTIONAL_GRANT", 422)
        row, _created = await self.entitlements.grant(
            ctx,
            user_id=user_id,
            entitlement_type=entitlement_type,
            ref_id=ref_id,
            scope=scope,
            expires_at=expires_at,
            source_type="STAFF_GRANT",
            source_id=ctx.user_id,
            organization_id=org_id,
        )
        return row

    async def sandbox_renew(
        self,
        ctx: AuthContext,
        *,
        subscription_id: UUID,
        idempotency_key: str,
    ) -> tuple[Order, Payment]:
        from cornerroom.modules.subscriptions.domain.lifecycle import NON_TERMINAL_SUBSCRIPTION

        sub = await self.subscriptions.get_own(ctx, subscription_id)
        if sub.status not in NON_TERMINAL_SUBSCRIPTION:
            raise AppError("INVALID_TRANSITION", "Subscription is not renewable", 409)
        plan, version = await self.subscriptions.get_active_plan(sub.plan_id)
        self.subscriptions.request_renewal_via_port(subscription=sub, version=version)
        return await self.checkout_from_plan(
            ctx,
            plan_id=plan.id,
            idempotency_key=idempotency_key,
            renew_subscription_id=sub.id,
        )
