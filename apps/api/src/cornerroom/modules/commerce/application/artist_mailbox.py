"""The act's mailbox history (owner, 2026-11-09, D-MAILBOX-01).

Every email Corner Room sent for an artist or band, one row per person: when it was queued and sent,
to whom (their name, never their address), why (a thank-you, an email to buyers, a music gift, a
gift update for one campaign and status, or a test), whether it went (on its way, sent, not sent
because they had stopped the act's emails, couldn't send) and how many links they pressed. The act's
team and staff in its workspace read it; anyone else gets 404, like the rest of the act's emails.

A message's own words are shown to read again with every link replaced by its label, so a per-person
click or stop link can't be pressed from the mailbox.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import NotFoundError
from cornerroom.infra.settings import Settings, get_settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.modules.commerce.domain.artist_mail import ArtistMail, ArtistMailClick, ArtistMailMessage
from cornerroom.modules.commerce.domain.gifts import GiftCampaign, GiftMailSend, GiftRecipient
from cornerroom.modules.commerce.domain.music_gifts import MusicGift, MusicGiftRecipient

KINDS = ("THANK_YOU", "MANUAL", "GIFT", "GIFT_UPDATE", "TEST")
STATES = ("PENDING", "SENT", "SUPPRESSED", "FAILED")
PAGE_MAX = 200
# Any web address in a written email: per-person click and stop links must never be pressable here.
_URL = re.compile(r"https?://[^\s<>\"')\]]+")


def without_links(text: str) -> str:
    """The words of a sent email with every web address taken out (labels stay)."""
    return _URL.sub("(link)", text or "")


class ArtistMailboxService:
    def __init__(self, session: AsyncSession, settings: Settings | None = None, clock: Clock | None = None) -> None:
        from cornerroom.modules.commerce.application.artist_mail import ArtistMailService

        self.session = session
        self.settings = settings or get_settings()
        self.clock = clock or SystemClock()
        self.mail = ArtistMailService(session, self.settings, self.clock)

    async def _rows(self, kind: str, pid: UUID, *, q: str | None, kinds: list[str], states: list[str], before: datetime | None, limit: int):
        from cornerroom.modules.identity.domain.models import CustomerProfile

        stmt = (
            select(ArtistMailMessage, CustomerProfile.display_name, GiftRecipient, GiftCampaign.title, MusicGift.title, MusicGiftRecipient.name, ArtistMail.subject)
            .outerjoin(CustomerProfile, CustomerProfile.user_id == ArtistMailMessage.user_id)
            .outerjoin(GiftRecipient, GiftRecipient.id == ArtistMailMessage.gift_recipient_id)
            .outerjoin(GiftCampaign, GiftCampaign.id == GiftRecipient.campaign_id)
            .outerjoin(MusicGift, MusicGift.id == ArtistMailMessage.music_gift_id)
            .outerjoin(MusicGiftRecipient, MusicGiftRecipient.message_id == ArtistMailMessage.id)
            .outerjoin(ArtistMail, ArtistMail.id == ArtistMailMessage.mail_id)
            .where(ArtistMailMessage.profile_type == kind, ArtistMailMessage.profile_id == pid)
        )
        if kinds:
            stmt = stmt.where(ArtistMailMessage.kind.in_(kinds))
        if states:
            stmt = stmt.where(ArtistMailMessage.status.in_(states))
        if before is not None:
            stmt = stmt.where(ArtistMailMessage.created_at < before)
        words = " ".join((q or "").split())[:100]
        if words:
            like = f"%{words.replace('%', '').replace('_', ' ')}%"
            stmt = stmt.where(
                or_(
                    ArtistMailMessage.subject.ilike(like), CustomerProfile.display_name.ilike(like), GiftRecipient.name.ilike(like),
                    MusicGiftRecipient.name.ilike(like), GiftCampaign.title.ilike(like), MusicGift.title.ilike(like),
                )
            )
        return (await self.session.execute(stmt.order_by(ArtistMailMessage.created_at.desc()).limit(limit + 1))).all()

    async def _clicks(self, ids: list[UUID]) -> dict[UUID, int]:
        if not ids:
            return {}
        rows = await self.session.execute(
            select(ArtistMailClick.message_id, func.count()).where(ArtistMailClick.message_id.in_(ids)).group_by(ArtistMailClick.message_id)
        )
        return {mid: int(n) for mid, n in rows.all()}

    @staticmethod
    def _why(m: ArtistMailMessage, campaign: str | None, gift_title: str | None, mail_subject: str | None) -> dict[str, Any]:
        """Why this person got this email, in data the page words (never invented)."""
        if m.kind == "GIFT_UPDATE":
            return {
                "kind": "GIFT_UPDATE", "campaign": campaign, "gift_status": m.gift_status,
                "picked": m.gift_send_id is not None, "send_id": m.gift_send_id,
            }
        if m.kind == "MANUAL":
            return {"kind": "MANUAL", "mail_id": m.mail_id, "mail_subject": mail_subject}
        if m.kind == "GIFT":
            return {"kind": "GIFT", "music_gift_id": m.music_gift_id, "gift_title": gift_title}
        if m.kind == "THANK_YOU":
            return {"kind": "THANK_YOU", "thank_you_id": m.thank_you_id}
        return {"kind": m.kind}

    async def history(
        self, ctx: AuthContext, kind: str, pid: UUID, *, q: str | None = None, kinds: list[str] | None = None,
        states: list[str] | None = None, before: datetime | None = None, limit: int = 100,
    ) -> dict[str, Any]:
        await self.mail._act(ctx, kind, pid)
        limit = max(1, min(int(limit or 100), PAGE_MAX))
        kinds = [k for k in (kinds or []) if k in KINDS]
        states = [s for s in (states or []) if s in STATES]
        rows = await self._rows(kind, pid, q=q, kinds=kinds, states=states, before=before, limit=limit)
        more = len(rows) > limit
        rows = rows[:limit]
        recipients = [r[2] for r in rows if r[2] is not None]
        contact = await self.mail.gifts._contact(recipients) if recipients else {}
        clicks = await self._clicks([r[0].id for r in rows])
        items = []
        for m, user_name, recipient, campaign, gift_title, gift_name, mail_subject in rows:
            name = (contact.get(recipient.id, {}).get("name") if recipient is not None else None) or gift_name or user_name
            items.append({
                "id": m.id, "kind": m.kind, "subject": m.subject, "to_name": name if m.kind != "TEST" else None,
                "state": m.status, "queued_at": m.created_at, "sent_at": m.sent_at, "clicks": clicks.get(m.id, 0),
                "why": self._why(m, campaign, gift_title, mail_subject),
            })
        totals = dict(
            (await self.session.execute(
                select(ArtistMailMessage.kind, func.count())
                .where(ArtistMailMessage.profile_type == kind, ArtistMailMessage.profile_id == pid)
                .group_by(ArtistMailMessage.kind)
            )).all()
        )
        return {
            "items": items,
            "next_before": items[-1]["queued_at"] if more and items else None,
            "totals": {k: int(totals.get(k, 0)) for k in KINDS},
        }

    async def message(self, ctx: AuthContext, message_id: UUID) -> dict[str, Any]:
        """One email as it was written for its person, to read again (links shown by their labels)."""
        m = await self.session.get(ArtistMailMessage, message_id)
        if m is None:
            raise NotFoundError("Email not found")
        await self.mail._act(ctx, m.profile_type, m.profile_id)
        rows = (
            await self.session.execute(
                select(GiftRecipient, GiftCampaign.title)
                .join(GiftCampaign, GiftCampaign.id == GiftRecipient.campaign_id)
                .where(GiftRecipient.id == m.gift_recipient_id)
            )
        ).first() if m.gift_recipient_id else None
        name = None
        campaign_id = None
        if rows is not None:
            name = (await self.mail.gifts._contact([rows[0]])).get(rows[0].id, {}).get("name")
            campaign_id = rows[0].campaign_id
        if name is None and m.user_id is not None and m.kind != "TEST":
            from cornerroom.modules.identity.domain.models import CustomerProfile

            name = (
                await self.session.execute(select(CustomerProfile.display_name).where(CustomerProfile.user_id == m.user_id))
            ).scalar_one_or_none()
        if name is None and m.music_gift_id is not None:
            name = (
                await self.session.execute(select(MusicGiftRecipient.name).where(MusicGiftRecipient.message_id == m.id))
            ).scalar_one_or_none()
        send = await self.session.get(GiftMailSend, m.gift_send_id) if m.gift_send_id else None
        links = [
            {"label": link.get("label"), "kind": link.get("kind")}
            for link in (m.links or [])
            if isinstance(link, dict)
        ]
        return {
            "id": m.id, "kind": m.kind, "subject": m.subject, "from_name": m.from_name, "to_name": name if m.kind != "TEST" else None,
            "body": without_links(m.body), "state": m.status, "queued_at": m.created_at, "sent_at": m.sent_at,
            "clicks": (await self._clicks([m.id])).get(m.id, 0), "links": links,
            "campaign_id": campaign_id or (send.campaign_id if send else None), "gift_status": m.gift_status,
            "mail_id": m.mail_id, "music_gift_id": m.music_gift_id,
        }
