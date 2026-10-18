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

# Artist states after approval: Studio, royalties and the artist menu apply.
ARTIST_PROFILE_STATES = ("APPROVED", "CONTRACT_PENDING", "SIGNED", "ACTIVE", "SUSPENDED")


async def _roles_for_menu(svc: IdentityService, user_id: UUID, permission_keys: frozenset[str] | set[str]) -> dict[str, bool]:
    from sqlalchemy import exists, select

    from cornerroom.modules.artists.domain.models import Artist, BandMember
    from cornerroom.modules.identity.domain.models import OrganizationMembership

    session = svc.session
    is_artist = await session.scalar(
        select(
            exists().where(
                Artist.claimed_user_id == user_id, Artist.deleted_at.is_(None), Artist.status.in_(ARTIST_PROFILE_STATES)
            )
        )
    ) or await session.scalar(
        select(
            exists().where(
                BandMember.user_id == user_id, BandMember.status == "ACTIVE", BandMember.is_admin.is_(True), BandMember.deleted_at.is_(None)
            )
        )
    )
    member = await session.scalar(
        select(
            exists().where(
                OrganizationMembership.user_id == user_id,
                OrganizationMembership.status == "ACTIVE",
                OrganizationMembership.deleted_at.is_(None),
            )
        )
    )
    return {"is_artist": bool(is_artist), "has_workspace": bool(member) or "org.admin" in permission_keys}


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
    # What the menus offer (UX only; every page still asks the API). An artist has an approved
    # artist profile or runs a band; a workspace member belongs to an organization.
    is_artist: bool = False
    has_workspace: bool = False


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
        **await _roles_for_menu(svc, user.id, ctx.permission_keys),
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
        **await _roles_for_menu(svc, user.id, ctx.permission_keys),
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


# --- Delivery address for gifts (D-ADDR-01) -------------------------------------------------


class DeliveryAddressIn(BaseModel):
    recipient_name: str = Field(max_length=200)
    phone: str = Field(max_length=32)
    division: str = Field(max_length=64)
    district: str = Field(max_length=64)
    upazila: str = Field(max_length=200)
    area: str = Field(max_length=200)
    house_road: str = Field(max_length=300)
    postcode: str | None = Field(default=None, max_length=16)
    landmark: str | None = Field(default=None, max_length=300)


class DeliveryAddressOut(BaseModel):
    recipient_name: str
    phone: str
    division: str
    district: str
    upazila: str
    area: str
    house_road: str
    postcode: str | None
    landmark: str | None
    updated_at: datetime | None = None


class AddressOptionsOut(BaseModel):
    country: str = "Bangladesh"
    divisions: list[dict]


def _address_out(row) -> DeliveryAddressOut:
    from cornerroom.modules.identity.domain.bd_address import ADDRESS_FIELDS

    return DeliveryAddressOut(**{f: getattr(row, f) for f in ADDRESS_FIELDS}, updated_at=row.updated_at)


@router.get("/address-options", response_model=AddressOptionsOut)
async def address_options() -> AddressOptionsOut:
    """Bangladesh divisions and their districts, so the form and the API use the same names."""
    from cornerroom.modules.identity.domain.bd_address import DIVISIONS

    return AddressOptionsOut(divisions=[{"name": name, "districts": list(districts)} for name, districts in DIVISIONS.items()])


@router.get("/me/delivery-address", response_model=DeliveryAddressOut)
async def my_delivery_address(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[IdentityService, Depends(identity_service)],
) -> DeliveryAddressOut:
    from cornerroom.infra.errors import NotFoundError
    from cornerroom.modules.identity.application.delivery_address import DeliveryAddressService

    row = await DeliveryAddressService(svc.session).get_for_user(ctx.user_id)
    if row is None:
        raise NotFoundError("No delivery address yet")
    return _address_out(row)


@router.put("/me/delivery-address", response_model=DeliveryAddressOut)
async def save_my_delivery_address(
    body: DeliveryAddressIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[IdentityService, Depends(identity_service)],
) -> DeliveryAddressOut:
    from cornerroom.modules.identity.application.delivery_address import DeliveryAddressService

    row = await DeliveryAddressService(svc.session).save(ctx, body.model_dump())
    return _address_out(row)