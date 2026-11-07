"""An act's own wording for collectible status emails (owner, 2026-11-07, D-CAMPAIGN-05).

For each gift campaign the act may write the email for each status that tells the buyer
(Dispatched, Returned, Missing) in the artist-email editor, with fill-ins. Staff approve each one
(someone other than the act's owners or whoever wrote it); until then, and whenever the act goes
back to it, Corner Room's own wording (`GIFT_EMAILS`) sends. Editing an approved email keeps the
approved words sending until staff approve the new ones.

These emails are about something the buyer is owed, so they always send: a stop from the act's
emails doesn't stop them, and they carry no stop link. They go to every buyer by email (account
holders too, whose in-app note stays Corner Room's).
"""

from __future__ import annotations

import re
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, NotFoundError
from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.infra.settings import Settings, get_settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import (
    GIFT_DISPATCHED,
    GIFT_MARKED_MISSING,
    GIFT_RETURNED,
    GIFT_STATUS_MAIL_APPROVED,
    GIFT_STATUS_MAIL_RETURNED,
    GIFT_STATUS_MAIL_SUBMITTED,
    DomainEvent,
)
from cornerroom.modules.commerce.domain.gifts import STATUS_MAIL_STATUSES, GiftCampaign, GiftRecipient, GiftStatusMail

SUBJECT_MAX = 200
BODY_MAX = 5000
# The fill-ins these emails take: the artist-email ones plus the gift itself.
FILL_INS = ("first_name", "buyer_name", "artist", "music", "gift")
_FILL = re.compile(r"\{([a-z_]+)\}")
# Starter text marks the bits to write as [add ...]; they must be gone before staff see it.
_UNFINISHED = re.compile(r"\[add [^\]]*\]", re.IGNORECASE)

EVENT_STATUS = {GIFT_DISPATCHED: "DISPATCHED", GIFT_RETURNED: "RETURNED", GIFT_MARKED_MISSING: "MISSING"}

# The starting words in the editor: Corner Room's own wording, greeting the buyer by name.
DEFAULTS: dict[str, tuple[str, str]] = {
    "DISPATCHED": (
        "A gift is on its way",
        "Hi {first_name},\n\nGood news from {artist}: a gift for buying {music} is on its way to you ({gift}). "
        "It should reach you in the next few days.",
    ),
    "RETURNED": (
        "Your gift couldn't be delivered",
        "Hi {first_name},\n\nYour gift from {artist} ({gift}), for buying {music}, couldn't be delivered and came back. "
        "Please check that the delivery address you gave us is correct. Once your address is right, it will be sent "
        "again. We'll email you again when there's news.",
    ),
    "MISSING": (
        "Your gift is taking longer than expected",
        "Hi {first_name},\n\nYour gift from {artist} ({gift}), for buying {music}, hasn't arrived yet. We're finding out "
        "where it is and will email you as soon as we know more. If it doesn't turn up, we'll send another. You don't "
        "need to do anything for now.",
    ),
}


def check_words(subject: str, body: str) -> tuple[str, str]:
    """Trimmed words, or the reason they can't be saved."""
    subject = " ".join((subject or "").split())
    body = (body or "").replace("\r\n", "\n").strip()
    if not subject:
        raise AppError("VALIDATION_ERROR", "Write a subject", 422)
    if not body:
        raise AppError("VALIDATION_ERROR", "Write the email", 422)
    if len(subject) > SUBJECT_MAX:
        raise AppError("VALIDATION_ERROR", f"Keep the subject under {SUBJECT_MAX} characters", 422)
    if len(body) > BODY_MAX:
        raise AppError("VALIDATION_ERROR", f"Keep the email under {BODY_MAX} characters", 422)
    unknown = sorted({m.group(1) for m in _FILL.finditer(subject + "\n" + body)} - set(FILL_INS))
    if unknown:
        raise AppError("VALIDATION_ERROR", f"Unknown fill-in: {{{unknown[0]}}}", 422)
    return subject, body


def unfinished(subject: str, body: str) -> bool:
    return bool(_UNFINISHED.search(subject) or _UNFINISHED.search(body))


def with_gift(text: str, gift: str) -> str:
    """The gift fill-in, put in before the artist-email writer fills the rest."""
    return text.replace("{gift}", gift)


