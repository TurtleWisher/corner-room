"""Artist emails (owner, 2026-11-02, D-MAIL-01). Rules live in
modules/commerce/application/artist_mail.py."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.api.deps import db_session, get_auth_context, settings_dep
from cornerroom.infra.errors import AppError
from cornerroom.infra.settings import Settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.commerce.application.artist_mail import ArtistMailService

router = APIRouter(tags=["artist-mail"])


async def artist_mail(
    session: Annotated[AsyncSession, Depends(db_session)],
    settings: Annotated[Settings, Depends(settings_dep)],
) -> ArtistMailService:
    return ArtistMailService(session, settings)


Svc = Annotated[ArtistMailService, Depends(artist_mail)]
Ctx = Annotated[AuthContext, Depends(get_auth_context)]
Kind = Literal["artist", "band"]


class WorkIn(BaseModel):
    type: Literal["RELEASE", "TRACK"]
    id: UUID


class AudienceIn(BaseModel):
    works: list[WorkIn] = Field(min_length=1, max_length=200)
    # ALL buyers of these works, PRESALE buyers only, or PICKED people (refs from the buyer list).
    who: Literal["ALL", "PRESALE", "PICKED"] = "ALL"
    picked: list[str] = Field(default_factory=list, max_length=5000)


def _audience(a: AudienceIn) -> dict[str, Any]:
    return {"works": [{"type": w.type, "id": str(w.id)} for w in a.works], "who": a.who, "picked": a.picked}


class WorkOut(BaseModel):
    type: str
    id: UUID
    title: str


class AudienceOut(BaseModel):
    works: list[WorkOut]
    who: str
    picked: list[str]


class ProfileOut(BaseModel):
    kind: str
    id: UUID
    display_name: str


class ThankYouOut(BaseModel):
    on: bool
    subject: str
    body: str
    default_subject: str
    default_body: str
    sent_count: int


class ThankYouIn(BaseModel):
    """Fields left out keep what they are. Empty text goes back to Corner Room's default."""

    on: bool | None = None
    subject: str | None = Field(default=None, max_length=200)
    body: str | None = Field(default=None, max_length=10000)


class TestIn(BaseModel):
    kind: Literal["THANK_YOU", "MANUAL"]
    subject: str = Field(max_length=200)
    body: str = Field(max_length=10000)


class TestOut(BaseModel):
    sent_to: str


class TemplateIn(BaseModel):
    name: str = Field(max_length=120)
    subject: str = Field(max_length=200)
    body: str = Field(max_length=10000)
    audience: AudienceIn


class TemplateOut(BaseModel):
    id: UUID
    name: str
    subject: str
    body: str
    audience: AudienceOut
    updated_at: datetime


class ReachOut(BaseModel):
    # People it goes to now, and buyers left out because they stopped this act's emails.
    count: int
    stopped: int


class MailIn(BaseModel):
    subject: str | None = Field(default=None, max_length=200)
    body: str | None = Field(default=None, max_length=10000)
    audience: AudienceIn | None = None


class MailOut(BaseModel):
    id: UUID
    profile: ProfileOut
    subject: str
    body: str
    audience: AudienceOut
    # DRAFT, IN_REVIEW (waiting for Corner Room), SENDING or SENT.
    status: str
    review_note: str | None
    created_at: datetime
    submitted_at: datetime | None
    approved_at: datetime | None
    recipient_count: int | None
    # Messages PENDING, SENT and SUPPRESSED (the person stopped the act's emails before it went).
    counts: dict[str, int]
    reach: ReachOut | None = None


class OverviewOut(BaseModel):
    profile: ProfileOut
    viewer_role: Literal["owner", "staff"]
    thank_you: ThankYouOut
    templates: list[TemplateOut]
    mails: list[MailOut]
    # Buyers who stopped this act's emails.
    stopped_count: int
    # Emails this act may send in 7 days; 0 = no limit.
    weekly_limit: int


class BuyerOut(BaseModel):
    """Names only (D-BUYERS-01). `ref` picks the person; it is not their account id."""

    ref: str
    name: str
    presale: bool


