"""Music gifts (owner, 2026-11-06, D-GIFT-MUSIC-01): artists give music free to chosen people.
Rules live in modules/commerce/application/music_gifts.py."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.api.deps import db_session, get_auth_context, settings_dep
from cornerroom.infra.settings import Settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.commerce.application.music_gifts import MusicGiftService

router = APIRouter(tags=["music-gifts"])


async def music_gifts(
    session: Annotated[AsyncSession, Depends(db_session)],
    settings: Annotated[Settings, Depends(settings_dep)],
) -> MusicGiftService:
    return MusicGiftService(session, settings)


Svc = Annotated[MusicGiftService, Depends(music_gifts)]
Ctx = Annotated[AuthContext, Depends(get_auth_context)]
Kind = Literal["artist", "band"]


class WorkIn(BaseModel):
    type: Literal["RELEASE", "TRACK"]
    id: UUID


class PersonIn(BaseModel):
    email: str = Field(max_length=320)
    name: str | None = Field(default=None, max_length=200)
    note: str | None = Field(default=None, max_length=1000)


class GiftIn(BaseModel):
    """Fields left out keep what they are (on a change). `people` replaces the list; `buyer_refs`
    adds the act's buyers by their reference (their address stays on the server)."""

    title: str | None = Field(default=None, max_length=200)
    works: list[WorkIn] | None = Field(default=None, max_length=200)
    subject: str | None = Field(default=None, max_length=200)
    body: str | None = Field(default=None, max_length=10000)
    file_ids: list[UUID] | None = Field(default=None, max_length=20)
    send_at: datetime | None = None
    people: list[PersonIn] | None = Field(default=None, max_length=5000)
    buyer_refs: list[str] | None = Field(default=None, max_length=5000)


def _data(body: GiftIn) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key in body.model_fields_set:
        value = getattr(body, key)
        if key == "works" and value is not None:
            value = [{"type": w.type, "id": str(w.id)} for w in value]
        elif key == "people" and value is not None:
            value = [p.model_dump() for p in value]
        elif key == "file_ids" and value is not None:
            value = [str(v) for v in value]
        out[key] = value
    return out


class WorkOut(BaseModel):
    type: str
    id: UUID
    title: str


class ProfileOut(BaseModel):
    kind: str
    id: UUID
    display_name: str


class GiftOut(BaseModel):
    id: UUID
    profile: ProfileOut
    title: str
    works: list[WorkOut]
    subject: str
    body: str
    file_ids: list[str]
    send_at: datetime | None
    # DRAFT, IN_REVIEW, SCHEDULED (approved, waiting for its time) or SENT (given).
    status: str
    review_note: str | None
    created_at: datetime
    submitted_at: datetime | None
    approved_at: datetime | None
    sent_at: datetime | None
    # WAITING, GIVEN, WAITING_ACCOUNT, ALREADY_OWNED and TOTAL.
    counts: dict[str, int]


class FileOut(BaseModel):
    id: UUID
    name: str
    kind: str


class PersonOut(BaseModel):
    id: UUID
    email: str
    name: str | None
    note: str | None
    # WAITING, GIVEN (owns it now), WAITING_ACCOUNT (emailed; gets it when that address signs up)
    # or ALREADY_OWNED.
    status: str
    given_at: datetime | None
    emailed_at: datetime | None
    # The email: PENDING, SENT, SUPPRESSED (stopped emails from the act) or FAILED; None before.
    email_status: str | None
    clicks: int


class GiftDetailOut(GiftOut):
    viewer_role: Literal["owner", "staff"]
    files: list[FileOut]
    people: list[PersonOut]


class ReviewPersonOut(BaseModel):
    email: str
    name: str | None
    note: str | None


class ReviewGiftOut(GiftOut):
    files: list[FileOut]
    people: list[ReviewPersonOut]


class SuggestionOut(BaseModel):
    ref: str
    name: str | None
    label: str


