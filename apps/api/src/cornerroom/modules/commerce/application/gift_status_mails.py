"""Gift status emails (owner, 2026-11-07, D-CAMPAIGN-05 and D-CAMPAIGN-06).

For each gift campaign the act may write the email for each status that tells the buyer
(Dispatched, Returned, Missing): its words with fill-ins, a button (its own words and link) and
files for the gift. Staff approve each one (someone other than the act's owners or whoever wrote
it); until then, and whenever the act goes back to it, Corner Room's own wording (`DEFAULTS`)
sends. Editing an approved email keeps the approved version sending until staff approve the new one.

Every gift status email goes out as an artist email of kind GIFT_UPDATE: from "<act> via Corner
Room", greeting the buyer by their own name, links counted and files downloadable. They are about
something the buyer is owed, so they always send: a stop from the act's emails doesn't stop them,
and they carry no stop link or cover picture (a plain, personal message, the kind mail apps file
with the person's own mail). Account holders' in-app note stays and sends no second email.

The act can also send the email for one status to chosen buyers in that status (for example the
dispatched email again), and send itself a test written as one buyer will read it.
"""

from __future__ import annotations

import re
from typing import Any
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, NotFoundError
from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.infra.review_policy import second_review_on
from cornerroom.infra.settings import Settings, get_settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import (
    ARTIST_MAIL_QUEUED,
    GIFT_DISPATCHED,
    GIFT_MARKED_MISSING,
    GIFT_RETURNED,
    GIFT_STATUS_MAIL_APPROVED,
    GIFT_STATUS_MAIL_RETURNED,
    GIFT_STATUS_MAIL_SUBMITTED,
    DomainEvent,
)
from cornerroom.modules.commerce.domain.artist_mail import ArtistMailFile, ArtistMailMessage
from cornerroom.modules.commerce.domain.gifts import STATUS_MAIL_STATUSES, GiftCampaign, GiftRecipient, GiftStatusMail

SUBJECT_MAX = 200
BODY_MAX = 5000
BUTTON_LABEL_MAX = 80
MAX_FILES = 10
MAX_SEND = 2000
# The fill-ins these emails take: the artist-email ones plus the gift itself.
FILL_INS = ("first_name", "buyer_name", "artist", "music", "gift")
# Said in place of a name only when Corner Room has none (every account has one).
NO_NAME = "there"
_FILL = re.compile(r"\{([a-z_]+)\}")
# Starter text marks the bits to write as [add ...]; they must be gone before staff see it.
_UNFINISHED = re.compile(r"\[add [^\]]*\]", re.IGNORECASE)
_URL = re.compile(r"^https?://[^\s<>\"']{1,2000}$")

EVENT_STATUS = {GIFT_DISPATCHED: "DISPATCHED", GIFT_RETURNED: "RETURNED", GIFT_MARKED_MISSING: "MISSING"}

