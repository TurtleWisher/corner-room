"""Customer subscriptions that already exist. Thin controllers.

Owner, 2026-10-23 (D-COMMERCE-01): Corner Room has no subscriptions. Plans can no longer be created,
listed, sold or renewed, and nobody can subscribe. People who subscribed before can still see their
subscription and cancel it; access already granted keeps working until it ends.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from cornerroom.api.deps import get_auth_context, subscription_service
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.subscriptions.application.service import SubscriptionService
from cornerroom.modules.subscriptions.domain.models import Subscription

router = APIRouter(tags=["subscriptions"])


class SubscriptionOut(BaseModel):
    id: UUID
    plan_id: UUID
    plan_version_id: UUID
    status: str
    cancel_at_period_end: bool
    period_ends_at: datetime | None = None


class SubscriptionPage(BaseModel):
    items: list[SubscriptionOut]


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
