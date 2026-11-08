"""Trending Corner (owner, 2026-11-08, D-TRENDING-01): the home page's carousel of music staff
picked as selling and being heard the most. Thin: rules live in modules/music/application/trending.py."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.api.deps import db_session, get_auth_context
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.music.application.trending import MAX_PICKS, TrendingService

router = APIRouter(tags=["trending"])


async def trending_service(session: AsyncSession = Depends(db_session)) -> TrendingService:
    return TrendingService(session)


Svc = Annotated[TrendingService, Depends(trending_service)]
Ctx = Annotated[AuthContext, Depends(get_auth_context)]


class TrendingSongOut(BaseModel):
    id: UUID
    title: str
    duration_ms: int | None
    # Released releases the song is on, so a bought release counts as owning it.
    release_ids: list[UUID]
    # Its newest published teaser, for anyone who hasn't bought it (D-TEASER-02).
    teaser_id: UUID | None
    listens: int


class TrendingItemOut(BaseModel):
    id: UUID
    kind: Literal["TRACK", "RELEASE"]
    title: str
    track_id: UUID | None
    # The release that gives the cover: the release itself, or the first one a song is out on.
    release_id: UUID | None
    release_title: str | None
    release_type: str | None
    released_at: datetime | None
    has_cover: bool
    primary_artist_id: UUID | None
    primary_band_id: UUID | None
    listens: int
    tracks: list[TrendingSongOut]


class TrendingListOut(BaseModel):
    items: list[TrendingItemOut]


class StaffEntryOut(BaseModel):
    kind: Literal["TRACK", "RELEASE"]
    id: UUID
    title: str
    release_type: str | None
    release_id: UUID | None
    has_cover: bool
    primary_artist_id: UUID | None
    primary_band_id: UUID | None
    is_out: bool
    listens: int
    sold: int
    refunded: int


class StaffPickOut(StaffEntryOut):
    pick_id: UUID


class StaffCandidateOut(StaffEntryOut):
    picked: bool


class StaffTrendingOut(BaseModel):
    picks: list[StaffPickOut]
    candidates: list[StaffCandidateOut]
    max_picks: int = MAX_PICKS


class AddIn(BaseModel):
    kind: Literal["TRACK", "RELEASE"]
    id: UUID


class OrderIn(BaseModel):
    pick_ids: list[UUID] = Field(max_length=MAX_PICKS)


@router.get("/trending", response_model=TrendingListOut)
async def public_trending(svc: Svc) -> TrendingListOut:
    """Anyone, no account: the picks in order, released music only."""
    return TrendingListOut(items=[TrendingItemOut(**row) for row in await svc.public_list()])


@router.get("/staff/trending", response_model=StaffTrendingOut)
async def staff_trending(ctx: Ctx, svc: Svc, q: Annotated[str | None, Query(max_length=100)] = None) -> StaffTrendingOut:
    """Catalog staff of the workspace (`music.approve`); anyone else gets 404."""
    return StaffTrendingOut(**await svc.staff_view(ctx, q))


@router.post("/staff/trending", response_model=StaffTrendingOut, status_code=201)
async def add_pick(body: AddIn, ctx: Ctx, svc: Svc) -> StaffTrendingOut:
    await svc.add(ctx, body.kind, body.id)
    return StaffTrendingOut(**await svc.staff_view(ctx))


@router.put("/staff/trending/order", response_model=StaffTrendingOut)
async def order_picks(body: OrderIn, ctx: Ctx, svc: Svc) -> StaffTrendingOut:
    await svc.reorder(ctx, body.pick_ids)
    return StaffTrendingOut(**await svc.staff_view(ctx))


@router.delete("/staff/trending/{pick_id}", status_code=204)
async def remove_pick(pick_id: UUID, ctx: Ctx, svc: Svc) -> Response:
    await svc.remove(ctx, pick_id)
    return Response(status_code=204)
