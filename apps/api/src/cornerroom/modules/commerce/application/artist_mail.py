"""Artist emails (owner, 2026-11-02, D-MAIL-01).

An artist or band (its owner and managers, or staff helping them) can:

- **Thank every buyer.** When an order with the act's music is paid, the buyer gets one thank-you
  email from "{Artist} via Corner Room". The act turns it on and edits its text any time; changes go
  live at once. It always sends (it is part of the purchase), with no stop link.
- **Write to buyers.** Subject and body to the buyers of chosen songs and releases: all of them,
  pre-sale buyers only, or people picked by name. Staff approve each email; who gets it is worked
  out when it is approved. Every one carries a one-click "stop emails from {artist}" link.
- **Save templates** of subject, body and audience to start new emails from.

Buyers: everyone whose paid order they still have (refunded orders are left out), plus pre-sale
buyers from before launch at the pre-sale sheet's address. Buying an album counts as buying each of
its songs (owner, 2026-11-02, for these emails only). Artists see names and counts only, never an
address (D-BUYERS-01); picking uses a reference made for that act, not the account id. Corner Room
sends every email, plain text, from its own address; replies aren't read.
"""

from __future__ import annotations

import hashlib
import re
import secrets
from datetime import timedelta
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, NotFoundError
from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.infra.settings import Settings, get_settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import (
    ARTIST_MAIL_APPROVED,
    ARTIST_MAIL_QUEUED,
    ARTIST_MAIL_REJECTED,
    ARTIST_MAIL_SUBMITTED,
    ORDER_PAID,
    DomainEvent,
)
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.commerce.domain.artist_mail import (
    ArtistMail,
    ArtistMailMessage,
    ArtistMailOptOut,
    ArtistMailSettings,
    ArtistMailTemplate,
)
from cornerroom.modules.commerce.domain.models import Order, OrderItem, PresaleClaim, Product

log = structlog.get_logger("commerce.artist_mail")

# Orders the buyer still has (a fully refunded order is left out, owner 2026-11-02).
KEPT_ORDER_STATUSES = ("PAID", "FULFILLED", "PARTIALLY_REFUNDED")
WHO = ("ALL", "PRESALE", "PICKED")
FILL_INS = ("buyer_name", "music", "artist")
SUBJECT_MAX = 200
BODY_MAX = 10000
MAX_PICKED = 5000
# Said in place of a buyer's name when Corner Room doesn't have one.
NO_NAME = "friend"
NO_NAME_LIST = "Name not given"

DEFAULT_THANK_YOU_SUBJECT = "Thank you for buying {music}"
DEFAULT_THANK_YOU_BODY = "Hi {buyer_name},\n\nThank you for buying {music}. It means a lot.\n\n{artist}"

_FILL_IN = re.compile(r"\{(" + "|".join(FILL_INS) + r")\}")


def fill(text: str, values: dict[str, str]) -> str:
    """Put the buyer's name, the music and the act's name in place of {buyer_name}, {music} and
    {artist}. Any other braces are left as written."""
    return _FILL_IN.sub(lambda m: values.get(m.group(1), m.group(0)), text)


def music_line(titles: list[str]) -> str:
    titles = [t for t in titles if t]
    if not titles:
        return "your music"
    if len(titles) == 1:
        return titles[0]
    if len(titles) <= 3:
        return ", ".join(titles[:-1]) + " and " + titles[-1]
    return ", ".join(titles[:3]) + f" and {len(titles) - 3} more"


def from_name(artist: str) -> str:
    return f"{artist} via Corner Room"[:200]


def thank_you_email(*, subject: str, body: str, values: dict[str, str], web_base_url: str) -> tuple[str, str]:
    """Subject and plain-text body of a thank-you (no stop link: it always sends)."""
    web = web_base_url.rstrip("/")
    footer = [
        "",
        "--",
        f"Sent by Corner Room for {values['artist']}. Replies to this email aren't read.",
        f"Your music on Corner Room: {web}/purchases",
    ]
    return fill(subject, values)[:SUBJECT_MAX], fill(body, values) + "\n" + "\n".join(footer)


def buyer_email(*, subject: str, body: str, values: dict[str, str], web_base_url: str, stop_token: str) -> tuple[str, str]:
    """Subject and plain-text body of an email to buyers, with its one-click stop link."""
    web = web_base_url.rstrip("/")
    footer = [
        "",
        "--",
        f"You're getting this because you bought music from {values['artist']} on Corner Room. Replies to this email aren't read.",
        f"Stop emails from {values['artist']}: {web}/email-stop/{stop_token}",
    ]
    return fill(subject, values)[:SUBJECT_MAX], fill(body, values) + "\n" + "\n".join(footer)


def buyer_ref(kind: str, pid: UUID, key: str) -> str:
    """A buyer's reference for one act: stable, but not their account id and different per act."""
    return hashlib.sha256(f"{kind}:{pid}:{key}".encode()).hexdigest()[:24]


def _text(value: Any, limit: int) -> str:
    return str(value or "").replace("\r\n", "\n").strip()[:limit]