class GiftStatusMailService:
    def __init__(self, session: AsyncSession, settings: Settings | None = None, clock: Clock | None = None) -> None:
        from cornerroom.modules.commerce.application.gifts import GiftCampaignService

        self.session = session
        self.settings = settings or get_settings()
        self.clock = clock or SystemClock()
        self.gifts = GiftCampaignService(session, self.settings, self.clock)
        self.audit = self.gifts.audit

    # --- reading --------------------------------------------------------------------------------

    async def _rows(self, campaign_id: UUID) -> dict[str, GiftStatusMail]:
        rows = (await self.session.execute(select(GiftStatusMail).where(GiftStatusMail.campaign_id == campaign_id))).scalars()
        return {r.status: r for r in rows}

    async def _can_review(self, ctx: AuthContext, campaign: GiftCampaign) -> bool:
        try:
            await self.gifts._reviewer(ctx, campaign)
        except NotFoundError:
            return False
        return True

    async def view(self, ctx: AuthContext, campaign_id: UUID) -> dict[str, Any]:
        campaign, role, name = await self.gifts._campaign(ctx, campaign_id)
        rows = await self._rows(campaign.id)
        reviewer = role == "staff" and await self._can_review(ctx, campaign)
        items = []
        for status in STATUS_MAIL_STATUSES:
            row = rows.get(status)
            default_subject, default_body = DEFAULTS[status]
            items.append({
                "status": status,
                "default_subject": default_subject,
                "default_body": default_body,
                "subject": row.subject if row else None,
                "body": row.body if row else None,
                "state": row.state if row else None,
                "review_note": row.review_note if row else None,
                "live": bool(row and row.live_body),
                "live_subject": row.live_subject if row else None,
                "live_body": row.live_body if row else None,
                "sent_count": row.sent_count if row else 0,
                "submitted_at": row.submitted_at if row else None,
                "approved_at": row.approved_at if row else None,
                "can_review": bool(reviewer and row and row.state == "IN_REVIEW"),
            })
        return {
            "campaign": {"id": campaign.id, "title": campaign.title, "gift_items": campaign.gift_items, "status": campaign.status},
            "artist": name,
            "music": await self.gifts._music_line(campaign),
            "viewer_role": role,
            "fill_ins": list(FILL_INS),
            "items": items,
        }

    async def waiting_count(self, campaign_id: UUID) -> int:
        return int(
            (
                await self.session.execute(
                    select(func.count()).select_from(GiftStatusMail).where(
                        GiftStatusMail.campaign_id == campaign_id, GiftStatusMail.state == "IN_REVIEW"
                    )
                )
            ).scalar_one()
        )

    async def live_statuses(self, campaign_id: UUID) -> set[str]:
        rows = await self.session.execute(
            select(GiftStatusMail.status).where(GiftStatusMail.campaign_id == campaign_id, GiftStatusMail.live_body.is_not(None))
        )
        return set(rows.scalars())

    # --- writing --------------------------------------------------------------------------------

    def _status(self, status: str) -> str:
        if status not in STATUS_MAIL_STATUSES:
            raise NotFoundError("Email not found")
        return status

    async def _event(self, ctx: AuthContext, event_type: str, campaign: GiftCampaign, row: GiftStatusMail, extra: dict[str, Any]) -> None:
        await enqueue_outbox(
            self.session,
            DomainEvent(
                event_type=event_type, producer="commerce", aggregate_type="GiftStatusMail", aggregate_id=row.id,
                payload={"campaign_id": str(campaign.id), "status": row.status, **extra}, occurred_at=self.clock.now(),
                actor_id=ctx.user_id, organization_id=campaign.organization_id, correlation_id=ctx.request_id,
            ),
        )

    async def save(self, ctx: AuthContext, campaign_id: UUID, status: str, subject: str, body: str) -> dict[str, Any]:
        campaign, _role, _name = await self.gifts._campaign(ctx, campaign_id)
        status = self._status(status)
        subject, body = check_words(subject, body)
        row = (await self._rows(campaign.id)).get(status)
        if row is None:
            row = GiftStatusMail(campaign_id=campaign.id, status=status, subject=subject, body=body, created_by=ctx.user_id)
            self.session.add(row)
        row.subject, row.body = subject, body
        row.updated_by = ctx.user_id
        # The same words as the approved ones are simply approved again; anything else is a draft.
        row.state = "APPROVED" if row.live_body is not None and (subject, body) == (row.live_subject, row.live_body) else "DRAFT"
        row.review_note = None
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx, action="gift_status_mail.saved", entity_type="GiftStatusMail", entity_id=row.id,
            new_state={"campaign_id": str(campaign.id), "status": status, "state": row.state},
            organization_id=campaign.organization_id,
        )
        return await self.view(ctx, campaign.id)

    async def submit(self, ctx: AuthContext, campaign_id: UUID, status: str) -> dict[str, Any]:
        campaign, _role, _name = await self.gifts._campaign(ctx, campaign_id)
        row = (await self._rows(campaign.id)).get(self._status(status))
        if row is None or row.state not in ("DRAFT", "RETURNED"):
            raise AppError("INVALID_TRANSITION", "Nothing new to send for review", 409)
        if unfinished(row.subject, row.body):
            raise AppError("UNFINISHED_EMAIL", "Write the parts marked [add ...] first", 422)
        row.state = "IN_REVIEW"
        row.submitted_by = ctx.user_id
        row.submitted_at = self.clock.now()
        await self.session.flush()
        await self._event(ctx, GIFT_STATUS_MAIL_SUBMITTED, campaign, row, {})
        await self.audit.record_from_auth(
            ctx, action="gift_status_mail.submitted", entity_type="GiftStatusMail", entity_id=row.id,
            new_state={"campaign_id": str(campaign.id), "status": row.status}, organization_id=campaign.organization_id,
        )
        return await self.view(ctx, campaign.id)

    async def review(self, ctx: AuthContext, campaign_id: UUID, status: str, *, approve: bool, note: str | None) -> dict[str, Any]:
        campaign = await self.session.get(GiftCampaign, campaign_id)
        if campaign is None:
            raise NotFoundError("Campaign not found")
        await self.gifts._reviewer(ctx, campaign)
        row = (await self._rows(campaign.id)).get(self._status(status))
        if row is None or row.state != "IN_REVIEW":
            raise AppError("INVALID_TRANSITION", "This email isn't waiting for review", 409)
        text = " ".join((note or "").split())[:2000] or None
        if approve:
            owners = await self.gifts.music.catalog_owner_ids(
                campaign.profile_id if campaign.profile_type == "artist" else None,
                campaign.profile_id if campaign.profile_type == "band" else None,
            )
            if ctx.user_id in owners or ctx.user_id in {row.created_by, row.updated_by, row.submitted_by}:
                raise AppError("SAME_PERSON_REVIEW", "Someone else must approve this", 403, "You wrote or changed this email")
            row.live_subject, row.live_body = row.subject, row.body
            row.state = "APPROVED"
            row.approved_by = ctx.user_id
            row.approved_at = self.clock.now()
            row.review_note = None
        else:
            if not text:
                raise AppError("VALIDATION_ERROR", "Tell the artist what to change", 422)
            row.state = "RETURNED"
            row.review_note = text
        await self.session.flush()
        await self._event(ctx, GIFT_STATUS_MAIL_APPROVED if approve else GIFT_STATUS_MAIL_RETURNED, campaign, row, {"note": text})
        await self.audit.record_from_auth(
            ctx, action="gift_status_mail.approved" if approve else "gift_status_mail.returned", entity_type="GiftStatusMail",
            entity_id=row.id, new_state={"campaign_id": str(campaign.id), "status": row.status, "note": text},
            organization_id=campaign.organization_id,
        )
        return await self.view(ctx, campaign.id)

    async def reset(self, ctx: AuthContext, campaign_id: UUID, status: str) -> dict[str, Any]:
        """Back to Corner Room's own wording: the act's words, approved or not, are dropped."""
        campaign, _role, _name = await self.gifts._campaign(ctx, campaign_id)
        row = (await self._rows(campaign.id)).get(self._status(status))
        if row is not None:
            await self.audit.record_from_auth(
                ctx, action="gift_status_mail.reset", entity_type="GiftStatusMail", entity_id=row.id,
                previous_state={"state": row.state, "live": row.live_body is not None},
                new_state={"campaign_id": str(campaign.id), "status": row.status}, organization_id=campaign.organization_id,
            )
            await self.session.delete(row)
            await self.session.flush()
        return await self.view(ctx, campaign.id)