# Corner Room's own wording: what sends until the act's is approved, and where editing starts.
DEFAULTS: dict[str, tuple[str, str]] = {
    "DISPATCHED": (
        "Your gift from {artist} is on its way",
        "Hi {first_name},\n\nGood news from {artist}: your gift for buying {music} is on its way to you ({gift}). "
        "It should reach you in the next few days.",
    ),
    "RETURNED": (
        "Your gift from {artist} couldn't be delivered",
        "Hi {first_name},\n\nYour gift from {artist} ({gift}), for buying {music}, couldn't be delivered and came back. "
        "Please check that the delivery address you gave us is correct. Once your address is right, it will be sent "
        "again. We'll email you again when there's news.",
    ),
    "MISSING": (
        "Your gift from {artist} is taking longer than expected",
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


def check_button(label: str | None, url: str | None) -> tuple[str | None, str | None]:
    """A button needs both its words and a web address; neither means no button."""
    label = " ".join((label or "").split()) or None
    url = (url or "").strip() or None
    if label is None and url is None:
        return None, None
    if label is None:
        raise AppError("VALIDATION_ERROR", "Write the words on the button", 422)
    if url is None:
        raise AppError("VALIDATION_ERROR", "Add the web address the button opens", 422)
    if len(label) > BUTTON_LABEL_MAX:
        raise AppError("VALIDATION_ERROR", f"Keep the button under {BUTTON_LABEL_MAX} characters", 422)
    if not _URL.match(url):
        raise AppError("VALIDATION_ERROR", "The button needs a web address starting with https://", 422)
    return label, url


def unfinished(*texts: str | None) -> bool:
    return any(_UNFINISHED.search(t or "") for t in texts)


def with_gift(text: str, gift: str) -> str:
    """The gift fill-in, put in before the artist-email writer fills the rest."""
    return text.replace("{gift}", gift)


def first_name(name: str | None) -> str:
    words = (name or "").split()
    return words[0] if words else NO_NAME


def mail_values(name: str | None, artist: str, music: str) -> dict[str, str]:
    """What each fill-in becomes for one buyer: their own name, never a stand-in when it's known."""
    clean = " ".join((name or "").split())
    return {"first_name": first_name(clean), "buyer_name": clean or NO_NAME, "artist": artist, "music": music or "your music"}


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

    async def _sent_counts(self, campaign_id: UUID) -> dict[str, int]:
        rows = await self.session.execute(
            select(ArtistMailMessage.gift_status, func.count())
            .join(GiftRecipient, GiftRecipient.id == ArtistMailMessage.gift_recipient_id)
            .where(
                GiftRecipient.campaign_id == campaign_id,
                ArtistMailMessage.kind == "GIFT_UPDATE",
                ArtistMailMessage.status.in_(("PENDING", "SENT")),
            )
            .group_by(ArtistMailMessage.gift_status)
        )
        return {status: int(n) for status, n in rows.all() if status}

    async def _people(self, campaign: GiftCampaign) -> list[dict[str, Any]]:
        """Each buyer by name (never their address) with where their gift is, to preview as and pick."""
        await self.gifts.sync_recipients(campaign)
        rows = (
            await self.session.execute(
                select(GiftRecipient)
                .where(GiftRecipient.campaign_id == campaign.id, GiftRecipient.waiting.is_(False))
                .order_by(GiftRecipient.created_at)
            )
        ).scalars().all()
        contact = await self.gifts._contact(list(rows))
        return [
            {
                "id": r.id,
                "name": contact.get(r.id, {}).get("name"),
                "status": r.status,
                "reachable": bool(r.email or r.user_id),
            }
            for r in rows
        ]

    def _item(self, status: str, row: GiftStatusMail | None, reviewer: bool, sent: int) -> dict[str, Any]:
        default_subject, default_body = DEFAULTS[status]
        return {
            "status": status,
            "default_subject": default_subject,
            "default_body": default_body,
            "subject": row.subject if row else None,
            "body": row.body if row else None,
            "button_label": row.button_label if row else None,
            "button_url": row.button_url if row else None,
            "file_ids": [str(f) for f in (row.file_ids or [])] if row else [],
            "state": row.state if row else None,
            "review_note": row.review_note if row else None,
            "live": bool(row and row.live_body),
            "live_subject": row.live_subject if row else None,
            "live_body": row.live_body if row else None,
            "live_button_label": row.live_button_label if row else None,
            "live_button_url": row.live_button_url if row else None,
            "live_file_ids": [str(f) for f in (row.live_file_ids or [])] if row else [],
            "sent_count": sent,
            "submitted_at": row.submitted_at if row else None,
            "approved_at": row.approved_at if row else None,
            "can_review": bool(reviewer and row and row.state == "IN_REVIEW"),
        }

    async def view(self, ctx: AuthContext, campaign_id: UUID) -> dict[str, Any]:
        campaign, role, name = await self.gifts._campaign(ctx, campaign_id)
        rows = await self._rows(campaign.id)
        reviewer = role == "staff" and await self._can_review(ctx, campaign)
        sent = await self._sent_counts(campaign.id)
        return {
            "campaign": {"id": campaign.id, "title": campaign.title, "gift_items": campaign.gift_items, "status": campaign.status},
            "profile": {"kind": campaign.profile_type, "id": campaign.profile_id},
            "artist": name,
            "music": await self.gifts._music_line(campaign),
            "viewer_role": role,
            "fill_ins": list(FILL_INS),
            "items": [self._item(s, rows.get(s), reviewer, sent.get(s, 0)) for s in STATUS_MAIL_STATUSES],
            "people": await self._people(campaign),
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

    # --- writing --------------------------------------------------------------------------------

    def _status(self, status: str) -> str:
        if status not in STATUS_MAIL_STATUSES:
            raise NotFoundError("Email not found")
        return status

    async def _clean_files(self, campaign: GiftCampaign, file_ids: list[Any] | None) -> list[str]:
        """The act's own kept files only, each once, at most MAX_FILES."""
        out: list[str] = []
        for fid in file_ids or []:
            try:
                uid = UUID(str(fid))
            except ValueError as exc:
                raise AppError("VALIDATION_ERROR", "That file isn't one of yours", 422) from exc
            f = await self.session.get(ArtistMailFile, uid)
            if f is None or f.deleted_at is not None or f.profile_type != campaign.profile_type or f.profile_id != campaign.profile_id:
                raise AppError("VALIDATION_ERROR", "That file isn't one of yours", 422)
            if str(uid) not in out:
                out.append(str(uid))
        if len(out) > MAX_FILES:
            raise AppError("VALIDATION_ERROR", f"Add at most {MAX_FILES} files", 422)
        return out

    async def _event(self, ctx: AuthContext, event_type: str, campaign: GiftCampaign, row: GiftStatusMail, extra: dict[str, Any]) -> None:
        await enqueue_outbox(
            self.session,
            DomainEvent(
                event_type=event_type, producer="commerce", aggregate_type="GiftStatusMail", aggregate_id=row.id,
                payload={"campaign_id": str(campaign.id), "status": row.status, **extra}, occurred_at=self.clock.now(),
                actor_id=ctx.user_id, organization_id=campaign.organization_id, correlation_id=ctx.request_id,
            ),
        )

    async def save(self, ctx: AuthContext, campaign_id: UUID, status: str, data: dict[str, Any]) -> dict[str, Any]:
        campaign, _role, _name = await self.gifts._campaign(ctx, campaign_id)
        status = self._status(status)
        subject, body = check_words(data.get("subject") or "", data.get("body") or "")
        label, url = check_button(data.get("button_label"), data.get("button_url"))
        files = await self._clean_files(campaign, data.get("file_ids"))
        row = (await self._rows(campaign.id)).get(status)
        if row is None:
            row = GiftStatusMail(campaign_id=campaign.id, status=status, subject=subject, body=body, created_by=ctx.user_id)
            self.session.add(row)
        row.subject, row.body, row.button_label, row.button_url, row.file_ids = subject, body, label, url, files
        row.updated_by = ctx.user_id
        same_as_live = row.live_body is not None and (subject, body, label, url, files) == (
            row.live_subject, row.live_body, row.live_button_label, row.live_button_url, list(row.live_file_ids or []),
        )
        # The same as the approved version is simply approved again; anything else is a draft.
        row.state = "APPROVED" if same_as_live else "DRAFT"
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
        if unfinished(row.subject, row.body, row.button_label):
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
            if second_review_on(self.settings) and (
                ctx.user_id in owners or ctx.user_id in {row.created_by, row.updated_by, row.submitted_by}
            ):
                raise AppError("SAME_PERSON_REVIEW", "Someone else must approve this", 403, "You wrote or changed this email")
            row.live_subject, row.live_body = row.subject, row.body
            row.live_button_label, row.live_button_url = row.button_label, row.button_url
            row.live_file_ids = list(row.file_ids or [])
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

    # --- sending --------------------------------------------------------------------------------

    def _sending(self, status: str, row: GiftStatusMail | None) -> dict[str, Any]:
        """The version that goes out now: the act's approved one, else Corner Room's."""
        if row is not None and row.live_body and row.live_subject:
            return {
                "subject": row.live_subject, "body": row.live_body,
                "button": (row.live_button_label, row.live_button_url) if row.live_button_label and row.live_button_url else None,
                "file_ids": [str(f) for f in (row.live_file_ids or [])],
            }
        subject, body = DEFAULTS[status]
        return {"subject": subject, "body": body, "button": None, "file_ids": []}

    async def _address(self, recipient: GiftRecipient) -> tuple[str | None, UUID | None]:
        from cornerroom.modules.identity.domain.models import User

        if recipient.user_id:
            user = await self.session.get(User, recipient.user_id)
            if user is not None and user.email and user.deleted_at is None:
                return user.email, user.id
        return recipient.email, None

    async def _queue(
        self, ctx: AuthContext | None, campaign: GiftCampaign, recipient: GiftRecipient, status: str, version: dict[str, Any], *,
        artist: str, music: str, name: str | None, kind: str = "GIFT_UPDATE", to: str | None = None, user_id: UUID | None = None,
        subject_prefix: str = "",
    ) -> bool:
        from cornerroom.modules.commerce.application.artist_mail import ArtistMailService

        if to is None:
            to, user_id = await self._address(recipient)
        if not to:
            return False
        mail = ArtistMailService(self.session, self.settings, self.clock)
        gift = campaign.gift_items
        button = version.get("button")
        written, token = await mail._write(
            kind="GIFT_UPDATE",
            subject=subject_prefix + with_gift(version["subject"], gift),
            body=with_gift(version["body"], gift),
            values=mail_values(name, artist, music),
            work=None,
            file_ids=list(version.get("file_ids") or []),
            stop_token=None,
            button=(with_gift(button[0], gift), button[1]) if button else None,
        )
        message = await mail._message(
            written, token, kind=kind, profile_type=campaign.profile_type, profile_id=campaign.profile_id,
            user_id=user_id, email=to, from_name=f"{artist} via Corner Room",
            gift_recipient_id=recipient.id if kind == "GIFT_UPDATE" else None, gift_status=status if kind == "GIFT_UPDATE" else None,
        )
        await mail._event(ctx, ARTIST_MAIL_QUEUED, "ArtistMailMessage", message.id, {"kind": kind}, campaign.organization_id)
        return True

    async def tell_buyer(self, recipient_id: UUID, status: str) -> bool:
        """A gift moved to a status that tells the buyer (worker, from the gift's event)."""
        recipient = await self.session.get(GiftRecipient, recipient_id)
        if recipient is None or status not in STATUS_MAIL_STATUSES:
            return False
        campaign = await self.session.get(GiftCampaign, recipient.campaign_id)
        if campaign is None:
            return False
        _row, _org, artist = await self.gifts.studio._profile(campaign.profile_type, campaign.profile_id)
        name = (await self.gifts._contact([recipient])).get(recipient.id, {}).get("name")
        version = self._sending(status, (await self._rows(campaign.id)).get(status))
        return await self._queue(None, campaign, recipient, status, version, artist=artist, music=await self.gifts._music_line(campaign), name=name)

    async def send_to(self, ctx: AuthContext, campaign_id: UUID, status: str, recipient_ids: list[UUID]) -> dict[str, Any]:
        """Send the email for one status now to chosen buyers whose gift is in that status. It is
        the version that sends anyway (the act's approved one, else Corner Room's), so it needs no
        new review."""
        campaign, _role, artist = await self.gifts._campaign(ctx, campaign_id)
        status = self._status(status)
        if campaign.status not in ("ACTIVE", "PAUSED", "ENDED"):
            raise AppError("INVALID_TRANSITION", "Gifts can be emailed once the campaign has been live", 409)
        ids = list(dict.fromkeys(recipient_ids))[:MAX_SEND]
        if not ids:
            raise AppError("VALIDATION_ERROR", "Choose who to email", 422)
        rows = (
            await self.session.execute(
                select(GiftRecipient).where(
                    and_(GiftRecipient.campaign_id == campaign.id, GiftRecipient.id.in_(ids), GiftRecipient.waiting.is_(False))
                )
            )
        ).scalars().all()
        version = self._sending(status, (await self._rows(campaign.id)).get(status))
        music = await self.gifts._music_line(campaign)
        names = await self.gifts._contact(list(rows))
        sent = 0
        for r in rows:
            # Only buyers whose gift is in this status: nobody is told it left when it hasn't.
            if r.status != status:
                continue
            if await self._queue(ctx, campaign, r, status, version, artist=artist, music=music, name=names.get(r.id, {}).get("name")):
                sent += 1
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx, action="gift_status_mail.sent_to_chosen", entity_type="GiftCampaign", entity_id=campaign.id,
            new_state={"status": status, "sent": sent, "chosen": len(ids)}, organization_id=campaign.organization_id,
        )
        out = await self.view(ctx, campaign.id)
        out["sent"] = sent
        out["skipped"] = len(ids) - sent
        return out

    async def send_test(self, ctx: AuthContext, campaign_id: UUID, status: str, data: dict[str, Any]) -> dict[str, Any]:
        """The words being written, to the signed-in person's own email, as one buyer would read it."""
        from cornerroom.modules.identity.domain.models import User

        campaign, _role, artist = await self.gifts._campaign(ctx, campaign_id)
        status = self._status(status)
        subject, body = check_words(data.get("subject") or "", data.get("body") or "")
        label, url = check_button(data.get("button_label"), data.get("button_url"))
        files = await self._clean_files(campaign, data.get("file_ids"))
        me = await self.session.get(User, ctx.user_id)
        if me is None or not me.email:
            raise AppError("VALIDATION_ERROR", "Your account has no email address", 422)
        preview: GiftRecipient | None = None
        if data.get("recipient_id"):
            preview = await self.session.get(GiftRecipient, UUID(str(data["recipient_id"])))
            if preview is None or preview.campaign_id != campaign.id:
                preview = None
        name = (await self.gifts._contact([preview])).get(preview.id, {}).get("name") if preview else None
        version = {"subject": subject, "body": body, "button": (label, url) if label and url else None, "file_ids": files}
        stand_in = preview or GiftRecipient(campaign_id=campaign.id, status=status)
        await self._queue(
            ctx, campaign, stand_in, status, version, artist=artist, music=await self.gifts._music_line(campaign), name=name,
            kind="TEST", to=me.email, user_id=me.id, subject_prefix="[Test] ",
        )
        return {"sent_to": me.email}


async def queue_gift_email(event: DomainEvent, session: AsyncSession, settings: Settings) -> bool:
    """A gift moved to a status that tells the buyer: queue its email (the act's approved words or
    Corner Room's). False for events that aren't one of these."""
    status = EVENT_STATUS.get(event.event_type)
    if status is None or event.aggregate_id is None:
        return False
    return await GiftStatusMailService(session, settings).tell_buyer(event.aggregate_id, status)
