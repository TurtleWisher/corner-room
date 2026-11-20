"""Fan gifts and gift credit (owner, 2026-11-20, D-GIFT-FAN-01). Buying a gift goes through
`POST /orders` with `gift`; paying with credit through `POST /orders` with `use_credit`."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.api.deps import db_session, get_auth_context, get_optional_auth_context, settings_dep
from cornerroom.infra.settings import Settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.commerce.application.fan_gifts import FanGiftService

router = APIRouter(tags=["fan-gifts"])


async def fan_gifts(
    session: Annotated[AsyncSession, Depends(db_session)],
    settings: Annotated[Settings, Depends(settings_dep)],
) -> FanGiftService:
    return FanGiftService(session, settings)


Svc = Annotated[FanGiftService, Depends(fan_gifts)]
Ctx = Annotated[AuthContext, Depends(get_auth_context)]
MaybeCtx = Annotated[AuthContext | None, Depends(get_optional_auth_context)]


class MoneyOut(BaseModel):
    amount_minor: int
    currency_code: str


class SpendOut(BaseModel):
    offer_id: UUID
    kind: str
    subject_id: UUID
    title: str
    price: MoneyOut
    open_price: bool = False


class GiftPageOut(BaseModel):
    giver_name: str | None
    passed_on_by: str | None = None
    work_type: str
    work_id: UUID
    title: str
    act_name: str
    note: str | None = None
    # A pre-order: it unlocks on release day.
    preorder: bool = False
    for_email: str
    # RECIPIENT: signed in as the person it is for. SIGNED_IN: someone else. SIGNED_OUT.
    viewer: str
    status: str | None = None
    expires_at: datetime | None = None
    amount: MoneyOut | None = None
    credit: MoneyOut | None = None
    spend_on: list[SpendOut] = []


class ChooseIn(BaseModel):
    choice: Literal["KEEP_CREDIT", "PASS_ON", "DECLINE"]
    email: str | None = Field(default=None, max_length=320)
    name: str | None = Field(default=None, max_length=200)


class GivenPersonOut(BaseModel):
    email: str
    name: str | None = None
    # NOT_SENT_YET, DELIVERED, ACCEPTED, PASSED_ON, DECLINED, NOT_CLAIMED (never why).
    state: str


class MyGiftOut(BaseModel):
    id: UUID
    order_id: UUID
    work_type: str
    work_id: UUID
    title: str
    act_name: str
    status: str
    note_state: str
    created_at: datetime | None = None
    each: MoneyOut
    people: list[GivenPersonOut]


class CreditOut(BaseModel):
    act_id: UUID
    act_name: str
    balance: MoneyOut


class OfferCreditOut(BaseModel):
    usable: bool
    balance: MoneyOut | None = None
    act_name: str | None = None


class NoteOut(BaseModel):
    id: UUID
    note: str | None
    title: str
    act_name: str
    giver_name: str | None = None
    people: int
    paid_at: datetime | None = None


class NoteReviewIn(BaseModel):
    approve: bool


class NoteReviewOut(BaseModel):
    id: UUID
    note_state: str
    status: str


@router.get("/gifts/{token}", response_model=GiftPageOut)
async def open_gift(token: str, svc: Svc, ctx: MaybeCtx) -> dict[str, Any]:
    return await svc.open(ctx, token)


@router.post("/gifts/{token}/choose", response_model=GiftPageOut)
async def choose(token: str, body: ChooseIn, svc: Svc, ctx: Ctx) -> dict[str, Any]:
    return await svc.choose(ctx, token, choice=body.choice, email=body.email, name=body.name)


@router.get("/me/fan-gifts", response_model=list[MyGiftOut])
async def my_gifts(svc: Svc, ctx: Ctx) -> list[dict[str, Any]]:
    return await svc.mine(ctx)


@router.get("/me/gift-credit", response_model=list[CreditOut])
async def my_credit(svc: Svc, ctx: Ctx) -> list[dict[str, Any]]:
    return await svc.my_credit(ctx)


@router.get("/me/gift-credit/offers/{offer_id}", response_model=OfferCreditOut)
async def credit_for_offer(offer_id: UUID, svc: Svc, ctx: Ctx) -> dict[str, Any]:
    return await svc.credit_for_offer(ctx, offer_id)


@router.get("/staff/fan-gift-notes", response_model=list[NoteOut])
async def note_queue(svc: Svc, ctx: Ctx) -> list[dict[str, Any]]:
    return await svc.note_queue(ctx)


@router.post("/staff/fan-gift-notes/{gift_id}/review", response_model=NoteReviewOut)
async def review_note(gift_id: UUID, body: NoteReviewIn, svc: Svc, ctx: Ctx) -> dict[str, Any]:
    return await svc.review_note(ctx, gift_id, approve=body.approve)
