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
    amount_minor: int
    currency_code: str
    status: str
    version: int | None = None


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
    payment_id: UUID
    amount_minor: int = Field(ge=0)
    reason_code: str = Field(min_length=1, max_length=64)


class RefundOut(BaseModel):
    id: UUID
    payment_id: UUID
    status: str
    amount_minor: int
    currency_code: str
    reason_code: str


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
        amount_minor=row.amount_minor,
        currency_code=row.currency_code,
        status=row.status,
        version=row.version if staff else None,
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
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> RefundOut:
    if not idempotency_key:
        raise AppError("VALIDATION_ERROR", "Idempotency-Key is required", 422)
    row = await svc.request_refund(
        ctx,
        payment_id=body.payment_id,
        amount_minor=body.amount_minor,
        reason_code=body.reason_code,
        idempotency_key=f"{ctx.user_id}:{idempotency_key}",
    )
    return _refund_out(row)


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
