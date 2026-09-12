"""Analytics read API. Not a ledger. Unique listeners NOT_AVAILABLE."""

from __future__ import annotations

from datetime import date
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field

from cornerroom.api.deps import analytics_service, get_auth_context
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.analytics.application.service import AnalyticsService

router = APIRouter(tags=["analytics"])


class MoneyTileOut(BaseModel):
    status: str


class StaffOverviewOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    organization_id: UUID
    from_date: date | None = Field(default=None, alias="from")
    to: date | None = None
    metric_timezone: str
    metric_timezone_status: str
    tracks: dict[str, Any]
    events: dict[str, Any]
    campaigns: dict[str, Any]
    money: MoneyTileOut


class TrackAnalyticsOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    track_id: UUID
    from_date: date | None = Field(default=None, alias="from")
    to: date | None = None
    metric_timezone: str
    metric_timezone_status: str
    play_count: int
    completed_play_count: int
    listen_duration_ms: int
    unique_listeners: str


class EventAnalyticsOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    event_id: UUID
    from_date: date | None = Field(default=None, alias="from")
    to: date | None = None
    metric_timezone: str
    metric_timezone_status: str
    ticket_paid_count: int
    ticket_issued_count: int
    ticket_checked_in_count: int
    unique_listeners: str


class CampaignAnalyticsOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    campaign_id: UUID
    from_date: date | None = Field(default=None, alias="from")
    to: date | None = None
    metric_timezone: str
    metric_timezone_status: str
    ingested_event_count: int
    attribution_status: str


class ArtistAnalyticsOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    artist_id: UUID
    from_date: date | None = Field(default=None, alias="from")
    to: date | None = None
    metric_timezone: str
    metric_timezone_status: str
    unique_listeners: str


@router.get("/staff/analytics/overview", response_model=StaffOverviewOut)
async def staff_overview(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[AnalyticsService, Depends(analytics_service)],
    from_date: date | None = Query(default=None, alias="from"),
    to_date: date | None = Query(default=None, alias="to"),
) -> StaffOverviewOut:
    body = await svc.read_staff_overview(ctx, from_date=from_date, to_date=to_date)
    return StaffOverviewOut(
        organization_id=body["organization_id"],
        from_date=body["from"],
        to=body["to"],
        metric_timezone=body["metric_timezone"],
        metric_timezone_status=body["metric_timezone_status"],
        tracks=body["tracks"],
        events=body["events"],
        campaigns=body["campaigns"],
        money=MoneyTileOut(status=body["money"]["status"]),
    )


@router.get("/analytics/tracks/{track_id}", response_model=TrackAnalyticsOut)
async def track_analytics(
    track_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[AnalyticsService, Depends(analytics_service)],
    from_date: date | None = Query(default=None, alias="from"),
    to_date: date | None = Query(default=None, alias="to"),
) -> TrackAnalyticsOut:
    body = await svc.read_track(ctx, track_id, from_date=from_date, to_date=to_date)
    return TrackAnalyticsOut(
        track_id=body["track_id"],
        from_date=body["from"],
        to=body["to"],
        metric_timezone=body["metric_timezone"],
        metric_timezone_status=body["metric_timezone_status"],
        play_count=body["play_count"],
        completed_play_count=body["completed_play_count"],
        listen_duration_ms=body["listen_duration_ms"],
        unique_listeners=body["unique_listeners"],
    )


@router.get("/analytics/events/{event_id}", response_model=EventAnalyticsOut)
async def event_analytics(
    event_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[AnalyticsService, Depends(analytics_service)],
    from_date: date | None = Query(default=None, alias="from"),
    to_date: date | None = Query(default=None, alias="to"),
) -> EventAnalyticsOut:
    body = await svc.read_event(ctx, event_id, from_date=from_date, to_date=to_date)
    return EventAnalyticsOut(
        event_id=body["event_id"],
        from_date=body["from"],
        to=body["to"],
        metric_timezone=body["metric_timezone"],
        metric_timezone_status=body["metric_timezone_status"],
        ticket_paid_count=body["ticket_paid_count"],
        ticket_issued_count=body["ticket_issued_count"],
        ticket_checked_in_count=body["ticket_checked_in_count"],
        unique_listeners=body["unique_listeners"],
    )


@router.get("/analytics/campaigns/{campaign_id}", response_model=CampaignAnalyticsOut)
async def campaign_analytics(
    campaign_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[AnalyticsService, Depends(analytics_service)],
    from_date: date | None = Query(default=None, alias="from"),
    to_date: date | None = Query(default=None, alias="to"),
) -> CampaignAnalyticsOut:
    body = await svc.read_campaign(ctx, campaign_id, from_date=from_date, to_date=to_date)
    return CampaignAnalyticsOut(
        campaign_id=body["campaign_id"],
        from_date=body["from"],
        to=body["to"],
        metric_timezone=body["metric_timezone"],
        metric_timezone_status=body["metric_timezone_status"],
        ingested_event_count=body["ingested_event_count"],
        attribution_status=body["attribution_status"],
    )


@router.get("/analytics/artists/{artist_id}", response_model=ArtistAnalyticsOut)
async def artist_analytics(
    artist_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[AnalyticsService, Depends(analytics_service)],
    from_date: date | None = Query(default=None, alias="from"),
    to_date: date | None = Query(default=None, alias="to"),
) -> ArtistAnalyticsOut:
    body = await svc.read_artist(ctx, artist_id, from_date=from_date, to_date=to_date)
    return ArtistAnalyticsOut(
        artist_id=body["artist_id"],
        from_date=body["from"],
        to=body["to"],
        metric_timezone=body["metric_timezone"],
        metric_timezone_status=body["metric_timezone_status"],
        unique_listeners=body["unique_listeners"],
    )
