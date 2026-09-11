"""Admin user lifecycle. Permission-based — not is_admin."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
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
    status: str
    email_verified: bool
    security_locked: bool


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
    return UserAdminOut(
        id=user.id,
        email=user.email,
        status=user.status,
        email_verified=user.email_verified_at is not None,
        security_locked=user.security_locked_at is not None,
    )
