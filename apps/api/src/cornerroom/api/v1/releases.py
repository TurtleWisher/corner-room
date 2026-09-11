"""Release, release-track, and release-credit routes. Thin — rules live in MusicService."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from cornerroom.api.deps import get_auth_context, get_optional_auth_context, music_service
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.music.application.service import MusicService
from cornerroom.modules.music.domain.models import Credit, Release, ReleaseTrack

router = APIRouter(tags=["releases"])


class ReleaseOut(BaseModel):
    id: UUID
    title: str
    release_type: str
    status: str
    primary_artist_id: UUID | None
    primary_band_id: UUID | None
    primary_org_id: UUID | None
    cover_asset_id: UUID | None
    release_at: datetime | None
    metadata: dict[str, Any] | None
    version: int


class PublicReleaseOut(BaseModel):
    id: UUID
    title: str
    release_type: str
    status: str
    primary_artist_id: UUID | None
    primary_band_id: UUID | None
    cover_asset_id: UUID | None
    release_at: datetime | None


class ReleasePage(BaseModel):
    items: list[ReleaseOut]
    next_cursor: str | None


class PublicReleasePage(BaseModel):
    items: list[PublicReleaseOut]
    next_cursor: str | None


class ReleaseCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    release_type: str = Field(default="SINGLE")
    metadata: dict[str, Any] | None = None
    primary_artist_id: UUID | None = None
    primary_band_id: UUID | None = None
    cover_asset_id: UUID | None = None
    release_at: datetime | None = None
    organization_id: UUID | None = None


class ReleasePatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    release_type: str | None = None
    metadata: dict[str, Any] | None = None
    primary_artist_id: UUID | None = None
    primary_band_id: UUID | None = None
    cover_asset_id: UUID | None = None
    release_at: datetime | None = None
    version: int | None = Field(default=None, ge=1)


class ReleaseTransitionIn(BaseModel):
    action: str = Field(
        pattern="^(start_demo|start_production|start_qc|start_metadata_review|"
        "approve|schedule|release|takedown|archive)$"
    )
    version: int | None = Field(default=None, ge=1)
    release_at: datetime | None = None


class ReleaseTrackIn(BaseModel):
    track_id: UUID
    position: int = Field(ge=1)


class ReleaseTrackOut(BaseModel):
    release_id: UUID
    track_id: UUID
    position: int


class CreditCreate(BaseModel):
    artist_id: UUID | None = None
    user_id: UUID | None = None
    credit_role: str = Field(min_length=1, max_length=80)


class CreditOut(BaseModel):
    id: UUID
    track_id: UUID | None
    release_id: UUID | None
    artist_id: UUID | None
    user_id: UUID | None
    credit_role: str


def _release_out(row: Release) -> ReleaseOut:
    return ReleaseOut(
        id=row.id,
        title=row.title,
        release_type=row.release_type,
        status=row.status,
        primary_artist_id=row.primary_artist_id,
        primary_band_id=row.primary_band_id,
        primary_org_id=row.primary_org_id,
        cover_asset_id=row.cover_asset_id,
        release_at=row.release_at,
        metadata=row.extra_metadata,
        version=row.version,
    )


def _public_release(row: Release) -> PublicReleaseOut:
    return PublicReleaseOut(
        id=row.id,
        title=row.title,
        release_type=row.release_type,
        status=row.status,
        primary_artist_id=row.primary_artist_id,
        primary_band_id=row.primary_band_id,
        cover_asset_id=row.cover_asset_id,
        release_at=row.release_at,
    )


def _release_track_out(row: ReleaseTrack) -> ReleaseTrackOut:
    return ReleaseTrackOut(release_id=row.release_id, track_id=row.track_id, position=row.position)


def _credit_out(row: Credit) -> CreditOut:
    return CreditOut(
        id=row.id,
        track_id=row.track_id,
        release_id=row.release_id,
        artist_id=row.artist_id,
        user_id=row.user_id,
        credit_role=row.credit_role,
    )


@router.get("/releases")
async def list_releases(
    svc: Annotated[MusicService, Depends(music_service)],
    ctx: Annotated[AuthContext | None, Depends(get_optional_auth_context)],
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
) -> ReleasePage | PublicReleasePage:
    rows, next_cursor, public_only = await svc.list_releases(ctx, cursor=cursor, limit=limit)
    if public_only:
        return PublicReleasePage(items=[_public_release(r) for r in rows], next_cursor=next_cursor)
    return ReleasePage(items=[_release_out(r) for r in rows], next_cursor=next_cursor)


@router.post("/releases", response_model=ReleaseOut, status_code=201)
async def create_release(
    body: ReleaseCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[MusicService, Depends(music_service)],
) -> ReleaseOut:
    row = await svc.create_release(
        ctx,
        title=body.title,
        release_type=body.release_type,
        extra_metadata=body.metadata,
        primary_artist_id=body.primary_artist_id,
        primary_band_id=body.primary_band_id,
        cover_asset_id=body.cover_asset_id,
        release_at=body.release_at,
        organization_id=body.organization_id,
    )
    return _release_out(row)


@router.get("/releases/{release_id}")
async def get_release(
    release_id: UUID,
    svc: Annotated[MusicService, Depends(music_service)],
    ctx: Annotated[AuthContext | None, Depends(get_optional_auth_context)],
) -> ReleaseOut | PublicReleaseOut:
    row, public_view = await svc.get_release(release_id, ctx)
    if public_view:
        return _public_release(row)
    return _release_out(row)


@router.patch("/releases/{release_id}", response_model=ReleaseOut)
async def patch_release(
    release_id: UUID,
    body: ReleasePatch,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[MusicService, Depends(music_service)],
) -> ReleaseOut:
    payload: dict[str, Any] = {}
    if body.title is not None:
        payload["title"] = body.title
    if body.release_type is not None:
        payload["release_type"] = body.release_type
    if "metadata" in body.model_fields_set:
        payload["extra_metadata"] = body.metadata
    if "primary_artist_id" in body.model_fields_set:
        payload["primary_artist_id"] = body.primary_artist_id
    if "primary_band_id" in body.model_fields_set:
        payload["primary_band_id"] = body.primary_band_id
    if "cover_asset_id" in body.model_fields_set:
        payload["cover_asset_id"] = body.cover_asset_id
    if "release_at" in body.model_fields_set:
        payload["release_at"] = body.release_at
    row = await svc.update_release(ctx, release_id, expected_version=body.version, **payload)
    return _release_out(row)


@router.post("/releases/{release_id}/transition", response_model=ReleaseOut)
async def release_transition(
    release_id: UUID,
    body: ReleaseTransitionIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[MusicService, Depends(music_service)],
) -> ReleaseOut:
    row = await svc.transition_release(
        ctx,
        release_id,
        action=body.action,
        expected_version=body.version,
        release_at=body.release_at,
    )
    return _release_out(row)


@router.post("/releases/{release_id}/tracks", response_model=ReleaseTrackOut, status_code=201)
async def add_release_track(
    release_id: UUID,
    body: ReleaseTrackIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[MusicService, Depends(music_service)],
) -> ReleaseTrackOut:
    row = await svc.add_release_track(
        ctx, release_id, track_id=body.track_id, position=body.position
    )
    return _release_track_out(row)


@router.get("/releases/{release_id}/tracks")
async def list_release_tracks(
    release_id: UUID,
    svc: Annotated[MusicService, Depends(music_service)],
    ctx: Annotated[AuthContext | None, Depends(get_optional_auth_context)],
) -> dict[str, list[ReleaseTrackOut]]:
    await svc.get_release(release_id, ctx)
    rows = await svc.list_release_tracks(release_id)
    return {"items": [_release_track_out(r) for r in rows]}


@router.delete("/releases/{release_id}/tracks/{track_id}", status_code=204)
async def remove_release_track(
    release_id: UUID,
    track_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[MusicService, Depends(music_service)],
) -> None:
    await svc.remove_release_track(ctx, release_id, track_id)


@router.post("/releases/{release_id}/credits", response_model=CreditOut, status_code=201)
async def add_release_credit(
    release_id: UUID,
    body: CreditCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[MusicService, Depends(music_service)],
) -> CreditOut:
    row = await svc.add_credit(
        ctx,
        release_id=release_id,
        artist_id=body.artist_id,
        user_id=body.user_id,
        credit_role=body.credit_role,
    )
    return _credit_out(row)


@router.get("/releases/{release_id}/credits")
async def list_release_credits(
    release_id: UUID,
    svc: Annotated[MusicService, Depends(music_service)],
    ctx: Annotated[AuthContext | None, Depends(get_optional_auth_context)],
) -> dict[str, list[CreditOut]]:
    await svc.get_release(release_id, ctx)
    rows = await svc.list_credits(release_id=release_id)
    return {"items": [_credit_out(r) for r in rows]}
