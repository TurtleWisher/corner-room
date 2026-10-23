"""Artists and band admins edit their public profile in Studio; staff approve it first (owner,
2026-10-23). Rules live in modules/artists/application/profile_changes.py."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.api.deps import db_session, get_auth_context, settings_dep
from cornerroom.api.v1.studio import CoverReportOut
from cornerroom.infra.settings import Settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.artists.application.profile_changes import ProfileChangeService

router = APIRouter(tags=["profiles"])


async def profiles(
    session: Annotated[AsyncSession, Depends(db_session)],
    settings: Annotated[Settings, Depends(settings_dep)],
) -> ProfileChangeService:
    return ProfileChangeService(session, settings)


Svc = Annotated[ProfileChangeService, Depends(profiles)]
Ctx = Annotated[AuthContext, Depends(get_auth_context)]


class PublicProfileOut(BaseModel):
    kind: Literal["artist", "band"]
    id: UUID
    status: str
    stage_name: str
    bio: str | None
    portrait_url: str | None


class ChangeRequestOut(BaseModel):
    id: UUID
    status: str
    stage_name: str | None
    bio: str | None
    bio_changed: bool
    portrait_url: str | None
    remove_portrait: bool
    submitted_at: datetime | None
    reviewed_at: datetime | None
    review_note: str | None


class StudioProfileOut(BaseModel):
    profile: PublicProfileOut
    pending: ChangeRequestOut | None
    last_decision: ChangeRequestOut | None
    picture_report: CoverReportOut | None


class ProfileChangeIn(BaseModel):
    """Fields left out keep what is waiting (or what is public). Send `bio: null` to clear it."""

    stage_name: str | None = Field(default=None, min_length=1, max_length=200)
    bio: str | None = Field(default=None, max_length=8000)
    remove_portrait: bool = False


class ReviewItemOut(BaseModel):
    request: ChangeRequestOut
    profile: PublicProfileOut


class TransitionIn(BaseModel):
    to: Literal["APPROVED", "REJECTED", "WITHDRAWN"]
    note: str | None = Field(default=None, max_length=2000)


@router.get("/studio/profiles/{kind}/{profile_id}/profile", response_model=StudioProfileOut)
async def studio_profile(kind: Literal["artist", "band"], profile_id: UUID, ctx: Ctx, svc: Svc) -> StudioProfileOut:
    return StudioProfileOut(**await svc.view(ctx, kind, profile_id))


@router.post("/studio/profiles/{kind}/{profile_id}/profile-changes", response_model=StudioProfileOut)
async def save_profile_change(
    kind: Literal["artist", "band"], profile_id: UUID, body: ProfileChangeIn, ctx: Ctx, svc: Svc
) -> StudioProfileOut:
    fields = body.model_fields_set
    return StudioProfileOut(
        **await svc.save(
            ctx,
            kind,
            profile_id,
            stage_name=body.stage_name,
            bio=body.bio if "bio" in fields else ...,
            remove_portrait=body.remove_portrait,
        )
    )


@router.get("/profile-changes", response_model=list[ReviewItemOut])
async def review_queue(ctx: Ctx, svc: Svc) -> list[ReviewItemOut]:
    """Staff: waiting profile changes in the active workspace (artist.manage)."""
    return [ReviewItemOut(**item) for item in await svc.queue(ctx)]


@router.post("/profile-changes/{request_id}/transition", response_model=ReviewItemOut)
async def transition_profile_change(request_id: UUID, body: TransitionIn, ctx: Ctx, svc: Svc) -> ReviewItemOut:
    """Staff approve or reject; the artist may withdraw."""
    return ReviewItemOut(**await svc.transition(ctx, request_id, body.to, body.note))
