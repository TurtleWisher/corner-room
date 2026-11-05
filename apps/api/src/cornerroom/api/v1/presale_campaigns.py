"""Pre-sale campaigns (owner, 2026-11-06, D-PRESALE-04): public pre-sale lists, live counting,
and the artist's campaign numbers and share links in Studio."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.api.deps import db_session, get_auth_context, get_optional_auth_context, settings_dep
from cornerroom.api.v1.studio import PresaleViewOut
from cornerroom.infra.settings import Settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.commerce.application.presale_campaigns import PresaleCampaignService

router = APIRouter(tags=["presale-campaigns"])


async def campaign_service(
    session: Annotated[AsyncSession, Depends(db_session)],
    settings: Annotated[Settings, Depends(settings_dep)],
) -> PresaleCampaignService:
    return PresaleCampaignService(session, settings)


Svc = Annotated[PresaleCampaignService, Depends(campaign_service)]
Ctx = Annotated[AuthContext, Depends(get_auth_context)]
MaybeCtx = Annotated[AuthContext | None, Depends(get_optional_auth_context)]


class PresaleListOut(BaseModel):
    items: list[PresaleViewOut]


class CountIn(BaseModel):
    kind: Literal["view", "prebook", "VIEW", "PREBOOK"]
    place: str | None = Field(default=None, max_length=16)
    # A share link's code from the address bar (?from=...), and the site the visit came from.
    source: str | None = Field(default=None, max_length=32)
    referrer: str | None = Field(default=None, max_length=512)


class CampaignOut(BaseModel):
    id: UUID
    title: str
    release_type: str
    release_status: str
    release_at: datetime | None
    artist: str
    artist_kind: str
    artist_id: UUID
    cover_url: str | None
    state: str
    preorders: int
    views: int


class CanStartOut(BaseModel):
    id: UUID
    title: str
    release_type: str
    artist: str


class CampaignListOut(BaseModel):
    items: list[CampaignOut]
    can_start: list[CanStartOut]


class ShareLinkOut(BaseModel):
    id: UUID
    label: str
    code: str
    url: str
    created_at: datetime
    archived: bool
    views: int
    prebook_clicks: int


class ShareLinkIn(BaseModel):
    label: str = Field(min_length=1, max_length=120)


@router.get("/presales/releases", response_model=PresaleListOut)
async def public_presales(
    svc: Svc,
    artist_id: UUID | None = None,
    band_id: UUID | None = None,
    limit: int = Query(default=24, ge=1, le=48),
) -> PresaleListOut:
    """Public: releases on pre-sale now, soonest first (title, artist, date and offer only)."""
    items = await svc.public_list(artist_id=artist_id, band_id=band_id, limit=limit)
    return PresaleListOut(items=[PresaleViewOut(**i) for i in items])


@router.post("/presales/releases/{release_id}/count", status_code=204)
async def count(release_id: UUID, body: CountIn, request: Request, svc: Svc, ctx: MaybeCtx) -> Response:
    """Public: one page open or Pre-book press, added to running totals. Always 204, counted or
    not, so the answer says nothing about the release or the limit."""
    await svc.count(
        release_id,
        kind=body.kind,
        place=body.place,
        code=body.source,
        referrer=body.referrer,
        user_agent=request.headers.get("user-agent"),
        address=request.client.host if request.client else None,
        viewer=ctx.user_id if ctx is not None else None,
    )
    return Response(status_code=204)


@router.get("/studio/presales", response_model=CampaignListOut)
async def campaigns(ctx: Ctx, svc: Svc) -> CampaignListOut:
    return CampaignListOut(**await svc.campaigns(ctx))


@router.get("/studio/releases/{release_id}/numbers")
async def numbers(release_id: UUID, ctx: Ctx, svc: Svc) -> dict[str, Any]:
    """Live numbers: `presale`, `since_release` (null until it is out) and `all`."""
    return await svc.numbers(ctx, release_id)


@router.get("/studio/releases/{release_id}/share-links", response_model=list[ShareLinkOut])
async def share_links(release_id: UUID, ctx: Ctx, svc: Svc) -> list[ShareLinkOut]:
    return [ShareLinkOut(**i) for i in await svc.share_links(ctx, release_id)]


@router.post("/studio/releases/{release_id}/share-links", response_model=list[ShareLinkOut], status_code=201)
async def add_share_link(release_id: UUID, body: ShareLinkIn, ctx: Ctx, svc: Svc) -> list[ShareLinkOut]:
    return [ShareLinkOut(**i) for i in await svc.add_share_link(ctx, release_id, body.label)]


@router.post("/studio/releases/{release_id}/share-links/{link_id}/archive", response_model=list[ShareLinkOut])
async def archive_share_link(release_id: UUID, link_id: UUID, ctx: Ctx, svc: Svc) -> list[ShareLinkOut]:
    return [ShareLinkOut(**i) for i in await svc.archive_share_link(ctx, release_id, link_id)]
