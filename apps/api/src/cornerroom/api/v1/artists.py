"""Artist, application, and follow routes. Thin — rules live in ArtistService."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from cornerroom.api.deps import artist_service, get_auth_context, get_optional_auth_context
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.artists.application.service import ArtistService
from cornerroom.modules.artists.domain.models import Artist, ArtistApplication, Follow

router = APIRouter(tags=["artists"])


class ArtistOut(BaseModel):
    id: UUID
    stage_name: str
    legal_name: str | None
    bio: str | None
    status: str
    primary_org_id: UUID | None
    claimed_user_id: UUID | None
    portrait_asset_id: UUID | None
    metadata: dict[str, Any] | None
    version: int


class PublicArtistOut(BaseModel):
    id: UUID
    stage_name: str
    bio: str | None
    status: str
    portrait_asset_id: UUID | None


class ArtistPage(BaseModel):
    items: list[ArtistOut]
    next_cursor: str | None


class PublicArtistPage(BaseModel):
    items: list[PublicArtistOut]
    next_cursor: str | None


class ArtistCreate(BaseModel):
    stage_name: str = Field(min_length=1, max_length=200)
    legal_name: str | None = Field(default=None, max_length=200)
    bio: str | None = Field(default=None, max_length=8000)
    metadata: dict[str, Any] | None = None
    portrait_asset_id: UUID | None = None
    organization_id: UUID | None = None
    claimed_user_id: UUID | None = None


class ArtistPatch(BaseModel):
    stage_name: str | None = Field(default=None, min_length=1, max_length=200)
    legal_name: str | None = Field(default=None, max_length=200)
    bio: str | None = Field(default=None, max_length=8000)
    metadata: dict[str, Any] | None = None
    portrait_asset_id: UUID | None = None
    version: int | None = Field(default=None, ge=1)


class ArtistLifecycleIn(BaseModel):
    action: str = Field(
        pattern="^(start_review|approve|reject|begin_contract|mark_signed|activate|suspend|terminate)$"
    )
    version: int | None = Field(default=None, ge=1)


class ApplicationCreate(BaseModel):
    stage_name: str = Field(min_length=1, max_length=200)
    legal_name: str | None = Field(default=None, max_length=200)
    # From a label's join link (/studio/join?code=...): the application goes to that label.
    join_code: str | None = Field(default=None, max_length=64)
    bio: str | None = Field(default=None, max_length=8000)
    metadata: dict[str, Any] | None = None
    payload: dict[str, Any] | None = None


class ApplicationOut(BaseModel):
    id: UUID
    user_id: UUID
    artist_id: UUID | None
    status: str
    payload: dict[str, Any] | None
    version: int
    # What the reviewer needs from the artist profile it created; never the legal name.
    stage_name: str | None = None
    bio: str | None = None
    artist_status: str | None = None
    created_at: datetime | None = None
    organization_id: UUID | None = None


class ApplicationPage(BaseModel):
    items: list[ApplicationOut]
    next_cursor: str | None


class ApplicationLifecycleIn(BaseModel):
    action: str = Field(pattern="^(start_review|approve|reject|withdraw)$")
    version: int | None = Field(default=None, ge=1)


class MemberGrantIn(BaseModel):
    user_id: UUID


class FollowOut(BaseModel):
    id: UUID
    user_id: UUID
    target_type: str
    target_id: UUID
    status: str


def _artist_out(row: Artist) -> ArtistOut:
    return ArtistOut(
        id=row.id,
        stage_name=row.stage_name,
        legal_name=row.legal_name,
        bio=row.bio,
        status=row.status,
        primary_org_id=row.primary_org_id,
        claimed_user_id=row.claimed_user_id,
        portrait_asset_id=row.portrait_asset_id,
        metadata=row.extra_metadata,
        version=row.version,
    )


def _public_artist(row: Artist) -> PublicArtistOut:
    return PublicArtistOut(
        id=row.id,
        stage_name=row.stage_name,
        bio=row.bio,
        status=row.status,
        portrait_asset_id=row.portrait_asset_id,
    )


def _application_out(row: ArtistApplication, artist: Artist | None = None) -> ApplicationOut:
    return ApplicationOut(
        id=row.id,
        user_id=row.user_id,
        artist_id=row.artist_id,
        status=row.status,
        payload=row.payload,
        version=row.version,
        stage_name=artist.stage_name if artist else None,
        bio=artist.bio if artist else None,
        artist_status=artist.status if artist else None,
        created_at=row.created_at,
        organization_id=row.organization_id,
    )


async def _application_with_artist(svc: ArtistService, row: ArtistApplication) -> ApplicationOut:
    artist = await svc.session.get(Artist, row.artist_id) if row.artist_id else None
    return _application_out(row, artist)


def _follow_out(row: Follow) -> FollowOut:
    return FollowOut(
        id=row.id,
        user_id=row.user_id,
        target_type=row.target_type,
        target_id=row.target_id,
        status=row.status,
    )


@router.get("/artists")
async def list_artists(
    svc: Annotated[ArtistService, Depends(artist_service)],
    ctx: Annotated[AuthContext | None, Depends(get_optional_auth_context)],
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
) -> ArtistPage | PublicArtistPage:
    rows, next_cursor, public_only = await svc.list_artists(ctx, cursor=cursor, limit=limit)
    if public_only:
        return PublicArtistPage(items=[_public_artist(r) for r in rows], next_cursor=next_cursor)
    return ArtistPage(items=[_artist_out(r) for r in rows], next_cursor=next_cursor)


@router.post("/artists", response_model=ArtistOut, status_code=201)
async def create_artist(
    body: ArtistCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[ArtistService, Depends(artist_service)],
) -> ArtistOut:
    row = await svc.create_artist(
        ctx,
        stage_name=body.stage_name,
        legal_name=body.legal_name,
        bio=body.bio,
        extra_metadata=body.metadata,
        portrait_asset_id=body.portrait_asset_id,
        organization_id=body.organization_id,
        claimed_user_id=body.claimed_user_id,
    )
    return _artist_out(row)


@router.get("/artists/{artist_id}")
async def get_artist(
    artist_id: UUID,
    svc: Annotated[ArtistService, Depends(artist_service)],
    ctx: Annotated[AuthContext | None, Depends(get_optional_auth_context)],
) -> ArtistOut | PublicArtistOut:
    row, public_view = await svc.get_artist(artist_id, ctx)
    if public_view:
        return _public_artist(row)
    return _artist_out(row)


@router.patch("/artists/{artist_id}", response_model=ArtistOut)
async def patch_artist(
    artist_id: UUID,
    body: ArtistPatch,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[ArtistService, Depends(artist_service)],
) -> ArtistOut:
    payload: dict[str, Any] = {}
    if body.stage_name is not None:
        payload["stage_name"] = body.stage_name
    if "legal_name" in body.model_fields_set:
        payload["legal_name"] = body.legal_name
    if "bio" in body.model_fields_set:
        payload["bio"] = body.bio
    if "metadata" in body.model_fields_set:
        payload["extra_metadata"] = body.metadata
    if "portrait_asset_id" in body.model_fields_set:
        payload["portrait_asset_id"] = body.portrait_asset_id
    row = await svc.update_artist(ctx, artist_id, expected_version=body.version, **payload)
    return _artist_out(row)


@router.post("/artists/{artist_id}/lifecycle", response_model=ArtistOut)
async def artist_lifecycle(
    artist_id: UUID,
    body: ArtistLifecycleIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[ArtistService, Depends(artist_service)],
) -> ArtistOut:
    row = await svc.transition_artist(
        ctx, artist_id, action=body.action, expected_version=body.version
    )
    return _artist_out(row)


@router.post("/artists/{artist_id}/members", status_code=201)
async def grant_artist_member(
    artist_id: UUID,
    body: MemberGrantIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[ArtistService, Depends(artist_service)],
) -> dict[str, str]:
    await svc.grant_artist_member(ctx, artist_id, user_id=body.user_id)
    return {"status": "granted"}


@router.post("/artists/{artist_id}/follow", response_model=FollowOut, status_code=201)
async def follow_artist(
    artist_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[ArtistService, Depends(artist_service)],
) -> FollowOut:
    row = await svc.follow(ctx, target_type="ARTIST", target_id=artist_id)
    return _follow_out(row)


@router.delete("/artists/{artist_id}/follow", response_model=FollowOut)
async def unfollow_artist(
    artist_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[ArtistService, Depends(artist_service)],
) -> FollowOut:
    row = await svc.unfollow(ctx, target_type="ARTIST", target_id=artist_id)
    return _follow_out(row)


@router.post("/artist-applications", response_model=ApplicationOut, status_code=201)
async def submit_application(
    body: ApplicationCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[ArtistService, Depends(artist_service)],
) -> ApplicationOut:
    row, artist = await svc.submit_application(
        ctx,
        stage_name=body.stage_name,
        legal_name=body.legal_name,
        bio=body.bio,
        extra_metadata=body.metadata,
        payload=body.payload,
        join_code=body.join_code,
    )
    return _application_out(row, artist)


@router.get("/artist-applications", response_model=ApplicationPage)
async def list_applications(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[ArtistService, Depends(artist_service)],
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    mine: bool = False,
) -> ApplicationPage:
    rows, next_cursor = await svc.list_applications(ctx, cursor=cursor, limit=limit, mine=mine)
    return ApplicationPage(items=[await _application_with_artist(svc, r) for r in rows], next_cursor=next_cursor)


@router.get("/artist-applications/{application_id}", response_model=ApplicationOut)
async def get_application(
    application_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[ArtistService, Depends(artist_service)],
) -> ApplicationOut:
    return await _application_with_artist(svc, await svc.get_application(ctx, application_id))


@router.post("/artist-applications/{application_id}/lifecycle", response_model=ApplicationOut)
async def application_lifecycle(
    application_id: UUID,
    body: ApplicationLifecycleIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[ArtistService, Depends(artist_service)],
) -> ApplicationOut:
    row = await svc.transition_application(
        ctx, application_id, action=body.action, expected_version=body.version
    )
    return await _application_with_artist(svc, row)


# --- artist join links (owner, 2026-10-17: one shared link per label, staff still review) -------


class JoinLinkCreate(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    expires_at: datetime | None = None
    max_uses: int | None = Field(default=None, ge=1, le=100_000)


class JoinLinkOut(BaseModel):
    id: UUID
    code: str
    label: str
    status: str
    expires_at: datetime | None
    max_uses: int | None
    uses: int
    usable: bool
    created_at: datetime
    disabled_at: datetime | None


class JoinCodeIn(BaseModel):
    code: str = Field(min_length=1, max_length=64)


class JoinCodeOut(BaseModel):
    organization_name: str


def _join_link_out(svc: ArtistService, row) -> JoinLinkOut:  # type: ignore[no-untyped-def]
    return JoinLinkOut(
        id=row.id, code=row.code, label=row.label, status=row.status, expires_at=row.expires_at,
        max_uses=row.max_uses, uses=row.uses, usable=svc.join_link_usable(row),
        created_at=row.created_at, disabled_at=row.disabled_at,
    )


@router.post("/artist-join-links", response_model=JoinLinkOut, status_code=201)
async def create_join_link(
    body: JoinLinkCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[ArtistService, Depends(artist_service)],
) -> JoinLinkOut:
    row = await svc.create_join_link(ctx, label=body.label, expires_at=body.expires_at, max_uses=body.max_uses)
    return _join_link_out(svc, row)


@router.get("/artist-join-links", response_model=list[JoinLinkOut])
async def list_join_links(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[ArtistService, Depends(artist_service)],
) -> list[JoinLinkOut]:
    return [_join_link_out(svc, r) for r in await svc.list_join_links(ctx)]


@router.post("/artist-join-links/{link_id}/disable", response_model=JoinLinkOut)
async def disable_join_link(
    link_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[ArtistService, Depends(artist_service)],
) -> JoinLinkOut:
    return _join_link_out(svc, await svc.disable_join_link(ctx, link_id))


@router.post("/artist-join-links/check", response_model=JoinCodeOut)
async def check_join_code(
    body: JoinCodeIn,
    svc: Annotated[ArtistService, Depends(artist_service)],
) -> JoinCodeOut:
    """Public, for the artist join page: which label the link joins. The code travels in the body,
    never in a URL that logs could keep."""
    _row, org = await svc.check_join_code(body.code)
    return JoinCodeOut(organization_name=org.name)

