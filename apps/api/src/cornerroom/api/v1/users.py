"""Admin user inspect and lifecycle. Permission-based — not is_admin."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from cornerroom.api.deps import get_auth_context, identity_service, require_permission
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.identity.application.services import IdentityService

router = APIRouter(prefix="/users", tags=["users"])


class LifecycleIn(BaseModel):
    action: str = Field(pattern="^(activate|suspend|unsuspend|close|lock|unlock)$")


class UserAdminOut(BaseModel):
    id: UUID
    email: str | None
    phone: str | None = None
    status: str
    email_verified: bool
    security_locked: bool
    created_at: datetime | None = None


class UserAdminPage(BaseModel):
    items: list[UserAdminOut]
    next_cursor: str | None


class UserInspectOut(UserAdminOut):
    assignments: list[dict[str, Any]]
    memberships: list[dict[str, Any]]


def _user_out(user) -> UserAdminOut:
    return UserAdminOut(
        id=user.id,
        email=user.email,
        phone=user.phone,
        status=user.status,
        email_verified=user.email_verified_at is not None,
        security_locked=user.security_locked_at is not None,
        created_at=user.created_at,
    )


@router.get(
    "",
    response_model=UserAdminPage,
    dependencies=[Depends(require_permission("user.admin"))],
)
async def list_users(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[IdentityService, Depends(identity_service)],
    q: str | None = None,
    status: str | None = None,
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
) -> UserAdminPage:
    rows, next_cursor = await svc.list_users(
        query=q,
        status=status,
        cursor=cursor,
        limit=limit,
        organization_id=ctx.organization_id,
    )
    return UserAdminPage(items=[_user_out(row) for row in rows], next_cursor=next_cursor)


@router.get(
    "/{user_id}",
    response_model=UserInspectOut,
    dependencies=[Depends(require_permission("user.admin"))],
)
async def inspect_user(
    user_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[IdentityService, Depends(identity_service)],
) -> UserInspectOut:
    user, assignments, memberships = await svc.inspect_user(
        user_id,
        organization_id=ctx.organization_id,
    )
    base = _user_out(user)
    return UserInspectOut(**base.model_dump(), assignments=assignments, memberships=memberships)


@router.post(
    "/{user_id}/lifecycle",
    response_model=UserAdminOut,
    dependencies=[Depends(require_permission("user.admin"))],
)
async def apply_lifecycle(
    user_id: UUID,
    body: LifecycleIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[IdentityService, Depends(identity_service)],
) -> UserAdminOut:
    user = await svc.apply_lifecycle(ctx, user_id=user_id, action=body.action)
    return _user_out(user)
