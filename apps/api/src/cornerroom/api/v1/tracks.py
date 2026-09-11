"""Track, version, and track-credit routes. Thin — rules live in MusicService."""

from __future__ import annotations

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from cornerroom.api.deps import get_auth_context, get_optional_auth_context, music_service
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.music.application.service import MusicService
from cornerroom.modules.music.domain.models import Credit, Track, TrackVersion

router = APIRouter(tags=["tracks"])


class TrackOut(BaseModel):
    id: UUID
    title: str
    isrc: str | None
    status: str
    primary_artist_id: UUID | None
    primary_band_id: UUID | None
    primary_org_id: UUID | None
    metadata: dict[str, Any] | None
    version: int


class PublicTrackOut(BaseModel):
    id: UUID
    title: str
    status: str
    primary_artist_id: UUID | None
    primary_band_id: UUID | None


class TrackPage(BaseModel):
    items: list[TrackOut]
    next_cursor: str | None


class PublicTrackPage(BaseModel):
    items: list[PublicTrackOut]
    next_cursor: str | None


class TrackCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    isrc: str | None = Field(default=None, max_length=32)
    metadata: dict[str, Any] | None = None
    primary_artist_id: UUID | None = None
    primary_band_id: UUID | None = None
    organization_id: UUID | None = None


class TrackPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    isrc: str | None = Field(default=None, max_length=32)
    metadata: dict[str, Any] | None = None
    primary_artist_id: UUID | None = None
    primary_band_id: UUID | None = None
    version: int | None = Field(default=None, ge=1)


class TrackTransitionIn(BaseModel):
    action: str = Field(
        pattern="^(submit|start_review|approve|reject|schedule|release|takedown|archive)$"
    )
    version: int | None = Field(default=None, ge=1)


class VersionCreate(BaseModel):
    version_type: str = Field(default="MASTER")
    media_asset_id: UUID | None = None
    duration_ms: int | None = Field(default=None, ge=0)


class VersionOut(BaseModel):
    id: UUID
    track_id: UUID
    version_type: str
    media_asset_id: UUID | None
    duration_ms: int | None
    status: str
    is_current: bool
    version: int


class VersionTransitionIn(BaseModel):
    action: str = Field(pattern="^(start_processing|mark_ready|reject|supersede)$")
    version: int | None = Field(default=None, ge=1)


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


def _track_out(row: Track) -> TrackOut:
    return TrackOut(
        id=row.id,
        title=row.title,
        isrc=row.isrc,
        status=row.status,
        primary_artist_id=row.primary_artist_id,
        primary_band_id=row.primary_band_id,
        primary_org_id=row.primary_org_id,
        metadata=row.extra_metadata,
        version=row.version,
    )


def _public_track(row: Track) -> PublicTrackOut:
    return PublicTrackOut(
        id=row.id,
        title=row.title,
        status=row.status,
        primary_artist_id=row.primary_artist_id,
        primary_band_id=row.primary_band_id,
    )


def _version_out(row: TrackVersion) -> VersionOut:
    return VersionOut(
        id=row.id,
        track_id=row.track_id,
        version_type=row.version_type,
        media_asset_id=row.media_asset_id,
        duration_ms=row.duration_ms,
        status=row.status,
        is_current=row.is_current,
        version=row.version,
    )


def _credit_out(row: Credit) -> CreditOut:
    return CreditOut(
        id=row.id,
        track_id=row.track_id,
        release_id=row.release_id,
        artist_id=row.artist_id,
        user_id=row.user_id,
        credit_role=row.credit_role,
    )


@router.get("/tracks")
async def list_tracks(
    svc: Annotated[MusicService, Depends(music_service)],
    ctx: Annotated[AuthContext | None, Depends(get_optional_auth_context)],
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
) -> TrackPage | PublicTrackPage:
    rows, next_cursor, public_only = await svc.list_tracks(ctx, cursor=cursor, limit=limit)
    if public_only:
        return PublicTrackPage(items=[_public_track(r) for r in rows], next_cursor=next_cursor)
    return TrackPage(items=[_track_out(r) for r in rows], next_cursor=next_cursor)


