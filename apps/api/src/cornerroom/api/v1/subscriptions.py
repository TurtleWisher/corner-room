"""Subscription plans and customer subscriptions. Thin controllers."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.api.deps import (
    checkout_service,
    db_session,
    get_auth_context,
    get_optional_auth_context,
    settings_dep,
    subscription_service,
)
from cornerroom.api.v1.ticketing import OrderOut, _order_out
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
from cornerroom.modules.subscriptions.application.service import SubscriptionService
from cornerroom.modules.subscriptions.domain.models import (
    Subscription,
    SubscriptionPlan,
    SubscriptionPlanVersion,
)

router = APIRouter(tags=["subscriptions"])


class PlanCreate(BaseModel):
    key: str = Field(min_length=1, max_length=64)
    price_amount_minor: int = Field(ge=0)
    currency_code: str = Field(min_length=3, max_length=3)
    interval: str
    interval_count: int = Field(default=1, ge=1)
    trial_days: int | None = Field(default=None, ge=0)


class PlanVersionCreate(BaseModel):
    price_amount_minor: int = Field(ge=0)
    currency_code: str = Field(min_length=3, max_length=3)
    interval: str
    interval_count: int = Field(default=1, ge=1)
    trial_days: int | None = Field(default=None, ge=0)


class PlanLifecycleIn(BaseModel):
    action: str = Field(pattern="^(activate|retire)$")


class PlanOut(BaseModel):
    id: UUID
    key: str
    status: str
    price_amount_minor: int
    currency_code: str
    interval: str
    interval_count: int
    trial_days: int | None = None
    version_number: int | None = None


class PlanPage(BaseModel):
    items: list[PlanOut]


class SubscribeIn(BaseModel):
    plan_id: UUID


class SubscriptionOut(BaseModel):
    id: UUID
    plan_id: UUID
    plan_version_id: UUID
    status: str
    cancel_at_period_end: bool
    period_ends_at: datetime | None = None


class SubscriptionPage(BaseModel):
    items: list[SubscriptionOut]


def _plan_out(plan: SubscriptionPlan, version: SubscriptionPlanVersion | None) -> PlanOut:
    return PlanOut(
        id=plan.id,
        key=plan.key,
        status=plan.status,
        price_amount_minor=version.price_amount_minor if version else plan.price_amount_minor,
        currency_code=version.currency_code if version else plan.currency_code,
        interval=version.interval if version else plan.interval,
        interval_count=version.interval_count if version else plan.interval_count,
        trial_days=version.trial_days if version else None,
        version_number=version.version_number if version else None,
    )


async def _subscription_out(svc: SubscriptionService, row: Subscription) -> SubscriptionOut:
    period = await svc.current_period(row)
    return SubscriptionOut(
        id=row.id,
        plan_id=row.plan_id,
        plan_version_id=row.plan_version_id,
        status=row.status,
        cancel_at_period_end=row.cancel_at_period_end,
        period_ends_at=period.ends_at if period else None,
    )


@router.get("/subscription-plans", response_model=PlanPage)
async def list_public_plans(
    svc: Annotated[SubscriptionService, Depends(subscription_service)],
    _ctx: Annotated[object, Depends(get_optional_auth_context)] = None,
) -> PlanPage:
    rows = await svc.list_active_plans()
    return PlanPage(items=[_plan_out(plan, version) for plan, version in rows])


@router.post("/subscription-plans", response_model=PlanOut, status_code=201)
async def create_plan(
    body: PlanCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[SubscriptionService, Depends(subscription_service)],
) -> PlanOut:
    plan = await svc.create_plan(
        ctx,
        key=body.key,
        price_amount_minor=body.price_amount_minor,
        currency_code=body.currency_code,
        interval=body.interval,
        interval_count=body.interval_count,
        trial_days=body.trial_days,
    )
    version = None
    if plan.current_version_id is not None:
        version = await svc.session.get(SubscriptionPlanVersion, plan.current_version_id)
    return _plan_out(plan, version)


@router.get("/staff/subscription-plans", response_model=PlanPage)
async def list_staff_plans(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[SubscriptionService, Depends(subscription_service)],
) -> PlanPage:
    rows = await svc.list_org_plans(ctx)
    return PlanPage(items=[_plan_out(plan, version) for plan, version in rows])


@router.post("/subscription-plans/{plan_id}/versions", response_model=PlanOut, status_code=201)
async def add_plan_version(
    plan_id: UUID,
    body: PlanVersionCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[SubscriptionService, Depends(subscription_service)],
) -> PlanOut:
    version = await svc.add_plan_version(
        ctx,
        plan_id,
        price_amount_minor=body.price_amount_minor,
        currency_code=body.currency_code,
        interval=body.interval,
        interval_count=body.interval_count,
        trial_days=body.trial_days,
    )
    plan = await svc.session.get(SubscriptionPlan, plan_id)
    assert plan is not None
    return _plan_out(plan, version)


@router.post("/subscription-plans/{plan_id}/lifecycle", response_model=PlanOut)
async def plan_lifecycle(
    plan_id: UUID,
    body: PlanLifecycleIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[SubscriptionService, Depends(subscription_service)],
) -> PlanOut:
    plan = await svc.transition_plan(ctx, plan_id, action=body.action)
    version = None
    if plan.current_version_id is not None:
        version = await svc.session.get(SubscriptionPlanVersion, plan.current_version_id)
    return _plan_out(plan, version)


@router.post("/subscriptions", response_model=OrderOut, status_code=201)
async def start_subscription(
    body: SubscribeIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[CheckoutService, Depends(checkout_service)],
    session: Annotated[AsyncSession, Depends(db_session)],
    settings: Annotated[Settings, Depends(settings_dep)],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> OrderOut | JSONResponse:
    if not idempotency_key:
        raise AppError("VALIDATION_ERROR", "Idempotency-Key is required", 422)
    key = compose_idempotency_key("subscription", f"{ctx.user_id}:{idempotency_key}")
    started = await begin_idempotent(
        session,
        key=key,
        request_hash=fingerprint_payload({"plan_id": str(body.plan_id)}),
        ttl_seconds=settings.idempotency_ttl_seconds,
    )
    if isinstance(started, IdempotencyReplay):
        payload = json.loads(started.body) if started.body else {}
        return JSONResponse(status_code=started.status_code, content=payload)
    try:
        order, payment = await svc.checkout_from_plan(
            ctx, plan_id=body.plan_id, idempotency_key=f"{ctx.user_id}:{idempotency_key}"
        )
        out = _order_out(order, payment).model_dump(mode="json")
        await complete_idempotent(session, started, status_code=201, body=json.dumps(out, default=str))
        return OrderOut.model_validate(out)
    except Exception:
        await fail_idempotent(session, started)
        raise


@router.get("/me/subscription", response_model=SubscriptionOut)
async def my_subscription(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[SubscriptionService, Depends(subscription_service)],
) -> SubscriptionOut:
    row = await svc.get_mine(ctx)
    return await _subscription_out(svc, row)


@router.get("/me/subscriptions", response_model=SubscriptionPage)
async def list_my_subscriptions(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[SubscriptionService, Depends(subscription_service)],
    limit: int = Query(default=20, ge=1, le=100),
) -> SubscriptionPage:
    rows = await svc.list_mine(ctx, limit=limit)
    items = [await _subscription_out(svc, row) for row in rows]
    return SubscriptionPage(items=items)


@router.get("/subscriptions/{subscription_id}", response_model=SubscriptionOut)
async def get_subscription(
    subscription_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[SubscriptionService, Depends(subscription_service)],
) -> SubscriptionOut:
    row = await svc.get_own(ctx, subscription_id)
    return await _subscription_out(svc, row)


@router.post("/subscriptions/{subscription_id}/cancel", response_model=SubscriptionOut)
async def cancel_subscription(
    subscription_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[SubscriptionService, Depends(subscription_service)],
) -> SubscriptionOut:
    row = await svc.cancel(ctx, subscription_id)
    return await _subscription_out(svc, row)


@router.post("/subscriptions/{subscription_id}/sandbox-renew", response_model=OrderOut)
async def sandbox_renew(
    subscription_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[CheckoutService, Depends(checkout_service)],
    session: Annotated[AsyncSession, Depends(db_session)],
    settings: Annotated[Settings, Depends(settings_dep)],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> OrderOut | JSONResponse:
    if not idempotency_key:
        raise AppError("VALIDATION_ERROR", "Idempotency-Key is required", 422)
    key = compose_idempotency_key("renew", f"{ctx.user_id}:{idempotency_key}")
    started = await begin_idempotent(
        session,
        key=key,
        request_hash=fingerprint_payload({"subscription_id": str(subscription_id)}),
        ttl_seconds=settings.idempotency_ttl_seconds,
    )
    if isinstance(started, IdempotencyReplay):
        payload = json.loads(started.body) if started.body else {}
        return JSONResponse(status_code=started.status_code, content=payload)
    try:
        order, payment = await svc.sandbox_renew(
            ctx,
            subscription_id=subscription_id,
            idempotency_key=f"{ctx.user_id}:{idempotency_key}",
        )
        out = _order_out(order, payment).model_dump(mode="json")
        await complete_idempotent(session, started, status_code=200, body=json.dumps(out, default=str))
        return OrderOut.model_validate(out)
    except Exception:
        await fail_idempotent(session, started)
        raise
