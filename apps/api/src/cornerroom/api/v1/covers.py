"""Official artwork (OD-05, OD-06; owner 2026-10-23). Images only, so no session: public routes
resolve covers of released music and posters of published events; anything else needs a signed
link from a Studio or staff response.
A missing cover is a 404, and the page shows the letter cube instead."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.api.deps import db_session, settings_dep
from cornerroom.infra.errors import NotFoundError
from cornerroom.infra.settings import Settings
from cornerroom.modules.documents.application.covers import CoverService

router = APIRouter(tags=["covers"])

PUBLIC_CACHE = "public, max-age=3600"
SIGNED_CACHE = "private, max-age=600"


async def covers(
    session: Annotated[AsyncSession, Depends(db_session)],
    settings: Annotated[Settings, Depends(settings_dep)],
) -> CoverService:
    return CoverService(session, settings)


CoverDep = Annotated[CoverService, Depends(covers)]


def _jpeg(data: bytes, cache: str) -> Response:
    return Response(content=data, media_type="image/jpeg", headers={"Cache-Control": cache})


# An <img> that gets a JSON error body is blocked by the browser (ORB) and logged as an error, so
# "no cover" is a bare 404 here; the page shows the letter cube either way.
NO_COVER = Response(status_code=404, headers={"Cache-Control": "public, max-age=300"})


@router.get("/covers/releases/{release_id}/{size}", response_class=Response)
async def release_cover(release_id: UUID, size: int, svc: CoverDep) -> Response:
    asset_id = await svc.public_release_cover(release_id)
    if asset_id is None:
        return NO_COVER
    try:
        return _jpeg(await svc.image(asset_id, size), PUBLIC_CACHE)
    except NotFoundError:
        return NO_COVER


@router.get("/covers/tracks/{track_id}/{size}", response_class=Response)
async def track_cover(track_id: UUID, size: int, svc: CoverDep) -> Response:
    asset_id = await svc.public_track_cover(track_id)
    if asset_id is None:
        return NO_COVER
    try:
        return _jpeg(await svc.image(asset_id, size), PUBLIC_CACHE)
    except NotFoundError:
        return NO_COVER


@router.get("/covers/events/{event_id}/{size}", response_class=Response)
async def event_cover(event_id: UUID, size: int, svc: CoverDep) -> Response:
    asset_id = await svc.public_event_cover(event_id)
    if asset_id is None:
        return NO_COVER
    try:
        return _jpeg(await svc.image(asset_id, size), PUBLIC_CACHE)
    except NotFoundError:
        return NO_COVER


@router.get("/covers/signed/{token}/{size}", response_class=Response)
async def signed_cover(token: str, size: int, svc: CoverDep) -> Response:
    return _jpeg(await svc.image(svc.asset_from_token(token), size), SIGNED_CACHE)
