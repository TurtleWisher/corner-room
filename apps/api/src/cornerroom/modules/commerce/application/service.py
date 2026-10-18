"""Ticket checkout. Controllers stay thin. Capture is not a checkout flag."""

from __future__ import annotations

from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, NotFoundError
from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.infra.settings import Settings, get_settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import DomainEvent, ORDER_PAID, ORDER_PLACED, TRACK_PURCHASED
from cornerroom.kernel.money import Money
from cornerroom.kernel.pagination import clamp_limit, encode_cursor, keyset_before
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


log = structlog.get_logger("commerce")

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
        delivery_confirmed: bool = False,
    ) -> tuple[Order, Payment]:
        found = await self._existing_order(ctx, idempotency_key)
        if found is not None:
            return found
        address = await self._confirmed_delivery_address(ctx, delivery_confirmed)
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
        self._copy_delivery_address(order, address)
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

    async def _confirmed_delivery_address(self, ctx: AuthContext, confirmed: bool):
        """D-ADDR-01: no payment starts until the buyer has a Bangladesh delivery address saved
        and has confirmed it for this order."""
        from cornerroom.modules.identity.application.delivery_address import DeliveryAddressService

        address = await DeliveryAddressService(self.session).get_for_user(ctx.user_id)
        if address is None:
            raise AppError(
                "DELIVERY_ADDRESS_REQUIRED",
                "Add a Bangladesh address where we can send your gifts before you pay",
                409,
            )
        if not confirmed:
            raise AppError(
                "DELIVERY_ADDRESS_CONFIRMATION_REQUIRED",
                "Confirm the address where we can send your gifts before you pay",
                422,
            )
        return address

    def _copy_delivery_address(self, order: Order, address) -> None:
        from cornerroom.modules.commerce.domain.models import OrderDeliveryAddress
        from cornerroom.modules.identity.domain.bd_address import ADDRESS_FIELDS

        self.session.add(OrderDeliveryAddress(order_id=order.id, **{f: getattr(address, f) for f in ADDRESS_FIELDS}))

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
        delivery_confirmed: bool = False,
    ) -> tuple[Order, Payment]:
        found = await self._existing_order(ctx, idempotency_key)
        if found is not None:
            return found
        address = await self._confirmed_delivery_address(ctx, delivery_confirmed)
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
        await self._check_music_offer(ctx, offer, product)
        money = Money(amount_minor=offer.amount_minor, currency_code=offer.currency_code)
        if product.product_type == "RELEASE":
            item_type, purpose = "RELEASE", "RELEASE"
        else:
            item_type = "TRACK" if product.product_type in {"TRACK", "CATALOG_ACCESS"} else "OTHER"
            purpose = "TRACK"
        order = Order(
            user_id=ctx.user_id,
            status="PENDING_PAYMENT",
            total_amount_minor=money.amount_minor,
            currency_code=money.currency_code,
            idempotency_key=idempotency_key,
            purpose=purpose,
            created_by=ctx.user_id,
            updated_by=ctx.user_id,
        )
        self.session.add(order)
        await self.session.flush()
        self._copy_delivery_address(order, address)
        self.session.add(
            OrderItem(
                order_id=order.id,
                item_type=item_type,
                ref_id=product.subject_id,
                product_id=product.id,
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

    async def _check_music_offer(self, ctx: AuthContext, offer: Offer, product: Product) -> None:
        """Release and song purchases follow the artist's choices (D-AUDIO-10, -11, -12)."""
        from cornerroom.modules.commerce.application.catalog import CatalogCommerceService
        from cornerroom.modules.music.domain.models import Release, ReleaseTrack

        if product.product_type == "TRACK":
            await CatalogCommerceService(self.session).assert_track_sold_separately(product.subject_id)
        if product.product_type != "RELEASE":
            return
        release = await self.session.get(Release, product.subject_id)
        if release is None or release.deleted_at is not None or release.status != "RELEASED":
            raise AppError("RELEASE_NOT_AVAILABLE", "This release isn't on sale", 409)
        if await self.entitlements.find_active_release(ctx.user_id, release.id) is not None:
            raise AppError("ALREADY_OWNED", "You already own this release", 409)
        if offer.audience == "OWNS_PART_OF_RELEASE":
            track_ids = (
                await self.session.execute(select(ReleaseTrack.track_id).where(ReleaseTrack.release_id == release.id))
            ).scalars().all()
            owns_part = False
            for track_id in track_ids:
                if await self.entitlements.has_catalog_access(ctx.user_id, track_id):
                    owns_part = True
                    break
            if not owns_part:
                raise AppError(
                    "OFFER_NOT_ELIGIBLE",
                    "This price is for fans who already own some of these songs",
                    403,
                )

    async def checkout_from_plan(
        self,
        ctx: AuthContext,
        *,
        plan_id: UUID,
        idempotency_key: str,
        renew_subscription_id: UUID | None = None,
        delivery_confirmed: bool = False,
    ) -> tuple[Order, Payment]:
        found = await self._existing_order(ctx, idempotency_key)
        if found is not None:
            return found
        address = await self._confirmed_delivery_address(ctx, delivery_confirmed)
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
        self._copy_delivery_address(order, address)
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
        if order.status == "CANCELLED" and payment.status == "CAPTURED":
            # Q-COM-03 (amends Q-PAY-02): the money is kept and staff refund it; the order stays
            # CANCELLED because Order has no CANCELLED -> PAID transition.
            await self._flag_late_payment(order, payment)
            return order
        if order.status in {"REFUNDED", "PARTIALLY_REFUNDED", "CANCELLED"}:
            return order
        if payment.status != "CAPTURED":
            raise AppError("INVALID_TRANSITION", "Payment is not captured", 409)
        if order.status == "PENDING_PAYMENT":
            order_transition_action(order.status, "PAID")
            order.status = "PAID"
            await self.session.flush()
        # Payment confirmed is not fulfilment confirmed. Fulfil inside a savepoint: if tickets or
        # access cannot be granted (for example the hold expired before a late payment), only the
        # fulfilment rolls back. The capture, the PAID order and the ledger facts stay, the order
        # waits for staff (owner decision 2026-10-13: keep the payment, flag for staff), and a
        # repeated callback retries the fulfilment safely.
        try:
            async with self.session.begin_nested():
                organization_id = await self._fulfill_items(ctx, order)
        except Exception as exc:  # noqa: BLE001 - money must never be lost to a fulfilment error
            await self._record_fulfillment_failure(order, payment, exc)
            return order
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
                if item.product_id is not None:
                    product = await self.session.get(Product, item.product_id)
                else:
                    # Older lines: find it by subject, preferring a live TRACK/CATALOG_ACCESS product.
                    product = (
                        await self.session.execute(
                            select(Product)
                            .where(
                                Product.subject_id == item.ref_id,
                                Product.deleted_at.is_(None),
                                Product.product_type.in_(("TRACK", "CATALOG_ACCESS")),
                            )
                            .order_by((Product.status == "ACTIVE").desc(), Product.created_at)
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
            elif item.item_type == "RELEASE":
                # D-AUDIO-12: one release entitlement covers the release's current tracklist.
                from cornerroom.kernel.events import RELEASE_PURCHASED
                from cornerroom.modules.music.domain.models import Release

                release = await self.session.get(Release, item.ref_id)
                organization_id = release.primary_org_id if release is not None else organization_id
                await self.entitlements.grant(
                    ctx,
                    user_id=order.user_id,
                    entitlement_type="PURCHASE",
                    ref_id=item.ref_id,
                    scope="RELEASE",
                    expires_at=None,
                    source_type="ORDER_ITEM",
                    source_id=item.id,
                    organization_id=organization_id,
                    actor_id=order.user_id,
                )
                existing_lib = (
                    await self.session.execute(
                        select(LibraryItem).where(
                            LibraryItem.user_id == order.user_id,
                            LibraryItem.item_type == "release",
                            LibraryItem.item_id == item.ref_id,
                            LibraryItem.kind == "PURCHASE_REF",
                        )
                    )
                ).scalar_one_or_none()
                if existing_lib is None:
                    self.session.add(
                        LibraryItem(user_id=order.user_id, item_type="release", item_id=item.ref_id, kind="PURCHASE_REF", created_at=self.clock.now())
                    )
                await enqueue_outbox(
                    self.session,
                    DomainEvent(
                        event_type=RELEASE_PURCHASED,
                        producer="commerce",
                        aggregate_type="Order",
                        aggregate_id=order.id,
                        payload={"order_id": str(order.id), "release_id": str(item.ref_id), "user_id": str(order.user_id)},
                        occurred_at=self.clock.now(),
                        actor_id=ctx.user_id if ctx is not None else None,
                        organization_id=organization_id,
                    ),
                )
            elif item.item_type == "SUBSCRIPTION":
                # The plan's label, so the subscription's events and revenue are attributed to it
                # (module pass, 2026-10-18: this was always None).
                organization_id = await self._order_organization(order)
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

    async def _record_fulfillment_failure(self, order: Order, payment: Payment, exc: Exception) -> None:
        """Audit a paid order that could not be fulfilled. Only a fixed reason code is stored."""
        code = exc.code if isinstance(exc, AppError) else "FULFILLMENT_ERROR"
        if not isinstance(exc, AppError):
            log.exception("order_fulfillment_failed", order_id=str(order.id))
        await self.audit.record(
            action="order.fulfillment_failed",
            entity_type="Order",
            entity_id=order.id,
            actor_id="system:commerce",
            actor_type="system",
            new_state={"status": order.status, "payment_id": str(payment.id), "reason": code},
        )

    async def _flag_late_payment(self, order: Order, payment: Payment) -> None:
        """Flag a payment captured on a cancelled order for staff, once (repeat callbacks are quiet)."""
        from cornerroom.modules.audit.domain.models import AuditLog

        already = (
            await self.session.execute(
                select(AuditLog.id).where(
                    AuditLog.entity_type == "Order",
                    AuditLog.entity_id == str(order.id),
                    AuditLog.action == "order.fulfillment_failed",
                )
            )
        ).first()
        if already is None:
            await self._record_fulfillment_failure(
                order, payment, AppError("ORDER_CANCELLED", "Payment captured after the order was cancelled", 409)
            )

    async def cancel_unpaid_ticket_orders(self, *, batch: int | None = None) -> int:
        """Q-COM-03: an unpaid ticket order whose hold expired or was released is cancelled.

        FAILURE_MODEL: "Order PENDING_PAYMENT / cancelled per TTL; hold released". The payment row
        is left open on purpose: a payment the provider (or staff) still captures later is kept and
        flagged, never lost. Orders are locked and rows another worker holds are skipped.
        """
        from cornerroom.kernel.events import ORDER_CANCELLED

        stmt = (
            select(Order, TicketHold)
            .join(TicketHold, TicketHold.order_id == Order.id)
            .where(
                Order.status == "PENDING_PAYMENT",
                Order.purpose == "TICKET",
                Order.deleted_at.is_(None),
                TicketHold.status.in_(("EXPIRED", "RELEASED")),
            )
            .order_by(Order.created_at, Order.id)
            .with_for_update(of=Order, skip_locked=True)
        )
        if batch is not None:
            stmt = stmt.limit(batch)
        rows = list((await self.session.execute(stmt)).all())
        for order, hold in rows:
            order_transition_action(order.status, "CANCELLED")
            order.status = "CANCELLED"
            reason = "HOLD_EXPIRED" if hold.status == "EXPIRED" else "HOLD_RELEASED"
            ticket_type = await self.session.get(TicketType, hold.ticket_type_id)
            event = await self.session.get(Event, ticket_type.event_id) if ticket_type else None
            organization_id = event.organization_id if event else None
            await enqueue_outbox(
                self.session,
                DomainEvent(
                    event_type=ORDER_CANCELLED,
                    producer="commerce",
                    aggregate_type="Order",
                    aggregate_id=order.id,
                    payload={"order_id": str(order.id), "hold_id": str(hold.id), "reason": reason},
                    occurred_at=self.clock.now(),
                    organization_id=organization_id,
                ),
            )
            await self.audit.record(
                action="order.cancelled",
                entity_type="Order",
                entity_id=order.id,
                actor_id="system:commerce",
                actor_type="system",
                previous_state={"status": "PENDING_PAYMENT"},
                new_state={"status": "CANCELLED", "reason": reason},
                organization_id=organization_id,
            )
        await self.session.flush()
        return len(rows)

    async def sandbox_confirm(self, ctx: AuthContext, payment_id: UUID) -> tuple[Order, Payment]:
        current = await self.payments.get_payment(payment_id)
        if current.user_id == ctx.user_id and current.order_id is not None and current.status != "CAPTURED":
            order = await self.session.get(Order, current.order_id)
            if order is not None and order.status == "CANCELLED":
                # Q-COM-03: the customer cannot pay for a cancelled order.
                raise AppError(
                    "ORDER_CANCELLED",
                    "This order was cancelled because the reservation ran out. Start again to buy.",
                    409,
                )
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
            stmt = stmt.where(keyset_before(Order.created_at, Order.id, cursor))
        stmt = stmt.limit(limit + 1)
        rows = list((await self.session.execute(stmt)).scalars().all())
        next_cursor = None
        if len(rows) > limit:
            last = rows[limit - 1]
            next_cursor = encode_cursor(last.created_at.isoformat(), last.id)
            rows = rows[:limit]
        return rows, next_cursor

    async def order_details(self, order: Order) -> dict[str, Any]:
        """Read-only facts the checkout page shows: line items as priced by the server, and the
        reservation expiry for ticket orders. Nothing here is computed for display."""
        rows = (
            await self.session.execute(select(OrderItem).where(OrderItem.order_id == order.id).order_by(OrderItem.created_at))
        ).scalars()
        items: list[dict[str, Any]] = []
        for item in rows:
            entry: dict[str, Any] = {
                "id": item.id,
                "item_type": item.item_type,
                "ref_id": item.ref_id,
                "quantity": item.quantity,
                "unit_amount_minor": item.unit_amount_minor,
                "amount_minor": item.amount_minor,
                "currency_code": item.currency_code,
                "ticket_type_name": None,
                "event_id": None,
            }
            if item.item_type == "TICKET":
                ticket_type = await self.session.get(TicketType, item.ref_id)
                if ticket_type is not None:
                    entry["ticket_type_name"] = ticket_type.name
                    entry["event_id"] = ticket_type.event_id
            if item.item_type == "RELEASE":
                from cornerroom.modules.music.domain.models import Release

                release = await self.session.get(Release, item.ref_id)
                entry["release_title"] = release.title if release is not None else None
                entry["release_type"] = release.release_type if release is not None else None
            items.append(entry)
        hold = (
            await self.session.execute(select(TicketHold).where(TicketHold.order_id == order.id))
        ).scalar_one_or_none()
        payment = await self.payment_for_order(order.id)
        from cornerroom.modules.commerce.domain.models import OrderDeliveryAddress
        from cornerroom.modules.identity.domain.bd_address import ADDRESS_FIELDS

        delivery = (
            await self.session.execute(select(OrderDeliveryAddress).where(OrderDeliveryAddress.order_id == order.id))
        ).scalar_one_or_none()
        submission = await self.latest_submission(payment.id) if payment is not None else None
        return {
            "items": items,
            # The buyer's latest Bangla QR payment report and what staff decided (Q-PAY-01/05).
            "payment_submission": {
                "status": submission.status,
                "transaction_ref": submission.transaction_ref,
                "paid_with": submission.paid_with,
                "decision_note": submission.decision_note,
                "submitted_at": submission.created_at,
            }
            if submission is not None
            else None,
            # The address the buyer confirmed for this order (owner-only reads; D-ADDR-01).
            "delivery_address": {f: getattr(delivery, f) for f in ADDRESS_FIELDS} if delivery else None,
            # Completed refunds, so the page can tell a refunded late payment from a pending one.
            "refunded_amount_minor": (payment.amount_minor - await self.payments.remaining_refundable(payment))
            if payment is not None and payment.status == "CAPTURED"
            else 0,
            "created_at": order.created_at,
            "hold_expires_at": hold.expires_at if hold is not None else None,
            "hold_status": hold.status if hold is not None else None,
        }

    async def payment_for_order(self, order_id: UUID) -> Payment | None:
        return (
            await self.session.execute(select(Payment).where(Payment.order_id == order_id))
        ).scalar_one_or_none()

    async def payments_for_orders(self, order_ids: list[UUID]) -> dict[UUID, Payment]:
        """One query for an order list page (one payment per order)."""
        if not order_ids:
            return {}
        rows = (await self.session.execute(select(Payment).where(Payment.order_id.in_(order_ids)))).scalars()
        return {row.order_id: row for row in rows if row.order_id is not None}

    async def apply_completed_refund(self, ctx: AuthContext, refund: Refund) -> Order | None:
        payment = await self.payments.get_payment(refund.payment_id)
        if payment.order_id is None:
            return None
        order = await self.session.get(Order, payment.order_id)
        if order is None:
            return None
        remaining = await self.payments.remaining_refundable(payment)
        if order.status == "CANCELLED":
            # A late payment on a cancelled order (Q-COM-03) is refunded; the order stays CANCELLED
            # (no CANCELLED -> REFUNDED transition) and nothing was ever granted.
            order.updated_by = ctx.user_id
            await self.session.flush()
            return order
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
        if order.purpose == "TICKET" and refund.ticket_ids:
            # Q-COM-01: a per-ticket refund refunds exactly the tickets it named.
            await self.ticketing.refund_order_tickets(
                ctx, order_id=order.id, refund_id=refund.id, ticket_ids=[UUID(t) for t in refund.ticket_ids]
            )
        elif remaining == 0 and order.purpose == "TICKET":
            # 06 §5: a fully refunded order's tickets are REFUNDED and their QR stops working. A
            # goodwill part refund that names no tickets leaves every ticket valid (Q-COM-01).
            await self.ticketing.refund_order_tickets(ctx, order_id=order.id, refund_id=refund.id)
        mapping = (
            await self.session.execute(
                select(RefundEntitlementPolicy).where(
                    RefundEntitlementPolicy.reason_code == refund.reason_code
                )
            )
        ).scalars().first()
        # D-AUDIO-06: a refunded song or release purchase no longer streams or downloads, whatever
        # the refund reason. Other purchases follow the reason-code policy as before.
        music_refunded = remaining == 0 and order.purpose in {"TRACK", "RELEASE"}
        if not music_refunded and (mapping is None or mapping.action != "REVOKE"):
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

    # --- Refunds: per-ticket requests and the staff screen (Q-COM-01, D-REF-01) ---------------

    async def _order_organization(self, order: Order) -> UUID | None:
        """The label an order belongs to: the event's for tickets, the product's or plan's otherwise."""
        if order.purpose == "TICKET":
            hold = (
                await self.session.execute(select(TicketHold).where(TicketHold.order_id == order.id))
            ).scalar_one_or_none()
            if hold is None:
                return None
            ticket_type = await self.session.get(TicketType, hold.ticket_type_id)
            event = await self.session.get(Event, ticket_type.event_id) if ticket_type else None
            return event.organization_id if event else None
        item = (
            await self.session.execute(select(OrderItem).where(OrderItem.order_id == order.id).limit(1))
        ).scalar_one_or_none()
        if item is None:
            return None
        if item.item_type == "SUBSCRIPTION":
            from cornerroom.modules.subscriptions.domain.models import SubscriptionPlan, SubscriptionPlanVersion

            version = await self.session.get(SubscriptionPlanVersion, item.ref_id)
            plan = await self.session.get(SubscriptionPlan, version.plan_id) if version else None
            return plan.organization_id if plan else None
        product = (
            await self.session.execute(
                select(Product).where(Product.subject_id == item.ref_id, Product.deleted_at.is_(None)).limit(1)
            )
        ).scalar_one_or_none()
        return product.organization_id if product else None

    async def _assert_order_staff(self, ctx: AuthContext, order: Order) -> UUID | None:
        """Staff act on an order only with finance.post in its label; anything else reads as 404."""
        from cornerroom.infra.errors import ForbiddenError
        from cornerroom.modules.authorization.application.service import AuthorizationService

        if ctx.organization_id is None:
            raise AppError("WORKSPACE_REQUIRED", "An active organization is required", 409)
        org_id = await self._order_organization(order)
        if org_id is None:
            raise NotFoundError("Order not found")
        try:
            await AuthorizationService(self.session, clock=self.clock).authorize(
                ctx.user_id,
                "finance.post",
                resource_type="organization",
                resource_id=org_id,
                scope_organization_id=org_id,
            )
        except ForbiddenError as exc:
            raise NotFoundError("Order not found") from exc
        return org_id

    async def _tickets_in_open_refunds(self, payment_id: UUID) -> set[str]:
        rows = (
            await self.session.execute(
                select(Refund.ticket_ids).where(
                    Refund.payment_id == payment_id,
                    Refund.status.in_(("REQUESTED", "APPROVED", "PROCESSING")),
                    Refund.ticket_ids.is_not(None),
                )
            )
        ).scalars()
        return {ticket_id for ids in rows for ticket_id in (ids or [])}

    async def request_ticket_refund(
        self,
        ctx: AuthContext,
        *,
        order_id: UUID,
        ticket_ids: list[UUID],
        reason_code: str,
        idempotency_key: str,
    ) -> Refund:
        """Q-COM-01: refund exactly these tickets. The amount is what they cost, worked out here
        from the order's own line (never typed by staff or sent by the browser)."""
        replay = (
            await self.session.execute(select(Refund).where(Refund.idempotency_key == idempotency_key))
        ).scalar_one_or_none()
        if replay is not None:
            return replay
        order = await self.get_order_row(order_id)
        if order.user_id != ctx.user_id:
            await self._assert_order_staff(ctx, order)
        if order.purpose != "TICKET":
            raise AppError("VALIDATION_ERROR", "Only ticket orders are refunded per ticket", 422)
        wanted = list(dict.fromkeys(ticket_ids))
        if not wanted:
            raise AppError("VALIDATION_ERROR", "Choose at least one ticket", 422)
        payment = await self.payment_for_order(order.id)
        if payment is None:
            raise NotFoundError("Order not found")
        refundable = {t.id for t in await self.ticketing.refundable_order_tickets(order.id)}
        if any(t not in refundable for t in wanted):
            raise AppError("TICKET_NOT_REFUNDABLE", "One of these tickets can't be refunded", 409)
        pending = await self._tickets_in_open_refunds(payment.id)
        if any(str(t) in pending for t in wanted):
            raise AppError("TICKET_REFUND_PENDING", "One of these tickets already has a refund waiting", 409)
        line = (
            await self.session.execute(
                select(OrderItem).where(OrderItem.order_id == order.id, OrderItem.item_type == "TICKET")
            )
        ).scalar_one()
        amount = Money(amount_minor=line.unit_amount_minor * len(wanted), currency_code=line.currency_code)
        return await self.payments.request_refund(
            ctx,
            payment_id=payment.id,
            amount_minor=amount.amount_minor,
            reason_code=reason_code,
            idempotency_key=idempotency_key,
            ticket_ids=wanted,
        )

    async def request_remaining_refund(
        self, ctx: AuthContext, *, order_id: UUID, reason_code: str, idempotency_key: str
    ) -> Refund:
        """Refund whatever is still refundable on an order (for example a late payment on a
        cancelled order). The amount comes from the payment, never from the browser."""
        replay = (
            await self.session.execute(select(Refund).where(Refund.idempotency_key == idempotency_key))
        ).scalar_one_or_none()
        if replay is not None:
            return replay
        order = await self.get_order_row(order_id)
        if order.user_id != ctx.user_id:
            await self._assert_order_staff(ctx, order)
        payment = await self.payment_for_order(order.id)
        if payment is None:
            raise NotFoundError("Order not found")
        return await self.payments.request_refund(
            ctx,
            payment_id=payment.id,
            amount_minor=await self.payments.remaining_refundable(payment),
            reason_code=reason_code,
            idempotency_key=idempotency_key,
        )

    async def staff_order_view(self, ctx: AuthContext, reference: str) -> dict[str, Any]:
        """Support view of one order for the refund screen. The buyer's email is masked."""
        from sqlalchemy import String as SAString, cast, func

        from cornerroom.infra.logging import mask_email
        from cornerroom.modules.identity.domain.models import User

        ref = reference.strip().upper().removeprefix("CR-").lower()
        if len(ref) != 8 or any(c not in "0123456789abcdef" for c in ref):
            raise AppError("VALIDATION_ERROR", "An order reference looks like CR-1A2B3C4D", 422)
        candidates = list(
            (
                await self.session.execute(
                    select(Order).where(
                        func.right(func.replace(cast(Order.id, SAString), "-", ""), 8) == ref,
                        Order.deleted_at.is_(None),
                    )
                )
            ).scalars()
        )
        order = None
        for row in candidates:
            try:
                await self._assert_order_staff(ctx, row)
            except NotFoundError:
                continue
            order = row
            break
        if order is None:
            raise NotFoundError("Order not found")
        payment = await self.payment_for_order(order.id)
        details = await self.order_details(order)
        buyer = await self.session.get(User, order.user_id)
        tickets: list[dict[str, Any]] = []
        if order.purpose == "TICKET":
            from cornerroom.modules.ticketing.domain.models import Ticket

            line = next((i for i in details["items"] if i["item_type"] == "TICKET"), None)
            hold = (
                await self.session.execute(select(TicketHold).where(TicketHold.order_id == order.id))
            ).scalar_one_or_none()
            if hold is not None:
                pending = await self._tickets_in_open_refunds(payment.id) if payment else set()
                rows = (
                    await self.session.execute(
                        select(Ticket).where(Ticket.hold_id == hold.id, Ticket.deleted_at.is_(None)).order_by(Ticket.created_at, Ticket.id)
                    )
                ).scalars()
                for ticket in rows:
                    tickets.append(
                        {
                            "id": ticket.id,
                            "status": ticket.status,
                            "ticket_type_name": line["ticket_type_name"] if line else None,
                            "unit_amount_minor": line["unit_amount_minor"] if line else 0,
                            "currency_code": order.currency_code,
                            "refundable": ticket.status in {"PAID", "ISSUED", "CHECKED_IN"} and str(ticket.id) not in pending,
                            "refund_pending": str(ticket.id) in pending,
                        }
                    )
        refunds = []
        if payment is not None:
            refunds = [
                self._refund_row(r, order, payment.provider)
                for r in (
                    await self.session.execute(select(Refund).where(Refund.payment_id == payment.id).order_by(Refund.created_at))
                ).scalars()
            ]
        return {
            "order": order,
            "payment": payment,
            "details": details,
            "buyer_email": mask_email(buyer.email) if buyer and buyer.email else None,
            "tickets": tickets,
            "refunds": refunds,
        }

    @staticmethod
    def _refund_row(refund: Refund, order: Order, provider: str | None = None) -> dict[str, Any]:
        return {
            "id": refund.id,
            "payment_id": refund.payment_id,
            "order_id": order.id,
            "status": refund.status,
            "amount_minor": refund.amount_minor,
            "currency_code": refund.currency_code,
            "reason_code": refund.reason_code,
            "ticket_ids": refund.ticket_ids,
            "created_at": refund.created_at,
            # sandbox: the test button completes it; bangla_qr: paid back by hand with a reference.
            "payment_provider": provider,
        }

    async def staff_open_refunds(self, ctx: AuthContext, *, limit: int = 100) -> list[dict[str, Any]]:
        """Refunds waiting for approval or completion, in labels this staff member may act for."""
        rows = (
            await self.session.execute(
                select(Refund, Order, Payment.provider)
                .join(Payment, Payment.id == Refund.payment_id)
                .join(Order, Order.id == Payment.order_id)
                .where(Refund.status.in_(("REQUESTED", "APPROVED", "PROCESSING")))
                .order_by(Refund.created_at)
                .limit(clamp_limit(limit))
            )
        ).all()
        out: list[dict[str, Any]] = []
        allowed: dict[UUID, bool] = {}
        for refund, order, provider in rows:
            if order.id not in allowed:
                try:
                    await self._assert_order_staff(ctx, order)
                    allowed[order.id] = True
                except NotFoundError:
                    allowed[order.id] = False
            if allowed[order.id]:
                out.append(self._refund_row(refund, order, provider))
        return out

    # --- Bangla QR staff verification (Q-PAY-01, Q-PAY-05) ------------------------------------

    @staticmethod
    def _clean_submission(transaction_ref: str, paid_from: str, paid_with: str) -> tuple[str, str, str]:
        import re

        from cornerroom.modules.finance.application.bangla_qr import PAID_WITH
        from cornerroom.modules.identity.domain.bd_address import normalize_bd_mobile

        ref = re.sub(r"\s+", "", transaction_ref or "").upper()
        if not re.fullmatch(r"[A-Z0-9\-]{6,40}", ref):
            raise AppError("VALIDATION_ERROR", "Enter the transaction ID from your payment app", 422, extras={"field": "transaction_ref"})
        digits = re.sub(r"[\s\-()]", "", paid_from or "")
        mobile = normalize_bd_mobile(digits)
        if mobile is None and not re.fullmatch(r"\+?\d{6,20}", digits):
            raise AppError("VALIDATION_ERROR", "Enter the number or account you paid from", 422, extras={"field": "paid_from"})
        if paid_with not in PAID_WITH:
            raise AppError("VALIDATION_ERROR", "Choose the app you paid with", 422, extras={"field": "paid_with"})
        return ref, mobile or digits, paid_with

    async def latest_submission(self, payment_id: UUID):
        from cornerroom.modules.finance.domain.models import PaymentSubmission

        return (
            await self.session.execute(
                select(PaymentSubmission)
                .where(PaymentSubmission.payment_id == payment_id)
                .order_by(PaymentSubmission.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()

    async def submit_payment(
        self, ctx: AuthContext, *, payment_id: UUID, transaction_ref: str, paid_from: str, paid_with: str
    ):
        """The buyer reports a Bangla QR payment. Staff check it; until they decide, a ticket
        order's seats stay held (Q-PAY-05). Nothing is captured here."""
        from sqlalchemy.exc import IntegrityError

        from cornerroom.kernel.events import PAYMENT_SUBMITTED
        from cornerroom.modules.finance.domain.models import PaymentSubmission

        payment = await self.payments.get_payment(payment_id)
        if payment.user_id != ctx.user_id or payment.order_id is None:
            raise NotFoundError("Payment not found")
        ref, source, app = self._clean_submission(transaction_ref, paid_from, paid_with)
        order = await self.get_order_row(payment.order_id)
        if order.status == "CANCELLED":
            raise AppError("ORDER_CANCELLED", "This order was cancelled because the reservation ran out. Start again to buy.", 409)
        if order.status != "PENDING_PAYMENT" or payment.status not in {"CREATED", "REQUIRES_ACTION", "AUTHORIZED"}:
            raise AppError("INVALID_TRANSITION", "This payment is already settled", 409)
        latest = await self.latest_submission(payment.id)
        if latest is not None and latest.status == "SUBMITTED":
            raise AppError("PAYMENT_SUBMISSION_PENDING", "We're already checking a payment for this order", 409)
        if order.purpose == "TICKET":
            await self.ticketing.pause_hold_for_verification(order.id)
        row = PaymentSubmission(
            payment_id=payment.id,
            order_id=order.id,
            user_id=ctx.user_id,
            transaction_ref=ref,
            paid_from=source,
            paid_with=app,
            status="SUBMITTED",
        )
        try:
            async with self.session.begin_nested():
                self.session.add(row)
                await self.session.flush()
        except IntegrityError as exc:
            raise AppError(
                "TRANSACTION_ALREADY_USED",
                "That transaction ID has already been sent for another payment",
                409,
                extras={"field": "transaction_ref"},
            ) from exc
        await enqueue_outbox(
            self.session,
            DomainEvent(
                event_type=PAYMENT_SUBMITTED,
                producer="commerce",
                aggregate_type="Payment",
                aggregate_id=payment.id,
                payload={"payment_id": str(payment.id), "order_id": str(order.id), "submission_id": str(row.id)},
                occurred_at=self.clock.now(),
                actor_id=ctx.user_id,
                organization_id=await self._order_organization(order),
                correlation_id=ctx.request_id,
            ),
        )
        # Audit without the transaction details (personal/financial data stays in its table).
        await self.audit.record_from_auth(
            ctx, action="payment.submitted", entity_type="PaymentSubmission", entity_id=row.id,
            new_state={"status": "SUBMITTED", "paid_with": app},
        )
        return row

    async def _submission_for_staff(self, ctx: AuthContext, submission_id: UUID):
        from cornerroom.modules.finance.domain.models import PaymentSubmission

        row = (
            await self.session.execute(select(PaymentSubmission).where(PaymentSubmission.id == submission_id).with_for_update())
        ).scalar_one_or_none()
        if row is None or row.order_id is None:
            raise NotFoundError("Submission not found")
        order = await self.get_order_row(row.order_id)
        try:
            org_id = await self._assert_order_staff(ctx, order)
        except NotFoundError as exc:
            raise NotFoundError("Submission not found") from exc
        if row.status != "SUBMITTED":
            raise AppError("INVALID_TRANSITION", "This payment was already decided", 409)
        return row, order, org_id

    async def confirm_submission(self, ctx: AuthContext, submission_id: UUID) -> tuple[Order, Payment]:
        """Finance staff found the payment on the statement: capture it through the normal
        pipeline (PaymentCaptured, ledger, recognition) and fulfil the order."""
        from cornerroom.kernel.payment import PaymentCallback

        row, order, org_id = await self._submission_for_staff(ctx, submission_id)
        payment = await self.payments.get_payment(row.payment_id)
        row.status = "CONFIRMED"
        row.decided_by = ctx.user_id
        row.decided_at = self.clock.now()
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx, action="payment.submission_confirmed", entity_type="PaymentSubmission", entity_id=row.id,
            new_state={"status": "CONFIRMED"}, organization_id=org_id,
        )
        payment = await self.payments.apply_callback(
            PaymentCallback(
                payment_id=payment.id,
                amount_minor=payment.amount_minor,
                currency_code=payment.currency_code,
                provider_event_id=f"staff-verified:{row.id}",
                captured=True,
            )
        )
        order = await self.fulfill_captured_payment(ctx, payment)
        return order, payment

    async def reject_submission(self, ctx: AuthContext, submission_id: UUID, *, reason: str):
        """Staff could not find the payment. The buyer sees the reason and may fix and resend; a
        ticket order keeps its seats for the normal hold time from now (Q-PAY-05)."""
        from cornerroom.kernel.events import PAYMENT_SUBMISSION_REJECTED

        note = " ".join((reason or "").split())
        if not note:
            raise AppError("VALIDATION_ERROR", "Say why, so the buyer can fix it", 422, extras={"field": "reason"})
        if len(note) > 300:
            raise AppError("VALIDATION_ERROR", "Keep the reason under 300 characters", 422, extras={"field": "reason"})
        row, order, org_id = await self._submission_for_staff(ctx, submission_id)
        row.status = "REJECTED"
        row.decided_by = ctx.user_id
        row.decided_at = self.clock.now()
        row.decision_note = note
        if order.purpose == "TICKET":
            await self.ticketing.resume_hold_after_rejection(order.id)
        await self.session.flush()
        await enqueue_outbox(
            self.session,
            DomainEvent(
                event_type=PAYMENT_SUBMISSION_REJECTED,
                producer="commerce",
                aggregate_type="Payment",
                aggregate_id=row.payment_id,
                payload={"payment_id": str(row.payment_id), "order_id": str(order.id), "reason": note},
                occurred_at=self.clock.now(),
                actor_id=ctx.user_id,
                organization_id=org_id,
                correlation_id=ctx.request_id,
            ),
        )
        await self.audit.record_from_auth(
            ctx, action="payment.submission_rejected", entity_type="PaymentSubmission", entity_id=row.id,
            new_state={"status": "REJECTED"}, reason=note, organization_id=org_id,
        )
        return row

    async def staff_submissions(
        self, ctx: AuthContext, *, status: str | None = "SUBMITTED", limit: int = 100, submission_id: UUID | None = None
    ) -> list[dict[str, Any]]:
        """The finance queue: submissions in labels this staff member may act for (oldest first)."""
        from cornerroom.infra.logging import mask_email
        from cornerroom.modules.finance.domain.models import PaymentSubmission
        from cornerroom.modules.identity.domain.models import User

        if ctx.organization_id is None:
            raise AppError("WORKSPACE_REQUIRED", "An active organization is required", 409)
        stmt = (
            select(PaymentSubmission, Order, Payment, User.email)
            .join(Order, Order.id == PaymentSubmission.order_id)
            .join(Payment, Payment.id == PaymentSubmission.payment_id)
            .join(User, User.id == PaymentSubmission.user_id)
            .order_by(PaymentSubmission.created_at)
            .limit(clamp_limit(limit))
        )
        if status is not None:
            stmt = stmt.where(PaymentSubmission.status == status)
        if submission_id is not None:
            stmt = stmt.where(PaymentSubmission.id == submission_id)
        rows = (await self.session.execute(stmt)).all()
        allowed: dict[UUID, bool] = {}
        out: list[dict[str, Any]] = []
        for sub, order, payment, email in rows:
            if order.id not in allowed:
                try:
                    await self._assert_order_staff(ctx, order)
                    allowed[order.id] = True
                except NotFoundError:
                    allowed[order.id] = False
            if not allowed[order.id]:
                continue
            out.append(
                {
                    "id": sub.id,
                    "order_id": order.id,
                    "purpose": order.purpose,
                    "amount_minor": payment.amount_minor,
                    "currency_code": payment.currency_code,
                    "transaction_ref": sub.transaction_ref,
                    "paid_from": sub.paid_from,
                    "paid_with": sub.paid_with,
                    "status": sub.status,
                    "decision_note": sub.decision_note,
                    "buyer_email": mask_email(email) if email else None,
                    "submitted_at": sub.created_at,
                }
            )
        return out

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
        # A renewal the subscriber starts uses the address already saved (still required, D-ADDR-01).
        return await self.checkout_from_plan(
            ctx,
            plan_id=plan.id,
            idempotency_key=idempotency_key,
            renew_subscription_id=sub.id,
            delivery_confirmed=True,
        )
