"""Fan gifts and gift credit (owner, 2026-11-20, D-GIFT-FAN-01). Buying a gift goes through
`POST /orders` with `gift`; paying with credit through `POST /orders` with `use_credit`."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.api.deps import db_session, get_auth_context, get_optional_auth_context, settings_dep
from cornerroom.infra.errors import AppError
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
    files: list["GiftFileOut"] = []


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
    # Set when someone didn't claim it and the music is still on sale: checkout opens on it.
    send_again_offer_id: UUID | None = None


class CreditOut(BaseModel):
    act_id: UUID
    act_name: str
    balance: MoneyOut


class OfferCreditOut(BaseModel):
    usable: bool
    balance: MoneyOut | None = None
    act_name: str | None = None


class GiftFileOut(BaseModel):
    id: UUID
    name: str
    # IMAGE (shown in the email) or PDF (a download).
    kind: str
    byte_size: int


class PreviewIn(BaseModel):
    offer_id: UUID
    note: str | None = Field(default=None, max_length=4000)
    subject: str | None = Field(default=None, max_length=400)
    look: str | None = Field(default=None, max_length=10)
    show_cover: bool = True
    file_ids: list[UUID] = Field(default_factory=list, max_length=10)
    # Whose name {first_name} shows (one of the people typed); None reads "there".
    person_name: str | None = Field(default=None, max_length=200)


class PreviewOut(BaseModel):
    subject: str
    html: str
    text: str
    # Words or files wait for Corner Room to check before anyone is emailed.
    needs_review: bool


class StaffPreviewOut(BaseModel):
    subject: str
    html: str
    files: list[GiftFileOut]


class NoteOut(BaseModel):
    id: UUID
    note: str | None
    subject: str | None = None
    look: str = "SKY"
    files: list[GiftFileOut] = []
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


def _file_response(found: tuple[bytes, str, str, str]) -> Response:
    data, mime, name, kind = found
    safe = "".join(ch for ch in name if ch.isalnum() or ch in "._- ")[:120] or "file"
    disposition = "inline" if kind == "IMAGE" else "attachment"
    return Response(
        content=data,
        media_type=mime,
        headers={
            "Content-Disposition": f'{disposition}; filename="{safe}"',
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, max-age=300",
        },
    )


class SendAgainPersonOut(BaseModel):
    email: str
    name: str | None = None


class SendAgainOut(BaseModel):
    offer_id: UUID
    people: list[SendAgainPersonOut]
    note: str
    subject: str
    look: str
    show_cover: bool
    files: list[GiftFileOut]


@router.post("/me/fan-gifts/{gift_id}/send-again", response_model=SendAgainOut)
async def send_gift_again(gift_id: UUID, svc: Svc, ctx: Ctx) -> dict[str, Any]:
    """Everything to send a gift again as it was: the people who didn't claim it, the words, look,
    cover and copies of its files (owner, 2026-11-27, D-GIFT-FAN-03). Sends nothing itself."""
    return await svc.send_again(ctx, gift_id)


@router.post("/me/fan-gift-files", response_model=GiftFileOut, status_code=201)
async def add_gift_file(
    svc: Svc, ctx: Ctx, settings: Annotated[Settings, Depends(settings_dep)],
    file: UploadFile = File(...), name: str | None = Form(default=None),
) -> dict[str, Any]:
    """A picture or PDF for a gift's email (D-GIFT-FAN-02). Same size limit as other uploads."""
    limit = settings.media_cover_max_bytes
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise AppError("UPLOAD_TOO_LARGE", "File too large", 422, f"The limit is {limit} bytes")
    return await svc.add_file(ctx, filename=name or file.filename or "", content_type=file.content_type, data=data)


@router.get("/me/fan-gift-files/{file_id}")
async def my_gift_file(file_id: UUID, svc: Svc, ctx: Ctx) -> Response:
    return _file_response(await svc.file_for_owner(ctx, file_id))


@router.delete("/me/fan-gift-files/{file_id}", status_code=204)
async def delete_gift_file(file_id: UUID, svc: Svc, ctx: Ctx) -> Response:
    await svc.delete_file(ctx, file_id)
    return Response(status_code=204)


@router.post("/fan-gifts/preview", response_model=PreviewOut)
async def preview_gift_email(body: PreviewIn, svc: Svc, ctx: Ctx) -> dict[str, Any]:
    """The gift email exactly as one person will get it. Nothing is sent or kept."""
    raw = body.model_dump(exclude={"offer_id", "person_name"})
    raw["file_ids"] = [str(f) for f in body.file_ids]
    return await svc.preview(ctx, offer_id=body.offer_id, raw=raw, person_name=body.person_name)


@router.get("/gifts/{token}/files/{file_id}")
async def gift_file(token: str, file_id: UUID, svc: Svc) -> Response:
    """A gift's picture or PDF, opened through the person's own gift link."""
    return _file_response(await svc.file_for_token(token, file_id))


@router.get("/staff/fan-gift-notes/{gift_id}/preview", response_model=StaffPreviewOut)
async def staff_preview(gift_id: UUID, svc: Svc, ctx: Ctx) -> dict[str, Any]:
    return await svc.staff_preview(ctx, gift_id)


@router.get("/staff/fan-gift-files/{file_id}")
async def staff_gift_file(file_id: UUID, svc: Svc, ctx: Ctx) -> Response:
    return _file_response(await svc.file_for_staff(ctx, file_id))


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


GiftPageOut.model_rebuild()
