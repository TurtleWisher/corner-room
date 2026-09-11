"""Playback, library, playlist, and artist play-aggregate routes. Thin — rules live in StreamingService."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID
import json

from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from cornerroom.api.deps import get_auth_context, get_optional_auth_context, streaming_service
from cornerroom.infra.idempotency import (
    IdempotencyReplay,
    begin_idempotent,
    complete_idempotent,
    compose_idempotency_key,
    fail_idempotent,
    fingerprint_payload,
)
from cornerroom.infra.settings import Settings, get_settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.streaming.application.service import StreamingService
from cornerroom.modules.streaming.domain.models import (
    LibraryItem,
    ListeningSession,
    PlaybackEvent,
    Playlist,
    PlaylistItem,
)
from cornerroom.modules.streaming.domain.playability import Playability

router = APIRouter(tags=["streaming"])


class ListeningSessionOut(BaseModel):
    id: UUID
    user_id: UUID
    device: str | None
    started_at: datetime
    ended_at: datetime | None
    status: str
    version: int
    catalog_playable: bool | None = None
    audio_deliverable: bool | None = None
    entitled: bool | None = None
    availability_reason: str | None = None
    track_id: UUID | None = None
    track_version_id: UUID | None = None


class SessionCreate(BaseModel):
    track_id: UUID
    device: str | None = Field(default=None, max_length=120)
    release_id: UUID | None = None
    track_version_id: UUID | None = None


class SessionClose(BaseModel):
    version: int | None = Field(default=None, ge=1)


class PlaybackEventIn(BaseModel):
    client_event_id: str = Field(min_length=1, max_length=128)
    track_id: UUID
    session_id: UUID
    duration_ms: int = Field(ge=0)
    completed: bool = False
    started_at: datetime | None = None
    region: str | None = Field(default=None, max_length=64)
    track_version_id: UUID | None = None
    release_id: UUID | None = None


class PlaybackEventBatchIn(BaseModel):
    events: list[PlaybackEventIn] = Field(min_length=1, max_length=100)


class PlaybackEventOut(BaseModel):
    id: UUID
    client_event_id: str
    user_id: UUID
    track_id: UUID
    track_version_id: UUID
    session_id: UUID
    started_at: datetime
    duration_ms: int
    completed: bool
    region: str | None
    eligible_hint: bool | None
    replayed: bool = False


class AvailabilityOut(BaseModel):
    track_id: UUID | None
    track_version_id: UUID | None
    media_asset_id: UUID | None
    catalog_playable: bool
    audio_deliverable: bool
    entitled: bool = False
    reason: str | None
    duration_ms: int | None
    eligibility: str = "not_computed"


class AudioOut(BaseModel):
    url: str
    expires_at: datetime
    track_id: UUID
    track_version_id: UUID
    media_asset_id: UUID


class PlayableTrackOut(BaseModel):
    id: UUID
    title: str
    status: str
    primary_artist_id: UUID | None
    primary_band_id: UUID | None
    catalog_playable: bool
    audio_deliverable: bool
    track_version_id: UUID | None
    duration_ms: int | None
    reason: str | None


class PlayableTrackPage(BaseModel):
    items: list[PlayableTrackOut]
    next_cursor: str | None


class ReleasePlayabilityOut(BaseModel):
    release_id: UUID
    track_id: UUID
    position: int
    catalog_playable: bool
    audio_deliverable: bool
    reason: str | None
    track_version_id: UUID | None


class LibraryIn(BaseModel):
    item_type: str = Field(pattern="^(track|release|artist|playlist)$")
    item_id: UUID
    kind: str = Field(pattern="^(LIKE|SAVE)$")


class LibraryOut(BaseModel):
    id: UUID
    user_id: UUID
    item_type: str
    item_id: UUID
    kind: str
    created_at: datetime


class LibraryPage(BaseModel):
    items: list[LibraryOut]
    next_cursor: str | None


class PlaylistCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    kind: str = Field(default="USER", pattern="^(USER|EDITORIAL)$")


class PlaylistOut(BaseModel):
    id: UUID
    owner_user_id: UUID | None
    kind: str
    status: str
    title: str
    version: int


class PlaylistPage(BaseModel):
    items: list[PlaylistOut]
    next_cursor: str | None


class PlaylistTransitionIn(BaseModel):
    action: str = Field(pattern="^(publish|archive)$")
    version: int | None = Field(default=None, ge=1)


class PlaylistItemIn(BaseModel):
    track_id: UUID
    position: int = Field(ge=1)


class PlaylistItemOut(BaseModel):
    playlist_id: UUID
    track_id: UUID
    position: int


class HistoryPage(BaseModel):
    items: list[PlaybackEventOut]
    next_cursor: str | None


class TrackAggregateOut(BaseModel):
    track_id: UUID
    title: str
    play_count: int
    unique_listener_count: int
    total_duration_ms: int
    completed_count: int
    skip_count: int


class ArtistPlayAggregatesOut(BaseModel):
    artist_id: UUID
    label: str
    eligibility: str
    tracks: list[TrackAggregateOut]


def _session_out(row: ListeningSession, playability: Playability | None = None) -> ListeningSessionOut:
    return ListeningSessionOut(
        id=row.id,
        user_id=row.user_id,
        device=row.device,
        started_at=row.started_at,
        ended_at=row.ended_at,
        status=row.status,
        version=row.version,
        catalog_playable=None if playability is None else playability.catalog_playable,
        audio_deliverable=None if playability is None else playability.audio_deliverable,
        entitled=True if playability is not None else None,
        availability_reason=None if playability is None else playability.reason,
        track_id=None if playability is None else playability.track_id,
        track_version_id=None if playability is None else playability.track_version_id,
    )


def _event_out(row: PlaybackEvent, replayed: bool = False) -> PlaybackEventOut:
    return PlaybackEventOut(
        id=row.id,
        client_event_id=row.client_event_id,
        user_id=row.user_id,
        track_id=row.track_id,
        track_version_id=row.track_version_id,
        session_id=row.session_id,
        started_at=row.started_at,
        duration_ms=row.duration_ms,
        completed=row.completed,
        region=row.region,
        eligible_hint=row.eligible_hint,
        replayed=replayed,
    )


def _availability_out(row: Playability, *, entitled: bool) -> AvailabilityOut:
    return AvailabilityOut(
        track_id=row.track_id,
        track_version_id=row.track_version_id,
        media_asset_id=row.media_asset_id,
        catalog_playable=row.catalog_playable,
        audio_deliverable=row.audio_deliverable,
        entitled=entitled,
        reason=row.reason,
        duration_ms=row.duration_ms,
    )


def _library_out(row: LibraryItem) -> LibraryOut:
    return LibraryOut(
        id=row.id,
        user_id=row.user_id,
        item_type=row.item_type,
        item_id=row.item_id,
        kind=row.kind,
        created_at=row.created_at,
    )


def _playlist_out(row: Playlist) -> PlaylistOut:
    return PlaylistOut(
        id=row.id,
        owner_user_id=row.owner_user_id,
        kind=row.kind,
        status=row.status,
        title=row.title,
        version=row.version,
    )


def _item_out(row: PlaylistItem) -> PlaylistItemOut:
    return PlaylistItemOut(playlist_id=row.playlist_id, track_id=row.track_id, position=row.position)


@router.post("/playback/sessions", status_code=201)
async def open_session(
    body: SessionCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[StreamingService, Depends(streaming_service)],
) -> ListeningSessionOut:
    row, playability = await svc.open_session(
        ctx,
        track_id=body.track_id,
        device=body.device,
        release_id=body.release_id,
        track_version_id=body.track_version_id,
    )
    return _session_out(row, playability)


@router.get("/playback/sessions/{session_id}")
async def get_session(
    session_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[StreamingService, Depends(streaming_service)],
) -> ListeningSessionOut:
    return _session_out(await svc.get_session(ctx, session_id))


@router.post("/playback/sessions/{session_id}/close")
async def close_session(
    session_id: UUID,
    body: SessionClose,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[StreamingService, Depends(streaming_service)],
) -> ListeningSessionOut:
    return _session_out(await svc.close_session(ctx, session_id, expected_version=body.version))


@router.post("/playback/events", status_code=201, response_model=None)
async def ingest_event(
    body: PlaybackEventIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[StreamingService, Depends(streaming_service)],
    settings: Annotated[Settings, Depends(get_settings)],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> PlaybackEventOut | JSONResponse:
    async def _run() -> tuple[PlaybackEvent, bool]:
        return await svc.ingest_event(
            ctx,
            client_event_id=body.client_event_id,
            track_id=body.track_id,
            session_id=body.session_id,
            duration_ms=body.duration_ms,
            completed=body.completed,
            started_at=body.started_at,
            region=body.region,
            track_version_id=body.track_version_id,
            release_id=body.release_id,
        )

    if idempotency_key:
        key = compose_idempotency_key("playback", f"{ctx.user_id}:{idempotency_key}")
        begun = await begin_idempotent(
            svc.session,
            key=key,
            request_hash=fingerprint_payload(body.model_dump(mode="json")),
            ttl_seconds=settings.idempotency_ttl_seconds,
        )
        if isinstance(begun, IdempotencyReplay):
            payload = json.loads(begun.body) if begun.body else {}
            return JSONResponse(status_code=begun.status_code, content=payload)
        try:
            row, created = await _run()
            out = _event_out(row, replayed=not created)
            await complete_idempotent(
                svc.session, begun, status_code=201, body=json.dumps(out.model_dump(mode="json"))
            )
            return out
        except Exception:
            await fail_idempotent(svc.session, begun)
            raise
    row, created = await _run()
    return _event_out(row, replayed=not created)


@router.post("/playback/events:batch", status_code=201)
async def ingest_event_batch(
    body: PlaybackEventBatchIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[StreamingService, Depends(streaming_service)],
) -> list[PlaybackEventOut]:
    results = await svc.ingest_batch(
        ctx,
        [item.model_dump() for item in body.events],
    )
    return [_event_out(row, replayed=not created) for row, created in results]


@router.get("/playback/tracks/{track_id}/availability")
async def track_availability(
    track_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[StreamingService, Depends(streaming_service)],
    release_id: UUID | None = Query(default=None),
    track_version_id: UUID | None = Query(default=None),
) -> AvailabilityOut:
    playability = await svc.availability(ctx, track_id, release_id=release_id, track_version_id=track_version_id)
    entitled = await svc.entitlements.has_catalog_access(ctx.user_id, track_id)
    return _availability_out(playability, entitled=entitled)


@router.get("/playback/tracks/{track_id}/audio")
async def track_audio(
    track_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[StreamingService, Depends(streaming_service)],
    release_id: UUID | None = Query(default=None),
    track_version_id: UUID | None = Query(default=None),
) -> AudioOut:
    minted = await svc.mint_audio(
        ctx, track_id, release_id=release_id, track_version_id=track_version_id
    )
    return AudioOut(
        url=minted.url,
        expires_at=minted.expires_at,
        track_id=minted.track_id,
        track_version_id=minted.track_version_id,
        media_asset_id=minted.media_asset_id,
    )


@router.get("/playback/media/{token:path}")
async def playback_media(
    token: str,
    svc: Annotated[StreamingService, Depends(streaming_service)],
) -> Response:
    data, mime = await svc.load_media_bytes(token)
    return Response(content=data, media_type=mime or "application/octet-stream")


@router.get("/playback/catalog")
async def playable_catalog(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[StreamingService, Depends(streaming_service)],
    limit: int | None = Query(default=None),
    cursor: str | None = Query(default=None),
) -> PlayableTrackPage:
    rows, next_cursor = await svc.list_playable_tracks(ctx, limit=limit, cursor=cursor)
    return PlayableTrackPage(
        items=[
            PlayableTrackOut(
                id=track.id,
                title=track.title,
                status=track.status,
                primary_artist_id=track.primary_artist_id,
                primary_band_id=track.primary_band_id,
                catalog_playable=playability.catalog_playable,
                audio_deliverable=playability.audio_deliverable,
                track_version_id=playability.track_version_id,
                duration_ms=playability.duration_ms,
                reason=playability.reason,
            )
            for track, playability in rows
        ],
        next_cursor=next_cursor,
    )


@router.get("/playback/releases/{release_id}/tracks")
async def release_playability(
    release_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[StreamingService, Depends(streaming_service)],
) -> list[ReleasePlayabilityOut]:
    rows = await svc.release_track_playability(ctx, release_id)
    return [
        ReleasePlayabilityOut(
            release_id=item.release_id,
            track_id=item.track_id,
            position=item.position,
            catalog_playable=playability.catalog_playable,
            audio_deliverable=playability.audio_deliverable,
            reason=playability.reason,
            track_version_id=playability.track_version_id,
        )
        for item, playability in rows
    ]


@router.get("/me/library")
async def list_library(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[StreamingService, Depends(streaming_service)],
    limit: int | None = Query(default=None),
    cursor: str | None = Query(default=None),
) -> LibraryPage:
    rows, next_cursor = await svc.list_library(ctx, limit=limit, cursor=cursor)
    return LibraryPage(items=[_library_out(row) for row in rows], next_cursor=next_cursor)


@router.post("/me/library", status_code=201)
async def add_library(
    body: LibraryIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[StreamingService, Depends(streaming_service)],
) -> LibraryOut:
    return _library_out(
        await svc.add_library_item(ctx, item_type=body.item_type, item_id=body.item_id, kind=body.kind)
    )


@router.delete("/me/library/{item_id}", status_code=204)
async def delete_library(
    item_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[StreamingService, Depends(streaming_service)],
) -> None:
    await svc.delete_library_item(ctx, item_id)


@router.get("/me/listening-history")
async def listening_history(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[StreamingService, Depends(streaming_service)],
    limit: int | None = Query(default=None),
    cursor: str | None = Query(default=None),
) -> HistoryPage:
    rows, next_cursor = await svc.listening_history(ctx, limit=limit, cursor=cursor)
    return HistoryPage(items=[_event_out(row) for row in rows], next_cursor=next_cursor)


@router.get("/playlists")
async def list_playlists(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[StreamingService, Depends(streaming_service)],
    limit: int | None = Query(default=None),
    cursor: str | None = Query(default=None),
) -> PlaylistPage:
    rows, next_cursor = await svc.list_playlists(ctx, limit=limit, cursor=cursor)
    return PlaylistPage(items=[_playlist_out(row) for row in rows], next_cursor=next_cursor)


@router.post("/playlists", status_code=201)
async def create_playlist(
    body: PlaylistCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[StreamingService, Depends(streaming_service)],
) -> PlaylistOut:
    return _playlist_out(await svc.create_playlist(ctx, title=body.title, kind=body.kind))


@router.get("/playlists/{playlist_id}")
async def get_playlist(
    playlist_id: UUID,
    ctx: Annotated[AuthContext | None, Depends(get_optional_auth_context)],
    svc: Annotated[StreamingService, Depends(streaming_service)],
) -> PlaylistOut:
    return _playlist_out(await svc.get_playlist(ctx, playlist_id))


@router.post("/playlists/{playlist_id}/transition")
async def transition_playlist(
    playlist_id: UUID,
    body: PlaylistTransitionIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[StreamingService, Depends(streaming_service)],
) -> PlaylistOut:
    return _playlist_out(
        await svc.transition_playlist(
            ctx, playlist_id, action=body.action, expected_version=body.version
        )
    )


@router.get("/playlists/{playlist_id}/items")
async def list_playlist_items(
    playlist_id: UUID,
    ctx: Annotated[AuthContext | None, Depends(get_optional_auth_context)],
    svc: Annotated[StreamingService, Depends(streaming_service)],
) -> list[PlaylistItemOut]:
    return [_item_out(row) for row in await svc.list_playlist_items(ctx, playlist_id)]


@router.post("/playlists/{playlist_id}/items", status_code=201)
async def add_playlist_item(
    playlist_id: UUID,
    body: PlaylistItemIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[StreamingService, Depends(streaming_service)],
) -> PlaylistItemOut:
    return _item_out(
        await svc.add_playlist_item(ctx, playlist_id, track_id=body.track_id, position=body.position)
    )


@router.delete("/playlists/{playlist_id}/items/{track_id}", status_code=204)
async def delete_playlist_item(
    playlist_id: UUID,
    track_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[StreamingService, Depends(streaming_service)],
) -> None:
    await svc.delete_playlist_item(ctx, playlist_id, track_id)


@router.get("/artists/{artist_id}/play-aggregates")
async def artist_play_aggregates(
    artist_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[StreamingService, Depends(streaming_service)],
) -> ArtistPlayAggregatesOut:
    body = await svc.artist_play_aggregates(ctx, artist_id)
    return ArtistPlayAggregatesOut(
        artist_id=body["artist_id"],
        label=body["label"],
        eligibility=body["eligibility"],
        tracks=[TrackAggregateOut(**row) for row in body["tracks"]],
    )