class ReviewIn(BaseModel):
    action: Literal["approve", "reject"]
    note: str | None = Field(default=None, max_length=2000)


class ChoiceOut(BaseModel):
    kind: str
    id: UUID
    display_name: str
    receiving: bool


class ChoiceIn(BaseModel):
    receiving: bool


class StopOut(BaseModel):
    artist: str
    stopped: bool


def _works(work: list[str]) -> list[dict[str, str]]:
    out = []
    for item in work[:200]:
        kind, _sep, wid = item.partition(":")
        if kind.upper() not in ("TRACK", "RELEASE") or not wid:
            raise AppError("VALIDATION_ERROR", "Unknown song or release", 422, extras={"field": "work"})
        out.append({"type": kind.upper(), "id": wid})
    return out


# --- Studio --------------------------------------------------------------------------------------


@router.get("/studio/profiles/{kind}/{profile_id}/mail", response_model=OverviewOut)
async def mail_overview(kind: Kind, profile_id: UUID, ctx: Ctx, svc: Svc) -> OverviewOut:
    return OverviewOut(**await svc.overview(ctx, kind, profile_id))


@router.put("/studio/profiles/{kind}/{profile_id}/mail/thank-you", response_model=ThankYouOut)
async def set_thank_you(kind: Kind, profile_id: UUID, body: ThankYouIn, ctx: Ctx, svc: Svc) -> ThankYouOut:
    """Goes live at once (owner, 2026-11-02)."""
    data = {k: getattr(body, k) for k in body.model_fields_set}
    return ThankYouOut(**await svc.set_thank_you(ctx, kind, profile_id, data))


@router.post("/studio/profiles/{kind}/{profile_id}/mail/test", response_model=TestOut)
async def send_test(kind: Kind, profile_id: UUID, body: TestIn, ctx: Ctx, svc: Svc) -> TestOut:
    """Send the email as written to your own account address."""
    return TestOut(**await svc.send_test(ctx, kind, profile_id, body.model_dump()))


@router.get("/studio/profiles/{kind}/{profile_id}/mail/buyers", response_model=list[BuyerOut])
async def mail_buyers(kind: Kind, profile_id: UUID, ctx: Ctx, svc: Svc, work: list[str] = Query(default=[])) -> list[BuyerOut]:
    """Buyers of these works (`work=TRACK:<id>` or `work=RELEASE:<id>`, repeated), names only."""
    return [BuyerOut(**b) for b in await svc.buyers(ctx, kind, profile_id, _works(work))]


@router.post("/studio/profiles/{kind}/{profile_id}/mail/reach", response_model=ReachOut)
async def mail_reach(kind: Kind, profile_id: UUID, body: AudienceIn, ctx: Ctx, svc: Svc) -> ReachOut:
    return ReachOut(**await svc.audience_size(ctx, kind, profile_id, _audience(body)))


@router.post("/studio/profiles/{kind}/{profile_id}/mail/templates", response_model=TemplateOut, status_code=201)
async def create_template(kind: Kind, profile_id: UUID, body: TemplateIn, ctx: Ctx, svc: Svc) -> TemplateOut:
    data = {**body.model_dump(exclude={"audience"}), "audience": _audience(body.audience)}
    return TemplateOut(**await svc.save_template(ctx, kind, profile_id, data))


@router.put("/studio/mail-templates/{template_id}", response_model=TemplateOut)
async def update_template(template_id: UUID, body: TemplateIn, ctx: Ctx, svc: Svc) -> TemplateOut:
    data = {**body.model_dump(exclude={"audience"}), "audience": _audience(body.audience)}
    return TemplateOut(**await svc.update_template(ctx, template_id, data))


@router.delete("/studio/mail-templates/{template_id}", status_code=204)
async def delete_template(template_id: UUID, ctx: Ctx, svc: Svc) -> Response:
    await svc.delete_template(ctx, template_id)
    return Response(status_code=204)


