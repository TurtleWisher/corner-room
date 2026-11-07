"""Teasers (owner, 2026-11-07, D-TEASER-00 to D-TEASER-04): the Teaser Studio, staff review, and
the free teaser anyone can hear as often as they like (music/application/teasers.py).

Teaser audio and song audio never share a route: song bytes come only from /playback/media (behind
entitlement checks), teaser bytes only from /teasers/media, and the artist's editing audio only from
/studio/audio (the song's playback copy, never the master)."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.api.deps import db_session, get_auth_context, get_optional_auth_context, settings_dep
from cornerroom.infra.http_range import RangeNotSatisfiable, parse_byte_range
from cornerroom.infra.settings import Settings
from cornerroom.infra.review_policy import approve_at_once
from cornerroom.infra.storage import get_storage
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.music.application.teasers import MintedAudio, TeaserService
from cornerroom.modules.music.domain import teasers as rules

router = APIRouter(tags=["teasers"])


async def teaser_service(
    session: Annotated[AsyncSession, Depends(db_session)],
    settings: Annotated[Settings, Depends(settings_dep)],
) -> TeaserService:
    return TeaserService(session, settings)


Svc = Annotated[TeaserService, Depends(teaser_service)]
Ctx = Annotated[AuthContext, Depends(get_auth_context)]
MaybeCtx = Annotated[AuthContext | None, Depends(get_optional_auth_context)]
Accept = Annotated[str | None, Query(max_length=64, description="Codecs the browser can play, best first: opus,mp3")]


# --- shapes ------------------------------------------------------------------------------------


class CreateIn(BaseModel):
    title: str | None = Field(default=None, max_length=120)


class RenameIn(BaseModel):
    title: str | None = Field(default=None, max_length=120)


class DraftIn(BaseModel):
    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=1)
    fade_in_ms: int = Field(default=0, ge=0)
    fade_out_ms: int = Field(default=0, ge=0)
    gain_cdb: int = Field(default=0)


class TransitionIn(BaseModel):
    action: Literal["submit", "withdraw", "unpublish", "republish"]


class ReviewIn(BaseModel):
    action: Literal["approve", "return", "unpublish"]
    note: str | None = Field(default=None, max_length=2000)


class CountIn(BaseModel):
    kind: Literal["start", "complete", "prompt_click", "START", "COMPLETE", "PROMPT_CLICK"]


class AlternateOut(BaseModel):
    codec: str
    url: str


class AudioOut(BaseModel):
    url: str
    expires_at: datetime
    codec: str | None
    alternates: list[AlternateOut]
    duration_ms: int | None
    gain_db: float | None = None


class VersionOut(BaseModel):
    id: UUID
    number: int
    start_ms: int
    end_ms: int
    fade_in_ms: int
    fade_out_ms: int
    gain_cdb: int
    status: str
    failure_code: str | None
    duration_ms: int | None
    review_status: str | None
    review_note: str | None
    submitted_at: datetime | None
    published_at: datetime | None
    retired_at: datetime | None
    is_live: bool
    created_at: datetime


class MasterOut(BaseModel):
    version_id: UUID | None
    status: str | None
    duration_ms: int | None
    processing_detail: str | None


class LimitsOut(BaseModel):
    min_ms: int
    max_ms: int
    fade_max_ms: int
    gain_min_cdb: int
    gain_max_cdb: int


class CountsOut(BaseModel):
    starts: int
    completes: int
    prompt_clicks: int


class TeaserDetailOut(BaseModel):
    id: UUID
    title: str | None
    status: str
    track_id: UUID
    track_title: str
    track_status: str
    release_id: UUID
    release_title: str
    published_at: datetime | None
    master: MasterOut
    versions: list[VersionOut]
    latest_version_id: UUID | None
    actions: list[str]
    limits: LimitsOut
    counts: CountsOut


class TeaserRowOut(BaseModel):
    id: UUID
    title: str | None
    status: str
    live_duration_ms: int | None
    latest_status: str | None
    latest_review_status: str | None
    latest_review_note: str | None
    counts: CountsOut


class SongOut(BaseModel):
    track_id: UUID
    title: str
    track_status: str
    master_status: str | None
    master_duration_ms: int | None
    teasers: list[TeaserRowOut]


class ReleaseTeasersOut(BaseModel):
    release_id: UUID
    release_title: str
    release_status: str
    songs: list[SongOut]


class WaveformOut(BaseModel):
    status: str
    track_version_id: UUID
    points: list[int]
    bucket_ms: int
    duration_ms: int | None


class QueueItemOut(BaseModel):
    teaser_id: UUID
    version_id: UUID
    number: int
    title: str | None
    track_id: UUID
    track_title: str
    track_status: str
    profile_name: str | None
    start_ms: int
    end_ms: int
    duration_ms: int | None
    submitted_at: datetime | None
    replaces_live: bool


class ReviewOut(BaseModel):
    teaser_id: UUID
    status: str


class NextStepOut(BaseModel):
    # OWNED: the listener has the song. BUY / BUY_RELEASE: a live price exists. PREBOOK: a pre-sale
    # is open. NONE: nothing to offer (no invented offer).
    kind: str
    track_id: UUID
    release_id: UUID


class TeaserSummaryOut(BaseModel):
    id: UUID
    title: str | None
    duration_ms: int | None


class PublicTeaserOut(BaseModel):
    id: UUID
    title: str | None
    track_id: UUID
    track_title: str
    track_released: bool
    release_id: UUID
    release_title: str
    release_at: datetime | None
    artist: str | None
    artist_kind: str | None
    artist_id: UUID | None
    cover_url: str | None
    duration_ms: int | None
    published_at: datetime | None
    next_step: NextStepOut
    other_teasers: list[TeaserSummaryOut]


class TrackTeasersOut(BaseModel):
    items: list[TeaserSummaryOut]


class ReleaseTeaserOut(TeaserSummaryOut):
    track_id: UUID
    track_title: str


class ReleaseTeaserListOut(BaseModel):
    items: list[ReleaseTeaserOut]


class TeaserMapIn(BaseModel):
    track_ids: list[UUID] = Field(max_length=200)


class TeaserMapOut(BaseModel):
    # track id -> its newest published teaser, for rows of songs a listener can't play.
    teasers: dict[str, UUID]


def _audio(m: MintedAudio) -> AudioOut:
    return AudioOut(
        url=m.url, expires_at=m.expires_at, codec=m.codec,
        alternates=[AlternateOut(codec=c, url=u) for c, u in m.alternates],
        duration_ms=m.duration_ms, gain_db=m.gain_db,
    )


def _accept(value: str | None) -> list[str] | None:
    return value.split(",") if value else None


async def _ranged(asset: Any, settings: Settings, range_header: str | None) -> Response:
    storage = get_storage(settings)
    size = await storage.stat(asset.object_key)
    if size is None:
        return JSONResponse(status_code=409, content={"code": "AUDIO_NOT_READY", "title": "Audio is not available"})
    headers = {"Accept-Ranges": "bytes", "Cache-Control": "private, no-store"}
    try:
        span = parse_byte_range(range_header, size)
    except RangeNotSatisfiable:
        return Response(status_code=416, headers={**headers, "Content-Range": f"bytes */{size}"})
    start, end = (0, size - 1) if span is None else span
    return StreamingResponse(
        storage.read_range(asset.object_key, start, end),
        status_code=200 if span is None else 206,
        media_type=asset.mime or "application/octet-stream",
        headers={
            **headers,
            "Content-Length": str(end - start + 1),
            **({} if span is None else {"Content-Range": f"bytes {start}-{end}/{size}"}),
        },
    )


# --- Studio ------------------------------------------------------------------------------------


@router.get("/studio/releases/{release_id}/teasers", response_model=ReleaseTeasersOut)
async def release_teasers(release_id: UUID, ctx: Ctx, svc: Svc) -> ReleaseTeasersOut:
    return ReleaseTeasersOut(**await svc.release_overview(ctx, release_id))


@router.post("/studio/tracks/{track_id}/teasers", response_model=TeaserDetailOut, status_code=201)
async def create_teaser(track_id: UUID, body: CreateIn, ctx: Ctx, svc: Svc) -> TeaserDetailOut:
    return TeaserDetailOut(**await svc.create(ctx, track_id, body.title))


@router.get("/studio/teasers/{teaser_id}", response_model=TeaserDetailOut)
async def get_teaser(teaser_id: UUID, ctx: Ctx, svc: Svc) -> TeaserDetailOut:
    return TeaserDetailOut(**await svc.detail(ctx, teaser_id))


@router.patch("/studio/teasers/{teaser_id}", response_model=TeaserDetailOut)
async def rename_teaser(teaser_id: UUID, body: RenameIn, ctx: Ctx, svc: Svc) -> TeaserDetailOut:
    return TeaserDetailOut(**await svc.rename(ctx, teaser_id, body.title))


@router.put("/studio/teasers/{teaser_id}/draft", response_model=TeaserDetailOut)
async def save_draft(teaser_id: UUID, body: DraftIn, ctx: Ctx, svc: Svc) -> TeaserDetailOut:
    settings = rules.Settings(body.start_ms, body.end_ms, body.fade_in_ms, body.fade_out_ms, body.gain_cdb)
    return TeaserDetailOut(**await svc.save_draft(ctx, teaser_id, settings))


@router.post("/studio/teasers/{teaser_id}/process", response_model=TeaserDetailOut)
async def process_teaser(teaser_id: UUID, ctx: Ctx, svc: Svc) -> TeaserDetailOut:
    return TeaserDetailOut(**await svc.process(ctx, teaser_id))


@router.post("/studio/teasers/{teaser_id}/transition", response_model=TeaserDetailOut)
async def transition_teaser(teaser_id: UUID, body: TransitionIn, ctx: Ctx, svc: Svc) -> TeaserDetailOut:
    out = await svc.transition(ctx, teaser_id, body.action)
    # A teaser sent for review is approved at once when the sender may approve it (D-REVIEW-SOLO-01).
    if body.action == "submit" and await approve_at_once(
        svc.session, lambda: svc.review(ctx, teaser_id, "approve", None), settings=svc.settings
    ):
        out = await svc.detail(ctx, teaser_id)
    return TeaserDetailOut(**out)


@router.delete("/studio/teasers/{teaser_id}", status_code=204)
async def delete_teaser(teaser_id: UUID, ctx: Ctx, svc: Svc) -> Response:
    await svc.delete(ctx, teaser_id)
    return Response(status_code=204)


@router.get("/studio/tracks/{track_id}/waveform", response_model=WaveformOut)
async def track_waveform(track_id: UUID, ctx: Ctx, svc: Svc) -> WaveformOut:
    return WaveformOut(**await svc.waveform(ctx, track_id))


@router.get("/studio/tracks/{track_id}/listen", response_model=AudioOut)
async def listen_song(track_id: UUID, ctx: Ctx, svc: Svc, accept: Accept = None) -> AudioOut:
    """The song's playback copy for editing (never the master), released or not."""
    return _audio(await svc.studio_listen_song(ctx, track_id, _accept(accept)))


