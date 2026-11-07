"""Gift campaigns (owner, 2026-10-28, D-CAMPAIGN-01, D-CAMPAIGN-02). Rules live in
modules/commerce/application/gifts.py."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.api.deps import db_session, get_auth_context, settings_dep
from cornerroom.infra.settings import Settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.commerce.application.gifts import GiftCampaignService

router = APIRouter(tags=["gifts"])


async def gifts(
    session: Annotated[AsyncSession, Depends(db_session)],
    settings: Annotated[Settings, Depends(settings_dep)],
) -> GiftCampaignService:
    return GiftCampaignService(session, settings)


Svc = Annotated[GiftCampaignService, Depends(gifts)]
Ctx = Annotated[AuthContext, Depends(get_auth_context)]


class WorkIn(BaseModel):
    type: Literal["RELEASE", "TRACK"]
    id: UUID


class CampaignIn(BaseModel):
    """Fields left out keep what they are (on a change)."""

    title: str | None = Field(default=None, max_length=200)
    gift_items: str | None = Field(default=None, max_length=500)
    description: str | None = Field(default=None, max_length=4000)
    sender: Literal["ARTIST", "CORNER_ROOM"] | None = None
    include_presale: bool | None = None
    counts_from: datetime | None = None
    works: list[WorkIn] | None = Field(default=None, max_length=200)


def _data(body: CampaignIn) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key in body.model_fields_set:
        value = getattr(body, key)
        out[key] = [{"type": w.type, "id": str(w.id)} for w in value] if key == "works" and value is not None else value
    return out


class WorkOut(BaseModel):
    type: str
    id: UUID
    title: str


class ProfileOut(BaseModel):
    kind: str
    id: UUID
    display_name: str


class CampaignOut(BaseModel):
    id: UUID
    profile: ProfileOut
    title: str
    gift_items: str
    description: str | None
    # ARTIST (the band or artist posts them) or CORNER_ROOM (Corner Room's team does).
    sender: str
    include_presale: bool
    counts_from: datetime | None
    works: list[WorkOut]
    # DRAFT, IN_REVIEW, ACTIVE (live), PAUSED or ENDED.
    status: str
    # A change to a live campaign, waiting for staff.
    pending: dict[str, Any] | None
    review_note: str | None
    submitted_at: datetime | None
    approved_at: datetime | None
    # One count per collectible status (YET_TO_SEND is "not prepared yet", then PREPARED,
    # DISPATCHED, RECEIVED, RETURNED, MISSING), TOTAL, SCHEDULED (prepared with a dispatch time set;
    # already inside PREPARED) and WAITING (people the act added, waiting for staff; not in TOTAL).
    counts: dict[str, int]


class RecipientOut(BaseModel):
    id: UUID
    # YET_TO_SEND (not prepared yet), PREPARED, DISPATCHED (the buyer was told), RECEIVED, RETURNED
    # or MISSING (D-CAMPAIGN-03).
    status: str
    # BUYER (found on Corner Room or the pre-sale list) or ADDED (typed in or from a sheet, D-CAMPAIGN-04).
    source: str = "BUYER"
    has_account: bool
    prepared_at: datetime | None = None
    # Set on a prepared gift that will be dispatched at this time.
    dispatch_at: datetime | None = None
    dispatched_at: datetime | None = None
    # When it was received, returned or marked missing.
    outcome_at: datetime | None = None
    # Staff only.
    email: str | None = None
    # Staff, and the artist when they send the gifts themselves.
    name: str | None = None
    phone: str | None = None
    address: str | None = None


class CampaignDetailOut(CampaignOut):
    viewer_role: Literal["owner", "staff"]
    # Whether this viewer may update the gifts (staff always; the artist when they send them).
    can_dispatch: bool
    shows_contact: bool
    # Where each status may go next.
    transitions: dict[str, list[str]] = Field(default_factory=dict)
    recipients: list[RecipientOut]
    # D-CAMPAIGN-04: whether people can be added now, whether this viewer approves the act's additions,
    # and the additions still waiting for staff (with the details the act typed in).
    can_add: bool = False
    can_review: bool = False
    waiting: list[RecipientOut] = Field(default_factory=list)
    # After an update: how many gifts moved, and how many couldn't make that move. After adding
    # people: how many were added, and how many were already in the campaign.
    moved: int | None = None
    skipped: int | None = None
    added: int | None = None


RecipientStatus = Literal["YET_TO_SEND", "PREPARED", "DISPATCHED", "RECEIVED", "RETURNED", "MISSING"]


class RecipientsTransitionIn(BaseModel):
    """Move chosen gifts, or every gift in one status (`every`), to `to`. Dispatching with
    `dispatch_at` (a future time with its zone) schedules it instead of sending now."""

    to: RecipientStatus
    recipient_ids: list[UUID] | None = Field(default=None, max_length=500)
    every: RecipientStatus | None = None
    dispatch_at: datetime | None = None


class PersonIn(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    email: str | None = Field(default=None, max_length=320)
    phone: str | None = Field(default=None, max_length=40)
    address: str | None = Field(default=None, max_length=1000)


class AddPeopleIn(BaseModel):
    """People who bought outside Corner Room (D-CAMPAIGN-04): an email or a phone each."""

    people: list[PersonIn] = Field(min_length=1, max_length=2000)


class ReviewPeopleIn(BaseModel):
    recipient_ids: list[UUID] = Field(min_length=1, max_length=2000)
    action: Literal["approve", "reject"]


class ReviewIn(BaseModel):
    action: Literal["approve", "reject"]
    note: str | None = Field(default=None, max_length=2000)


class PublicGiftOut(BaseModel):
    id: UUID
    title: str
    gift_items: str
    description: str | None
    artist: str


@router.get("/studio/profiles/{kind}/{profile_id}/gift-campaigns", response_model=list[CampaignOut])
async def list_campaigns(kind: Literal["artist", "band"], profile_id: UUID, ctx: Ctx, svc: Svc) -> list[CampaignOut]:
    return [CampaignOut(**c) for c in await svc.list_for_profile(ctx, kind, profile_id)]


@router.post("/studio/profiles/{kind}/{profile_id}/gift-campaigns", response_model=CampaignDetailOut, status_code=201)
async def create_campaign(kind: Literal["artist", "band"], profile_id: UUID, body: CampaignIn, ctx: Ctx, svc: Svc) -> CampaignDetailOut:
    return CampaignDetailOut(**await svc.create(ctx, kind, profile_id, _data(body)))


@router.get("/studio/gift-campaigns/{campaign_id}", response_model=CampaignDetailOut)
async def campaign_detail(campaign_id: UUID, ctx: Ctx, svc: Svc) -> CampaignDetailOut:
    return CampaignDetailOut(**await svc.detail(ctx, campaign_id))


@router.patch("/studio/gift-campaigns/{campaign_id}", response_model=CampaignDetailOut)
async def change_campaign(campaign_id: UUID, body: CampaignIn, ctx: Ctx, svc: Svc) -> CampaignDetailOut:
    """A draft changes at once; a live or paused campaign's change waits for staff."""
    return CampaignDetailOut(**await svc.update(ctx, campaign_id, _data(body)))


