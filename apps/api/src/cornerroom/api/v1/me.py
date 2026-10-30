"""Current user profile."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from cornerroom.api.deps import get_auth_context, get_current_user, identity_service
from cornerroom.api.v1.studio import CoverReportOut as ArtworkReportOut
from cornerroom.infra.errors import AppError
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.identity.application.services import IdentityService
from cornerroom.modules.identity.domain.models import CustomerProfile, User

router = APIRouter(tags=["me"])

# Artist states after approval: Studio, royalties and the artist menu apply.
ARTIST_PROFILE_STATES = ("APPROVED", "CONTRACT_PENDING", "SIGNED", "ACTIVE", "SUSPENDED")


async def _roles_for_menu(svc: IdentityService, user_id: UUID, permission_keys: frozenset[str] | set[str]) -> dict[str, bool]:
    from sqlalchemy import exists, select

    from cornerroom.modules.artists.domain.models import Artist, ArtistTeamMember
    from cornerroom.modules.identity.domain.models import OrganizationMembership

    session = svc.session
    # Owner or approved manager of a solo or band profile past approval (D-ARTIST-UNIFY-01).
    is_artist = await session.scalar(
        select(
            exists().where(
                ArtistTeamMember.user_id == user_id,
                ArtistTeamMember.status == "ACTIVE",
                ArtistTeamMember.artist_id == Artist.id,
                Artist.deleted_at.is_(None),
                Artist.status.in_(ARTIST_PROFILE_STATES),
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
    # The fan's own picture (owner, 2026-10-23): a short-lived signed link, shown only to them.
    avatar_url: str | None = None


class MePatch(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=200)
    locale: str | None = Field(default=None, pattern="^(en|bn)$")
    remove_avatar: bool = False


def _avatar_url(svc: IdentityService, profile: CustomerProfile | None) -> str | None:
    if profile is None or profile.avatar_asset_id is None:
        return None
    from cornerroom.modules.documents.application.covers import CoverService

    return CoverService(svc.session, svc.settings).signed_path(profile.avatar_asset_id, 480)


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
        avatar_url=_avatar_url(svc, profile),
        **await _roles_for_menu(svc, user.id, ctx.permission_keys),
    )


@router.patch("/me", response_model=MeOut)
async def patch_me(
    body: MePatch,
    user: Annotated[User, Depends(get_current_user)],
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[IdentityService, Depends(identity_service)],
) -> MeOut:
    if body.display_name is not None and not body.display_name.strip():
        raise AppError("VALIDATION_ERROR", "Your name can't be empty", 422)
    profile = await svc.update_me(ctx, display_name=body.display_name, locale=body.locale)
    if body.remove_avatar:
        profile = await svc.remove_avatar(ctx)
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
        avatar_url=_avatar_url(svc, profile),
        **await _roles_for_menu(svc, user.id, ctx.permission_keys),
    )


@router.get("/me/avatar-report", response_model=ArtworkReportOut | None)
async def my_avatar_report(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[IdentityService, Depends(identity_service)],
) -> ArtworkReportOut | None:
    """What the checks found for the fan's latest picture upload (None before any)."""
    from cornerroom.modules.documents.application.covers import latest_artwork_report

    _, profile = await svc.get_me(ctx.user_id)
    report = await latest_artwork_report(
        svc.session, target_type="user_avatar", target_id=ctx.user_id,
        current_asset_id=profile.avatar_asset_id if profile else None,
    )
    return ArtworkReportOut(**report) if report else None


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


# --- Delivery address for gifts (D-ADDR-01; anywhere in the world, D-ADDR-02; one shape, D-ADDR-03)


class DeliveryAddressIn(BaseModel):
    """The same fields for every country (D-ADDR-03): detailed address, district or city, division,
    state or region, postcode. Phones come with their country (`phone_country`) or a leading +."""

    country_code: str = Field(default="BD", max_length=2)
    recipient_name: str = Field(max_length=200)
    phone_country: str | None = Field(default=None, max_length=2)
    phone: str = Field(max_length=32)
    address_line1: str | None = Field(default=None, max_length=400)
    city: str | None = Field(default=None, max_length=200)
    region: str | None = Field(default=None, max_length=200)
    postcode: str | None = Field(default=None, max_length=16)


class DeliveryAddressOut(BaseModel):
    country_code: str
    recipient_name: str
    phone_country: str | None
    phone: str
    address_line1: str | None
    city: str | None
    region: str | None
    postcode: str | None
    updated_at: datetime | None = None


class CountryOut(BaseModel):
    code: str
    name: str
    calling_code: str


class AddressOptionsOut(BaseModel):
    country: str = "Bangladesh"
    divisions: list[dict]
    # D-ADDR-02: every country, Bangladesh first, with its calling code for phone numbers.
    countries: list[CountryOut] = []


def _address_out(row) -> DeliveryAddressOut:
    from cornerroom.modules.identity.domain.bd_address import ADDRESS_FIELDS

    return DeliveryAddressOut(**{f: getattr(row, f) for f in ADDRESS_FIELDS}, updated_at=row.updated_at)


@router.get("/address-options", response_model=AddressOptionsOut)
async def address_options() -> AddressOptionsOut:
    """Countries with calling codes, and Bangladesh's divisions and districts, so the form and
    the API use the same names."""
    from cornerroom.modules.identity.domain.bd_address import DIVISIONS
    from cornerroom.modules.identity.domain.countries import BY_CODE, COUNTRIES

    countries = [BY_CODE["BD"], *(c for c in COUNTRIES if c[0] != "BD")]
    return AddressOptionsOut(
        divisions=[{"name": name, "districts": list(districts)} for name, districts in DIVISIONS.items()],
        countries=[CountryOut(code=c, name=n, calling_code=d) for c, n, d in countries],
    )


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