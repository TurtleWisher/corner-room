"""Who runs an artist profile, solo or band (owner, 2026-10-30, D-ARTIST-UNIFY-01). Rules live in
modules/artists/application/team.py."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.api.deps import db_session, get_auth_context, settings_dep
from cornerroom.infra.settings import Settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.artists.application.team import TeamService

router = APIRouter(tags=["artist-team"])


async def team_service(
    session: Annotated[AsyncSession, Depends(db_session)],
    settings: Annotated[Settings, Depends(settings_dep)],
) -> TeamService:
    return TeamService(session, settings)


Svc = Annotated[TeamService, Depends(team_service)]
Ctx = Annotated[AuthContext, Depends(get_auth_context)]
Kind = Literal["artist", "band"]


class TeamProfileOut(BaseModel):
    kind: Kind
    id: UUID
    display_name: str


class TeamMemberOut(BaseModel):
    id: UUID
    user_id: UUID
    display_name: str | None
    email: str | None
    role: Literal["OWNER", "MANAGER"]
    status: str
    requested_at: datetime
    reviewed_at: datetime | None


class TeamOut(BaseModel):
    profile: TeamProfileOut
    my_role: Literal["OWNER", "MANAGER"] | None
    can_pick_managers: bool
    members: list[TeamMemberOut]


class TeamRequestOut(TeamMemberOut):
    profile: TeamProfileOut
    picked_by: str | None


class EmailIn(BaseModel):
    email: str = Field(min_length=3, max_length=320)


class ReviewIn(BaseModel):
    action: Literal["approve", "reject"]
    note: str | None = Field(default=None, max_length=2000)


@router.get("/studio/profiles/{kind}/{profile_id}/team", response_model=TeamOut)
async def get_team(kind: Kind, profile_id: UUID, ctx: Ctx, svc: Svc) -> TeamOut:
    return TeamOut(**await svc.view(ctx, kind, profile_id))


@router.post("/studio/profiles/{kind}/{profile_id}/team", response_model=TeamOut, status_code=201)
async def pick_manager(kind: Kind, profile_id: UUID, body: EmailIn, ctx: Ctx, svc: Svc) -> TeamOut:
    """The owner picks a manager by their account email; staff approve before they get access."""
    return TeamOut(**await svc.pick_manager(ctx, kind, profile_id, body.email))


@router.delete("/studio/profiles/{kind}/{profile_id}/team/{member_id}", response_model=TeamOut)
async def take_off(kind: Kind, profile_id: UUID, member_id: UUID, ctx: Ctx, svc: Svc) -> TeamOut:
    """The owner takes a manager off (or withdraws a pick); a manager leaves."""
    return TeamOut(**await svc.take_off(ctx, kind, profile_id, member_id))


@router.put("/studio/profiles/{kind}/{profile_id}/team/{member_id}/owner", response_model=TeamOut)
async def hand_over(kind: Kind, profile_id: UUID, member_id: UUID, ctx: Ctx, svc: Svc) -> TeamOut:
    """The owner makes an approved manager the owner; they stay on as a manager."""
    return TeamOut(**await svc.hand_over(ctx, kind, profile_id, member_id))


@router.get("/artist-team-requests", response_model=list[TeamRequestOut])
async def team_requests(ctx: Ctx, svc: Svc) -> list[TeamRequestOut]:
    """Staff: managers waiting for approval in the active workspace (artist.manage)."""
    return [TeamRequestOut(**row) for row in await svc.queue(ctx)]


@router.post("/artist-team-requests/{member_id}/review", response_model=TeamMemberOut)
async def review_request(member_id: UUID, body: ReviewIn, ctx: Ctx, svc: Svc) -> TeamMemberOut:
    return TeamMemberOut(**await svc.review(ctx, member_id, body.action, body.note))


@router.get("/artists/{artist_id}/team", response_model=TeamOut)
async def staff_team(artist_id: UUID, ctx: Ctx, svc: Svc) -> TeamOut:
    """Staff: who runs this profile (a band's id works too: every band is an artist)."""
    return TeamOut(**await svc.staff_view(ctx, artist_id))


@router.put("/artists/{artist_id}/team/owner", response_model=TeamOut)
async def set_owner(artist_id: UUID, body: EmailIn, ctx: Ctx, svc: Svc) -> TeamOut:
    """Staff make an account the owner; the previous owner stays on as a manager."""
    return TeamOut(**await svc.set_owner(ctx, artist_id, body.email))
