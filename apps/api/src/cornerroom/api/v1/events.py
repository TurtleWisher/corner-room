"""Event routes. Thin — rules live in EventService."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from cornerroom.api.deps import event_service, get_auth_context, get_optional_auth_context
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.events.application.service import EventService
from cornerroom.modules.events.domain.models import Event

router = APIRouter(prefix="/events", tags=["events"])


class EventOut(BaseModel):
    id: UUID
    organization_id: UUID
    venue_id: UUID | None
    title: str
    description: str | None
    status: str
    timezone: str
    starts_at: datetime | None
    ends_at: datetime | None
    published_at: datetime | None
    cancelled_at: datetime | None
    postponed_at: datetime | None
    cancellation_reason: str | None = None
    postponement_reason: str | None = None
    previous_starts_at: datetime | None = None
    previous_ends_at: datetime | None = None
    version: int


class PublicEventOut(BaseModel):
    id: UUID
    title: str
    description: str | None
    status: str
    timezone: str
    starts_at: datetime | None
    ends_at: datetime | None
    venue_id: UUID | None


class EventPage(BaseModel):
    items: list[EventOut]
    next_cursor: str | None


class PublicEventPage(BaseModel):
    items: list[PublicEventOut]
    next_cursor: str | None


class EventCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    timezone: str = Field(min_length=1, max_length=64)
    description: str | None = Field(default=None, max_length=8000)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    organization_id: UUID | None = None


class EventPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=8000)
    timezone: str | None = Field(default=None, min_length=1, max_length=64)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    version: int | None = Field(default=None, ge=1)


class LifecycleIn(BaseModel):
    action: str = Field(
        pattern="^(plan|publish|open_ticketing|close_sales|go_live|complete|settle|archive|cancel|postpone|resume)$"
    )
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    reason: str | None = Field(default=None, max_length=2000)
    resume_status: str | None = None
    version: int | None = Field(default=None, ge=1)


class VenueAssignIn(BaseModel):
    venue_id: UUID | None = None
    version: int | None = Field(default=None, ge=1)


class MilestoneOut(BaseModel):
    id: UUID
    event_id: UUID
    type: str
    occurred_at: datetime
    previous_state: str | None
    new_state: str | None
    description: str | None


class MilestonePage(BaseModel):
    items: list[MilestoneOut]
    next_cursor: str | None


class LineupCreate(BaseModel):
    artist_id: UUID | None = None
    band_id: UUID | None = None
    billing_order: int = Field(default=0, ge=0, le=10000)


class LineupOut(BaseModel):
    id: UUID
    event_id: UUID
    artist_id: UUID | None
    band_id: UUID | None
    billing_order: int
    status: str
    contract_id: UUID | None
    version: int


class LineupPage(BaseModel):
    items: list[LineupOut]


class LineupLifecycleIn(BaseModel):
    action: str = Field(pattern="^(confirm|withdraw|mark_performed|mark_no_show)$")
    version: int | None = Field(default=None, ge=1)


def _event_out(row: Event) -> EventOut:
    return EventOut(
        id=row.id,
        organization_id=row.organization_id,
        venue_id=row.venue_id,
        title=row.title,
        description=row.description,
        status=row.status,
        timezone=row.timezone,
        starts_at=row.starts_at,
        ends_at=row.ends_at,
        published_at=row.published_at,
        cancelled_at=row.cancelled_at,
        postponed_at=row.postponed_at,
        cancellation_reason=row.cancellation_reason,
        postponement_reason=row.postponement_reason,
        previous_starts_at=row.previous_starts_at,
        previous_ends_at=row.previous_ends_at,
        version=row.version,
    )


def _public_out(row: Event) -> PublicEventOut:
    return PublicEventOut(
        id=row.id,
        title=row.title,
        description=row.description,
        status=row.status,
        timezone=row.timezone,
        starts_at=row.starts_at,
        ends_at=row.ends_at,
        venue_id=row.venue_id,
    )


@router.get("")
async def list_events(
    svc: Annotated[EventService, Depends(event_service)],
    ctx: Annotated[AuthContext | None, Depends(get_optional_auth_context)],
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
) -> EventPage | PublicEventPage:
    rows, next_cursor, public_only = await svc.list_events(ctx, cursor=cursor, limit=limit)
    if public_only:
        return PublicEventPage(items=[_public_out(r) for r in rows], next_cursor=next_cursor)
    return EventPage(items=[_event_out(r) for r in rows], next_cursor=next_cursor)


@router.post("", response_model=EventOut, status_code=201)
async def create_event(
    body: EventCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[EventService, Depends(event_service)],
) -> EventOut:
    row = await svc.create_event(
        ctx,
        title=body.title,
        timezone=body.timezone,
        description=body.description,
        starts_at=body.starts_at,
        ends_at=body.ends_at,
        organization_id=body.organization_id,
    )
    return _event_out(row)


@router.get("/{event_id}")
async def get_event(
    event_id: UUID,
    svc: Annotated[EventService, Depends(event_service)],
    ctx: Annotated[AuthContext | None, Depends(get_optional_auth_context)],
) -> EventOut | PublicEventOut:
    row, public_view = await svc.get_event(event_id, ctx)
    if public_view:
        return _public_out(row)
    return _event_out(row)


@router.patch("/{event_id}", response_model=EventOut)
async def patch_event(
    event_id: UUID,
    body: EventPatch,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[EventService, Depends(event_service)],
) -> EventOut:
    payload: dict[str, Any] = {}
    if body.title is not None:
        payload["title"] = body.title
    if "description" in body.model_fields_set:
        payload["description"] = body.description
    if body.timezone is not None:
        payload["timezone"] = body.timezone
    if "starts_at" in body.model_fields_set:
        payload["starts_at"] = body.starts_at
    if "ends_at" in body.model_fields_set:
        payload["ends_at"] = body.ends_at
    row = await svc.update_event(
        ctx,
        event_id,
        expected_version=body.version,
        **payload,
    )
    return _event_out(row)


@router.post("/{event_id}/lifecycle", response_model=EventOut)
async def event_lifecycle(
    event_id: UUID,
    body: LifecycleIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[EventService, Depends(event_service)],
) -> EventOut:
    row = await svc.transition_event(
        ctx,
        event_id,
        action=body.action,
        starts_at=body.starts_at,
        ends_at=body.ends_at,
        reason=body.reason,
        resume_status=body.resume_status,
        expected_version=body.version,
    )
    return _event_out(row)


@router.post("/{event_id}/venue", response_model=EventOut)
async def assign_venue(
    event_id: UUID,
    body: VenueAssignIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[EventService, Depends(event_service)],
) -> EventOut:
    row = await svc.assign_venue(
        ctx,
        event_id,
        venue_id=body.venue_id,
        expected_version=body.version,
    )
    return _event_out(row)


@router.get("/{event_id}/milestones", response_model=MilestonePage)
async def list_milestones(
    event_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[EventService, Depends(event_service)],
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
) -> MilestonePage:
    rows, next_cursor = await svc.list_milestones(ctx, event_id, cursor=cursor, limit=limit)
    return MilestonePage(
        items=[
            MilestoneOut(
                id=row.id,
                event_id=row.event_id,
                type=row.type,
                occurred_at=row.occurred_at,
                previous_state=row.previous_state,
                new_state=row.new_state,
                description=row.description,
            )
            for row in rows
        ],
        next_cursor=next_cursor,
    )


@router.get("/{event_id}/lineup", response_model=LineupPage)
async def list_lineup(
    event_id: UUID,
    svc: Annotated[EventService, Depends(event_service)],
    ctx: Annotated[AuthContext | None, Depends(get_optional_auth_context)],
) -> LineupPage:
    rows = await svc.list_lineup(event_id, ctx)
    return LineupPage(
        items=[
            LineupOut(
                id=row.id,
                event_id=row.event_id,
                artist_id=row.artist_id,
                band_id=row.band_id,
                billing_order=row.billing_order,
                status=row.status,
                contract_id=row.contract_id,
                version=row.version,
            )
            for row in rows
        ]
    )


@router.post("/{event_id}/lineup", response_model=LineupOut, status_code=201)
async def invite_lineup(
    event_id: UUID,
    body: LineupCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[EventService, Depends(event_service)],
) -> LineupOut:
    row = await svc.invite_lineup(
        ctx,
        event_id,
        artist_id=body.artist_id,
        band_id=body.band_id,
        billing_order=body.billing_order,
    )
    return LineupOut(
        id=row.id,
        event_id=row.event_id,
        artist_id=row.artist_id,
        band_id=row.band_id,
        billing_order=row.billing_order,
        status=row.status,
        contract_id=row.contract_id,
        version=row.version,
    )


@router.post("/{event_id}/lineup/{lineup_id}/lifecycle", response_model=LineupOut)
async def lineup_lifecycle(
    event_id: UUID,
    lineup_id: UUID,
    body: LineupLifecycleIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[EventService, Depends(event_service)],
) -> LineupOut:
    row = await svc.transition_lineup(
        ctx,
        event_id,
        lineup_id,
        action=body.action,
        expected_version=body.version,
    )
    return LineupOut(
        id=row.id,
        event_id=row.event_id,
        artist_id=row.artist_id,
        band_id=row.band_id,
        billing_order=row.billing_order,
        status=row.status,
        contract_id=row.contract_id,
        version=row.version,
    )