@router.post("/tracks", response_model=TrackOut, status_code=201)
async def create_track(
    body: TrackCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[MusicService, Depends(music_service)],
) -> TrackOut:
    row = await svc.create_track(
        ctx,
        title=body.title,
        isrc=body.isrc,
        extra_metadata=body.metadata,
        primary_artist_id=body.primary_artist_id,
        primary_band_id=body.primary_band_id,
        organization_id=body.organization_id,
    )
    return _track_out(row)


@router.get("/tracks/{track_id}")
async def get_track(
    track_id: UUID,
    svc: Annotated[MusicService, Depends(music_service)],
    ctx: Annotated[AuthContext | None, Depends(get_optional_auth_context)],
) -> TrackOut | PublicTrackOut:
    row, public_view = await svc.get_track(track_id, ctx)
    if public_view:
        return _public_track(row)
    return _track_out(row)


@router.patch("/tracks/{track_id}", response_model=TrackOut)
async def patch_track(
    track_id: UUID,
    body: TrackPatch,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[MusicService, Depends(music_service)],
) -> TrackOut:
    payload: dict[str, Any] = {}
    if body.title is not None:
        payload["title"] = body.title
    if "isrc" in body.model_fields_set:
        payload["isrc"] = body.isrc
    if "metadata" in body.model_fields_set:
        payload["extra_metadata"] = body.metadata
    if "primary_artist_id" in body.model_fields_set:
        payload["primary_artist_id"] = body.primary_artist_id
    if "primary_band_id" in body.model_fields_set:
        payload["primary_band_id"] = body.primary_band_id
    row = await svc.update_track(ctx, track_id, expected_version=body.version, **payload)
    return _track_out(row)


@router.post("/tracks/{track_id}/transition", response_model=TrackOut)
async def track_transition(
    track_id: UUID,
    body: TrackTransitionIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[MusicService, Depends(music_service)],
) -> TrackOut:
    row = await svc.transition_track(
        ctx, track_id, action=body.action, expected_version=body.version
    )
    return _track_out(row)


@router.post("/tracks/{track_id}/versions", response_model=VersionOut, status_code=201)
async def create_version(
    track_id: UUID,
    body: VersionCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[MusicService, Depends(music_service)],
) -> VersionOut:
    row = await svc.create_version(
        ctx,
        track_id,
        version_type=body.version_type,
        media_asset_id=body.media_asset_id,
        duration_ms=body.duration_ms,
    )
    return _version_out(row)


@router.get("/tracks/{track_id}/versions")
async def list_versions(
    track_id: UUID,
    svc: Annotated[MusicService, Depends(music_service)],
    ctx: Annotated[AuthContext | None, Depends(get_optional_auth_context)],
) -> dict[str, list[VersionOut]]:
    await svc.get_track(track_id, ctx)
    rows = await svc.list_versions(track_id)
    return {"items": [_version_out(r) for r in rows]}


@router.post("/tracks/{track_id}/versions/{version_id}/transition", response_model=VersionOut)
async def version_transition(
    track_id: UUID,
    version_id: UUID,
    body: VersionTransitionIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[MusicService, Depends(music_service)],
) -> VersionOut:
    row = await svc.transition_version(
        ctx,
        track_id,
        version_id,
        action=body.action,
        expected_version=body.version,
    )
    return _version_out(row)


@router.post("/tracks/{track_id}/credits", response_model=CreditOut, status_code=201)
async def add_track_credit(
    track_id: UUID,
    body: CreditCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[MusicService, Depends(music_service)],
) -> CreditOut:
    row = await svc.add_credit(
        ctx,
        track_id=track_id,
        artist_id=body.artist_id,
        user_id=body.user_id,
        credit_role=body.credit_role,
    )
    return _credit_out(row)


@router.get("/tracks/{track_id}/credits")
async def list_track_credits(
    track_id: UUID,
    svc: Annotated[MusicService, Depends(music_service)],
    ctx: Annotated[AuthContext | None, Depends(get_optional_auth_context)],
) -> dict[str, list[CreditOut]]:
    await svc.get_track(track_id, ctx)
    rows = await svc.list_credits(track_id=track_id)
    return {"items": [_credit_out(r) for r in rows]}
