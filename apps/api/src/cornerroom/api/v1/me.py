"""Current user profile."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from cornerroom.api.deps import get_auth_context, get_current_user, identity_service
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.identity.application.services import IdentityService
from cornerroom.modules.identity.domain.models import User

router = APIRouter(tags=["me"])


class MeOut(BaseModel):
    id: UUID
    email: str | None
    status: str
    display_name: str | None
    locale: str | None
    permissions: list[str]
    email_verified: bool
    security_locked: bool
    organization_id: UUID | None = None


class MePatch(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=200)
    locale: str | None = Field(default=None, pattern="^(en|bn)$")


class SessionOut(BaseModel):
    id: UUID
    status: str
    created_at: datetime
    last_used_at: datetime | None
    expires_at: datetime
    ip: str | None
    user_agent: str | None
    current: bool


@router.get("/me", response_model=MeOut)
async def get_me(
    user: Annotated[User, Depends(get_current_user)],
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[IdentityService, Depends(identity_service)],
) -> MeOut:
    _, profile = await svc.get_me(user.id)
    return MeOut(
        id=user.id,
        email=user.email,
        status=user.status,
        display_name=profile.display_name if profile else None,
        locale=profile.locale if profile else None,
        permissions=sorted(ctx.permission_keys),
        email_verified=user.email_verified_at is not None,
        security_locked=user.security_locked_at is not None,
        organization_id=ctx.organization_id,
    )


@router.patch("/me", response_model=MeOut)
async def patch_me(
    body: MePatch,
    user: Annotated[User, Depends(get_current_user)],
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[IdentityService, Depends(identity_service)],
) -> MeOut:
    profile = await svc.update_me(ctx, display_name=body.display_name, locale=body.locale)
    return MeOut(
        id=user.id,
        email=user.email,
        status=user.status,
        display_name=profile.display_name,
        locale=profile.locale,
        permissions=sorted(ctx.permission_keys),
        email_verified=user.email_verified_at is not None,
        security_locked=user.security_locked_at is not None,
        organization_id=ctx.organization_id,
    )


@router.get("/me/sessions", response_model=list[SessionOut])
async def list_my_sessions(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[IdentityService, Depends(identity_service)],
) -> list[SessionOut]:
    rows = await svc.list_sessions(ctx.user_id)
    return [
        SessionOut(
            id=row.id,
            status=row.status,
            created_at=row.created_at,
            last_used_at=row.last_used_at,
            expires_at=row.expires_at,
            ip=row.ip,
            user_agent=row.user_agent,
            current=ctx.session_id == row.id,
        )
        for row in rows
    ]


@router.delete("/me/sessions/{session_id}", status_code=204)
async def revoke_my_session(
    session_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[IdentityService, Depends(identity_service)],
) -> None:
    await svc.revoke_session(ctx, session_id)


@router.post("/me/sessions/revoke-all", status_code=204)
async def revoke_all_my_sessions(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[IdentityService, Depends(identity_service)],
) -> None:
    await svc.revoke_all_sessions(ctx, keep_current=False)