@router.post("/studio/profiles/{kind}/{profile_id}/mails", response_model=MailOut, status_code=201)
async def create_mail(kind: Kind, profile_id: UUID, body: MailIn, ctx: Ctx, svc: Svc) -> MailOut:
    data: dict[str, Any] = {"subject": body.subject, "body": body.body, "audience": _audience(body.audience) if body.audience else None}
    return MailOut(**await svc.create_mail(ctx, kind, profile_id, data))


@router.get("/studio/mails/{mail_id}", response_model=MailOut)
async def mail_detail(mail_id: UUID, ctx: Ctx, svc: Svc) -> MailOut:
    return MailOut(**await svc.mail_detail(ctx, mail_id))


@router.patch("/studio/mails/{mail_id}", response_model=MailOut)
async def change_mail(mail_id: UUID, body: MailIn, ctx: Ctx, svc: Svc) -> MailOut:
    """Drafts only."""
    data: dict[str, Any] = {}
    for key in body.model_fields_set:
        value = getattr(body, key)
        data[key] = _audience(value) if key == "audience" and value is not None else value
    return MailOut(**await svc.update_mail(ctx, mail_id, data))


@router.delete("/studio/mails/{mail_id}", status_code=204)
async def discard_mail(mail_id: UUID, ctx: Ctx, svc: Svc) -> Response:
    """Drafts only."""
    await svc.discard_mail(ctx, mail_id)
    return Response(status_code=204)


@router.post("/studio/mails/{mail_id}/submit", response_model=MailOut)
async def submit_mail(mail_id: UUID, ctx: Ctx, svc: Svc) -> MailOut:
    """Send for Corner Room's review; it goes out once approved."""
    return MailOut(**await svc.submit_mail(ctx, mail_id))


@router.post("/studio/mails/{mail_id}/withdraw", response_model=MailOut)
async def withdraw_mail(mail_id: UUID, ctx: Ctx, svc: Svc) -> MailOut:
    return MailOut(**await svc.withdraw_mail(ctx, mail_id))


# --- staff ---------------------------------------------------------------------------------------


@router.get("/catalog-intake/artist-mails", response_model=list[MailOut])
async def mails_to_review(ctx: Ctx, svc: Svc) -> list[MailOut]:
    """Staff: artists' emails to buyers waiting in the active workspace."""
    return [MailOut(**m) for m in await svc.review_queue(ctx)]


@router.post("/catalog-intake/artist-mails/{mail_id}/review", response_model=MailOut)
async def review_mail(mail_id: UUID, body: ReviewIn, ctx: Ctx, svc: Svc) -> MailOut:
    """Approve (it is sent to whoever the audience reaches now) or send back with a note."""
    return MailOut(**await svc.review(ctx, mail_id, approve=body.action == "approve", note=body.note))


# --- buyers --------------------------------------------------------------------------------------


@router.get("/me/artist-mail", response_model=list[ChoiceOut])
async def my_artist_mail(ctx: Ctx, svc: Svc) -> list[ChoiceOut]:
    """Artists and bands you bought from, and whether you get their emails (thank-yous always send)."""
    return [ChoiceOut(**c) for c in await svc.my_choices(ctx)]


@router.put("/me/artist-mail/{kind}/{profile_id}", response_model=list[ChoiceOut])
async def set_my_artist_mail(kind: Kind, profile_id: UUID, body: ChoiceIn, ctx: Ctx, svc: Svc) -> list[ChoiceOut]:
    return [ChoiceOut(**c) for c in await svc.set_choice(ctx, kind, profile_id, receiving=body.receiving)]


@router.get("/artist-mail/stop/{token}", response_model=StopOut)
async def stop_link_info(token: str, svc: Svc) -> StopOut:
    """The stop link in an email to buyers (no sign-in): whose emails, and whether already stopped."""
    return StopOut(**await svc.stop_link(token, stop=False))


@router.post("/artist-mail/stop/{token}", response_model=StopOut)
async def stop_link(token: str, svc: Svc) -> StopOut:
    return StopOut(**await svc.stop_link(token, stop=True))