class ArtistMailService:
    def __init__(self, session: AsyncSession, settings: Settings | None = None, clock: Clock | None = None) -> None:
        from cornerroom.modules.commerce.application.gifts import GiftCampaignService

        self.session = session
        self.settings = settings or get_settings()
        self.clock = clock or SystemClock()
        self.gifts = GiftCampaignService(session, self.settings, self.clock)
        self.studio = self.gifts.studio
        self.music = self.studio.music
        self.audit = AuditService(session)

    # --- access ------------------------------------------------------------------------------

    async def _act(self, ctx: AuthContext, kind: str, pid: UUID) -> tuple[str, UUID | None, str]:
        """The act's team (owner and managers) or staff in its workspace; anyone else gets 404."""
        return await self.gifts._profile_role(ctx, kind, pid)

    async def _mail(self, ctx: AuthContext, mail_id: UUID) -> tuple[ArtistMail, str, str]:
        mail = await self.session.get(ArtistMail, mail_id)
        if mail is None:
            raise NotFoundError("Email not found")
        role, _org, name = await self._act(ctx, mail.profile_type, mail.profile_id)
        return mail, role, name

    async def _event(self, ctx: AuthContext | None, event_type: str, agg: str, agg_id: UUID, payload: dict[str, Any], org: UUID | None) -> None:
        await enqueue_outbox(
            self.session,
            DomainEvent(
                event_type=event_type, producer="commerce", aggregate_type=agg, aggregate_id=agg_id, payload=payload,
                occurred_at=self.clock.now(), actor_id=ctx.user_id if ctx else None, organization_id=org,
                correlation_id=ctx.request_id if ctx else None,
            ),
        )

    # --- who bought what ---------------------------------------------------------------------

    async def _subjects(self, works: list[dict[str, str]]) -> set[UUID]:
        """Song and release ids whose purchase counts. A song counts when bought on its own or in
        any release that has it (owner, 2026-11-02); a single counts for its song too."""
        from cornerroom.modules.music.domain.models import Release, ReleaseTrack

        subjects: set[UUID] = set()
        for w in works:
            wid = UUID(w["id"])
            subjects.add(wid)
            if w["type"] == "RELEASE":
                release = await self.session.get(Release, wid)
                if release is not None and release.release_type == "SINGLE":
                    subjects |= set((await self.session.execute(select(ReleaseTrack.track_id).where(ReleaseTrack.release_id == wid))).scalars())
            else:
                holders = await self.session.execute(
                    select(Release.id)
                    .join(ReleaseTrack, ReleaseTrack.release_id == Release.id)
                    .where(ReleaseTrack.track_id == wid, Release.deleted_at.is_(None))
                )
                subjects |= set(holders.scalars())
        return subjects

    async def _buyers(self, kind: str, pid: UUID, works: list[dict[str, str]]) -> list[dict[str, Any]]:
        """Everyone who bought any of these works and still has it, once each, with whether they
        bought in a pre-sale. Personal data stays in here: callers outside staff get names only."""
        from cornerroom.modules.identity.domain.models import CustomerProfile, User

        subjects = await self._subjects(works)
        if not subjects:
            return []
        none = {UUID(int=0)}
        products = set((await self.session.execute(select(Product.id).where(Product.subject_id.in_(subjects)))).scalars())
        orders = (
            await self.session.execute(
                select(Order)
                .join(OrderItem, OrderItem.order_id == Order.id)
                .where(
                    Order.status.in_(KEPT_ORDER_STATUSES),
                    Order.deleted_at.is_(None),
                    (OrderItem.product_id.in_(products or none)) | (OrderItem.ref_id.in_(subjects)),
                )
                .distinct()
            )
        ).scalars().all()
        claims = (
            await self.session.execute(
                select(PresaleClaim).where(PresaleClaim.product_id.in_(products or none), PresaleClaim.status != "CANCELLED")
            )
        ).scalars().all()
        claimed_orders = {c.order_id for c in claims if c.order_id}
        user_ids = {o.user_id for o in orders}
        users = {u.id: u for u in (await self.session.execute(select(User).where(User.id.in_(user_ids or none)))).scalars()}
        names = {
            p.user_id: (p.display_name or "").strip()
            for p in (
                await self.session.execute(
                    select(CustomerProfile).where(CustomerProfile.user_id.in_(user_ids or none), CustomerProfile.deleted_at.is_(None))
                )
            ).scalars()
        }
        by_email: dict[str, dict[str, Any]] = {}
        for order in orders:
            user = users.get(order.user_id)
            if user is None or user.deleted_at is not None:
                continue
            row = by_email.setdefault(
                user.email.lower(),
                {"ref": buyer_ref(kind, pid, f"user:{user.id}"), "user_id": user.id, "email": user.email,
                 "name": names.get(user.id) or None, "presale": False},
            )
            if order.is_presale or order.id in claimed_orders:
                row["presale"] = True
        # Pre-sale buyers from before launch who haven't claimed yet: the sheet's address and name.
        for claim in claims:
            if claim.status != "WAITING":
                continue
            row = by_email.get(claim.email.lower())
            if row is None:
                by_email[claim.email.lower()] = {
                    "ref": buyer_ref(kind, pid, f"presale:{claim.id}"), "user_id": None, "email": claim.email,
                    "name": (claim.buyer_name or "").strip() or None, "presale": True,
                }
            else:
                row["presale"] = True
        return sorted(by_email.values(), key=lambda b: ((b["name"] or "~").lower(), b["ref"]))

    async def _stopped(self, kind: str, pid: UUID) -> tuple[set[str], set[UUID]]:
        rows = (
            await self.session.execute(
                select(ArtistMailOptOut).where(ArtistMailOptOut.profile_type == kind, ArtistMailOptOut.profile_id == pid)
            )
        ).scalars().all()
        return {r.email.lower() for r in rows}, {r.user_id for r in rows if r.user_id}

    async def _clean_audience(self, kind: str, pid: UUID, data: Any) -> dict[str, Any]:
        """{"works": [...], "who": "ALL"|"PRESALE"|"PICKED", "picked": [refs]}. Kept as an open
        shape so other filters (a bundle, say) can join it later (owner, 2026-11-02)."""
        data = data if isinstance(data, dict) else {}
        works = await self.gifts._clean_works(kind, pid, data.get("works"))
        who = str(data.get("who") or "ALL").upper()
        if who not in WHO:
            raise AppError("VALIDATION_ERROR", "Choose who gets this email", 422, extras={"field": "audience"})
        picked: list[str] = []
        if who == "PICKED":
            raw = data.get("picked")
            if not isinstance(raw, list) or not raw:
                raise AppError("VALIDATION_ERROR", "Pick at least one person", 422, extras={"field": "audience"})
            picked = sorted({str(r)[:64] for r in raw})[:MAX_PICKED]
        return {"works": works, "who": who, "picked": picked}

    async def _recipients(self, kind: str, pid: UUID, audience: dict[str, Any]) -> tuple[list[dict[str, Any]], int]:
        """Who this audience reaches now, and how many of them stopped the act's emails."""
        buyers = await self._buyers(kind, pid, audience.get("works") or [])
        who = audience.get("who") or "ALL"
        if who == "PRESALE":
            buyers = [b for b in buyers if b["presale"]]
        elif who == "PICKED":
            wanted = set(audience.get("picked") or [])
            buyers = [b for b in buyers if b["ref"] in wanted]
        emails, user_ids = await self._stopped(kind, pid)
        reach = [b for b in buyers if b["email"].lower() not in emails and b["user_id"] not in user_ids]
        return reach, len(buyers) - len(reach)

    async def _audience_out(self, audience: dict[str, Any]) -> dict[str, Any]:
        return {
            "works": await self.gifts._work_names(audience.get("works") or []),
            "who": audience.get("who") or "ALL",
            "picked": list(audience.get("picked") or []),
        }

    # --- Studio: overview, buyers and audiences ----------------------------------------------

    async def _settings_row(self, kind: str, pid: UUID) -> ArtistMailSettings | None:
        return (
            await self.session.execute(
                select(ArtistMailSettings).where(ArtistMailSettings.profile_type == kind, ArtistMailSettings.profile_id == pid)
            )
        ).scalar_one_or_none()

    async def _thank_you_out(self, kind: str, pid: UUID) -> dict[str, Any]:
        row = await self._settings_row(kind, pid)
        sent = await self.session.scalar(
            select(func.count()).select_from(ArtistMailMessage).where(
                ArtistMailMessage.profile_type == kind, ArtistMailMessage.profile_id == pid,
                ArtistMailMessage.kind == "THANK_YOU", ArtistMailMessage.status == "SENT",
            )
        )
        return {
            "on": bool(row and row.thank_you_on),
            "subject": (row.thank_you_subject if row else None) or DEFAULT_THANK_YOU_SUBJECT,
            "body": (row.thank_you_body if row else None) or DEFAULT_THANK_YOU_BODY,
            "default_subject": DEFAULT_THANK_YOU_SUBJECT,
            "default_body": DEFAULT_THANK_YOU_BODY,
            "sent_count": int(sent or 0),
        }

    async def _counts(self, mail_id: UUID) -> dict[str, int]:
        rows = await self.session.execute(
            select(ArtistMailMessage.status, func.count()).where(ArtistMailMessage.mail_id == mail_id).group_by(ArtistMailMessage.status)
        )
        counts = {"PENDING": 0, "SENT": 0, "SUPPRESSED": 0}
        for status, n in rows:
            counts[status] = int(n)
        return counts

    async def _mail_out(self, mail: ArtistMail, profile_name: str) -> dict[str, Any]:
        return {
            "id": mail.id,
            "profile": {"kind": mail.profile_type, "id": mail.profile_id, "display_name": profile_name},
            "subject": mail.subject,
            "body": mail.body,
            "audience": await self._audience_out(mail.audience or {}),
            "status": mail.status,
            "review_note": mail.review_note,
            "created_at": mail.created_at,
            "submitted_at": mail.submitted_at,
            "approved_at": mail.approved_at,
            "recipient_count": mail.recipient_count,
            "counts": await self._counts(mail.id),
        }

    def _template_out(self, t: ArtistMailTemplate, audience: dict[str, Any]) -> dict[str, Any]:
        return {"id": t.id, "name": t.name, "subject": t.subject, "body": t.body, "audience": audience, "updated_at": t.updated_at}

    async def overview(self, ctx: AuthContext, kind: str, pid: UUID) -> dict[str, Any]:
        role, _org, name = await self._act(ctx, kind, pid)
        templates = (
            await self.session.execute(
                select(ArtistMailTemplate)
                .where(ArtistMailTemplate.profile_type == kind, ArtistMailTemplate.profile_id == pid)
                .order_by(ArtistMailTemplate.name)
            )
        ).scalars().all()
        mails = (
            await self.session.execute(
                select(ArtistMail)
                .where(ArtistMail.profile_type == kind, ArtistMail.profile_id == pid)
                .order_by(ArtistMail.created_at.desc())
                .limit(50)
            )
        ).scalars().all()
        emails, _user_ids = await self._stopped(kind, pid)
        return {
            "profile": {"kind": kind, "id": pid, "display_name": name},
            "viewer_role": role,
            "thank_you": await self._thank_you_out(kind, pid),
            "templates": [self._template_out(t, await self._audience_out(t.audience or {})) for t in templates],
            "mails": [await self._mail_out(m, name) for m in mails],
            "stopped_count": len(emails),
            "weekly_limit": self.settings.artist_mail_weekly_limit,
        }

    async def buyers(self, ctx: AuthContext, kind: str, pid: UUID, works: list[dict[str, str]]) -> list[dict[str, Any]]:
        """Names to pick from (D-BUYERS-01: names only)."""
        await self._act(ctx, kind, pid)
        clean = await self.gifts._clean_works(kind, pid, works)
        return [{"ref": b["ref"], "name": b["name"] or NO_NAME_LIST, "presale": b["presale"]} for b in await self._buyers(kind, pid, clean)]

    async def audience_size(self, ctx: AuthContext, kind: str, pid: UUID, audience: Any) -> dict[str, int]:
        await self._act(ctx, kind, pid)
        clean = await self._clean_audience(kind, pid, audience)
        reach, stopped = await self._recipients(kind, pid, clean)
        return {"count": len(reach), "stopped": stopped}

    # --- Studio: thank-you -------------------------------------------------------------------

    async def set_thank_you(self, ctx: AuthContext, kind: str, pid: UUID, data: dict[str, Any]) -> dict[str, Any]:
        """Turn it on or off and change its text. Goes live at once (owner, 2026-11-02)."""
        _role, org, _name = await self._act(ctx, kind, pid)
        row = await self._settings_row(kind, pid)
        if row is None:
            row = ArtistMailSettings(profile_type=kind, profile_id=pid, organization_id=org)
            self.session.add(row)
        if "on" in data:
            row.thank_you_on = bool(data["on"])
        if "subject" in data:
            subject = " ".join(_text(data["subject"], SUBJECT_MAX).split())
            row.thank_you_subject = None if not subject or subject == DEFAULT_THANK_YOU_SUBJECT else subject
        if "body" in data:
            body = _text(data["body"], BODY_MAX)
            row.thank_you_body = None if not body or body == DEFAULT_THANK_YOU_BODY else body
        row.updated_by = ctx.user_id
        await self.music._flush_versioned()
        await self.audit.record_from_auth(
            ctx, action="artist_mail.thank_you_changed", entity_type="ArtistMailSettings", entity_id=row.id,
            new_state={"on": row.thank_you_on, "custom_subject": row.thank_you_subject is not None, "custom_body": row.thank_you_body is not None},
            organization_id=org,
        )
        return await self._thank_you_out(kind, pid)

    async def send_test(self, ctx: AuthContext, kind: str, pid: UUID, data: dict[str, Any]) -> dict[str, Any]:
        """Send the email as written to the person asking, at their own account address."""
        from cornerroom.modules.identity.domain.models import CustomerProfile, User

        _role, org, name = await self._act(ctx, kind, pid)
        user = await self.session.get(User, ctx.user_id)
        if user is None:
            raise NotFoundError("Account not found")
        subject = " ".join(_text(data.get("subject"), SUBJECT_MAX).split())
        body = _text(data.get("body"), BODY_MAX)
        if not subject or not body:
            raise AppError("VALIDATION_ERROR", "Write a subject and a message first", 422)
        profile = (await self.session.execute(select(CustomerProfile).where(CustomerProfile.user_id == user.id))).scalars().first()
        values = {"buyer_name": (profile.display_name if profile else "") or NO_NAME, "artist": name, "music": "Your song"}
        if str(data.get("kind") or "").upper() == "THANK_YOU":
            subject, body = thank_you_email(subject=subject, body=body, values=values, web_base_url=self.settings.web_base_url)
        else:
            subject, body = buyer_email(
                subject=subject, body=body, values=values, web_base_url=self.settings.web_base_url, stop_token="test-link"
            )
        message = ArtistMailMessage(
            kind="TEST", profile_type=kind, profile_id=pid, user_id=user.id, email=user.email, from_name=from_name(name),
            subject=f"[Test] {subject}"[:SUBJECT_MAX], body=body, status="PENDING",
        )
        self.session.add(message)
        await self.session.flush()
        await self._event(ctx, ARTIST_MAIL_QUEUED, "ArtistMailMessage", message.id, {"kind": "TEST"}, org)
        return {"sent_to": "your account email"}

    # --- Studio: templates -------------------------------------------------------------------

    async def _clean_template(self, kind: str, pid: UUID, data: dict[str, Any]) -> dict[str, Any]:
        name = " ".join(_text(data.get("name"), 120).split())
        subject = " ".join(_text(data.get("subject"), SUBJECT_MAX).split())
        body = _text(data.get("body"), BODY_MAX)
        if not name:
            raise AppError("VALIDATION_ERROR", "Give the template a name", 422, extras={"field": "name"})
        if not subject or not body:
            raise AppError("VALIDATION_ERROR", "Write a subject and a message", 422, extras={"field": "body"})
        return {"name": name, "subject": subject, "body": body, "audience": await self._clean_audience(kind, pid, data.get("audience"))}

    async def save_template(self, ctx: AuthContext, kind: str, pid: UUID, data: dict[str, Any], template_id: UUID | None = None) -> dict[str, Any]:
        _role, org, _name = await self._act(ctx, kind, pid)
        fields = await self._clean_template(kind, pid, data)
        if template_id is None:
            template = ArtistMailTemplate(profile_type=kind, profile_id=pid, created_by=ctx.user_id, updated_by=ctx.user_id, **fields)
            self.session.add(template)
        else:
            template = await self.session.get(ArtistMailTemplate, template_id)
            if template is None or template.profile_type != kind or template.profile_id != pid:
                raise NotFoundError("Template not found")
            for key, value in fields.items():
                setattr(template, key, value)
            template.updated_by = ctx.user_id
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx, action="artist_mail.template_saved", entity_type="ArtistMailTemplate", entity_id=template.id,
            new_state={"name": template.name}, organization_id=org,
        )
        return self._template_out(template, await self._audience_out(template.audience))

    async def update_template(self, ctx: AuthContext, template_id: UUID, data: dict[str, Any]) -> dict[str, Any]:
        template = await self.session.get(ArtistMailTemplate, template_id)
        if template is None:
            raise NotFoundError("Template not found")
        return await self.save_template(ctx, template.profile_type, template.profile_id, data, template_id)

    async def delete_template(self, ctx: AuthContext, template_id: UUID) -> None:
        template = await self.session.get(ArtistMailTemplate, template_id)
        if template is None:
            raise NotFoundError("Template not found")
        _role, org, _name = await self._act(ctx, template.profile_type, template.profile_id)
        await self.audit.record_from_auth(
            ctx, action="artist_mail.template_deleted", entity_type="ArtistMailTemplate", entity_id=template.id,
            previous_state={"name": template.name}, organization_id=org,
        )
        await self.session.delete(template)
        await self.session.flush()

    # --- Studio: emails to buyers ------------------------------------------------------------

    async def _clean_mail(self, kind: str, pid: UUID, data: dict[str, Any], *, partial: bool) -> dict[str, Any]:
        out: dict[str, Any] = {}
        if "subject" in data or not partial:
            subject = " ".join(_text(data.get("subject"), SUBJECT_MAX).split())
            if not subject:
                raise AppError("VALIDATION_ERROR", "Write a subject", 422, extras={"field": "subject"})
            out["subject"] = subject
        if "body" in data or not partial:
            body = _text(data.get("body"), BODY_MAX)
            if not body:
                raise AppError("VALIDATION_ERROR", "Write a message", 422, extras={"field": "body"})
            out["body"] = body
        if "audience" in data or not partial:
            out["audience"] = await self._clean_audience(kind, pid, data.get("audience"))
        return out

    async def create_mail(self, ctx: AuthContext, kind: str, pid: UUID, data: dict[str, Any]) -> dict[str, Any]:
        _role, org, name = await self._act(ctx, kind, pid)
        fields = await self._clean_mail(kind, pid, data, partial=False)
        mail = ArtistMail(profile_type=kind, profile_id=pid, organization_id=org, status="DRAFT", created_by=ctx.user_id, **fields)
        self.session.add(mail)
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx, action="artist_mail.created", entity_type="ArtistMail", entity_id=mail.id,
            new_state={"subject": mail.subject, "who": mail.audience["who"]}, organization_id=org,
        )
        return await self._mail_out(mail, name)

    async def mail_detail(self, ctx: AuthContext, mail_id: UUID) -> dict[str, Any]:
        mail, _role, name = await self._mail(ctx, mail_id)
        out = await self._mail_out(mail, name)
        if mail.status in ("DRAFT", "IN_REVIEW"):
            reach, stopped = await self._recipients(mail.profile_type, mail.profile_id, mail.audience or {})
            out["reach"] = {"count": len(reach), "stopped": stopped}
        return out

    async def update_mail(self, ctx: AuthContext, mail_id: UUID, data: dict[str, Any]) -> dict[str, Any]:
        mail, _role, name = await self._mail(ctx, mail_id)
        if mail.status != "DRAFT":
            raise AppError("INVALID_TRANSITION", "Only a draft can be changed", 409)
        for key, value in (await self._clean_mail(mail.profile_type, mail.profile_id, data, partial=True)).items():
            setattr(mail, key, value)
        await self.music._flush_versioned()
        await self.audit.record_from_auth(
            ctx, action="artist_mail.changed", entity_type="ArtistMail", entity_id=mail.id,
            new_state={"fields": sorted(k for k in data if k in ("subject", "body", "audience"))}, organization_id=mail.organization_id,
        )
        return await self.mail_detail(ctx, mail.id)

    async def discard_mail(self, ctx: AuthContext, mail_id: UUID) -> None:
        mail, _role, _name = await self._mail(ctx, mail_id)
        if mail.status != "DRAFT":
            raise AppError("INVALID_TRANSITION", "Only a draft can be thrown away", 409)
        await self.audit.record_from_auth(
            ctx, action="artist_mail.discarded", entity_type="ArtistMail", entity_id=mail.id,
            previous_state={"subject": mail.subject}, organization_id=mail.organization_id,
        )
        await self.session.delete(mail)
        await self.session.flush()

    async def submit_mail(self, ctx: AuthContext, mail_id: UUID) -> dict[str, Any]:
        mail, _role, _name = await self._mail(ctx, mail_id)
        if mail.status != "DRAFT":
            raise AppError("INVALID_TRANSITION", "Only a draft is sent for review", 409)
        reach, _stopped = await self._recipients(mail.profile_type, mail.profile_id, mail.audience or {})
        if not reach:
            raise AppError("VALIDATION_ERROR", "Nobody would get this email yet", 422, extras={"field": "audience"})
        limit = self.settings.artist_mail_weekly_limit
        if limit > 0:
            recent = await self.session.scalar(
                select(func.count()).select_from(ArtistMail).where(
                    ArtistMail.profile_type == mail.profile_type, ArtistMail.profile_id == mail.profile_id,
                    ArtistMail.status.in_(("IN_REVIEW", "SENDING", "SENT")),
                    ArtistMail.submitted_at >= self.clock.now() - timedelta(days=7),
                )
            )
            if int(recent or 0) >= limit:
                raise AppError("LIMIT_REACHED", f"You can send {limit} emails in 7 days", 409)
        mail.status = "IN_REVIEW"
        mail.submitted_by = ctx.user_id
        mail.submitted_at = self.clock.now()
        mail.review_note = None
        await self.music._flush_versioned()
        await self._event(ctx, ARTIST_MAIL_SUBMITTED, "ArtistMail", mail.id, {}, mail.organization_id)
        await self.audit.record_from_auth(
            ctx, action="artist_mail.submitted", entity_type="ArtistMail", entity_id=mail.id,
            new_state={"reach": len(reach)}, organization_id=mail.organization_id,
        )
        return await self.mail_detail(ctx, mail.id)

    async def withdraw_mail(self, ctx: AuthContext, mail_id: UUID) -> dict[str, Any]:
        mail, _role, _name = await self._mail(ctx, mail_id)
        if mail.status != "IN_REVIEW":
            raise AppError("INVALID_TRANSITION", "Only an email waiting for review can be taken back", 409)
        mail.status = "DRAFT"
        await self.music._flush_versioned()
        await self.audit.record_from_auth(
            ctx, action="artist_mail.withdrawn", entity_type="ArtistMail", entity_id=mail.id, new_state={},
            organization_id=mail.organization_id,
        )
        return await self.mail_detail(ctx, mail.id)

    # --- staff review --------------------------------------------------------------------------

    async def review_queue(self, ctx: AuthContext) -> list[dict[str, Any]]:
        org = await self.studio._require_staff_workspace(ctx, "music.approve")
        rows = (
            await self.session.execute(
                select(ArtistMail).where(ArtistMail.organization_id == org, ArtistMail.status == "IN_REVIEW").order_by(ArtistMail.submitted_at)
            )
        ).scalars().all()
        out = []
        for mail in rows:
            _row, _org, name = await self.studio._profile(mail.profile_type, mail.profile_id)
            item = await self._mail_out(mail, name)
            reach, stopped = await self._recipients(mail.profile_type, mail.profile_id, mail.audience or {})
            item["reach"] = {"count": len(reach), "stopped": stopped}
            out.append(item)
        return out

    async def review(self, ctx: AuthContext, mail_id: UUID, *, approve: bool, note: str | None) -> dict[str, Any]:
        mail = await self.session.get(ArtistMail, mail_id)
        if mail is None:
            raise NotFoundError("Email not found")
        org = mail.organization_id
        if org is None or not await self.music._is_allowed(
            ctx.user_id, "music.approve", resource_type="release", resource_id=mail.id, organization_id=org
        ):
            raise NotFoundError("Email not found")
        if mail.status != "IN_REVIEW":
            raise AppError("INVALID_TRANSITION", "This email isn't waiting for review", 409)
        text = " ".join(_text(note, 2000).split()) or None
        _row, _org, name = await self.studio._profile(mail.profile_type, mail.profile_id)
        if approve:
            owners = await self.music.catalog_owner_ids(
                mail.profile_id if mail.profile_type == "artist" else None,
                mail.profile_id if mail.profile_type == "band" else None,
            )
            if ctx.user_id in owners or ctx.user_id in {mail.created_by, mail.submitted_by}:
                raise AppError("SAME_PERSON_REVIEW", "Someone else must approve this", 403, "You wrote or sent this email")
            mail.approved_by = ctx.user_id
            mail.approved_at = self.clock.now()
            mail.review_note = None
            queued = await self._queue_mail(ctx, mail, name)
            mail.recipient_count = queued
            mail.status = "SENDING" if queued else "SENT"
        else:
            if not text:
                raise AppError("VALIDATION_ERROR", "Tell the artist what to change", 422)
            mail.status = "DRAFT"
            mail.review_note = text
        await self.music._flush_versioned()
        await self._event(
            ctx, ARTIST_MAIL_APPROVED if approve else ARTIST_MAIL_REJECTED, "ArtistMail", mail.id,
            {"note": text, "recipients": mail.recipient_count if approve else None}, org,
        )
        await self.audit.record_from_auth(
            ctx, action="artist_mail.approved" if approve else "artist_mail.rejected", entity_type="ArtistMail",
            entity_id=mail.id, new_state={"status": mail.status, "note": text, "recipients": mail.recipient_count}, organization_id=org,
        )
        return await self._mail_out(mail, name)

    async def _queue_mail(self, ctx: AuthContext, mail: ArtistMail, name: str) -> int:
        """Write one message per person the audience reaches now, and queue each to send."""
        reach, _stopped = await self._recipients(mail.profile_type, mail.profile_id, mail.audience or {})
        titles = [w["title"] for w in await self.gifts._work_names((mail.audience or {}).get("works") or [])]
        for person in reach:
            token = secrets.token_urlsafe(32)
            values = {"buyer_name": person["name"] or NO_NAME, "artist": name, "music": music_line(titles)}
            subject, body = buyer_email(
                subject=mail.subject, body=mail.body, values=values, web_base_url=self.settings.web_base_url, stop_token=token
            )
            message = ArtistMailMessage(
                kind="MANUAL", profile_type=mail.profile_type, profile_id=mail.profile_id, mail_id=mail.id,
                user_id=person["user_id"], email=person["email"], from_name=from_name(name), subject=subject, body=body,
                stop_token=token, status="PENDING",
            )
            self.session.add(message)
            await self.session.flush()
            await self._event(ctx, ARTIST_MAIL_QUEUED, "ArtistMailMessage", message.id, {"kind": "MANUAL"}, mail.organization_id)
        return len(reach)

    # --- thank-you on purchase -----------------------------------------------------------------

    async def thank_buyer(self, order_id: UUID) -> int:
        """One thank-you per act whose music is in this paid order, if the act has it on."""
        from cornerroom.modules.identity.domain.models import CustomerProfile, User
        from cornerroom.modules.music.domain.models import Release, Track

        order = await self.session.get(Order, order_id)
        if order is None or order.deleted_at is not None or order.status not in KEPT_ORDER_STATUSES:
            return 0
        user = await self.session.get(User, order.user_id)
        if user is None or user.deleted_at is not None:
            return 0
        items = (await self.session.execute(select(OrderItem).where(OrderItem.order_id == order.id).order_by(OrderItem.created_at))).scalars().all()
        acts: dict[tuple[str, UUID], list[str]] = {}
        for item in items:
            model = Track if item.item_type == "TRACK" else Release if item.item_type == "RELEASE" else None
            row = await self.session.get(model, item.ref_id) if model is not None else None
            if row is None:
                continue
            key = ("band", row.primary_band_id) if row.primary_band_id else ("artist", row.primary_artist_id) if row.primary_artist_id else None
            if key is not None:
                acts.setdefault(key, []).append(row.title)
        profile = (await self.session.execute(select(CustomerProfile).where(CustomerProfile.user_id == user.id))).scalars().first()
        buyer_name = ((profile.display_name if profile else "") or "").strip() or NO_NAME
        queued = 0
        for (kind, pid), titles in acts.items():
            settings_row = await self._settings_row(kind, pid)
            if settings_row is None or not settings_row.thank_you_on:
                continue
            done = await self.session.scalar(
                select(ArtistMailMessage.id).where(
                    ArtistMailMessage.kind == "THANK_YOU", ArtistMailMessage.profile_type == kind,
                    ArtistMailMessage.profile_id == pid, ArtistMailMessage.order_id == order.id,
                )
            )
            if done is not None:
                continue
            try:
                _row, org, name = await self.studio._profile(kind, pid)
            except (NotFoundError, AppError):
                continue
            values = {"buyer_name": buyer_name, "artist": name, "music": music_line(titles)}
            subject, body = thank_you_email(
                subject=settings_row.thank_you_subject or DEFAULT_THANK_YOU_SUBJECT,
                body=settings_row.thank_you_body or DEFAULT_THANK_YOU_BODY,
                values=values, web_base_url=self.settings.web_base_url,
            )
            message = ArtistMailMessage(
                kind="THANK_YOU", profile_type=kind, profile_id=pid, order_id=order.id, user_id=user.id, email=user.email,
                from_name=from_name(name), subject=subject, body=body, status="PENDING",
            )
            self.session.add(message)
            await self.session.flush()
            await self._event(None, ARTIST_MAIL_QUEUED, "ArtistMailMessage", message.id, {"kind": "THANK_YOU"}, org)
            queued += 1
        return queued

    # --- sending -------------------------------------------------------------------------------

    async def deliver(self, message_id: UUID) -> str | None:
        """Send one queued message. A failed send raises, so the outbox tries again later."""
        from cornerroom.infra.logging import mask_email
        from cornerroom.modules.notifications.infra.email import email_sender_for

        message = await self.session.get(ArtistMailMessage, message_id)
        if message is None or message.status != "PENDING":
            return None
        if message.kind == "MANUAL":
            emails, user_ids = await self._stopped(message.profile_type, message.profile_id)
            if message.email.lower() in emails or (message.user_id and message.user_id in user_ids):
                message.status = "SUPPRESSED"
                await self.session.flush()
                await self._finish_mail(message.mail_id)
                return message.status
        sender = email_sender_for(self.settings)
        if sender is None:
            log.warning("artist_mail_skipped", reason="no_email_provider", message_id=str(message.id))
            return None
        await sender.send(to=message.email, subject=message.subject, body=message.body, from_name=message.from_name)
        message.status = "SENT"
        message.sent_at = self.clock.now()
        await self.session.flush()
        await self._finish_mail(message.mail_id)
        log.info("artist_mail_sent", to=mask_email(message.email), kind=message.kind, message_id=str(message.id))
        return message.status

    async def _finish_mail(self, mail_id: UUID | None) -> None:
        if mail_id is None:
            return
        waiting = await self.session.scalar(
            select(func.count()).select_from(ArtistMailMessage).where(
                ArtistMailMessage.mail_id == mail_id, ArtistMailMessage.status == "PENDING"
            )
        )
        mail = await self.session.get(ArtistMail, mail_id)
        if mail is not None and mail.status == "SENDING" and not waiting:
            mail.status = "SENT"
            await self.session.flush()

    # --- buyers stopping emails ----------------------------------------------------------------

    async def _stop(self, kind: str, pid: UUID, email: str, user_id: UUID | None) -> ArtistMailOptOut:
        row = (
            await self.session.execute(
                select(ArtistMailOptOut).where(
                    ArtistMailOptOut.profile_type == kind, ArtistMailOptOut.profile_id == pid,
                    func.lower(ArtistMailOptOut.email) == email.lower(),
                )
            )
        ).scalar_one_or_none()
        if row is None:
            row = ArtistMailOptOut(profile_type=kind, profile_id=pid, email=email, user_id=user_id)
            self.session.add(row)
            await self.session.flush()
        return row

    async def _message_for_token(self, token: str) -> ArtistMailMessage:
        message = (
            await self.session.execute(select(ArtistMailMessage).where(ArtistMailMessage.stop_token == token[:64]))
        ).scalar_one_or_none() if token else None
        if message is None:
            raise NotFoundError("Link not found")
        return message

    async def stop_link(self, token: str, *, stop: bool) -> dict[str, Any]:
        """The one-click link in an email to buyers: no sign-in, the link itself is the proof."""
        message = await self._message_for_token(token)
        try:
            _row, _org, name = await self.studio._profile(message.profile_type, message.profile_id)
        except (NotFoundError, AppError):
            name = "This artist"
        emails, user_ids = await self._stopped(message.profile_type, message.profile_id)
        stopped = message.email.lower() in emails or (message.user_id is not None and message.user_id in user_ids)
        if stop and not stopped:
            row = await self._stop(message.profile_type, message.profile_id, message.email, message.user_id)
            await self.audit.record(
                action="artist_mail.stopped", entity_type="ArtistMailOptOut", entity_id=row.id,
                actor_id=str(message.user_id) if message.user_id else "system:email-link", actor_type="user" if message.user_id else "system",
                new_state={"via": "email_link"},
            )
            stopped = True
        return {"artist": name, "stopped": stopped}

    async def _my_acts(self, user_id: UUID) -> set[tuple[str, UUID]]:
        from cornerroom.modules.music.domain.models import Release, Track

        acts: set[tuple[str, UUID]] = set()
        items = (
            await self.session.execute(
                select(OrderItem.item_type, OrderItem.ref_id)
                .join(Order, Order.id == OrderItem.order_id)
                .where(Order.user_id == user_id, Order.status.in_(KEPT_ORDER_STATUSES), Order.deleted_at.is_(None),
                       OrderItem.item_type.in_(("TRACK", "RELEASE")))
                .distinct()
            )
        ).all()
        for item_type, ref_id in items:
            row = await self.session.get(Track if item_type == "TRACK" else Release, ref_id)
            if row is None:
                continue
            if row.primary_band_id:
                acts.add(("band", row.primary_band_id))
            elif row.primary_artist_id:
                acts.add(("artist", row.primary_artist_id))
        return acts

    async def my_choices(self, ctx: AuthContext) -> list[dict[str, Any]]:
        """/account: every act the person bought from, and whether they get its emails."""
        from cornerroom.modules.identity.domain.models import User

        user = await self.session.get(User, ctx.user_id)
        if user is None:
            raise NotFoundError("Account not found")
        stopped_rows = (
            await self.session.execute(
                select(ArtistMailOptOut).where(
                    (ArtistMailOptOut.user_id == user.id) | (func.lower(ArtistMailOptOut.email) == user.email.lower())
                )
            )
        ).scalars().all()
        stopped = {(r.profile_type, r.profile_id) for r in stopped_rows}
        out = []
        for kind, pid in (await self._my_acts(user.id)) | stopped:
            try:
                _row, _org, name = await self.studio._profile(kind, pid)
            except (NotFoundError, AppError):
                continue
            out.append({"kind": kind, "id": pid, "display_name": name, "receiving": (kind, pid) not in stopped})
        return sorted(out, key=lambda a: a["display_name"].lower())

    async def set_choice(self, ctx: AuthContext, kind: str, pid: UUID, *, receiving: bool) -> list[dict[str, Any]]:
        from cornerroom.modules.identity.domain.models import User

        if kind not in ("artist", "band"):
            raise NotFoundError("Profile not found")
        user = await self.session.get(User, ctx.user_id)
        if user is None:
            raise NotFoundError("Account not found")
        await self.studio._profile(kind, pid)
        rows = (
            await self.session.execute(
                select(ArtistMailOptOut).where(
                    ArtistMailOptOut.profile_type == kind, ArtistMailOptOut.profile_id == pid,
                    (ArtistMailOptOut.user_id == user.id) | (func.lower(ArtistMailOptOut.email) == user.email.lower()),
                )
            )
        ).scalars().all()
        if receiving:
            for row in rows:
                await self.session.delete(row)
            await self.session.flush()
            entity = rows[0].id if rows else pid
        else:
            entity = (rows[0] if rows else await self._stop(kind, pid, user.email, user.id)).id
        await self.audit.record_from_auth(
            ctx, action="artist_mail.restarted" if receiving else "artist_mail.stopped", entity_type="ArtistMailOptOut",
            entity_id=entity, new_state={"via": "account", "kind": kind, "profile_id": str(pid)},
        )
        return await self.my_choices(ctx)


async def consume_artist_mail_event(event: DomainEvent, session: AsyncSession, settings: Settings | None = None) -> None:
    """Outbox side consumer: a paid order queues the acts' thank-yous; each queued message is sent."""
    if event.event_type == ORDER_PAID and event.aggregate_type == "Order":
        await ArtistMailService(session, settings).thank_buyer(event.aggregate_id)
    elif event.event_type == ARTIST_MAIL_QUEUED:
        await ArtistMailService(session, settings).deliver(event.aggregate_id)
