"""Catalog commerce, entitlements, and additive refunds. Thin controllers."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel, Field

from cornerroom.api.deps import (
    catalog_commerce_service,
    checkout_service,
    get_auth_context,
    get_optional_auth_context,
    payment_service,
)
from cornerroom.infra.errors import AppError
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.commerce.application.catalog import CatalogCommerceService
from cornerroom.modules.commerce.application.service import CheckoutService
from cornerroom.modules.commerce.domain.models import Offer, Product
from cornerroom.modules.entitlements.domain.models import Entitlement
from cornerroom.modules.finance.application.service import PaymentService
from cornerroom.modules.finance.domain.models import Refund

router = APIRouter(tags=["commerce"])


class ProductCreate(BaseModel):
    product_type: str
    subject_id: UUID
    name: str = Field(min_length=1, max_length=200)


class ProductOut(BaseModel):
    id: UUID
    organization_id: UUID
    product_type: str
    subject_id: UUID
    name: str
    status: str
    version: int


class ProductPage(BaseModel):
    items: list[ProductOut]
    next_cursor: str | None


class LifecycleIn(BaseModel):
    action: str = Field(pattern="^(activate|retire)$")
    version: int | None = Field(default=None, ge=1)


class OfferCreate(BaseModel):
    product_id: UUID
    amount_minor: int = Field(ge=0)
    currency_code: str = Field(min_length=3, max_length=3)


class OfferOut(BaseModel):
    id: UUID
    organization_id: UUID
    product_id: UUID
    product_type: str | None = None
    name: str | None = None
    # What the offer sells (track id for TRACK products), so a track page can show its own price.
    subject_id: UUID | None = None
    amount_minor: int
    currency_code: str
    status: str
    version: int | None = None
    # EVERYONE, or OWNS_PART_OF_RELEASE for the price fans who own some songs pay (D-AUDIO-11).
    audience: str = "EVERYONE"


class OfferPage(BaseModel):
    items: list[OfferOut]
    next_cursor: str | None


class EntitlementOut(BaseModel):
    id: UUID
    entitlement_type: str
    ref_id: UUID
    scope: str
    status: str
    expires_at: datetime | None


class EntitlementPage(BaseModel):
    items: list[EntitlementOut]
    next_cursor: str | None


class GrantIn(BaseModel):
    user_id: UUID
    entitlement_type: str
    ref_id: UUID
    scope: str = "TRACK"
    expires_at: datetime | None = None


class RefundCreate(BaseModel):
    payment_id: UUID | None = None
    amount_minor: int | None = Field(default=None, ge=0)
    reason_code: str = Field(min_length=1, max_length=64)
    # Q-COM-01: refund exactly these tickets of `order_id`; the server works out the amount.
    order_id: UUID | None = None
    ticket_ids: list[UUID] | None = Field(default=None, max_length=100)
    # Refund everything still refundable on `order_id`; the server works out the amount.
    refund_remaining: bool = False


class RefundOut(BaseModel):
    id: UUID
    payment_id: UUID
    status: str
    amount_minor: int
    currency_code: str
    reason_code: str
    ticket_ids: list[UUID] | None = None


class RefundReasonOut(BaseModel):
    reason_code: str
    label: str
    requires_finance_approve: bool


class StaffTicketOut(BaseModel):
    id: UUID
    status: str
    ticket_type_name: str | None
    unit_amount_minor: int
    currency_code: str
    refundable: bool
    refund_pending: bool


class StaffRefundOut(RefundOut):
    order_id: UUID
    created_at: datetime
    payment_provider: str | None = None


class StaffOrderOut(BaseModel):
    id: UUID
    status: str
    purpose: str
    total_amount_minor: int
    currency_code: str
    created_at: datetime | None
    buyer_email: str | None
    payment_id: UUID | None
    payment_status: str | None
    payment_provider: str | None
    refunded_amount_minor: int
    items: list[dict]
    tickets: list[StaffTicketOut]
    refunds: list[StaffRefundOut]


def _product_out(row: Product) -> ProductOut:
    return ProductOut(
        id=row.id,
        organization_id=row.organization_id,
        product_type=row.product_type,
        subject_id=row.subject_id,
        name=row.name,
        status=row.status,
        version=row.version,
    )


def _offer_out(row: Offer, product: Product | None = None, *, staff: bool) -> OfferOut:
    return OfferOut(
        id=row.id,
        organization_id=row.organization_id,
        product_id=row.product_id,
        product_type=product.product_type if product else None,
        name=product.name if product else None,
        subject_id=product.subject_id if product else None,
        amount_minor=row.amount_minor,
        currency_code=row.currency_code,
        status=row.status,
        version=row.version if staff else None,
        audience=getattr(row, "audience", None) or "EVERYONE",
    )


def _entitlement_out(row: Entitlement) -> EntitlementOut:
    return EntitlementOut(
        id=row.id,
        entitlement_type=row.entitlement_type,
        ref_id=row.ref_id,
        scope=row.scope,
        status=row.status,
        expires_at=row.expires_at,
    )


def _refund_out(row: Refund) -> RefundOut:
    return RefundOut(
        id=row.id,
        payment_id=row.payment_id,
        status=row.status,
        amount_minor=row.amount_minor,
        currency_code=row.currency_code,
        reason_code=row.reason_code,
        ticket_ids=row.ticket_ids,
    )


@router.get("/offers", response_model=OfferPage)
async def list_public_offers(
    svc: Annotated[CatalogCommerceService, Depends(catalog_commerce_service)],
    _ctx: Annotated[object, Depends(get_optional_auth_context)] = None,
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
) -> OfferPage:
    rows, next_cursor = await svc.list_public_offers(cursor=cursor, limit=limit)
    return OfferPage(
        items=[_offer_out(offer, product, staff=False) for offer, product in rows],
        next_cursor=next_cursor,
    )


@router.post("/products", response_model=ProductOut, status_code=201)
async def create_product(
    body: ProductCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[CatalogCommerceService, Depends(catalog_commerce_service)],
) -> ProductOut:
    row = await svc.create_product(
        ctx,
        product_type=body.product_type,
        subject_id=body.subject_id,
        name=body.name,
    )
    return _product_out(row)


@router.get("/products", response_model=ProductPage)
async def list_products(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[CatalogCommerceService, Depends(catalog_commerce_service)],
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
) -> ProductPage:
    rows, next_cursor = await svc.list_org_products(ctx, cursor=cursor, limit=limit)
    return ProductPage(items=[_product_out(row) for row in rows], next_cursor=next_cursor)


@router.post("/products/{product_id}/lifecycle", response_model=ProductOut)
async def product_lifecycle(
    product_id: UUID,
    body: LifecycleIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[CatalogCommerceService, Depends(catalog_commerce_service)],
) -> ProductOut:
    row = await svc.transition_product(
        ctx, product_id, action=body.action, expected_version=body.version
    )
    return _product_out(row)


@router.post("/offers", response_model=OfferOut, status_code=201)
async def create_offer(
    body: OfferCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[CatalogCommerceService, Depends(catalog_commerce_service)],
) -> OfferOut:
    row = await svc.create_offer(
        ctx,
        product_id=body.product_id,
        amount_minor=body.amount_minor,
        currency_code=body.currency_code,
    )
    return _offer_out(row, staff=True)


@router.get("/staff/offers", response_model=OfferPage)
async def list_staff_offers(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[CatalogCommerceService, Depends(catalog_commerce_service)],
    product_id: UUID | None = None,
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
) -> OfferPage:
    rows, next_cursor = await svc.list_org_offers(
        ctx, product_id=product_id, cursor=cursor, limit=limit
    )
    return OfferPage(items=[_offer_out(row, staff=True) for row in rows], next_cursor=next_cursor)


@router.post("/offers/{offer_id}/lifecycle", response_model=OfferOut)
async def offer_lifecycle(
    offer_id: UUID,
    body: LifecycleIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[CatalogCommerceService, Depends(catalog_commerce_service)],
) -> OfferOut:
    row = await svc.transition_offer(ctx, offer_id, action=body.action, expected_version=body.version)
    return _offer_out(row, staff=True)


@router.get("/me/entitlements", response_model=EntitlementPage)
async def my_entitlements(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[CheckoutService, Depends(checkout_service)],
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
) -> EntitlementPage:
    rows, next_cursor = await svc.entitlements.list_for_user(ctx.user_id, cursor=cursor, limit=limit)
    return EntitlementPage(items=[_entitlement_out(row) for row in rows], next_cursor=next_cursor)


@router.get("/entitlements/{entitlement_id}", response_model=EntitlementOut)
async def get_entitlement(
    entitlement_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[CheckoutService, Depends(checkout_service)],
) -> EntitlementOut:
    row = await svc.entitlements.get_own(ctx.user_id, entitlement_id)
    return _entitlement_out(row)


@router.post("/entitlements/grants", response_model=EntitlementOut, status_code=201)
async def grant_entitlement(
    body: GrantIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[CheckoutService, Depends(checkout_service)],
) -> EntitlementOut:
    row = await svc.grant_staff_entitlement(
        ctx,
        user_id=body.user_id,
        entitlement_type=body.entitlement_type,
        ref_id=body.ref_id,
        scope=body.scope,
        expires_at=body.expires_at,
    )
    return _entitlement_out(row)


@router.post("/refunds", response_model=RefundOut, status_code=201)
async def request_refund(
    body: RefundCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[PaymentService, Depends(payment_service)],
    checkout: Annotated[CheckoutService, Depends(checkout_service)],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> RefundOut:
    if not idempotency_key:
        raise AppError("VALIDATION_ERROR", "Idempotency-Key is required", 422)
    key = f"{ctx.user_id}:{idempotency_key}"
    if body.refund_remaining:
        if body.order_id is None or body.amount_minor is not None or body.ticket_ids is not None:
            raise AppError("VALIDATION_ERROR", "refund_remaining needs order_id only", 422)
        row = await checkout.request_remaining_refund(
            ctx, order_id=body.order_id, reason_code=body.reason_code, idempotency_key=key
        )
        return _refund_out(row)
    if body.ticket_ids is not None:
        if body.order_id is None:
            raise AppError("VALIDATION_ERROR", "order_id is required with ticket_ids", 422)
        if body.amount_minor is not None:
            raise AppError("VALIDATION_ERROR", "The amount of a per-ticket refund is worked out by the server", 422)
        row = await checkout.request_ticket_refund(
            ctx, order_id=body.order_id, ticket_ids=body.ticket_ids, reason_code=body.reason_code, idempotency_key=key
        )
        return _refund_out(row)
    if body.payment_id is None or body.amount_minor is None:
        raise AppError("VALIDATION_ERROR", "payment_id and amount_minor are required", 422)
    row = await svc.request_refund(
        ctx,
        payment_id=body.payment_id,
        amount_minor=body.amount_minor,
        reason_code=body.reason_code,
        idempotency_key=key,
    )
    return _refund_out(row)


class ManualRefundIn(BaseModel):
    payout_reference: str = Field(max_length=120)


@router.post("/refunds/{refund_id}/complete-manual", response_model=RefundOut)
async def complete_manual_refund(
    refund_id: UUID,
    body: ManualRefundIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    payments: Annotated[PaymentService, Depends(payment_service)],
    checkout: Annotated[CheckoutService, Depends(checkout_service)],
) -> RefundOut:
    """Bangla QR: finance paid the money back by hand and records the transfer reference."""
    row = await payments.complete_manual_refund(ctx, refund_id, payout_reference=body.payout_reference)
    await checkout.apply_completed_refund(ctx, row)
    return _refund_out(row)


@router.get("/refund-reasons", response_model=list[RefundReasonOut])
async def refund_reasons(
    _ctx: Annotated[AuthContext, Depends(get_auth_context)],
    checkout: Annotated[CheckoutService, Depends(checkout_service)],
) -> list[RefundReasonOut]:
    """The platform refund reasons (D-REF-01), as data from the policy table."""
    from sqlalchemy import select

    from cornerroom.modules.ticketing.domain.models import RefundPolicy

    rows = (
        await checkout.session.execute(
            select(RefundPolicy)
            .where(RefundPolicy.scope_type == "PLATFORM", RefundPolicy.scope_id.is_(None))
            .order_by(RefundPolicy.created_at)
        )
    ).scalars()
    return [
        RefundReasonOut(reason_code=r.reason_code, label=r.notes or r.reason_code, requires_finance_approve=r.requires_finance_approve)
        for r in rows
    ]


@router.get("/staff/orders/lookup", response_model=StaffOrderOut)
async def staff_order_lookup(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    checkout: Annotated[CheckoutService, Depends(checkout_service)],
    reference: str = Query(min_length=8, max_length=16),
) -> StaffOrderOut:
    view = await checkout.staff_order_view(ctx, reference)
    order, payment, details = view["order"], view["payment"], view["details"]
    return StaffOrderOut(
        id=order.id,
        status=order.status,
        purpose=order.purpose,
        total_amount_minor=order.total_amount_minor,
        currency_code=order.currency_code,
        created_at=details["created_at"],
        buyer_email=view["buyer_email"],
        payment_id=payment.id if payment else None,
        payment_status=payment.status if payment else None,
        payment_provider=payment.provider if payment else None,
        refunded_amount_minor=details["refunded_amount_minor"],
        items=[{k: (str(v) if isinstance(v, UUID) else v) for k, v in item.items()} for item in details["items"]],
        tickets=[StaffTicketOut(**t) for t in view["tickets"]],
        refunds=[StaffRefundOut(**r) for r in view["refunds"]],
    )


class StaffSubmissionOut(BaseModel):
    id: UUID
    order_id: UUID
    purpose: str
    amount_minor: int
    currency_code: str
    transaction_ref: str
    paid_from: str
    paid_with: str
    status: str
    decision_note: str | None
    buyer_email: str | None
    submitted_at: datetime


class SubmissionRejectIn(BaseModel):
    reason: str = Field(max_length=400)


@router.get("/staff/payment-submissions", response_model=list[StaffSubmissionOut])
async def staff_payment_submissions(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    checkout: Annotated[CheckoutService, Depends(checkout_service)],
    status: str = Query(default="SUBMITTED", pattern="^(SUBMITTED|CONFIRMED|REJECTED)$"),
) -> list[StaffSubmissionOut]:
    """Bangla QR payments waiting for finance to check them against the statement (Q-PAY-01)."""
    return [StaffSubmissionOut(**row) for row in await checkout.staff_submissions(ctx, status=status)]


@router.post("/staff/payment-submissions/{submission_id}/confirm", response_model=StaffSubmissionOut)
async def confirm_payment_submission(
    submission_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    checkout: Annotated[CheckoutService, Depends(checkout_service)],
) -> StaffSubmissionOut:
    await checkout.confirm_submission(ctx, submission_id)
    return StaffSubmissionOut(**(await checkout.staff_submissions(ctx, status=None, submission_id=submission_id))[0])


@router.post("/staff/payment-submissions/{submission_id}/reject", response_model=StaffSubmissionOut)
async def reject_payment_submission(
    submission_id: UUID,
    body: SubmissionRejectIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    checkout: Annotated[CheckoutService, Depends(checkout_service)],
) -> StaffSubmissionOut:
    await checkout.reject_submission(ctx, submission_id, reason=body.reason)
    return StaffSubmissionOut(**(await checkout.staff_submissions(ctx, status=None, submission_id=submission_id))[0])


@router.get("/staff/refunds", response_model=list[StaffRefundOut])
async def staff_open_refunds(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    checkout: Annotated[CheckoutService, Depends(checkout_service)],
) -> list[StaffRefundOut]:
    if ctx.organization_id is None:
        raise AppError("WORKSPACE_REQUIRED", "An active organization is required", 409)
    return [StaffRefundOut(**r) for r in await checkout.staff_open_refunds(ctx)]


@router.post("/refunds/{refund_id}/approve", response_model=RefundOut)
async def approve_refund(
    refund_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[PaymentService, Depends(payment_service)],
) -> RefundOut:
    row = await svc.approve_refund(ctx, refund_id)
    return _refund_out(row)


@router.post("/refunds/{refund_id}/sandbox-complete", response_model=RefundOut)
async def sandbox_complete_refund(
    refund_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    payments: Annotated[PaymentService, Depends(payment_service)],
    checkout: Annotated[CheckoutService, Depends(checkout_service)],
) -> RefundOut:
    row = await payments.complete_sandbox_refund(ctx, refund_id)
    await checkout.apply_completed_refund(ctx, row)
    return _refund_out(row)


# --- Price proposals from the artist Studio (D-AUDIO-11, D-AUDIO-15) -----------------------------


class ProposalQueueOut(BaseModel):
    id: UUID
    release_id: UUID
    release_title: str
    release_status: str
    subject_type: str
    subject_id: UUID
    subject_title: str
    audience: str
    amount_minor: int
    currency_code: str
    note: str | None
    status: str
    decision_note: str | None
    created_at: datetime


class ProposalDecisionIn(BaseModel):
    decision: str = Field(pattern="^(accept|counter)$")
    note: str | None = Field(default=None, max_length=500)


@router.get("/offer-proposals", response_model=list[ProposalQueueOut])
async def list_offer_proposals(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[CatalogCommerceService, Depends(catalog_commerce_service)],
    status: str | None = Query(default="PROPOSED", pattern="^(PROPOSED|ACCEPTED|COUNTERED|WITHDRAWN)$"),
) -> list[ProposalQueueOut]:
    return [ProposalQueueOut(**row) for row in await svc.list_proposals(ctx, status=status)]


@router.post("/offer-proposals/{proposal_id}/decision", response_model=ProposalQueueOut)
async def decide_offer_proposal(
    proposal_id: UUID,
    body: ProposalDecisionIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[CatalogCommerceService, Depends(catalog_commerce_service)],
) -> ProposalQueueOut:
    proposal = await svc.decide_proposal(ctx, proposal_id, decision=body.decision, note=body.note)
    rows = await svc.list_proposals(ctx, status=None, proposal_id=proposal.id)
    return ProposalQueueOut(**rows[0])
