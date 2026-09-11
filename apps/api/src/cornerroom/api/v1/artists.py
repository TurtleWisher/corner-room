"""Artist, application, and follow routes. Thin — rules live in ArtistService."""

from __future__ import annotations

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


def _application_out(row: ArtistApplication) -> ApplicationOut:
    return ApplicationOut(
        id=row.id,
        user_id=row.user_id,
        artist_id=row.artist_id,
        status=row.status,
        payload=row.payload,
        version=row.version,
    )


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
    row, _artist = await svc.submit_application(
        ctx,
        stage_name=body.stage_name,
        legal_name=body.legal_name,
        bio=body.bio,
        extra_metadata=body.metadata,
        payload=body.payload,
    )
    return _application_out(row)


@router.get("/artist-applications", response_model=ApplicationPage)
async def list_applications(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[ArtistService, Depends(artist_service)],
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    mine: bool = False,
) -> ApplicationPage:
    rows, next_cursor = await svc.list_applications(ctx, cursor=cursor, limit=limit, mine=mine)
    return ApplicationPage(items=[_application_out(r) for r in rows], next_cursor=next_cursor)


@router.get("/artist-applications/{application_id}", response_model=ApplicationOut)
async def get_application(
    application_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[ArtistService, Depends(artist_service)],
) -> ApplicationOut:
    return _application_out(await svc.get_application(ctx, application_id))


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
    return _application_out(row)
