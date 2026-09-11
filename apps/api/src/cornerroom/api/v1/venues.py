"""Venue routes. Thin — rules live in EventService."""

from __future__ import annotations

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from cornerroom.api.deps import event_service, get_auth_context
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.events.application.service import EventService
from cornerroom.modules.events.domain.models import Venue

router = APIRouter(prefix="/venues", tags=["venues"])


class VenueOut(BaseModel):
    id: UUID
    organization_id: UUID
    name: str
    address: dict[str, Any] | None
    capacity: int
    status: str
    version: int


class VenuePage(BaseModel):
    items: list[VenueOut]
    next_cursor: str | None


class VenueCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    capacity: int = Field(default=0, ge=0)
    address: dict[str, Any] | None = None
    organization_id: UUID | None = None


class VenuePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    capacity: int | None = Field(default=None, ge=0)
    address: dict[str, Any] | None = None
    version: int | None = Field(default=None, ge=1)


class LifecycleIn(BaseModel):
    action: str = Field(pattern="^(activate|deactivate)$")
    version: int | None = Field(default=None, ge=1)


def _venue_out(row: Venue) -> VenueOut:
    return VenueOut(
        id=row.id,
        organization_id=row.organization_id,
        name=row.name,
        address=row.address,
        capacity=row.capacity,
        status=row.status,
        version=row.version,
    )


@router.get("", response_model=VenuePage)
async def list_venues(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[EventService, Depends(event_service)],
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
) -> VenuePage:
    rows, next_cursor = await svc.list_venues(ctx, cursor=cursor, limit=limit)
    return VenuePage(items=[_venue_out(r) for r in rows], next_cursor=next_cursor)


@router.post("", response_model=VenueOut, status_code=201)
async def create_venue(
    body: VenueCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[EventService, Depends(event_service)],
) -> VenueOut:
    row = await svc.create_venue(
        ctx,
        name=body.name,
        capacity=body.capacity,
        address=body.address,
        organization_id=body.organization_id,
    )
    return _venue_out(row)


@router.get("/{venue_id}", response_model=VenueOut)
async def get_venue(
    venue_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[EventService, Depends(event_service)],
) -> VenueOut:
    return _venue_out(await svc.get_venue(venue_id, ctx))


@router.patch("/{venue_id}", response_model=VenueOut)
async def patch_venue(
    venue_id: UUID,
    body: VenuePatch,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[EventService, Depends(event_service)],
) -> VenueOut:
    payload: dict[str, Any] = {}
    if body.name is not None:
        payload["name"] = body.name
    if body.capacity is not None:
        payload["capacity"] = body.capacity
    if "address" in body.model_fields_set:
        payload["address"] = body.address
    row = await svc.update_venue(ctx, venue_id, expected_version=body.version, **payload)
    return _venue_out(row)


@router.post("/{venue_id}/lifecycle", response_model=VenueOut)
async def venue_lifecycle(
    venue_id: UUID,
    body: LifecycleIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[EventService, Depends(event_service)],
) -> VenueOut:
    row = await svc.transition_venue(
        ctx,
        venue_id,
        action=body.action,
        expected_version=body.version,
    )
    return _venue_out(row)
