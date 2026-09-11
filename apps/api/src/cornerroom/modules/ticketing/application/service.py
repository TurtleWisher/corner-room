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
from cornerroom.kernel.pagination import clamp_limit, decode_cursor, encode_cursor
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
        return self.settings.jwt_secret

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

    async def expire_due_holds(self, ticket_type_id: UUID | None = None) -> int:
        now = self.clock.now()
        stmt = select(TicketHold).where(
            TicketHold.status == "ACTIVE",
            TicketHold.expires_at <= now,
            TicketHold.deleted_at.is_(None),
        )
        if ticket_type_id is not None:
            stmt = stmt.where(TicketHold.ticket_type_id == ticket_type_id)
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
            data = decode_cursor(cursor)
            stmt = stmt.where(TicketType.created_at < data["t"])
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
        await self._release_hold(hold, status="RELEASED", ctx=ctx)
        return hold

    async def get_active_hold_for_user(self, hold_id: UUID, user_id: UUID) -> TicketHold:
        await self.expire_due_holds()
        hold = await self.session.get(TicketHold, hold_id)
        if hold is None or hold.deleted_at is not None or hold.user_id != user_id:
            raise NotFoundError("Hold not found")
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
            data = decode_cursor(cursor)
            stmt = stmt.where(Ticket.created_at < data["t"])
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
            data = decode_cursor(cursor)
            stmt = stmt.where(CheckIn.scanned_at < data["t"])
        stmt = stmt.limit(limit + 1)
        rows = list((await self.session.execute(stmt)).scalars().all())
        next_cursor = None
        if len(rows) > limit:
            last = rows[limit - 1]
            next_cursor = encode_cursor(last.scanned_at.isoformat(), last.id)
            rows = rows[:limit]
        return rows, next_cursor
