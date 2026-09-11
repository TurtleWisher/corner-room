"""Organization workspace routes. Thin — rules live in OrganizationService."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, EmailStr, Field

from cornerroom.api.deps import (
    get_auth_context,
    get_current_user,
    organization_service,
    settings_dep,
)
from cornerroom.infra.settings import Settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.identity.application.organization_service import OrganizationService
from cornerroom.modules.identity.domain.models import ORG_TYPES, User

router = APIRouter(prefix="/organizations", tags=["organizations"])


class OrganizationOut(BaseModel):
    id: UUID
    name: str
    type: str
    status: str
    share_bps: int | None


class OrganizationPage(BaseModel):
    items: list[OrganizationOut]
    next_cursor: str | None


class OrganizationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    type: str = Field(pattern="^(PLATFORM|LABEL|EVENT_ORG|VENUE_PARTNER|SPONSOR|AGENCY)$")
    share_bps: int | None = Field(default=None, ge=0, le=10000)


class OrganizationSettingsPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    share_bps: int | None = Field(default=None, ge=0, le=10000)


class LifecycleIn(BaseModel):
    action: str = Field(pattern="^(activate|suspend|unsuspend|archive)$")


class MembershipCreate(BaseModel):
    user_id: UUID
    role_id: UUID | None = None
    status: str = Field(default="ACTIVE", pattern="^(INVITED|ACTIVE)$")


class MembershipOut(BaseModel):
    id: UUID
    organization_id: UUID
    user_id: UUID
    role_id: UUID | None
    status: str
    ended_at: datetime | None = None


class MembershipPage(BaseModel):
    items: list[MembershipOut]
    next_cursor: str | None


class MembershipPatch(BaseModel):
    status: str = Field(pattern="^(ACTIVE|REVOKED)$")


class InvitationCreate(BaseModel):
    email: EmailStr
    role_id: UUID | None = None


class InvitationIssueOut(BaseModel):
    id: UUID
    organization_id: UUID
    email: str
    status: str
    role_id: UUID | None
    expires_at: datetime | None
    token: str


class InvitationOut(BaseModel):
    id: UUID
    organization_id: UUID
    email: str
    status: str
    role_id: UUID | None
    invited_user_id: UUID | None
    expires_at: datetime | None
    accepted_at: datetime | None


class InvitationPage(BaseModel):
    items: list[InvitationOut]
    next_cursor: str | None


class InvitationAcceptIn(BaseModel):
    token: str = Field(min_length=8, max_length=256)


class SwitchOut(BaseModel):
    access_token: str
    token_type: str = "Bearer"
    expires_in: int
    organization: OrganizationOut


def _org_out(org) -> OrganizationOut:
    return OrganizationOut(
        id=org.id,
        name=org.name,
        type=org.type,
        status=org.status,
        share_bps=org.share_bps,
    )


def _membership_out(row) -> MembershipOut:
    return MembershipOut(
        id=row.id,
        organization_id=row.organization_id,
        user_id=row.user_id,
        role_id=row.role_id,
        status=row.status,
        ended_at=row.ended_at,
    )


@router.get("", response_model=OrganizationPage)
async def list_organizations(
    user: Annotated[User, Depends(get_current_user)],
    svc: Annotated[OrganizationService, Depends(organization_service)],
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
) -> OrganizationPage:
    rows, next_cursor = await svc.list_organizations(user.id, cursor=cursor, limit=limit)
    return OrganizationPage(items=[_org_out(o) for o in rows], next_cursor=next_cursor)


@router.post("", response_model=OrganizationOut, status_code=201)
async def create_organization(
    body: OrganizationCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[OrganizationService, Depends(organization_service)],
) -> OrganizationOut:
    if body.type not in ORG_TYPES:
        from cornerroom.infra.errors import AppError

        raise AppError("VALIDATION_ERROR", "Invalid type", 422)
    org = await svc.create_organization(
        ctx, name=body.name, org_type=body.type, share_bps=body.share_bps
    )
    return _org_out(org)


@router.post("/invitations/accept", response_model=MembershipOut)
async def accept_invitation(
    body: InvitationAcceptIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[OrganizationService, Depends(organization_service)],
) -> MembershipOut:
    membership = await svc.accept_invitation(ctx, token=body.token)
    return _membership_out(membership)


@router.get("/{org_id}", response_model=OrganizationOut)
async def get_organization(
    org_id: UUID,
    user: Annotated[User, Depends(get_current_user)],
    svc: Annotated[OrganizationService, Depends(organization_service)],
) -> OrganizationOut:
    if not await svc.can_see_org(user.id, org_id):
        from cornerroom.infra.errors import ForbiddenError

        raise ForbiddenError("Not permitted")
    org = await svc.get_organization(org_id)
    return _org_out(org)


@router.patch("/{org_id}", response_model=OrganizationOut)
async def patch_organization(
    org_id: UUID,
    body: OrganizationSettingsPatch,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[OrganizationService, Depends(organization_service)],
) -> OrganizationOut:
    payload = body.model_dump(exclude_unset=True)
    org = await svc.update_settings(
        ctx,
        org_id=org_id,
        name=payload.get("name"),
        share_bps=payload["share_bps"] if "share_bps" in payload else ...,
    )
    return _org_out(org)


@router.post("/{org_id}/lifecycle", response_model=OrganizationOut)
async def organization_lifecycle(
    org_id: UUID,
    body: LifecycleIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[OrganizationService, Depends(organization_service)],
) -> OrganizationOut:
    org = await svc.transition(ctx, org_id=org_id, action=body.action)
    return _org_out(org)


@router.post("/{org_id}/switch", response_model=SwitchOut)
async def switch_organization(
    org_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[OrganizationService, Depends(organization_service)],
    settings: Annotated[Settings, Depends(settings_dep)],
) -> SwitchOut:
    org, access = await svc.switch_workspace(ctx, org_id=org_id)
    return SwitchOut(access_token=access, expires_in=settings.jwt_access_ttl_seconds, organization=_org_out(org))


@router.get("/{org_id}/memberships", response_model=MembershipPage)
async def list_memberships(
    org_id: UUID,
    user: Annotated[User, Depends(get_current_user)],
    svc: Annotated[OrganizationService, Depends(organization_service)],
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
) -> MembershipPage:
    rows, next_cursor = await svc.list_memberships(user.id, org_id, cursor=cursor, limit=limit)
    return MembershipPage(items=[_membership_out(m) for m in rows], next_cursor=next_cursor)


@router.post("/{org_id}/memberships", response_model=MembershipOut, status_code=201)
async def add_membership(
    org_id: UUID,
    body: MembershipCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[OrganizationService, Depends(organization_service)],
) -> MembershipOut:
    membership = await svc.add_membership(
        ctx,
        organization_id=org_id,
        user_id=body.user_id,
        role_id=body.role_id,
        status=body.status,
    )
    return _membership_out(membership)


@router.patch("/{org_id}/memberships/{membership_id}", response_model=MembershipOut)
async def patch_membership(
    org_id: UUID,
    membership_id: UUID,
    body: MembershipPatch,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[OrganizationService, Depends(organization_service)],
) -> MembershipOut:
    membership = await svc.update_membership(
        ctx,
        organization_id=org_id,
        membership_id=membership_id,
        status=body.status,
    )
    return _membership_out(membership)


@router.post("/{org_id}/invites", response_model=InvitationIssueOut, status_code=201)
async def create_invite(
    org_id: UUID,
    body: InvitationCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[OrganizationService, Depends(organization_service)],
) -> InvitationIssueOut:
    invitation, token = await svc.issue_invitation(
        ctx,
        organization_id=org_id,
        email=str(body.email),
        role_id=body.role_id,
    )
    return InvitationIssueOut(
        id=invitation.id,
        organization_id=invitation.organization_id,
        email=invitation.email,
        status=invitation.status,
        role_id=invitation.role_id,
        expires_at=invitation.expires_at,
        token=token,
    )


@router.get("/{org_id}/invitations", response_model=InvitationPage)
async def list_invitations(
    org_id: UUID,
    user: Annotated[User, Depends(get_current_user)],
    svc: Annotated[OrganizationService, Depends(organization_service)],
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
) -> InvitationPage:
    rows, next_cursor = await svc.list_invitations(user.id, org_id, cursor=cursor, limit=limit)
    return InvitationPage(
        items=[
            InvitationOut(
                id=row.id,
                organization_id=row.organization_id,
                email=row.email,
                status=row.status,
                role_id=row.role_id,
                invited_user_id=row.invited_user_id,
                expires_at=row.expires_at,
                accepted_at=row.accepted_at,
            )
            for row in rows
        ],
        next_cursor=next_cursor,
    )


@router.post("/{org_id}/invitations/{invitation_id}/revoke", response_model=InvitationOut)
async def revoke_invite(
    org_id: UUID,
    invitation_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[OrganizationService, Depends(organization_service)],
) -> InvitationOut:
    row = await svc.revoke_invitation(ctx, organization_id=org_id, invitation_id=invitation_id)
    return InvitationOut(
        id=row.id,
        organization_id=row.organization_id,
        email=row.email,
        status=row.status,
        role_id=row.role_id,
        invited_user_id=row.invited_user_id,
        expires_at=row.expires_at,
        accepted_at=row.accepted_at,
    )