@router.post("/studio/gift-campaigns/{campaign_id}/submit", response_model=CampaignDetailOut)
async def submit_campaign(campaign_id: UUID, ctx: Ctx, svc: Svc) -> CampaignDetailOut:
    return CampaignDetailOut(**await svc.submit(ctx, campaign_id))


@router.post("/studio/gift-campaigns/{campaign_id}/withdraw", response_model=CampaignDetailOut)
async def withdraw_campaign_change(campaign_id: UUID, ctx: Ctx, svc: Svc) -> CampaignDetailOut:
    return CampaignDetailOut(**await svc.withdraw_change(ctx, campaign_id))


@router.post("/studio/gift-campaigns/{campaign_id}/pause", response_model=CampaignDetailOut)
async def pause_campaign(campaign_id: UUID, ctx: Ctx, svc: Svc) -> CampaignDetailOut:
    return CampaignDetailOut(**await svc.pause(ctx, campaign_id))


@router.post("/studio/gift-campaigns/{campaign_id}/resume", response_model=CampaignDetailOut)
async def resume_campaign(campaign_id: UUID, ctx: Ctx, svc: Svc) -> CampaignDetailOut:
    return CampaignDetailOut(**await svc.resume(ctx, campaign_id))


@router.post("/studio/gift-campaigns/{campaign_id}/recipients/transition", response_model=CampaignDetailOut)
async def track_gifts(campaign_id: UUID, body: RecipientsTransitionIn, ctx: Ctx, svc: Svc) -> CampaignDetailOut:
    """Collectible tracking (D-CAMPAIGN-03): prepare, dispatch now or at a time (the buyer is told it
    is on its way), then received, returned or missing (returned and missing tell the buyer)."""
    return CampaignDetailOut(
        **await svc.transition(
            ctx, campaign_id, to=body.to, ids=body.recipient_ids, every=body.every, dispatch_at=body.dispatch_at
        )
    )


