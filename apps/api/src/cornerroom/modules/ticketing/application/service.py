"""Ticketing application service. Inventory, types, holds, issuance, check-in."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import Select, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.exc import StaleDataError

from cornerroom.infra.errors import AppError, ConflictError, ForbiddenError, NotFoundError
from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.infra.settings import Settings, get_settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import DomainEvent
from cornerroom.kernel.money import Money
from cornerroom.kernel.pagination import clamp_limit, encode_cursor, keyset_before
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.authorization.application.service import AuthorizationService
from cornerroom.modules.events.domain.models import Event
from cornerroom.modules.ticketing.application.tokens import (
    ticket_token,
    token_hash,
    verify_ticket_token,
)
from cornerroom.modules.ticketing.domain.lifecycle import (
    PURCHASABLE_EVENT_STATUSES,
    ticket_type_target_for_action,
    ticket_type_transition_action,
)
from cornerroom.modules.ticketing.domain.models import (
    CheckIn,
    Ticket,
    TicketHold,
    TicketType,
    TicketTypeInventory,
)

TICKET_TYPE_PRICE_CHANGED = "TicketTypePriceChanged"
TICKET_HOLD_EXPIRED = "TicketHoldExpired"
TICKET_PAID = "TicketPaid"
TICKET_ISSUED = "TicketIssued"
TICKET_CHECKED_IN = "TicketCheckedIn"
TICKET_REFUNDED = "TicketRefunded"
# STATE_MACHINES Ticket: PAID / ISSUED / CHECKED_IN -> REFUNDED (Finance approve).
REFUNDABLE_TICKET_STATUSES = ("PAID", "ISSUED", "CHECKED_IN")


class TicketingService:
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
        self.authz = AuthorizationService(session, clock=self.clock)

    def _token_secret(self) -> str:
        return self.settings.ticket_secret

    async def _is_allowed(
        self,
        user_id: UUID,
        permission: str,
        *,
        resource_id: UUID,
        organization_id: UUID,
    ) -> bool:
        try:
            await self.authz.authorize(
                user_id,
                permission,
                resource_type="event",
                resource_id=resource_id,
                scope_organization_id=organization_id,
            )
            return True
        except ForbiddenError:
            return False

    async def _event(self, event_id: UUID) -> Event:
        event = await self.session.get(Event, event_id)
        if event is None or event.deleted_at is not None:
            raise NotFoundError("Event not found")
        return event

    async def _assert_event_perm(
        self,
        ctx: AuthContext,
        event: Event,
        permission: str,
        *,
        mutate: bool,
    ) -> None:
        allowed = await self._is_allowed(
            ctx.user_id,
            permission,
            resource_id=event.id,
            organization_id=event.organization_id,
        )
        if allowed:
            return
        can_read = await self._is_allowed(
            ctx.user_id,
            "event.read",
            resource_id=event.id,
            organization_id=event.organization_id,
        )
        if mutate and can_read:
            raise ForbiddenError(f"Missing permission {permission}")
        raise NotFoundError("Event not found")

    async def _emit(
        self,
        ctx: AuthContext | None,
        *,
        event_type: str,
        aggregate_type: str,
        aggregate_id: UUID,
        organization_id: UUID | None,
        payload: dict[str, Any],
        actor_id: UUID | None = None,
    ) -> None:
        domain = DomainEvent(
            event_type=event_type,
            producer="ticketing",
            aggregate_type=aggregate_type,
            aggregate_id=aggregate_id,
            payload=payload,
            occurred_at=self.clock.now(),
            actor_id=actor_id or (ctx.user_id if ctx else None),
            organization_id=organization_id,
            correlation_id=ctx.request_id if ctx else None,
        )
        await enqueue_outbox(self.session, domain)

    async def _flush_versioned(self) -> None:
        try:
            await self.session.flush()
        except StaleDataError as exc:
            raise ConflictError("The resource was updated concurrently") from exc

    async def _lock_inventory(self, ticket_type_id: UUID) -> TicketTypeInventory:
        stmt = (
            select(TicketTypeInventory)
            .where(TicketTypeInventory.ticket_type_id == ticket_type_id)
            .with_for_update()
        )
        row = (await self.session.execute(stmt)).scalar_one_or_none()
        if row is None:
            raise NotFoundError("Ticket type inventory not found")
        return row

    async def expire_due_holds(
        self, ticket_type_id: UUID | None = None, *, batch: int | None = None
    ) -> int:
        """Expire ACTIVE holds past their TTL and return their inventory.

        Holds are locked (rows another transaction is already expiring are skipped) and taken in
        ticket-type order, so concurrent callers lock inventory rows in the same order.
        """
        now = self.clock.now()
        stmt = (
            select(TicketHold)
            .where(
                TicketHold.status == "ACTIVE",
                TicketHold.expires_at <= now,
                TicketHold.deleted_at.is_(None),
                # Q-PAY-05: a payment staff are still checking keeps its seats.
                TicketHold.verification_pending.is_(False),
            )
            .order_by(TicketHold.ticket_type_id, TicketHold.id)
            .with_for_update(skip_locked=True)
            .execution_options(populate_existing=True)
        )
        if ticket_type_id is not None:
            stmt = stmt.where(TicketHold.ticket_type_id == ticket_type_id)
        if batch is not None:
            stmt = stmt.limit(batch)
        holds = list((await self.session.execute(stmt)).scalars().all())
        expired = 0
        for hold in holds:
            await self._release_hold(hold, status="EXPIRED", ctx=None)
            expired += 1
        return expired

    async def _release_hold(
        self,
        hold: TicketHold,
        *,
        status: str,
        ctx: AuthContext | None,
    ) -> None:
        if hold.status != "ACTIVE":
            return
        inventory = await self._lock_inventory(hold.ticket_type_id)
        inventory.remaining += hold.quantity
        hold.status = status
        tickets = (
            await self.session.execute(
                select(Ticket).where(
                    Ticket.hold_id == hold.id,
                    Ticket.status.in_(("CREATED", "RESERVED", "PAYMENT_PENDING")),
                    Ticket.deleted_at.is_(None),
                )
            )
        ).scalars().all()
        for ticket in tickets:
            ticket.status = "EXPIRED"
        ticket_type = await self.session.get(TicketType, hold.ticket_type_id)
        if (
            ticket_type is not None
            and ticket_type.status == "SOLD_OUT"
            and inventory.remaining > 0
        ):
            ticket_type.status = "ON_SALE"
        await self._flush_versioned()
        event = await self._event(ticket_type.event_id) if ticket_type else None
        if status == "EXPIRED":
            await self._emit(
                ctx,
                event_type=TICKET_HOLD_EXPIRED,
                aggregate_type="TicketHold",
                aggregate_id=hold.id,
                organization_id=event.organization_id if event else None,
                payload={
                    "hold_id": str(hold.id),
                    "ticket_type_id": str(hold.ticket_type_id),
                    "quantity": hold.quantity,
                    "status": status,
                },
            )
        if ctx is not None:
            await self.audit.record_from_auth(
                ctx,
                action=f"ticket_hold.{status.lower()}",
                entity_type="TicketHold",
                entity_id=hold.id,
                previous_state={"status": "ACTIVE"},
                new_state={"status": status},
                organization_id=event.organization_id if event else None,
            )

    async def _sync_sold_out(self, ticket_type: TicketType, remaining: int) -> None:
        if remaining == 0 and ticket_type.status == "ON_SALE":
            ticket_type.status = "SOLD_OUT"
        elif remaining > 0 and ticket_type.status == "SOLD_OUT":
            ticket_type.status = "ON_SALE"

    def _sales_window_open(self, ticket_type: TicketType, now: datetime) -> bool:
        if ticket_type.sales_starts_at is not None and now < ticket_type.sales_starts_at:
            return False
        if ticket_type.sales_ends_at is not None and now > ticket_type.sales_ends_at:
            return False
        return True

    async def create_ticket_type(
        self,
        ctx: AuthContext,
        *,
        event_id: UUID,
        name: str,
        price_amount_minor: int,
        currency_code: str,
        quantity_total: int,
        sales_starts_at: datetime | None = None,
        sales_ends_at: datetime | None = None,
    ) -> TicketType:
        event = await self._event(event_id)
        await self._assert_event_perm(ctx, event, "event.write", mutate=True)
        money = Money(amount_minor=price_amount_minor, currency_code=currency_code)
        if quantity_total < 0:
            raise AppError("VALIDATION_ERROR", "quantity_total must be >= 0", 422)
        if sales_starts_at and sales_ends_at and sales_ends_at <= sales_starts_at:
            raise AppError("VALIDATION_ERROR", "sales_ends_at must be after sales_starts_at", 422)
        row = TicketType(
            event_id=event.id,
            name=name.strip(),
            status="DRAFT",
            price_amount_minor=money.amount_minor,
            currency_code=money.currency_code,
            quantity_total=quantity_total,
            sales_starts_at=sales_starts_at,
            sales_ends_at=sales_ends_at,
            created_by=ctx.user_id,
            updated_by=ctx.user_id,
        )
        self.session.add(row)
        await self.session.flush()
        self.session.add(
            TicketTypeInventory(ticket_type_id=row.id, remaining=quantity_total)
        )
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx,
            action="ticket_type.created",
            entity_type="TicketType",
            entity_id=row.id,
            new_state={
                "name": row.name,
                "price_amount_minor": row.price_amount_minor,
                "currency_code": row.currency_code,
                "quantity_total": row.quantity_total,
            },
            organization_id=event.organization_id,
        )
        return row

    async def get_ticket_type_row(self, ticket_type_id: UUID) -> TicketType:
        row = await self.session.get(TicketType, ticket_type_id)
        if row is None or row.deleted_at is not None:
            raise NotFoundError("Ticket type not found")
        return row

    async def get_ticket_row(self, ticket_id: UUID) -> Ticket:
        ticket = await self.session.get(Ticket, ticket_id)
        if ticket is None or ticket.deleted_at is not None:
            raise NotFoundError("Ticket not found")
        return ticket

    async def get_ticket_type(self, ctx: AuthContext, ticket_type_id: UUID) -> TicketType:
        row = await self.get_ticket_type_row(ticket_type_id)
        event = await self._event(row.event_id)
        await self._assert_event_perm(ctx, event, "event.read", mutate=False)
        return row

    async def list_ticket_types(
        self,
        ctx: AuthContext | None,
        event_id: UUID,
        *,
        cursor: str | None = None,
        limit: int = 50,
    ) -> tuple[list[TicketType], str | None, bool]:
        event = await self._event(event_id)
        staff = False
        if ctx is not None:
            staff = await self._is_allowed(
                ctx.user_id,
                "event.read",
                resource_id=event.id,
                organization_id=event.organization_id,
            )
        public = event.published_at is not None and event.status in {
            "PUBLISHED",
            "TICKETING_OPEN",
            "SALES_CLOSED",
            "LIVE",
            "COMPLETED",
            "POSTPONED",
            "CANCELLED",
        }
        if not staff and not public:
            raise NotFoundError("Event not found")
        limit = clamp_limit(limit)
        stmt: Select[tuple[TicketType]] = select(TicketType).where(
            TicketType.event_id == event_id,
            TicketType.deleted_at.is_(None),
        )
        if not staff:
            stmt = stmt.where(TicketType.status == "ON_SALE")
        stmt = stmt.order_by(TicketType.created_at.desc(), TicketType.id.desc())
        if cursor:
            stmt = stmt.where(keyset_before(TicketType.created_at, TicketType.id, cursor))
        stmt = stmt.limit(limit + 1)
        rows = list((await self.session.execute(stmt)).scalars().all())
        next_cursor = None
        if len(rows) > limit:
            last = rows[limit - 1]
            next_cursor = encode_cursor(last.created_at.isoformat(), last.id)
            rows = rows[:limit]
        return rows, next_cursor, not staff

    async def remaining_for(self, ticket_type_id: UUID) -> int:
        inv = await self.session.get(TicketTypeInventory, ticket_type_id)
        return inv.remaining if inv is not None else 0

    async def remaining_for_many(self, ticket_type_ids: list[UUID]) -> dict[UUID, int]:
        """Remaining inventory for a page of ticket types in one query."""
        if not ticket_type_ids:
            return {}
        rows = await self.session.execute(
            select(TicketTypeInventory.ticket_type_id, TicketTypeInventory.remaining).where(
                TicketTypeInventory.ticket_type_id.in_(ticket_type_ids)
            )
        )
        found = {ticket_type_id: remaining for ticket_type_id, remaining in rows.all()}
        return {ticket_type_id: found.get(ticket_type_id, 0) for ticket_type_id in ticket_type_ids}

    async def update_ticket_type(
        self,
        ctx: AuthContext,
        ticket_type_id: UUID,
        *,
        name: str | None = None,
        price_amount_minor: int | None = None,
        currency_code: str | None = None,
        sales_starts_at: datetime | None = None,
        sales_ends_at: datetime | None = None,
        expected_version: int | None = None,
        sales_starts_set: bool = False,
        sales_ends_set: bool = False,
    ) -> TicketType:
        row = await self.get_ticket_type_row(ticket_type_id)
        event = await self._event(row.event_id)
        await self._assert_event_perm(ctx, event, "event.write", mutate=True)
        if expected_version is not None and row.version != expected_version:
            raise ConflictError("Ticket type version conflict")
        previous_price = {"amount_minor": row.price_amount_minor, "currency_code": row.currency_code}
        if name is not None:
            row.name = name.strip()
        if price_amount_minor is not None or currency_code is not None:
            money = Money(
                amount_minor=price_amount_minor if price_amount_minor is not None else row.price_amount_minor,
                currency_code=currency_code or row.currency_code,
            )
            price_changed = (
                money.amount_minor != row.price_amount_minor or money.currency_code != row.currency_code
            )
            row.price_amount_minor = money.amount_minor
            row.currency_code = money.currency_code
            if price_changed:
                await self._emit(
                    ctx,
                    event_type=TICKET_TYPE_PRICE_CHANGED,
                    aggregate_type="TicketType",
                    aggregate_id=row.id,
                    organization_id=event.organization_id,
                    payload={
                        "ticket_type_id": str(row.id),
                        "previous": previous_price,
                        "price": money.to_dict(),
                    },
                )
                await self.audit.record_from_auth(
                    ctx,
                    action="ticket_type.price_changed",
                    entity_type="TicketType",
                    entity_id=row.id,
                    previous_state=previous_price,
                    new_state=money.to_dict(),
                    organization_id=event.organization_id,
                )
        if sales_starts_set:
            row.sales_starts_at = sales_starts_at
        if sales_ends_set:
            row.sales_ends_at = sales_ends_at
        if row.sales_starts_at and row.sales_ends_at and row.sales_ends_at <= row.sales_starts_at:
            raise AppError("VALIDATION_ERROR", "sales_ends_at must be after sales_starts_at", 422)
        row.updated_by = ctx.user_id
        await self._flush_versioned()
        return row

    async def transition_ticket_type(
        self,
        ctx: AuthContext,
        ticket_type_id: UUID,
        *,
        action: str,
        expected_version: int | None = None,
    ) -> TicketType:
        row = await self.get_ticket_type_row(ticket_type_id)
        event = await self._event(row.event_id)
        await self._assert_event_perm(ctx, event, "event.write", mutate=True)
        if expected_version is not None and row.version != expected_version:
            raise ConflictError("Ticket type version conflict")
        target = ticket_type_target_for_action(action)
        ticket_type_transition_action(row.status, target)
        if target == "ON_SALE":
            Money(amount_minor=row.price_amount_minor, currency_code=row.currency_code)
            remaining = await self.remaining_for(row.id)
            if remaining <= 0:
                raise AppError(
                    "INSUFFICIENT_INVENTORY",
                    "Cannot put a sold-out type on sale",
                    409,
                    "remaining is 0",
                )
        previous = row.status
        row.status = target
        row.updated_by = ctx.user_id
        await self._flush_versioned()
        await self.audit.record_from_auth(
            ctx,
            action=f"ticket_type.{action}",
            entity_type="TicketType",
            entity_id=row.id,
            previous_state={"status": previous},
            new_state={"status": row.status},
            organization_id=event.organization_id,
        )
        return row

    async def create_hold(
        self,
        ctx: AuthContext,
        *,
        ticket_type_id: UUID,
        quantity: int,
    ) -> TicketHold:
        if quantity < 1:
            raise AppError("VALIDATION_ERROR", "quantity must be >= 1", 422)
        await self.expire_due_holds(ticket_type_id)
        ticket_type = await self.get_ticket_type_row(ticket_type_id)
        event = await self._event(ticket_type.event_id)
        if event.status not in PURCHASABLE_EVENT_STATUSES:
            raise AppError(
                "SALES_CLOSED",
                "Ticketing is not open",
                409,
                "Holds are allowed only while the event is TICKETING_OPEN (Q-P1-03 fail closed).",
            )
        if ticket_type.status != "ON_SALE":
            raise AppError("TICKET_TYPE_NOT_ON_SALE", "Ticket type is not on sale", 409)
        now = self.clock.now()
        if not self._sales_window_open(ticket_type, now):
            raise AppError("SALES_WINDOW_CLOSED", "Ticket type is outside its sales window", 409)
        ttl = self.settings.ticket_hold_ttl_seconds
        if ttl <= 0:
            raise AppError(
                "HOLD_TTL_UNCONFIGURED",
                "Hold TTL is not configured",
                409,
                "ticket_hold_ttl_seconds must be > 0 (Q-P5-01).",
            )
        inventory = await self._lock_inventory(ticket_type.id)
        if inventory.remaining < quantity:
            raise AppError(
                "INSUFFICIENT_INVENTORY",
                "Not enough tickets remaining",
                409,
                "Inventory cannot go negative.",
            )
        inventory.remaining -= quantity
        if inventory.remaining < 0:
            raise AppError("INSUFFICIENT_INVENTORY", "Not enough tickets remaining", 409)
        await self._sync_sold_out(ticket_type, inventory.remaining)
        hold = TicketHold(
            ticket_type_id=ticket_type.id,
            user_id=ctx.user_id,
            quantity=quantity,
            status="ACTIVE",
            expires_at=now + timedelta(seconds=ttl),
            created_by=ctx.user_id,
            updated_by=ctx.user_id,
        )
        self.session.add(hold)
        await self.session.flush()
        for _ in range(quantity):
            self.session.add(
                Ticket(
                    ticket_type_id=ticket_type.id,
                    hold_id=hold.id,
                    owner_user_id=ctx.user_id,
                    status="RESERVED",
                    created_by=ctx.user_id,
                    updated_by=ctx.user_id,
                )
            )
        await self._flush_versioned()
        await self.audit.record_from_auth(
            ctx,
            action="ticket_hold.created",
            entity_type="TicketHold",
            entity_id=hold.id,
            new_state={"quantity": quantity, "ticket_type_id": str(ticket_type.id)},
            organization_id=event.organization_id,
        )
        return hold

    async def release_hold(self, ctx: AuthContext, hold_id: UUID) -> TicketHold:
        hold = await self.session.get(TicketHold, hold_id)
        if hold is None or hold.deleted_at is not None:
            raise NotFoundError("Hold not found")
        if hold.user_id != ctx.user_id:
            raise NotFoundError("Hold not found")
        await self.expire_due_holds(hold.ticket_type_id)
        hold = await self.session.get(TicketHold, hold_id)
        if hold is None or hold.status != "ACTIVE":
            raise AppError("INVALID_TRANSITION", "Hold is not active", 409)
        if hold.verification_pending:
            raise AppError("HOLD_VERIFICATION_PENDING", "Your payment is being checked; these seats stay held", 409)
        await self._release_hold(hold, status="RELEASED", ctx=ctx)
        return hold

    async def _order_hold(self, order_id: UUID) -> TicketHold | None:
        return (
            await self.session.execute(
                select(TicketHold).where(TicketHold.order_id == order_id).with_for_update()
            )
        ).scalar_one_or_none()

    async def pause_hold_for_verification(self, order_id: UUID) -> TicketHold | None:
        """Q-PAY-05: once a Bangla QR payment is submitted, its seats stay held until staff decide.
        Refuses when the reservation has already run out (nothing is left to hold)."""
        hold = await self._order_hold(order_id)
        if hold is None:
            return None
        if hold.status != "ACTIVE" or (not hold.verification_pending and hold.expires_at <= self.clock.now()):
            raise AppError("HOLD_EXPIRED", "Your reservation ran out before the payment was sent", 409)
        hold.verification_pending = True
        await self.session.flush()
        return hold

    async def resume_hold_after_rejection(self, order_id: UUID) -> TicketHold | None:
        """Q-PAY-05 (owner, 2026-10-18): after a rejection the buyer may fix and resend; the seats
        stay held for the normal hold time from now, then expire as usual."""
        hold = await self._order_hold(order_id)
        if hold is None or hold.status != "ACTIVE":
            return hold
        hold.verification_pending = False
        hold.expires_at = self.clock.now() + timedelta(seconds=self.settings.ticket_hold_ttl_seconds)
        await self.session.flush()
        return hold

    async def get_active_hold_for_user(self, hold_id: UUID, user_id: UUID) -> TicketHold:
        hold = await self.session.get(TicketHold, hold_id)
        if hold is None or hold.deleted_at is not None or hold.user_id != user_id:
            raise NotFoundError("Hold not found")
        # Only this hold's ticket type: checkout must not lock other events' inventory.
        await self.expire_due_holds(hold.ticket_type_id)
        if hold.status != "ACTIVE" or hold.expires_at <= self.clock.now():
            if hold.status == "ACTIVE":
                await self._release_hold(hold, status="EXPIRED", ctx=None)
            raise AppError("HOLD_EXPIRED", "Hold is not active", 409)
        return hold

    async def attach_hold_to_order(self, hold: TicketHold, order_id: UUID, order_item_id: UUID) -> None:
        hold.order_id = order_id
        tickets = (
            await self.session.execute(
                select(Ticket).where(Ticket.hold_id == hold.id, Ticket.deleted_at.is_(None))
            )
        ).scalars().all()
        for ticket in tickets:
            ticket.status = "PAYMENT_PENDING"
            ticket.order_item_id = order_item_id
        await self.session.flush()

    async def convert_hold_and_issue(
        self,
        ctx: AuthContext | None,
        *,
        hold_id: UUID,
        organization_id: UUID | None,
    ) -> list[Ticket]:
        hold = await self.session.get(TicketHold, hold_id)
        if hold is None:
            raise NotFoundError("Hold not found")
        if hold.status == "CONVERTED":
            issued = (
                await self.session.execute(
                    select(Ticket).where(
                        Ticket.hold_id == hold.id,
                        Ticket.status.in_(("ISSUED", "CHECKED_IN")),
                        Ticket.deleted_at.is_(None),
                    )
                )
            ).scalars().all()
            return list(issued)
        if hold.status != "ACTIVE":
            raise AppError("INVALID_TRANSITION", "Hold cannot be converted", 409)
        hold.status = "CONVERTED"
        hold.verification_pending = False
        tickets = list(
            (
                await self.session.execute(
                    select(Ticket).where(Ticket.hold_id == hold.id, Ticket.deleted_at.is_(None))
                )
            ).scalars().all()
        )
        issued: list[Ticket] = []
        event_id: str | None = None
        if tickets:
            ticket_type = await self.get_ticket_type_row(tickets[0].ticket_type_id)
            event_id = str(ticket_type.event_id)
        for ticket in tickets:
            if ticket.status in {"ISSUED", "CHECKED_IN"}:
                issued.append(ticket)
                continue
            previous = ticket.status
            ticket.status = "PAID"
            await self._emit(
                ctx,
                event_type=TICKET_PAID,
                aggregate_type="Ticket",
                aggregate_id=ticket.id,
                organization_id=organization_id,
                payload={"ticket_id": str(ticket.id), "previous_status": previous},
            )
            token = ticket_token(ticket.id, self._token_secret())
            ticket.qr_secret_hash = token_hash(token)
            ticket.status = "ISSUED"
            await self._emit(
                ctx,
                event_type=TICKET_ISSUED,
                aggregate_type="Ticket",
                aggregate_id=ticket.id,
                organization_id=organization_id,
                payload={"ticket_id": str(ticket.id), "event_id": event_id},
            )
            issued.append(ticket)
        await self.session.flush()
        return issued

    async def refundable_order_tickets(self, order_id: UUID) -> list[Ticket]:
        """Tickets of an order that a refund may still cover (STATE_MACHINES Ticket)."""
        hold = (
            await self.session.execute(select(TicketHold).where(TicketHold.order_id == order_id))
        ).scalar_one_or_none()
        if hold is None:
            return []
        return list(
            (
                await self.session.execute(
                    select(Ticket)
                    .where(
                        Ticket.hold_id == hold.id,
                        Ticket.status.in_(REFUNDABLE_TICKET_STATUSES),
                        Ticket.deleted_at.is_(None),
                    )
                    .order_by(Ticket.created_at, Ticket.id)
                )
            ).scalars().all()
        )

    async def refund_order_tickets(
        self,
        ctx: AuthContext | None,
        *,
        order_id: UUID,
        refund_id: UUID,
        ticket_ids: list[UUID] | None = None,
    ) -> list[Ticket]:
        """Refunded tickets become REFUNDED and their QR stops working (06_FINANCIAL_ARCHITECTURE
        §5, 08_EVENT_ARCHITECTURE: "reverse revenue; void QR").

        `ticket_ids` limits it to the tickets a per-ticket refund named (Q-COM-01); without it every
        refundable ticket of the order is refunded (a full refund). Q-COM-02: a refunded seat goes
        back on sale only while its ticket type is still selling, the event is TICKETING_OPEN and
        has not started; a checked-in ticket never does. Tickets that were never issued (a late
        payment, Q-PAY-02) are left as they are. Idempotent: a repeat finds nothing left to refund.
        """
        hold = (
            await self.session.execute(select(TicketHold).where(TicketHold.order_id == order_id))
        ).scalar_one_or_none()
        if hold is None:
            return []
        stmt = (
            select(Ticket)
            .where(
                Ticket.hold_id == hold.id,
                Ticket.status.in_(REFUNDABLE_TICKET_STATUSES),
                Ticket.deleted_at.is_(None),
            )
            .with_for_update()
        )
        if ticket_ids is not None:
            stmt = stmt.where(Ticket.id.in_(ticket_ids))
        tickets = list((await self.session.execute(stmt)).scalars().all())
        if not tickets:
            return []
        ticket_type = await self.get_ticket_type_row(hold.ticket_type_id)
        event = await self.session.get(Event, ticket_type.event_id)
        organization_id = event.organization_id if event is not None else None
        resellable = [t for t in tickets if t.status != "CHECKED_IN"]
        if resellable and self._seat_returns_to_sale(event, ticket_type):
            inventory = await self._lock_inventory(ticket_type.id)
            inventory.remaining += len(resellable)
            if ticket_type.status == "SOLD_OUT" and inventory.remaining > 0:
                ticket_type.status = "ON_SALE"
        for ticket in tickets:
            previous = ticket.status
            ticket.status = "REFUNDED"
            ticket.qr_secret_hash = None
            await self._emit(
                ctx,
                event_type=TICKET_REFUNDED,
                aggregate_type="Ticket",
                aggregate_id=ticket.id,
                organization_id=organization_id,
                payload={
                    "ticket_id": str(ticket.id),
                    "event_id": str(ticket_type.event_id),
                    "refund_id": str(refund_id),
                    "previous_status": previous,
                },
            )
            audit = dict(
                action="ticket.refunded",
                entity_type="Ticket",
                entity_id=ticket.id,
                previous_state={"status": previous},
                new_state={"status": "REFUNDED", "refund_id": str(refund_id)},
                organization_id=organization_id,
            )
            if ctx is not None:
                await self.audit.record_from_auth(ctx, **audit)
            else:
                await self.audit.record(actor_id="system:ticketing", actor_type="system", **audit)
        await self._flush_versioned()
        return tickets

    def _seat_returns_to_sale(self, event: Event | None, ticket_type: TicketType) -> bool:
        """Q-COM-02 (owner, 2026-10-18): only while the seat can still be sold."""
        if event is None or event.status not in PURCHASABLE_EVENT_STATUSES:
            return False
        if event.starts_at is not None and event.starts_at <= self.clock.now():
            return False
        return ticket_type.status in {"ON_SALE", "SOLD_OUT"}

    def presentation_token(self, ticket: Ticket) -> str | None:
        if ticket.status not in {"ISSUED", "CHECKED_IN"}:
            return None
        return ticket_token(ticket.id, self._token_secret())

    async def list_my_tickets(
        self,
        ctx: AuthContext,
        *,
        cursor: str | None = None,
        limit: int = 50,
    ) -> tuple[list[Ticket], str | None]:
        limit = clamp_limit(limit)
        stmt = (
            select(Ticket)
            .where(Ticket.owner_user_id == ctx.user_id, Ticket.deleted_at.is_(None))
            .order_by(Ticket.created_at.desc(), Ticket.id.desc())
        )
        if cursor:
            stmt = stmt.where(keyset_before(Ticket.created_at, Ticket.id, cursor))
        stmt = stmt.limit(limit + 1)
        rows = list((await self.session.execute(stmt)).scalars().all())
        next_cursor = None
        if len(rows) > limit:
            last = rows[limit - 1]
            next_cursor = encode_cursor(last.created_at.isoformat(), last.id)
            rows = rows[:limit]
        return rows, next_cursor

    async def get_ticket(self, ctx: AuthContext, ticket_id: UUID) -> Ticket:
        ticket = await self.session.get(Ticket, ticket_id)
        if ticket is None or ticket.deleted_at is not None:
            raise NotFoundError("Ticket not found")
        if ticket.owner_user_id == ctx.user_id:
            return ticket
        ticket_type = await self.get_ticket_type_row(ticket.ticket_type_id)
        event = await self._event(ticket_type.event_id)
        allowed = await self._is_allowed(
            ctx.user_id,
            "ticket.checkin",
            resource_id=event.id,
            organization_id=event.organization_id,
        )
        if not allowed:
            raise NotFoundError("Ticket not found")
        return ticket

    async def check_in(self, ctx: AuthContext, token: str) -> CheckIn:
        ticket_id = verify_ticket_token(token, self._token_secret())
        if ticket_id is None:
            raise AppError("INVALID_TICKET_TOKEN", "Ticket token is not valid", 422)
        ticket = await self.session.get(Ticket, ticket_id)
        if ticket is None or ticket.deleted_at is not None:
            raise NotFoundError("Ticket not found")
        expected_hash = token_hash(token)
        if ticket.qr_secret_hash != expected_hash:
            raise AppError("INVALID_TICKET_TOKEN", "Ticket token is not valid", 422)
        ticket_type = await self.get_ticket_type_row(ticket.ticket_type_id)
        event = await self._event(ticket_type.event_id)
        await self._assert_event_perm(ctx, event, "ticket.checkin", mutate=True)
        existing = (
            await self.session.execute(select(CheckIn).where(CheckIn.ticket_id == ticket.id))
        ).scalar_one_or_none()
        if existing is not None:
            return existing
        if ticket.status != "ISSUED":
            raise AppError(
                "INVALID_TRANSITION",
                "Ticket cannot be checked in",
                409,
                f"Ticket status {ticket.status} is not ISSUED",
            )
        row = CheckIn(
            ticket_id=ticket.id,
            event_id=event.id,
            staff_user_id=ctx.user_id,
            status="RECORDED",
            scanned_at=self.clock.now(),
        )
        try:
            async with self.session.begin_nested():
                self.session.add(row)
                await self.session.flush()
        except IntegrityError as exc:
            existing = (
                await self.session.execute(select(CheckIn).where(CheckIn.ticket_id == ticket.id))
            ).scalar_one_or_none()
            if existing is not None:
                return existing
            raise ConflictError("Duplicate check-in") from exc
        ticket.status = "CHECKED_IN"
        await self._emit(
            ctx,
            event_type=TICKET_CHECKED_IN,
            aggregate_type="CheckIn",
            aggregate_id=row.id,
            organization_id=event.organization_id,
            payload={
                "ticket_id": str(ticket.id),
                "event_id": str(event.id),
                "check_in_id": str(row.id),
            },
        )
        await self.audit.record_from_auth(
            ctx,
            action="ticket.checked_in",
            entity_type="CheckIn",
            entity_id=row.id,
            new_state={"ticket_id": str(ticket.id), "event_id": str(event.id)},
            organization_id=event.organization_id,
        )
        return row

    async def list_attendance(
        self,
        ctx: AuthContext,
        event_id: UUID,
        *,
        cursor: str | None = None,
        limit: int = 50,
    ) -> tuple[list[CheckIn], str | None]:
        event = await self._event(event_id)
        await self._assert_event_perm(ctx, event, "ticket.checkin", mutate=True)
        limit = clamp_limit(limit)
        stmt = (
            select(CheckIn)
            .where(CheckIn.event_id == event_id)
            .order_by(CheckIn.scanned_at.desc(), CheckIn.id.desc())
        )
        if cursor:
            stmt = stmt.where(keyset_before(CheckIn.scanned_at, CheckIn.id, cursor))
        stmt = stmt.limit(limit + 1)
        rows = list((await self.session.execute(stmt)).scalars().all())
        next_cursor = None
        if len(rows) > limit:
            last = rows[limit - 1]
            next_cursor = encode_cursor(last.scanned_at.isoformat(), last.id)
            rows = rows[:limit]
        return rows, next_cursor
