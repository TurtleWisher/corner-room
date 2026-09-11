"""Band routes. Thin — rules live in ArtistService."""

from __future__ import annotations

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from cornerroom.api.deps import artist_service, get_auth_context, get_optional_auth_context
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.artists.application.service import ArtistService
from cornerroom.modules.artists.domain.models import Band, BandMember

router = APIRouter(prefix="/bands", tags=["bands"])


class BandOut(BaseModel):
    id: UUID
    name: str
    bio: str | None
    status: str
    primary_org_id: UUID | None
    portrait_asset_id: UUID | None
    metadata: dict[str, Any] | None
    version: int


class PublicBandOut(BaseModel):
    id: UUID
    name: str
    bio: str | None
    status: str
    portrait_asset_id: UUID | None


class BandPage(BaseModel):
    items: list[BandOut]
    next_cursor: str | None


class PublicBandPage(BaseModel):
    items: list[PublicBandOut]
    next_cursor: str | None


class BandCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    bio: str | None = Field(default=None, max_length=8000)
    metadata: dict[str, Any] | None = None
    portrait_asset_id: UUID | None = None
    organization_id: UUID | None = None


class BandPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    bio: str | None = Field(default=None, max_length=8000)
    metadata: dict[str, Any] | None = None
    portrait_asset_id: UUID | None = None
    version: int | None = Field(default=None, ge=1)


class BandLifecycleIn(BaseModel):
    action: str = Field(pattern="^(activate|pause|resume|disband)$")
    version: int | None = Field(default=None, ge=1)


class MemberCreate(BaseModel):
    user_id: UUID | None = None
    artist_id: UUID | None = None
    role_label: str | None = Field(default=None, max_length=80)


class MemberOut(BaseModel):
    id: UUID
    band_id: UUID
    user_id: UUID | None
    artist_id: UUID | None
    role_label: str | None
    status: str
    started_at: str | None
    ended_at: str | None


class MemberPage(BaseModel):
    items: list[MemberOut]


class MemberLifecycleIn(BaseModel):
    action: str = Field(pattern="^(accept|leave|remove)$")


class FollowOut(BaseModel):
    id: UUID
    user_id: UUID
    target_type: str
    target_id: UUID
    status: str


def _band_out(row: Band) -> BandOut:
    return BandOut(
        id=row.id,
        name=row.name,
        bio=row.bio,
        status=row.status,
        primary_org_id=row.primary_org_id,
        portrait_asset_id=row.portrait_asset_id,
        metadata=row.extra_metadata,
        version=row.version,
    )


def _public_band(row: Band) -> PublicBandOut:
    return PublicBandOut(
        id=row.id,
        name=row.name,
        bio=row.bio,
        status=row.status,
        portrait_asset_id=row.portrait_asset_id,
    )


def _member_out(row: BandMember) -> MemberOut:
    return MemberOut(
        id=row.id,
        band_id=row.band_id,
        user_id=row.user_id,
        artist_id=row.artist_id,
        role_label=row.role_label,
        status=row.status,
        started_at=row.started_at.isoformat() if row.started_at else None,
        ended_at=row.ended_at.isoformat() if row.ended_at else None,
    )


@router.get("")
async def list_bands(
    svc: Annotated[ArtistService, Depends(artist_service)],
    ctx: Annotated[AuthContext | None, Depends(get_optional_auth_context)],
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
) -> BandPage | PublicBandPage:
    rows, next_cursor, public_only = await svc.list_bands(ctx, cursor=cursor, limit=limit)
    if public_only:
        return PublicBandPage(items=[_public_band(r) for r in rows], next_cursor=next_cursor)
    return BandPage(items=[_band_out(r) for r in rows], next_cursor=next_cursor)


@router.post("", response_model=BandOut, status_code=201)
async def create_band(
    body: BandCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[ArtistService, Depends(artist_service)],
) -> BandOut:
    row = await svc.create_band(
        ctx,
        name=body.name,
        bio=body.bio,
        extra_metadata=body.metadata,
        portrait_asset_id=body.portrait_asset_id,
        organization_id=body.organization_id,
    )
    return _band_out(row)


@router.get("/{band_id}")
async def get_band(
    band_id: UUID,
    svc: Annotated[ArtistService, Depends(artist_service)],
    ctx: Annotated[AuthContext | None, Depends(get_optional_auth_context)],
) -> BandOut | PublicBandOut:
    row, public_view = await svc.get_band(band_id, ctx)
    if public_view:
        return _public_band(row)
    return _band_out(row)


@router.patch("/{band_id}", response_model=BandOut)
async def patch_band(
    band_id: UUID,
    body: BandPatch,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[ArtistService, Depends(artist_service)],
) -> BandOut:
    payload: dict[str, Any] = {}
    if body.name is not None:
        payload["name"] = body.name
    if "bio" in body.model_fields_set:
        payload["bio"] = body.bio
    if "metadata" in body.model_fields_set:
        payload["extra_metadata"] = body.metadata
    if "portrait_asset_id" in body.model_fields_set:
        payload["portrait_asset_id"] = body.portrait_asset_id
    row = await svc.update_band(ctx, band_id, expected_version=body.version, **payload)
    return _band_out(row)


@router.post("/{band_id}/lifecycle", response_model=BandOut)
async def band_lifecycle(
    band_id: UUID,
    body: BandLifecycleIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[ArtistService, Depends(artist_service)],
) -> BandOut:
    row = await svc.transition_band(ctx, band_id, action=body.action, expected_version=body.version)
    return _band_out(row)


@router.get("/{band_id}/members", response_model=MemberPage)
async def list_members(
    band_id: UUID,
    svc: Annotated[ArtistService, Depends(artist_service)],
    ctx: Annotated[AuthContext | None, Depends(get_optional_auth_context)],
) -> MemberPage:
    rows = await svc.list_members(ctx, band_id)
    return MemberPage(items=[_member_out(r) for r in rows])


@router.post("/{band_id}/members", response_model=MemberOut, status_code=201)
async def invite_member(
    band_id: UUID,
    body: MemberCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[ArtistService, Depends(artist_service)],
) -> MemberOut:
    row = await svc.invite_member(
        ctx,
        band_id,
        user_id=body.user_id,
        artist_id=body.artist_id,
        role_label=body.role_label,
    )
    return _member_out(row)


@router.post("/{band_id}/members/{member_id}/lifecycle", response_model=MemberOut)
async def member_lifecycle(
    band_id: UUID,
    member_id: UUID,
    body: MemberLifecycleIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[ArtistService, Depends(artist_service)],
) -> MemberOut:
    row = await svc.transition_member(ctx, band_id, member_id, action=body.action)
    return _member_out(row)


@router.post("/{band_id}/follow", response_model=FollowOut, status_code=201)
async def follow_band(
    band_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[ArtistService, Depends(artist_service)],
) -> FollowOut:
    row = await svc.follow(ctx, target_type="BAND", target_id=band_id)
    return FollowOut(
        id=row.id,
        user_id=row.user_id,
        target_type=row.target_type,
        target_id=row.target_id,
        status=row.status,
    )


@router.delete("/{band_id}/follow", response_model=FollowOut)
async def unfollow_band(
    band_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[ArtistService, Depends(artist_service)],
) -> FollowOut:
    row = await svc.unfollow(ctx, target_type="BAND", target_id=band_id)
    return FollowOut(
        id=row.id,
        user_id=row.user_id,
        target_type=row.target_type,
        target_id=row.target_id,
        status=row.status,
    )
