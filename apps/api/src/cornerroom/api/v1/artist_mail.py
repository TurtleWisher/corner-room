"""Artist emails (owner, 2026-11-02, D-MAIL-01 and D-MAIL-02). Rules live in
modules/commerce/application/artist_mail.py; how one email is written, in artist_mail_render.py."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile
from fastapi.responses import RedirectResponse
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


class PickIn(BaseModel):
    # ALL_BUT: everyone the filters let through except `refs`; ONLY: just `refs`.
    mode: Literal["ALL_BUT", "ONLY"] = "ALL_BUT"
    refs: list[str] = Field(default_factory=list, max_length=5000)


class AudienceIn(BaseModel):
    """Who gets an email. A thank-you uses `works` (none = any of the act's music) and `who` only."""

    works: list[WorkIn] = Field(default_factory=list, max_length=200)
    # ALL buyers or PRESALE buyers only. PICKED (with `picked`) is the pre-D-MAIL-02 shape.
    who: Literal["ALL", "PRESALE", "PICKED"] = "ALL"
    picked: list[str] = Field(default_factory=list, max_length=5000)
    exclude_works: list[WorkIn] = Field(default_factory=list, max_length=200)
    buyer_type: Literal["ANY", "FIRST_TIME", "RETURNING"] = "ANY"
    bought_from: str | None = Field(default=None, max_length=10)
    bought_to: str | None = Field(default=None, max_length=10)
    min_owned: int | None = Field(default=None, ge=0, le=1000)
    pick: PickIn = Field(default_factory=PickIn)


def _audience(a: AudienceIn) -> dict[str, Any]:
    data = a.model_dump()
    data["works"] = [{"type": w.type, "id": str(w.id)} for w in a.works]
    data["exclude_works"] = [{"type": w.type, "id": str(w.id)} for w in a.exclude_works]
    return data


class WorkOut(BaseModel):
    type: str
    id: UUID
    title: str


class AudienceOut(BaseModel):
    works: list[WorkOut]
    who: str
    exclude_works: list[WorkOut] = Field(default_factory=list)
    buyer_type: str = "ANY"
    bought_from: str | None = None
    bought_to: str | None = None
    min_owned: int | None = None
    pick: dict[str, Any] | None = None


class ProfileOut(BaseModel):
    kind: str
    id: UUID
    display_name: str


class FileOut(BaseModel):
    id: UUID
    kind: Literal["FILE", "LINK"]
    name: str
    url: str | None
    content_type: str | None
    byte_size: int | None
    created_at: datetime


class LinkIn(BaseModel):
    name: str = Field(max_length=200)
    url: str = Field(max_length=2000)


class ThankYouIn(BaseModel):
    """On a change, fields left out keep what they are."""

    audience: AudienceIn | None = None
    subject: str | None = Field(default=None, max_length=200)
    body: str | None = Field(default=None, max_length=10000)
    on: bool | None = None
    file_ids: list[UUID] | None = Field(default=None, max_length=50)


class ThankYouOut(BaseModel):
    id: UUID
    audience: AudienceOut
    subject: str
    body: str
    on: bool
    file_ids: list[str]
    sent_count: int
    people_clicked: int
    updated_at: datetime


def _thank_you(body: ThankYouIn) -> dict[str, Any]:
    data: dict[str, Any] = {}
    for key in body.model_fields_set:
        value = getattr(body, key)
        if key == "audience" and value is not None:
            value = _audience(value)
        elif key == "file_ids" and value is not None:
            value = [str(v) for v in value]
        data[key] = value
    return data


class PreviewIn(BaseModel):
    # The buyer the email is being previewed as: their name and what they bought.
    name: str | None = Field(default=None, max_length=120)
    music: list[str] = Field(default_factory=list, max_length=20)


class TestIn(BaseModel):
    kind: Literal["THANK_YOU", "MANUAL"]
    subject: str = Field(max_length=200)
    body: str = Field(max_length=10000)
    works: list[WorkIn] = Field(default_factory=list, max_length=200)
    preview: PreviewIn | None = None
    file_ids: list[UUID] = Field(default_factory=list, max_length=50)


class TestOut(BaseModel):
    sent_to: str


class TemplateIn(BaseModel):
    name: str = Field(max_length=120)
    subject: str = Field(max_length=200)
    body: str = Field(max_length=10000)
    audience: AudienceIn
    occasion: str | None = Field(default=None, max_length=32)
    file_ids: list[UUID] = Field(default_factory=list, max_length=50)


class TemplateOut(BaseModel):
    id: UUID
    name: str
    subject: str
    body: str
    audience: AudienceOut
    occasion: str | None
    file_ids: list[str]
    updated_at: datetime


def _template(body: TemplateIn) -> dict[str, Any]:
    return {**body.model_dump(exclude={"audience", "file_ids"}), "audience": _audience(body.audience),
            "file_ids": [str(f) for f in body.file_ids]}


class ReachOut(BaseModel):
    # People it goes to now, and people left out because they stopped this act's emails.
    count: int
    stopped: int


class PersonOut(BaseModel):
    """Names only (D-BUYERS-01). `ref` picks the person; it is not their account id."""

    ref: str
    name: str
    has_name: bool
    presale: bool
    bought: list[str]
    picked: bool
    stopped: bool


class PeopleOut(BaseModel):
    people: list[PersonOut]
    reach: ReachOut


class MailIn(BaseModel):
    subject: str | None = Field(default=None, max_length=200)
    body: str | None = Field(default=None, max_length=10000)
    audience: AudienceIn | None = None
    # When it goes once approved (Bangladesh time if no zone is given); empty = when approved.
    send_at: datetime | None = None
    occasion: str | None = Field(default=None, max_length=32)
    file_ids: list[UUID] | None = Field(default=None, max_length=50)


def _mail(body: MailIn, *, partial: bool) -> dict[str, Any]:
    keys = body.model_fields_set if partial else set(MailIn.model_fields)
    data: dict[str, Any] = {}
    for key in keys:
        value = getattr(body, key)
        if key == "audience" and value is not None:
            value = _audience(value)
        elif key == "file_ids":
            if value is None:
                continue
            value = [str(v) for v in value]
        elif key in ("send_at", "occasion") and value is None and not partial and key not in body.model_fields_set:
            continue
        data[key] = value.isoformat() if isinstance(value, datetime) else value
    return data


class AttachedFileOut(BaseModel):
    id: UUID
    name: str
    kind: str
    url: str


class MailOut(BaseModel):
    id: UUID
    profile: ProfileOut
    subject: str
    body: str
    audience: AudienceOut
    # DRAFT, IN_REVIEW (waiting for Corner Room), SCHEDULED (approved, goes at send_at), SENDING or SENT.
    status: str
    review_note: str | None
    occasion: str | None
    file_ids: list[str]
    send_at: datetime | None
    sent_at: datetime | None
    created_at: datetime
    submitted_at: datetime | None
    approved_at: datetime | None
    recipient_count: int | None
    # Messages PENDING, SENT, SUPPRESSED (stopped the act's emails before it went) and FAILED.
    counts: dict[str, int]
    reach: ReachOut | None = None
    files: list[AttachedFileOut] | None = None
    # D-PRESALE-03: the release-day email to pre-order buyers goes out when this release does.
    send_with_release_id: UUID | None = None


class OverviewOut(BaseModel):
    profile: ProfileOut
    viewer_role: Literal["owner", "staff"]
    thank_yous: list[ThankYouOut]
    templates: list[TemplateOut]
    mails: list[MailOut]
    files: list[FileOut]
    # Buyers who stopped this act's emails.
    stopped_count: int
    # Emails this act may send in 7 days; 0 = no limit.
    weekly_limit: int
    file_max_bytes: int


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


# --- Studio --------------------------------------------------------------------------------------


@router.get("/studio/profiles/{kind}/{profile_id}/mail", response_model=OverviewOut)
async def mail_overview(kind: Kind, profile_id: UUID, ctx: Ctx, svc: Svc) -> OverviewOut:
    return OverviewOut(**await svc.overview(ctx, kind, profile_id))


@router.post("/studio/profiles/{kind}/{profile_id}/mail/thank-yous", response_model=ThankYouOut, status_code=201)
async def add_thank_you(kind: Kind, profile_id: UUID, body: ThankYouIn, ctx: Ctx, svc: Svc) -> ThankYouOut:
    """A thank-you for one audience. Goes live at once (owner, 2026-11-02)."""
    return ThankYouOut(**await svc.save_thank_you(ctx, kind, profile_id, _thank_you(body)))


@router.put("/studio/mail-thank-yous/{thank_you_id}", response_model=ThankYouOut)
async def change_thank_you(thank_you_id: UUID, body: ThankYouIn, ctx: Ctx, svc: Svc) -> ThankYouOut:
    return ThankYouOut(**await svc.update_thank_you(ctx, thank_you_id, _thank_you(body)))


@router.delete("/studio/mail-thank-yous/{thank_you_id}", status_code=204)
async def delete_thank_you(thank_you_id: UUID, ctx: Ctx, svc: Svc) -> Response:
    await svc.delete_thank_you(ctx, thank_you_id)
    return Response(status_code=204)


@router.post("/studio/profiles/{kind}/{profile_id}/mail/test", response_model=TestOut)
async def send_test(kind: Kind, profile_id: UUID, body: TestIn, ctx: Ctx, svc: Svc) -> TestOut:
    """Send the email as written to your own account address, filled in as the previewed buyer."""
    data = body.model_dump()
    data["works"] = [{"type": w.type, "id": str(w.id)} for w in body.works]
    data["file_ids"] = [str(f) for f in body.file_ids]
    return TestOut(**await svc.send_test(ctx, kind, profile_id, data))


@router.post("/studio/profiles/{kind}/{profile_id}/mail/people", response_model=PeopleOut)
async def mail_people(kind: Kind, profile_id: UUID, body: AudienceIn, ctx: Ctx, svc: Svc) -> PeopleOut:
    """The people an audience's filters let through, names only, to tick in or out and preview as."""
    return PeopleOut(**await svc.people(ctx, kind, profile_id, _audience(body)))


@router.post("/studio/profiles/{kind}/{profile_id}/mail/reach", response_model=ReachOut)
async def mail_reach(kind: Kind, profile_id: UUID, body: AudienceIn, ctx: Ctx, svc: Svc) -> ReachOut:
    return ReachOut(**await svc.audience_size(ctx, kind, profile_id, _audience(body)))


@router.get("/studio/profiles/{kind}/{profile_id}/mail/report")
async def mail_dashboard(kind: Kind, profile_id: UUID, ctx: Ctx, svc: Svc, days: int = Query(default=90)) -> dict[str, Any]:
    """The act's email report over the last 30, 90 or 365 days (counts only; no money, D-MAIL-02)."""
    return await svc.act_report(ctx, kind, profile_id, days)


@router.post("/studio/profiles/{kind}/{profile_id}/mail/files", response_model=FileOut, status_code=201)
async def add_mail_file(
    kind: Kind, profile_id: UUID, ctx: Ctx, svc: Svc, settings: Annotated[Settings, Depends(settings_dep)],
    file: UploadFile = File(...), name: str | None = Form(default=None),
) -> FileOut:
    """A soft copy for buyers (a gift or collectible). Same size limit as other uploads."""
    limit = settings.media_cover_max_bytes
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise AppError("UPLOAD_TOO_LARGE", "File too large", 422, f"The limit is {limit} bytes")
    return FileOut(**await svc.add_file(ctx, kind, profile_id, filename=name or file.filename or "file",
                                        content_type=file.content_type, data=data))


@router.post("/studio/profiles/{kind}/{profile_id}/mail/file-links", response_model=FileOut, status_code=201)
async def add_mail_file_link(kind: Kind, profile_id: UUID, body: LinkIn, ctx: Ctx, svc: Svc) -> FileOut:
    """A soft copy kept elsewhere (a Drive or Dropbox link, say)."""
    return FileOut(**await svc.add_link(ctx, kind, profile_id, body.model_dump()))


@router.delete("/studio/mail-files/{file_id}", status_code=204)
async def delete_mail_file(file_id: UUID, ctx: Ctx, svc: Svc) -> Response:
    await svc.delete_file(ctx, file_id)
    return Response(status_code=204)


@router.post("/studio/profiles/{kind}/{profile_id}/mail/templates", response_model=TemplateOut, status_code=201)
async def create_template(kind: Kind, profile_id: UUID, body: TemplateIn, ctx: Ctx, svc: Svc) -> TemplateOut:
    return TemplateOut(**await svc.save_template(ctx, kind, profile_id, _template(body)))


@router.put("/studio/mail-templates/{template_id}", response_model=TemplateOut)
async def update_template(template_id: UUID, body: TemplateIn, ctx: Ctx, svc: Svc) -> TemplateOut:
    return TemplateOut(**await svc.update_template(ctx, template_id, _template(body)))


@router.delete("/studio/mail-templates/{template_id}", status_code=204)
async def delete_template(template_id: UUID, ctx: Ctx, svc: Svc) -> Response:
    await svc.delete_template(ctx, template_id)
    return Response(status_code=204)


@router.post("/studio/profiles/{kind}/{profile_id}/mails", response_model=MailOut, status_code=201)
async def create_mail(kind: Kind, profile_id: UUID, body: MailIn, ctx: Ctx, svc: Svc) -> MailOut:
    return MailOut(**await svc.create_mail(ctx, kind, profile_id, _mail(body, partial=False)))


@router.get("/studio/mails/{mail_id}", response_model=MailOut)
async def mail_detail(mail_id: UUID, ctx: Ctx, svc: Svc) -> MailOut:
    return MailOut(**await svc.mail_detail(ctx, mail_id))


@router.patch("/studio/mails/{mail_id}", response_model=MailOut)
async def change_mail(mail_id: UUID, body: MailIn, ctx: Ctx, svc: Svc) -> MailOut:
    """Drafts only."""
    return MailOut(**await svc.update_mail(ctx, mail_id, _mail(body, partial=True)))


@router.delete("/studio/mails/{mail_id}", status_code=204)
async def discard_mail(mail_id: UUID, ctx: Ctx, svc: Svc) -> Response:
    """Drafts only."""
    await svc.discard_mail(ctx, mail_id)
    return Response(status_code=204)


@router.post("/studio/mails/{mail_id}/copy", response_model=MailOut, status_code=201)
async def copy_mail(mail_id: UUID, ctx: Ctx, svc: Svc) -> MailOut:
    """A new draft with the same words, audience and files."""
    return MailOut(**await svc.copy_mail(ctx, mail_id))


@router.post("/studio/mails/{mail_id}/submit", response_model=MailOut)
async def submit_mail(mail_id: UUID, ctx: Ctx, svc: Svc) -> MailOut:
    """Send for Corner Room's review; it goes out once approved, or at its time."""
    return MailOut(**await svc.submit_mail(ctx, mail_id))


@router.post("/studio/mails/{mail_id}/withdraw", response_model=MailOut)
async def withdraw_mail(mail_id: UUID, ctx: Ctx, svc: Svc) -> MailOut:
    return MailOut(**await svc.withdraw_mail(ctx, mail_id))


@router.get("/studio/mails/{mail_id}/report")
async def mail_report(mail_id: UUID, ctx: Ctx, svc: Svc) -> dict[str, Any]:
    """One email's results: reach, delivery, clicks per link and over time, stops."""
    return await svc.mail_report(ctx, mail_id)


# --- staff ---------------------------------------------------------------------------------------


@router.get("/catalog-intake/artist-mails", response_model=list[MailOut])
async def mails_to_review(ctx: Ctx, svc: Svc) -> list[MailOut]:
    """Staff: artists' emails to buyers waiting in the active workspace."""
    return [MailOut(**m) for m in await svc.review_queue(ctx)]


@router.post("/catalog-intake/artist-mails/{mail_id}/review", response_model=MailOut)
async def review_mail(mail_id: UUID, body: ReviewIn, ctx: Ctx, svc: Svc) -> MailOut:
    """Approve (sent now to whoever the audience reaches, or at its time) or send back with a note."""
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


@router.get("/artist-mail/c/{token}/{position}", include_in_schema=False)
async def open_link(token: str, position: int, svc: Svc) -> Response:
    """A link in an act's email: counted (D-MAIL-02), then opened. No sign-in."""
    out = await svc.click(token, position)
    if "file" in out:
        filename = quote(out["name"])
        return Response(
            content=out["file"], media_type=out["content_type"],
            headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}", "Cache-Control": "private, no-store"},
        )
    return RedirectResponse(out["redirect"], status_code=302, headers={"Cache-Control": "no-store"})