@router.post("/studio/gift-campaigns/{campaign_id}/recipients", response_model=CampaignDetailOut)
async def add_people(campaign_id: UUID, body: AddPeopleIn, ctx: Ctx, svc: Svc) -> CampaignDetailOut:
    """Add people by hand or from a sheet. Staff additions count at once; the act's wait for staff."""
    return CampaignDetailOut(**await svc.add_people(ctx, campaign_id, [p.model_dump() for p in body.people]))


@router.post("/studio/gift-campaigns/{campaign_id}/recipients/review", response_model=CampaignDetailOut)
async def review_people(campaign_id: UUID, body: ReviewPeopleIn, ctx: Ctx, svc: Svc) -> CampaignDetailOut:
    """Staff approve the act's additions, or turn them away (they are removed)."""
    return CampaignDetailOut(
        **await svc.review_people(ctx, campaign_id, body.recipient_ids, approve=body.action == "approve")
    )


@router.delete("/studio/gift-campaigns/{campaign_id}/recipients/{recipient_id}", response_model=CampaignDetailOut)
async def remove_person(campaign_id: UUID, recipient_id: UUID, ctx: Ctx, svc: Svc) -> CampaignDetailOut:
    """Take back someone added by hand by mistake, before anything happened to their gift."""
    return CampaignDetailOut(**await svc.remove_person(ctx, campaign_id, recipient_id))


@router.get("/studio/releases/{release_id}/collectibles", response_model=list[CampaignOut])
async def release_collectibles(release_id: UUID, ctx: Ctx, svc: Svc) -> list[CampaignOut]:
    """Collectible campaigns covering this release, with how far their gifts have got."""
    return [CampaignOut(**c) for c in await svc.for_release(ctx, release_id)]


@router.get("/catalog-intake/gift-campaigns", response_model=list[CampaignOut])
async def campaigns_to_review(ctx: Ctx, svc: Svc) -> list[CampaignOut]:
    """Staff: gift campaigns (or changes to live ones) waiting in the active workspace."""
    return [CampaignOut(**c) for c in await svc.review_queue(ctx)]


@router.post("/catalog-intake/gift-campaigns/{campaign_id}/review", response_model=CampaignOut)
async def review_campaign(campaign_id: UUID, body: ReviewIn, ctx: Ctx, svc: Svc) -> CampaignOut:
    return CampaignOut(**await svc.review(ctx, campaign_id, approve=body.action == "approve", note=body.note))


@router.get("/gift-campaigns", response_model=list[PublicGiftOut])
async def public_gifts(
    svc: Svc,
    release_id: UUID | None = Query(default=None),
    track_id: UUID | None = Query(default=None),
) -> list[PublicGiftOut]:
    """Live gift campaigns covering this release or song (public)."""
    return [PublicGiftOut(**g) for g in await svc.public_for(release_id=release_id, track_id=track_id)]