async def send_artist_status_mail(event: DomainEvent, session: AsyncSession, settings: Settings, sender: Any) -> bool:
    """Send the act's approved email for this status to the buyer, if there is one. False when
    there isn't (the caller then sends Corner Room's wording)."""
    from cornerroom.modules.commerce.application.artist_mail_render import first_name, link_addresses, write_email
    from cornerroom.modules.identity.domain.models import User

    status = EVENT_STATUS.get(event.event_type)
    payload = event.payload or {}
    if status is None or not payload.get("campaign_id"):
        return False
    row = (
        await session.execute(
            select(GiftStatusMail).where(GiftStatusMail.campaign_id == UUID(str(payload["campaign_id"])), GiftStatusMail.status == status)
        )
    ).scalar_one_or_none()
    if row is None or not row.live_body or not row.live_subject:
        return False
    to = str(payload.get("email") or "").strip()
    if not to and payload.get("user_id"):
        user = await session.get(User, UUID(str(payload["user_id"])))
        to = (user.email if user else "") or ""
    if not to:
        return True  # nobody to write to; nothing else to send either
    recipient = await session.get(GiftRecipient, event.aggregate_id) if event.aggregate_id else None
    name = None
    if recipient is not None:
        from cornerroom.modules.commerce.application.gifts import GiftCampaignService

        name = (await GiftCampaignService(session, settings)._contact([recipient])).get(recipient.id, {}).get("name")
    artist = str(payload.get("artist") or "The artist")
    gift = str(payload.get("gift") or "a gift")
    values = {"artist": artist, "music": str(payload.get("music") or "your music"), "buyer_name": name or "", "first_name": first_name(name)}
    subject = with_gift(row.live_subject, gift)
    body = with_gift(row.live_body, gift)
    urls = link_addresses(body)
    written = write_email(
        kind="GIFT_UPDATE", subject=subject, body=body, values=values,
        click_url=lambda n: urls[n] if n < len(urls) else settings.web_base_url, web_base_url=settings.web_base_url,
    )
    await sender.send(to=to, subject=written.subject, body=written.text, html=written.html, from_name=f"{artist} via Corner Room")
    row.sent_count = (row.sent_count or 0) + 1
    await session.flush()
    return True