class ReviewIn(BaseModel):
    action: Literal["approve", "reject"]
    note: str | None = Field(default=None, max_length=2000)


class TestOut(BaseModel):
    sent_to: str


@router.get("/studio/profiles/{kind}/{profile_id}/music-gifts", response_model=list[GiftOut])
async def list_gifts(kind: Kind, profile_id: UUID, ctx: Ctx, svc: Svc) -> list[GiftOut]:
    return [GiftOut(**g) for g in await svc.list_for_profile(ctx, kind, profile_id)]


@router.get("/studio/profiles/{kind}/{profile_id}/music-gifts/people", response_model=list[SuggestionOut])
async def gift_suggestions(kind: Kind, profile_id: UUID, ctx: Ctx, svc: Svc) -> list[SuggestionOut]:
    """The act's buyers, by name only, to add to a gift."""
    return [SuggestionOut(**s) for s in await svc.suggestions(ctx, kind, profile_id)]


@router.post("/studio/profiles/{kind}/{profile_id}/music-gifts", response_model=GiftDetailOut, status_code=201)
async def create_gift(kind: Kind, profile_id: UUID, body: GiftIn, ctx: Ctx, svc: Svc) -> GiftDetailOut:
    return GiftDetailOut(**await svc.create(ctx, kind, profile_id, _data(body)))


@router.get("/studio/music-gifts/{gift_id}", response_model=GiftDetailOut)
async def gift_detail(gift_id: UUID, ctx: Ctx, svc: Svc) -> GiftDetailOut:
    return GiftDetailOut(**await svc.detail(ctx, gift_id))


@router.patch("/studio/music-gifts/{gift_id}", response_model=GiftDetailOut)
async def change_gift(gift_id: UUID, body: GiftIn, ctx: Ctx, svc: Svc) -> GiftDetailOut:
    return GiftDetailOut(**await svc.update(ctx, gift_id, _data(body)))


@router.delete("/studio/music-gifts/{gift_id}", status_code=204)
async def discard_gift(gift_id: UUID, ctx: Ctx, svc: Svc) -> Response:
    await svc.discard(ctx, gift_id)
    return Response(status_code=204)


@router.post("/studio/music-gifts/{gift_id}/copy", response_model=GiftDetailOut, status_code=201)
async def copy_gift(gift_id: UUID, ctx: Ctx, svc: Svc) -> GiftDetailOut:
    return GiftDetailOut(**await svc.copy(ctx, gift_id))


@router.post("/studio/music-gifts/{gift_id}/submit", response_model=GiftDetailOut)
async def submit_gift(gift_id: UUID, ctx: Ctx, svc: Svc) -> GiftDetailOut:
    return GiftDetailOut(**await svc.submit(ctx, gift_id))


@router.post("/studio/music-gifts/{gift_id}/withdraw", response_model=GiftDetailOut)
async def withdraw_gift(gift_id: UUID, ctx: Ctx, svc: Svc) -> GiftDetailOut:
    return GiftDetailOut(**await svc.withdraw(ctx, gift_id))


@router.post("/studio/music-gifts/{gift_id}/test", response_model=TestOut)
async def test_gift(gift_id: UUID, ctx: Ctx, svc: Svc) -> TestOut:
    """The gift's email, as the first person on the list gets it, to the asker's own address."""
    return TestOut(**await svc.send_test(ctx, gift_id))


@router.get("/catalog-intake/music-gifts", response_model=list[ReviewGiftOut])
async def gifts_to_review(ctx: Ctx, svc: Svc) -> list[ReviewGiftOut]:
    """Staff: music gifts waiting for review in the active workspace."""
    return [ReviewGiftOut(**g) for g in await svc.review_queue(ctx)]


@router.post("/catalog-intake/music-gifts/{gift_id}/review", response_model=GiftOut)
async def review_gift(gift_id: UUID, body: ReviewIn, ctx: Ctx, svc: Svc) -> GiftOut:
    return GiftOut(**await svc.review(ctx, gift_id, approve=body.action == "approve", note=body.note))
