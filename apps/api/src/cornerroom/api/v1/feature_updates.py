"""Corner Room's feature updates log (owner, 2026-11-06, D-UPDATES-01): every feature and each
update and fix to it, for staff only. The list lives in modules/administration/domain/feature_updates.py."""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from cornerroom.api.deps import get_auth_context
from cornerroom.infra.errors import NotFoundError
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.administration.domain.feature_updates import feature_updates

router = APIRouter(tags=["feature-updates"])

Ctx = Annotated[AuthContext, Depends(get_auth_context)]


class UpdateOut(BaseModel):
    date: str
    kind: Literal["NEW", "IMPROVED", "FIXED"]
    title: str
    details: str


class FeatureOut(BaseModel):
    id: str
    name: str
    area: str
    audience: list[str]
    summary: str
    description: str
    first_date: str
    last_date: str
    updates: list[UpdateOut]


@router.get("/staff/feature-updates", response_model=list[FeatureOut])
async def list_feature_updates(ctx: Ctx) -> list[FeatureOut]:
    """Staff only: anyone holding a staff permission. Everyone else gets 404, never 403."""
    if not ctx.permission_keys:
        raise NotFoundError("Not found")
    return [FeatureOut(**f) for f in feature_updates()]