@router.get("/studio/teasers/{teaser_id}/versions/{version_id}/listen", response_model=AudioOut)
async def listen_version(teaser_id: UUID, version_id: UUID, ctx: Ctx, svc: Svc, accept: Accept = None) -> AudioOut:
    return _audio(await svc.studio_listen_version(ctx, teaser_id, version_id, _accept(accept)))


@router.get("/studio/audio/{token:path}")
async def studio_media(
    token: str,
    svc: Svc,
    settings: Annotated[Settings, Depends(settings_dep)],
    range_header: Annotated[str | None, Header(alias="Range")] = None,
) -> Response:
    # Access is re-checked on every request, ranged or not.
    return await _ranged(await svc.open_studio_media(token), settings, range_header)


# --- Staff review (D-TEASER-01) ----------------------------------------------------------------


@router.get("/catalog-intake/teasers", response_model=list[QueueItemOut])
async def review_queue(ctx: Ctx, svc: Svc) -> list[QueueItemOut]:
    return [QueueItemOut(**row) for row in await svc.review_queue(ctx)]


@router.post("/catalog-intake/teasers/{teaser_id}/review", response_model=ReviewOut)
async def review_teaser(teaser_id: UUID, body: ReviewIn, ctx: Ctx, svc: Svc) -> ReviewOut:
    return ReviewOut(**await svc.review(ctx, teaser_id, body.action, body.note))


