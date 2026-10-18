"""Buyer downloads (AUDIO Phase 8, D-AUDIO-06). Rules live in modules/streaming/application/downloads.py."""

from __future__ import annotations

from dataclasses import asdict
from datetime import datetime
from typing import Annotated, Literal
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, Header
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.api.deps import db_session, get_auth_context, settings_dep
from cornerroom.infra.http_range import RangeNotSatisfiable, parse_byte_range
from cornerroom.infra.settings import Settings
from cornerroom.infra.storage import get_storage
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.streaming.application.downloads import DownloadService

router = APIRouter(tags=["downloads"])

Ctx = Annotated[AuthContext, Depends(get_auth_context)]


def _service(
    session: Annotated[AsyncSession, Depends(db_session)],
    settings: Annotated[Settings, Depends(settings_dep)],
) -> DownloadService:
    return DownloadService(session, settings)


Svc = Annotated[DownloadService, Depends(_service)]


class DownloadOptionOut(BaseModel):
    format: str
    label: str
    available: bool
    byte_size: int | None
    sample_rate_hz: int | None
    bit_depth: int | None
    bitrate_kbps: int | None


class DownloadIn(BaseModel):
    track_id: UUID
    format: Literal["flac", "mp3"]


class DownloadGrantOut(BaseModel):
    url: str
    expires_at: datetime
    filename: str
    format: str
    content_type: str
    byte_size: int
    sha256: str


@router.get("/me/downloads/tracks/{track_id}", response_model=list[DownloadOptionOut])
async def download_options(track_id: UUID, ctx: Ctx, svc: Svc) -> list[DownloadOptionOut]:
    """What this buyer can download for a song. 403 DOWNLOAD_NOT_OWNED when they did not buy it."""
    return [DownloadOptionOut(**asdict(o)) for o in await svc.options(ctx, track_id)]


@router.post("/me/downloads", response_model=DownloadGrantOut, status_code=201)
async def start_download(body: DownloadIn, ctx: Ctx, svc: Svc) -> DownloadGrantOut:
    """A short-lived, download-only link plus the file's name, size and SHA-256 to verify it."""
    g = await svc.grant(ctx, body.track_id, body.format)
    return DownloadGrantOut(
        url=g.url, expires_at=g.expires_at, filename=g.filename, format=g.format,
        content_type=g.content_type, byte_size=g.byte_size, sha256=g.sha256,
    )


def _disposition(filename: str) -> str:
    ascii_name = filename.encode("ascii", "ignore").decode("ascii").replace('"', "").strip() or "download"
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename)}"


@router.get("/downloads/{token:path}")
async def download_file(
    token: str,
    svc: Svc,
    settings: Annotated[Settings, Depends(settings_dep)],
    range_header: Annotated[str | None, Header(alias="Range")] = None,
) -> Response:
    # Ownership, takedown and refund are re-checked on every request, ranged or not.
    asset, filename = await svc.open(token)
    storage = get_storage(settings)
    size = await storage.stat(asset.object_key)
    if size is None:
        return JSONResponse(status_code=409, content={"code": "DOWNLOAD_PREPARING", "title": "This download is not available right now"})
    headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store",
        "Content-Disposition": _disposition(filename),
        "X-Content-Type-Options": "nosniff",
    }
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
