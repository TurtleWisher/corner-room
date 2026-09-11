"""Ticketing routes. Thin — rules live in TicketingService / CheckoutService."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from cornerroom.api.deps import (
    checkout_service,
    db_session,
    get_auth_context,
    get_optional_auth_context,
    settings_dep,
    ticketing_service,
)
from cornerroom.infra.errors import AppError
from cornerroom.infra.idempotency import (
    IdempotencyReplay,
    begin_idempotent,
    complete_idempotent,
    compose_idempotency_key,
    fail_idempotent,
    fingerprint_payload,
)
from cornerroom.infra.settings import Settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.commerce.application.service import CheckoutService
from cornerroom.modules.commerce.domain.models import Order
from cornerroom.modules.finance.domain.models import Payment
from cornerroom.modules.ticketing.application.service import TicketingService
from cornerroom.modules.ticketing.domain.models import Ticket, TicketHold, TicketType
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(tags=["ticketing"])


class TicketTypeOut(BaseModel):
    id: UUID
    event_id: UUID
    name: str
    status: str
    price_amount_minor: int
    currency_code: str
    quantity_total: int
    remaining: int
    sales_starts_at: datetime | None
    sales_ends_at: datetime | None
    version: int | None = None


class TicketTypePage(BaseModel):
    items: list[TicketTypeOut]
    next_cursor: str | None


class TicketTypeCreate(BaseModel):
    event_id: UUID
    name: str = Field(min_length=1, max_length=120)
    price_amount_minor: int = Field(ge=0)
    currency_code: str = Field(min_length=3, max_length=3)
    quantity_total: int = Field(ge=0)
    sales_starts_at: datetime | None = None
    sales_ends_at: datetime | None = None


class TicketTypePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    price_amount_minor: int | None = Field(default=None, ge=0)
    currency_code: str | None = Field(default=None, min_length=3, max_length=3)
    sales_starts_at: datetime | None = None
    sales_ends_at: datetime | None = None
    version: int | None = Field(default=None, ge=1)


class TicketTypeLifecycleIn(BaseModel):
    action: str = Field(pattern="^(on_sale|close|archive)$")
    version: int | None = Field(default=None, ge=1)


class HoldCreate(BaseModel):
    ticket_type_id: UUID
    quantity: int = Field(ge=1)


class HoldOut(BaseModel):
    id: UUID
    ticket_type_id: UUID
    quantity: int
    status: str
    expires_at: datetime


class OrderCreate(BaseModel):
    hold_id: UUID | None = None
    offer_id: UUID | None = None


class PaymentOut(BaseModel):
    id: UUID
    order_id: UUID | None
    status: str
    amount_minor: int
    currency_code: str
    provider: str


class OrderOut(BaseModel):
    id: UUID
    status: str
    purpose: str
    total_amount_minor: int
    currency_code: str
    payment: PaymentOut | None = None


class OrderPage(BaseModel):
    items: list[OrderOut]
    next_cursor: str | None


class TicketOut(BaseModel):
    id: UUID
    ticket_type_id: UUID
    status: str
    presentation_token: str | None = None


class TicketPage(BaseModel):
    items: list[TicketOut]
    next_cursor: str | None


class CheckInIn(BaseModel):
    token: str = Field(min_length=8, max_length=200)


class CheckInOut(BaseModel):
    id: UUID
    ticket_id: UUID
    event_id: UUID
    status: str
    scanned_at: datetime


class AttendancePage(BaseModel):
    items: list[CheckInOut]
    next_cursor: str | None


class PaymentCallbackIn(BaseModel):
    payment_id: UUID
    amount_minor: int
    currency_code: str
    provider_event_id: str
    status: str = "CAPTURED"


def _type_out(row: TicketType, remaining: int, *, staff: bool) -> TicketTypeOut:
    return TicketTypeOut(
        id=row.id,
        event_id=row.event_id,
        name=row.name,
        status=row.status,
        price_amount_minor=row.price_amount_minor,
        currency_code=row.currency_code,
        quantity_total=row.quantity_total,
        remaining=remaining,
        sales_starts_at=row.sales_starts_at,
        sales_ends_at=row.sales_ends_at,
        version=row.version if staff else None,
    )


def _hold_out(row: TicketHold) -> HoldOut:
    return HoldOut(
        id=row.id,
        ticket_type_id=row.ticket_type_id,
        quantity=row.quantity,
        status=row.status,
        expires_at=row.expires_at,
    )


def _payment_out(row: Payment) -> PaymentOut:
    return PaymentOut(
        id=row.id,
        order_id=row.order_id,
        status=row.status,
        amount_minor=row.amount_minor,
        currency_code=row.currency_code,
        provider=row.provider,
    )


def _order_out(row: Order, payment: Payment | None) -> OrderOut:
    return OrderOut(
        id=row.id,
        status=row.status,
        purpose=row.purpose,
        total_amount_minor=row.total_amount_minor,
        currency_code=row.currency_code,
        payment=_payment_out(payment) if payment else None,
    )


def _ticket_out(row: Ticket, token: str | None) -> TicketOut:
    return TicketOut(
        id=row.id,
        ticket_type_id=row.ticket_type_id,
        status=row.status,
        presentation_token=token,
    )


@router.post("/ticket-types", response_model=TicketTypeOut, status_code=201)
async def create_ticket_type(
    body: TicketTypeCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[TicketingService, Depends(ticketing_service)],
) -> TicketTypeOut:
    row = await svc.create_ticket_type(
        ctx,
        event_id=body.event_id,
        name=body.name,
        price_amount_minor=body.price_amount_minor,
        currency_code=body.currency_code,
        quantity_total=body.quantity_total,
        sales_starts_at=body.sales_starts_at,
        sales_ends_at=body.sales_ends_at,
    )
    remaining = await svc.remaining_for(row.id)
    return _type_out(row, remaining, staff=True)


@router.get("/ticket-types/{ticket_type_id}", response_model=TicketTypeOut)
async def get_ticket_type(
    ticket_type_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[TicketingService, Depends(ticketing_service)],
) -> TicketTypeOut:
    row = await svc.get_ticket_type(ctx, ticket_type_id)
    remaining = await svc.remaining_for(row.id)
    return _type_out(row, remaining, staff=True)


@router.patch("/ticket-types/{ticket_type_id}", response_model=TicketTypeOut)
async def patch_ticket_type(
    ticket_type_id: UUID,
    body: TicketTypePatch,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[TicketingService, Depends(ticketing_service)],
) -> TicketTypeOut:
    row = await svc.update_ticket_type(
        ctx,
        ticket_type_id,
        name=body.name,
        price_amount_minor=body.price_amount_minor,
        currency_code=body.currency_code,
        sales_starts_at=body.sales_starts_at,
        sales_ends_at=body.sales_ends_at,
        expected_version=body.version,
        sales_starts_set="sales_starts_at" in body.model_fields_set,
        sales_ends_set="sales_ends_at" in body.model_fields_set,
    )
    remaining = await svc.remaining_for(row.id)
    return _type_out(row, remaining, staff=True)


@router.post("/ticket-types/{ticket_type_id}/lifecycle", response_model=TicketTypeOut)
async def ticket_type_lifecycle(
    ticket_type_id: UUID,
    body: TicketTypeLifecycleIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[TicketingService, Depends(ticketing_service)],
) -> TicketTypeOut:
    row = await svc.transition_ticket_type(
        ctx,
        ticket_type_id,
        action=body.action,
        expected_version=body.version,
    )
    remaining = await svc.remaining_for(row.id)
    return _type_out(row, remaining, staff=True)


@router.get("/events/{event_id}/ticket-types", response_model=TicketTypePage)
async def list_event_ticket_types(
    event_id: UUID,
    svc: Annotated[TicketingService, Depends(ticketing_service)],
    ctx: Annotated[AuthContext | None, Depends(get_optional_auth_context)],
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
) -> TicketTypePage:
    rows, next_cursor, public_only = await svc.list_ticket_types(
        ctx, event_id, cursor=cursor, limit=limit
    )
    items = []
    for row in rows:
        remaining = await svc.remaining_for(row.id)
        items.append(_type_out(row, remaining, staff=not public_only))
    return TicketTypePage(items=items, next_cursor=next_cursor)


@router.get("/events/{event_id}/attendance", response_model=AttendancePage)
async def list_attendance(
    event_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[TicketingService, Depends(ticketing_service)],
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
) -> AttendancePage:
    rows, next_cursor = await svc.list_attendance(ctx, event_id, cursor=cursor, limit=limit)
    return AttendancePage(
        items=[
            CheckInOut(
                id=row.id,
                ticket_id=row.ticket_id,
                event_id=row.event_id,
                status=row.status,
                scanned_at=row.scanned_at,
            )
            for row in rows
        ],
        next_cursor=next_cursor,
    )


@router.post("/ticket-holds", response_model=HoldOut, status_code=201)
async def create_hold(
    body: HoldCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[TicketingService, Depends(ticketing_service)],
) -> HoldOut:
    row = await svc.create_hold(ctx, ticket_type_id=body.ticket_type_id, quantity=body.quantity)
    return _hold_out(row)


@router.post("/ticket-holds/{hold_id}/release", response_model=HoldOut)
async def release_hold(
    hold_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[TicketingService, Depends(ticketing_service)],
) -> HoldOut:
    row = await svc.release_hold(ctx, hold_id)
    return _hold_out(row)


@router.post("/orders", response_model=OrderOut, status_code=201)
async def create_order(
    body: OrderCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[CheckoutService, Depends(checkout_service)],
    session: Annotated[AsyncSession, Depends(db_session)],
    settings: Annotated[Settings, Depends(settings_dep)],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> OrderOut | JSONResponse:
    if not idempotency_key:
        raise AppError("VALIDATION_ERROR", "Idempotency-Key is required", 422)
    if body.hold_id is not None and body.offer_id is not None:
        raise AppError(
            "MIXED_ORDER",
            "An order may use hold_id or offer_id, not both",
            422,
            "Mixed ticket+track checkout is fail closed (Q-P9-07)",
        )
    if body.hold_id is None and body.offer_id is None:
        raise AppError("VALIDATION_ERROR", "hold_id or offer_id is required", 422)
    key = compose_idempotency_key("order", f"{ctx.user_id}:{idempotency_key}")
    fingerprint = {
        "hold_id": str(body.hold_id) if body.hold_id else None,
        "offer_id": str(body.offer_id) if body.offer_id else None,
    }
    started = await begin_idempotent(
        session,
        key=key,
        request_hash=fingerprint_payload(fingerprint),
        ttl_seconds=settings.idempotency_ttl_seconds,
    )
    if isinstance(started, IdempotencyReplay):
        payload = json.loads(started.body) if started.body else {}
        return JSONResponse(status_code=started.status_code, content=payload)
    try:
        if body.hold_id is not None:
            order, payment = await svc.checkout_from_hold(
                ctx, hold_id=body.hold_id, idempotency_key=f"{ctx.user_id}:{idempotency_key}"
            )
        else:
            order, payment = await svc.checkout_from_offer(
                ctx, offer_id=body.offer_id, idempotency_key=f"{ctx.user_id}:{idempotency_key}"
            )
        out = _order_out(order, payment).model_dump(mode="json")
        await complete_idempotent(session, started, status_code=201, body=json.dumps(out, default=str))
        return OrderOut.model_validate(out)
    except Exception:
        await fail_idempotent(session, started)
        raise


@router.get("/me/orders", response_model=OrderPage)
async def my_orders(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[CheckoutService, Depends(checkout_service)],
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
) -> OrderPage:
    rows, next_cursor = await svc.list_my_orders(ctx, cursor=cursor, limit=limit)
    items = []
    for row in rows:
        payment = await svc.payment_for_order(row.id)
        items.append(_order_out(row, payment))
    return OrderPage(items=items, next_cursor=next_cursor)


@router.get("/orders/{order_id}", response_model=OrderOut)
async def get_order(
    order_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[CheckoutService, Depends(checkout_service)],
) -> OrderOut:
    row = await svc.get_order(ctx, order_id)
    payment = await svc.payment_for_order(row.id)
    return _order_out(row, payment)


@router.post("/payments/callbacks", response_model=OrderOut)
async def payment_callback(
    body: PaymentCallbackIn,
    svc: Annotated[CheckoutService, Depends(checkout_service)],
    signature: Annotated[str | None, Header(alias="X-CornerRoom-Payment-Signature")] = None,
) -> OrderOut:
    payload: dict[str, Any] = body.model_dump(mode="json")
    order, payment = await svc.apply_provider_callback(payload, signature)
    if order is None:
        raise AppError("PAYMENT_NOT_CAPTURED", "Payment was not captured", 409)
    return _order_out(order, payment)


@router.post("/payments/{payment_id}/sandbox-confirm", response_model=OrderOut)
async def sandbox_confirm(
    payment_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[CheckoutService, Depends(checkout_service)],
) -> OrderOut:
    order, payment = await svc.sandbox_confirm(ctx, payment_id)
    return _order_out(order, payment)


@router.get("/me/tickets", response_model=TicketPage)
async def my_tickets(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[TicketingService, Depends(ticketing_service)],
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
) -> TicketPage:
    rows, next_cursor = await svc.list_my_tickets(ctx, cursor=cursor, limit=limit)
    return TicketPage(
        items=[_ticket_out(row, svc.presentation_token(row)) for row in rows],
        next_cursor=next_cursor,
    )


@router.get("/tickets/{ticket_id}", response_model=TicketOut)
async def get_ticket(
    ticket_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[TicketingService, Depends(ticketing_service)],
) -> TicketOut:
    row = await svc.get_ticket(ctx, ticket_id)
    token = svc.presentation_token(row) if row.owner_user_id == ctx.user_id else None
    return _ticket_out(row, token)


@router.post("/check-in", response_model=CheckInOut)
async def check_in(
    body: CheckInIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[TicketingService, Depends(ticketing_service)],
) -> CheckInOut:
    row = await svc.check_in(ctx, body.token)
    return CheckInOut(
        id=row.id,
        ticket_id=row.ticket_id,
        event_id=row.event_id,
        status=row.status,
        scanned_at=row.scanned_at,
    )