# --- Public (D-TEASER-02: no account needed) ---------------------------------------------------


@router.get("/teasers/{teaser_id}", response_model=PublicTeaserOut)
async def public_teaser(teaser_id: UUID, svc: Svc, ctx: MaybeCtx) -> PublicTeaserOut:
    return PublicTeaserOut(**await svc.public_view(teaser_id, ctx.user_id if ctx else None))


@router.get("/tracks/{track_id}/teasers", response_model=TrackTeasersOut)
async def track_teasers(track_id: UUID, svc: Svc) -> TrackTeasersOut:
    """Published teasers of a song, newest first. Empty for a song without any."""
    return TrackTeasersOut(items=[TeaserSummaryOut(**row) for row in await svc.track_teasers(track_id)])


@router.get("/releases/{release_id}/teasers", response_model=ReleaseTeaserListOut)
async def release_teasers_public(release_id: UUID, svc: Svc) -> ReleaseTeaserListOut:
    """Published teasers of a release's songs, in track order (also on pre-sale, D-TEASER-04)."""
    return ReleaseTeaserListOut(items=[ReleaseTeaserOut(**row) for row in await svc.release_teasers(release_id)])


@router.post("/teasers/for-tracks", response_model=TeaserMapOut)
async def teasers_for_tracks(body: TeaserMapIn, svc: Svc) -> TeaserMapOut:
    found = await svc.teasers_for_tracks(body.track_ids)
    return TeaserMapOut(teasers={str(k): v for k, v in found.items()})


@router.get("/teasers/{teaser_id}/audio", response_model=AudioOut)
async def teaser_audio(teaser_id: UUID, svc: Svc, accept: Accept = None) -> AudioOut:
    return _audio(await svc.public_audio(teaser_id, _accept(accept)))


@router.get("/teasers/media/{token:path}")
async def teaser_media(
    token: str,
    svc: Svc,
    settings: Annotated[Settings, Depends(settings_dep)],
    range_header: Annotated[str | None, Header(alias="Range")] = None,
) -> Response:
    return await _ranged(await svc.open_public_media(token), settings, range_header)


@router.post("/teasers/{teaser_id}/count", status_code=204)
async def count_teaser(teaser_id: UUID, body: CountIn, request: Request, svc: Svc, ctx: MaybeCtx) -> Response:
    """Always 204, counted or not (Q-TS-14): running totals only, nothing about the listener."""
    await svc.count(
        teaser_id,
        body.kind,
        address=request.client.host if request.client else None,
        viewer=ctx.user_id if ctx is not None else None,
        user_agent=request.headers.get("user-agent"),
    )
    return Response(status_code=204)
