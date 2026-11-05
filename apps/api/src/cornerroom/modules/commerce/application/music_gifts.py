"""Music gifts (owner, 2026-11-06, D-GIFT-MUSIC-01).

An artist or band (its owner and managers, or staff helping them) gives chosen songs and releases
free to chosen people, by email address, with no payment pages:

- **Set up** in Studio > Gifts > Music gifts: a name for the gift (only the act sees it), the music
  (released songs and releases of the act only, owner), the people (email, optional name and a
  personal note for each; typed, pasted as a list, or added from the act's buyers by name), the
  email that tells them (subject and words with fill-ins and links, as artist emails), files or
  links to give with it, and an optional sending time.
- **Staff approve** each gift before anything is given or sent (owner), on Catalog releases; the
  act's own people and whoever set it up or sent it can't approve it.
- **Given** when approved (or at its time): a person whose address is a verified account owns the
  music at once, through a ৳0 order marked with the gift (`orders.music_gift_id`), so it is in their
  purchases, plays and saves offline like a purchase, counts as a ৳0 buyer and never as money
  (owner, as the pre-sale ৳0 gifts). An address with no account gets the email with a sign-up link,
  and the music when that address becomes a verified account (claimed the way pre-sale buyers are).
  Someone who already owns all of it still gets the email.
- **No cap** on how many people (owner); the per-gift list limit below is a technical limit.

Every email is an artist email of kind GIFT: written out in ``artist_mail_render``, sent from Corner
Room's address, links counted, and it carries the act's "stop emails" link (a stopped address gets
no email, but an account still gets the music). No payment, ledger, revenue or royalty money moves.
"""

from __future__ import annotations

import re
import secrets
from datetime import datetime
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, NotFoundError
from cornerroom.infra.settings import Settings, get_settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import (
    ARTIST_MAIL_QUEUED,
    MUSIC_GIFT_APPROVED,
    MUSIC_GIFT_GIVEN,
    MUSIC_GIFT_REJECTED,
    MUSIC_GIFT_SUBMITTED,
    USER_ACTIVATED,
    USER_REGISTERED,
    USER_VERIFIED,
    DomainEvent,
)
from cornerroom.modules.commerce.application.artist_mail import ArtistMailService, from_name
from cornerroom.modules.commerce.application.artist_mail_render import SUBJECT_MAX, values_for
from cornerroom.modules.commerce.domain.artist_mail import ArtistMailMessage
from cornerroom.modules.commerce.domain.lifecycle import order_transition_action
from cornerroom.modules.commerce.domain.models import Order, OrderItem, Product
from cornerroom.modules.commerce.domain.music_gifts import MusicGift, MusicGiftRecipient

log = structlog.get_logger("commerce.music_gifts")

# Technical limits for one gift (not business rules; the owner set no cap on copies).
MAX_PEOPLE = 5000
MAX_WORKS = 200
BODY_MAX = 10000
NOTE_MAX = 1000
NAME_MAX = 200
DEFAULT_CURRENCY = "BDT"
EDITABLE = ("title", "works", "subject", "body", "file_ids", "send_at", "people")
_EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")


def _line(value: Any, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


def _text(value: Any, limit: int) -> str:
    return str(value or "").replace("\r\n", "\n").strip()[:limit]


def normalize_email(value: Any) -> str:
    return str(value or "").strip().lower()


def clean_people(raw: Any) -> list[dict[str, Any]]:
    """The people a gift is for: each {"email", "name", "note"}. An address listed twice keeps its
    first row (with any name or note the later rows add). Pure, so it is tested on its own."""
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise AppError("VALIDATION_ERROR", "List the people this gift is for", 422, extras={"field": "people"})
    out: dict[str, dict[str, Any]] = {}
    bad: list[str] = []
    for row in raw:
        row = row if isinstance(row, dict) else {"email": row}
        email = normalize_email(row.get("email"))
        if not email:
            continue
        if len(email) > 320 or not _EMAIL.match(email):
            bad.append(email[:80])
            continue
        name = _line(row.get("name"), NAME_MAX) or None
        note = _text(row.get("note"), NOTE_MAX) or None
        if email in out:
            out[email]["name"] = out[email]["name"] or name
            out[email]["note"] = out[email]["note"] or note
        else:
            out[email] = {"email": email, "name": name, "note": note}
    if bad:
        raise AppError(
            "VALIDATION_ERROR", f"Check these email addresses: {', '.join(bad[:5])}", 422,
            extras={"field": "people", "invalid": bad[:50]},
        )
    if len(out) > MAX_PEOPLE:
        raise AppError("VALIDATION_ERROR", f"One gift can go to at most {MAX_PEOPLE} people; make another for the rest", 422, extras={"field": "people"})
    return list(out.values())


class MusicGiftService:
    def __init__(self, session: AsyncSession, settings: Settings | None = None, clock: Clock | None = None) -> None:
        self.session = session
        self.settings = settings or get_settings()
        self.clock = clock or SystemClock()
        self.mail = ArtistMailService(session, self.settings, self.clock)
        self.campaigns = self.mail.gifts
        self.studio = self.mail.studio
        self.music = self.mail.music
        self.audit = self.mail.audit

    # --- access ------------------------------------------------------------------------------

    async def _act(self, ctx: AuthContext, kind: str, pid: UUID) -> tuple[str, UUID | None, str]:
        """The act's team (owner and managers) or staff in its workspace; anyone else gets 404."""
        return await self.mail._act(ctx, kind, pid)

    async def _gift(self, ctx: AuthContext, gift_id: UUID) -> tuple[MusicGift, str, str]:
        gift = await self.session.get(MusicGift, gift_id)
        if gift is None:
            raise NotFoundError("Gift not found")
        role, _org, name = await self._act(ctx, gift.profile_type, gift.profile_id)
        return gift, role, name

    # --- what it gives -------------------------------------------------------------------------

    async def _clean_works(self, kind: str, pid: UUID, raw: Any) -> list[dict[str, str]]:
        """The act's own songs and releases, and only music that is out (owner)."""
        from cornerroom.modules.music.domain.models import Release, Track

        if not raw:
            return []
        if isinstance(raw, list) and len(raw) > MAX_WORKS:
            raise AppError("VALIDATION_ERROR", "Too many songs and releases", 422, extras={"field": "works"})
        works = await self.campaigns._clean_works(kind, pid, raw)
        for w in works:
            row = await self.session.get(Release if w["type"] == "RELEASE" else Track, UUID(w["id"]))
            if row is None or row.status != "RELEASED":
                raise AppError("NOT_RELEASED", "Only music that is out can be given", 422, extras={"field": "works"})
        return works

    async def _titles(self, works: list[dict[str, str]]) -> list[dict[str, Any]]:
        return await self.campaigns._work_names(works)

    async def _clean(self, kind: str, pid: UUID, data: dict[str, Any], *, partial: bool) -> dict[str, Any]:
        out: dict[str, Any] = {}
        if "title" in data or not partial:
            title = _line(data.get("title"), 200)
            if not title:
                raise AppError("VALIDATION_ERROR", "Give the gift a name (only you see it)", 422, extras={"field": "title"})
            out["title"] = title
        if "works" in data or not partial:
            out["works"] = await self._clean_works(kind, pid, data.get("works"))
        if "subject" in data or not partial:
            out["subject"] = _line(data.get("subject"), SUBJECT_MAX)
        if "body" in data or not partial:
            body = _text(data.get("body"), BODY_MAX)
            if body:
                checked = await self.mail._clean_body({"subject": out.get("subject") or "x", "body": body}, partial=True)
                body = checked["body"]
            out["body"] = body
        if "file_ids" in data:
            out["file_ids"] = await self.mail._clean_file_ids(kind, pid, data.get("file_ids"))
        if "send_at" in data:
            value = data.get("send_at")
            if isinstance(value, str) and value:
                try:
                    value = datetime.fromisoformat(value)
                except ValueError as exc:
                    raise AppError("VALIDATION_ERROR", "Pick a date and time", 422, extras={"field": "send_at"}) from exc
            out["send_at"] = value or None
        if "people" in data:
            out["people"] = clean_people(data.get("people"))
        return out

    async def _set_people(self, gift: MusicGift, people: list[dict[str, Any]]) -> None:
        """Replace a draft's list: kept addresses keep their row, others go, new ones are added."""
        rows = {
            r.email: r
            for r in (await self.session.execute(select(MusicGiftRecipient).where(MusicGiftRecipient.gift_id == gift.id))).scalars()
        }
        wanted = {p["email"]: p for p in people}
        for email, row in rows.items():
            if email not in wanted:
                await self.session.delete(row)
        for email, p in wanted.items():
            row = rows.get(email)
            if row is None:
                self.session.add(MusicGiftRecipient(gift_id=gift.id, email=email, name=p["name"], note=p["note"], status="WAITING"))
            else:
                row.name, row.note = p["name"], p["note"]
        await self.session.flush()

    # --- Studio --------------------------------------------------------------------------------

    async def _recipients(self, gift_id: UUID) -> list[MusicGiftRecipient]:
        return list(
            (
                await self.session.execute(
                    select(MusicGiftRecipient).where(MusicGiftRecipient.gift_id == gift_id).order_by(MusicGiftRecipient.created_at, MusicGiftRecipient.email)
                )
            ).scalars()
        )

    async def _counts(self, gift_id: UUID) -> dict[str, int]:
        rows = await self.session.execute(
            select(MusicGiftRecipient.status, func.count()).where(MusicGiftRecipient.gift_id == gift_id).group_by(MusicGiftRecipient.status)
        )
        counts = {"WAITING": 0, "GIVEN": 0, "WAITING_ACCOUNT": 0, "ALREADY_OWNED": 0}
        for status, n in rows:
            counts[status] = int(n)
        counts["TOTAL"] = sum(counts.values())
        return counts

    async def _summary(self, gift: MusicGift, name: str) -> dict[str, Any]:
        return {
            "id": gift.id,
            "profile": {"kind": gift.profile_type, "id": gift.profile_id, "display_name": name},
            "title": gift.title,
            "works": await self._titles(gift.works or []),
            "subject": gift.subject,
            "body": gift.body,
            "file_ids": list(gift.file_ids or []),
            "send_at": gift.send_at,
            "status": gift.status,
            "review_note": gift.review_note,
            "created_at": gift.created_at,
            "submitted_at": gift.submitted_at,
            "approved_at": gift.approved_at,
            "sent_at": gift.sent_at,
            "counts": await self._counts(gift.id),
        }

    async def _email_states(self, ids: list[UUID]) -> dict[UUID, tuple[str, int]]:
        """Each person's email: its status and how many times a link in it was opened."""
        from cornerroom.modules.commerce.domain.artist_mail import ArtistMailClick

        if not ids:
            return {}
        rows = (await self.session.execute(select(ArtistMailMessage).where(ArtistMailMessage.id.in_(ids)))).scalars().all()
        clicks = dict(
            (
                await self.session.execute(
                    select(ArtistMailClick.message_id, func.count()).where(ArtistMailClick.message_id.in_(ids)).group_by(ArtistMailClick.message_id)
                )
            ).all()
        )
        return {m.id: (m.status, int(clicks.get(m.id, 0))) for m in rows}

    async def detail(self, ctx: AuthContext, gift_id: UUID) -> dict[str, Any]:
        gift, role, name = await self._gift(ctx, gift_id)
        out = await self._summary(gift, name)
        people = await self._recipients(gift.id)
        states = await self._email_states([r.message_id for r in people if r.message_id])
        out["viewer_role"] = "staff" if role == "staff" else "owner"
        out["files"] = await self.mail._files_for(list(gift.file_ids or []))
        out["people"] = [
            {
                "id": r.id, "email": r.email, "name": r.name, "note": r.note, "status": r.status,
                "given_at": r.given_at, "emailed_at": r.emailed_at,
                "email_status": states.get(r.message_id, (None, 0))[0] if r.message_id else None,
                "clicks": states.get(r.message_id, (None, 0))[1] if r.message_id else 0,
            }
            for r in people
        ]
        return out

    async def list_for_profile(self, ctx: AuthContext, kind: str, pid: UUID) -> list[dict[str, Any]]:
        _role, _org, name = await self._act(ctx, kind, pid)
        rows = (
            await self.session.execute(
                select(MusicGift).where(MusicGift.profile_type == kind, MusicGift.profile_id == pid).order_by(MusicGift.created_at.desc())
            )
        ).scalars().all()
        return [await self._summary(g, name) for g in rows]

    async def _act_buyers(self, kind: str, pid: UUID) -> list[dict[str, Any]]:
        """Everyone who owns some of the act's music now, once each (address stays in here)."""
        from cornerroom.modules.commerce.application.artist_mail import buyer_ref

        by_email: dict[str, dict[str, Any]] = {}
        for p in await self.mail._purchases(await self.mail._act_subjects(kind, pid)):
            email = normalize_email(p["email"])
            row = by_email.get(email)
            if row is None or (row["user_id"] is None and p["user_id"] is not None):
                by_email[email] = {"ref": buyer_ref(kind, pid, p["key"]), "user_id": p["user_id"], "email": email,
                                   "name": p["name"] or (row["name"] if row else None)}
        return sorted(by_email.values(), key=lambda b: ((b["name"] or "~").lower(), b["ref"]))

    async def suggestions(self, ctx: AuthContext, kind: str, pid: UUID) -> list[dict[str, Any]]:
        """People the act can add quickly: its buyers, by name and a reference only, never the
        address (D-BUYERS-01). Added by reference, the address stays on the server."""
        await self._act(ctx, kind, pid)
        from cornerroom.modules.commerce.application.artist_mail_render import NO_NAME

        return [{"ref": b["ref"], "name": b["name"] or None, "label": b["name"] or NO_NAME.capitalize()} for b in await self._act_buyers(kind, pid)]

    async def _people_from_refs(self, kind: str, pid: UUID, refs: list[str]) -> list[dict[str, Any]]:
        if not refs:
            return []
        wanted = {str(r) for r in refs}
        return [{"email": b["email"], "name": b["name"], "note": None} for b in await self._act_buyers(kind, pid) if b["ref"] in wanted]

    async def create(self, ctx: AuthContext, kind: str, pid: UUID, data: dict[str, Any]) -> dict[str, Any]:
        _role, org, name = await self._act(ctx, kind, pid)
        fields = await self._clean(kind, pid, data, partial=False)
        people = fields.pop("people", [])
        people = clean_people(people + await self._people_from_refs(kind, pid, list(data.get("buyer_refs") or [])))
        gift = MusicGift(profile_type=kind, profile_id=pid, organization_id=org, status="DRAFT", created_by=ctx.user_id, **fields)
        self.session.add(gift)
        await self.session.flush()
        await self._set_people(gift, people)
        await self.audit.record_from_auth(
            ctx, action="music_gift.created", entity_type="MusicGift", entity_id=gift.id,
            new_state={"works": len(gift.works or []), "people": len(people)}, organization_id=org,
        )
        return await self.detail(ctx, gift.id)

    async def update(self, ctx: AuthContext, gift_id: UUID, data: dict[str, Any]) -> dict[str, Any]:
        """Only a draft changes; take a waiting gift back first."""
        gift, _role, _name = await self._gift(ctx, gift_id)
        if gift.status != "DRAFT":
            raise AppError("INVALID_TRANSITION", "Take the gift back to change it", 409)
        fields = await self._clean(gift.profile_type, gift.profile_id, {k: v for k, v in data.items() if k in EDITABLE}, partial=True)
        people = fields.pop("people", None)
        refs = list(data.get("buyer_refs") or [])
        for key, value in fields.items():
            setattr(gift, key, value)
        if people is not None or refs:
            current = [{"email": r.email, "name": r.name, "note": r.note} for r in await self._recipients(gift.id)]
            base = people if people is not None else current
            await self._set_people(gift, clean_people(base + await self._people_from_refs(gift.profile_type, gift.profile_id, refs)))
        await self.music._flush_versioned()
        await self.audit.record_from_auth(
            ctx, action="music_gift.changed", entity_type="MusicGift", entity_id=gift.id,
            new_state={"fields": sorted(set(fields) | ({"people"} if people is not None or refs else set()))},
            organization_id=gift.organization_id,
        )
        return await self.detail(ctx, gift.id)

    async def copy(self, ctx: AuthContext, gift_id: UUID) -> dict[str, Any]:
        """A new draft with the same music, words, files and people (to give again or to others)."""
        gift, _role, _name = await self._gift(ctx, gift_id)
        people = [{"email": r.email, "name": r.name, "note": r.note} for r in await self._recipients(gift.id)]
        copy = MusicGift(
            profile_type=gift.profile_type, profile_id=gift.profile_id, organization_id=gift.organization_id, status="DRAFT",
            created_by=ctx.user_id, title=f"{gift.title} (copy)"[:200], works=list(gift.works or []), subject=gift.subject,
            body=gift.body, file_ids=list(gift.file_ids or []),
        )
        self.session.add(copy)
        await self.session.flush()
        await self._set_people(copy, people)
        return await self.detail(ctx, copy.id)

    async def discard(self, ctx: AuthContext, gift_id: UUID) -> None:
        gift, _role, _name = await self._gift(ctx, gift_id)
        if gift.status != "DRAFT":
            raise AppError("INVALID_TRANSITION", "Only a draft can be thrown away", 409)
        await self.audit.record_from_auth(
            ctx, action="music_gift.discarded", entity_type="MusicGift", entity_id=gift.id,
            previous_state={"title": gift.title}, organization_id=gift.organization_id,
        )
        for row in await self._recipients(gift.id):
            await self.session.delete(row)
        await self.session.delete(gift)
        await self.session.flush()

    def _missing(self, gift: MusicGift, people: int) -> list[str]:
        missing = []
        if not gift.works:
            missing.append("the music")
        if not people:
            missing.append("who it is for")
        if not (gift.subject or "").strip():
            missing.append("a subject")
        if not (gift.body or "").strip():
            missing.append("a message")
        return missing

    async def submit(self, ctx: AuthContext, gift_id: UUID) -> dict[str, Any]:
        gift, _role, _name = await self._gift(ctx, gift_id)
        if gift.status != "DRAFT":
            raise AppError("INVALID_TRANSITION", "Only a draft is sent for review", 409)
        people = len(await self._recipients(gift.id))
        missing = self._missing(gift, people)
        if missing:
            raise AppError("VALIDATION_ERROR", f"Add {', '.join(missing)} first", 422, extras={"missing": missing})
        if "[add" in (gift.subject or "") + (gift.body or ""):
            raise AppError("VALIDATION_ERROR", "Fill in the [add ...] parts first", 422, extras={"field": "body"})
        # Music taken down since the draft was saved can't be given.
        await self._clean_works(gift.profile_type, gift.profile_id, gift.works)
        if gift.send_at is not None and gift.send_at <= self.clock.now():
            raise AppError("VALIDATION_ERROR", "Pick a time that hasn't passed, or give it when approved", 422, extras={"field": "send_at"})
        gift.status = "IN_REVIEW"
        gift.submitted_by = ctx.user_id
        gift.submitted_at = self.clock.now()
        gift.review_note = None
        await self.music._flush_versioned()
        await self.mail._event(ctx, MUSIC_GIFT_SUBMITTED, "MusicGift", gift.id, {"people": people}, gift.organization_id)
        await self.audit.record_from_auth(
            ctx, action="music_gift.submitted", entity_type="MusicGift", entity_id=gift.id,
            new_state={"people": people, "send_at": gift.send_at.isoformat() if gift.send_at else None},
            organization_id=gift.organization_id,
        )
        return await self.detail(ctx, gift.id)

    async def withdraw(self, ctx: AuthContext, gift_id: UUID) -> dict[str, Any]:
        """Back to a draft while waiting for review or for its time (it needs approving again)."""
        gift, _role, _name = await self._gift(ctx, gift_id)
        if gift.status not in ("IN_REVIEW", "SCHEDULED"):
            raise AppError("INVALID_TRANSITION", "Only a gift that hasn't gone yet can be taken back", 409)
        gift.status = "DRAFT"
        await self.music._flush_versioned()
        await self.audit.record_from_auth(
            ctx, action="music_gift.withdrawn", entity_type="MusicGift", entity_id=gift.id, new_state={},
            organization_id=gift.organization_id,
        )
        return await self.detail(ctx, gift.id)

    async def send_test(self, ctx: AuthContext, gift_id: UUID) -> dict[str, Any]:
        """The email as the first person on the list will get it, to the asker's own address."""
        from cornerroom.modules.identity.domain.models import User

        gift, _role, name = await self._gift(ctx, gift_id)
        user = await self.session.get(User, ctx.user_id)
        if user is None:
            raise NotFoundError("Account not found")
        if not (gift.subject or "").strip() or not (gift.body or "").strip():
            raise AppError("VALIDATION_ERROR", "Write a subject and a message first", 422)
        people = await self._recipients(gift.id)
        first = people[0] if people else None
        written, token = await self._write(gift, name, first, has_account=True, stop_token="test-link")
        written.subject = f"[Test] {written.subject}"[:SUBJECT_MAX]
        message = await self.mail._message(
            written, token, kind="TEST", profile_type=gift.profile_type, profile_id=gift.profile_id, user_id=user.id,
            email=user.email, from_name=from_name(name),
        )
        await self.mail._event(ctx, ARTIST_MAIL_QUEUED, "ArtistMailMessage", message.id, {"kind": "TEST"}, gift.organization_id)
        return {"sent_to": "your account email"}

    # --- staff review --------------------------------------------------------------------------

    async def review_queue(self, ctx: AuthContext) -> list[dict[str, Any]]:
        org = await self.studio._require_staff_workspace(ctx, "music.approve")
        rows = (
            await self.session.execute(
                select(MusicGift).where(MusicGift.organization_id == org, MusicGift.status == "IN_REVIEW").order_by(MusicGift.submitted_at)
            )
        ).scalars().all()
        out = []
        for gift in rows:
            _row, _org, name = await self.studio._profile(gift.profile_type, gift.profile_id)
            item = await self._summary(gift, name)
            item["files"] = await self.mail._files_for(list(gift.file_ids or []))
            item["people"] = [{"email": r.email, "name": r.name, "note": r.note} for r in await self._recipients(gift.id)]
            out.append(item)
        return out

    async def review(self, ctx: AuthContext, gift_id: UUID, *, approve: bool, note: str | None) -> dict[str, Any]:
        gift = await self.session.get(MusicGift, gift_id)
        if gift is None:
            raise NotFoundError("Gift not found")
        org = gift.organization_id
        if org is None or not await self.music._is_allowed(
            ctx.user_id, "music.approve", resource_type="release", resource_id=gift.id, organization_id=org
        ):
            raise NotFoundError("Gift not found")
        if gift.status != "IN_REVIEW":
            raise AppError("INVALID_TRANSITION", "This gift isn't waiting for review", 409)
        text = _line(note, 2000) or None
        _row, _org, name = await self.studio._profile(gift.profile_type, gift.profile_id)
        if approve:
            owners = await self.music.catalog_owner_ids(
                gift.profile_id if gift.profile_type == "artist" else None,
                gift.profile_id if gift.profile_type == "band" else None,
            )
            if ctx.user_id in owners or ctx.user_id in {gift.created_by, gift.submitted_by}:
                raise AppError("SAME_PERSON_REVIEW", "Someone else must approve this", 403, "You set up or sent this gift")
            await self._clean_works(gift.profile_type, gift.profile_id, gift.works)
            gift.approved_by = ctx.user_id
            gift.approved_at = self.clock.now()
            gift.review_note = None
            if gift.send_at is not None and gift.send_at > self.clock.now():
                gift.status = "SCHEDULED"
            else:
                await self._give_all(gift, name)
        else:
            if not text:
                raise AppError("VALIDATION_ERROR", "Tell the artist what to change", 422)
            gift.status = "DRAFT"
            gift.review_note = text
        await self.music._flush_versioned()
        await self.mail._event(
            ctx, MUSIC_GIFT_APPROVED if approve else MUSIC_GIFT_REJECTED, "MusicGift", gift.id,
            {"note": text, "send_at": gift.send_at.isoformat() if approve and gift.status == "SCHEDULED" and gift.send_at else None}, org,
        )
        await self.audit.record_from_auth(
            ctx, action="music_gift.approved" if approve else "music_gift.rejected", entity_type="MusicGift",
            entity_id=gift.id, new_state={"status": gift.status, "note": text}, organization_id=org,
        )
        return await self._summary(gift, name)

    async def send_due(self) -> int:
        """Worker, every minute: approved gifts whose time has come are given."""
        due = (
            await self.session.execute(
                select(MusicGift).where(MusicGift.status == "SCHEDULED", MusicGift.send_at <= self.clock.now()).order_by(MusicGift.send_at)
            )
        ).scalars().all()
        for gift in due:
            try:
                _row, _org, name = await self.studio._profile(gift.profile_type, gift.profile_id)
            except (NotFoundError, AppError):
                continue
            await self._give_all(gift, name)
            await self.music._flush_versioned()
            await self.audit.record(
                action="music_gift.given_on_time", entity_type="MusicGift", entity_id=gift.id, actor_id="system:music-gift",
                actor_type="system", new_state={"people": (await self._counts(gift.id))["TOTAL"]},
            )
        return len(due)

    # --- giving ----------------------------------------------------------------------------------

    async def _write(self, gift: MusicGift, name: str, person: MusicGiftRecipient | None, *, has_account: bool, stop_token: str | None) -> tuple[Any, str]:
        from cornerroom.modules.commerce.application.artist_mail_render import write_email

        works = list(gift.works or [])
        titles = [w["title"] for w in await self._titles(works)]
        values = values_for(person.name if person else None, titles, name)
        token = secrets.token_urlsafe(24)
        api, web = self.mail._api_base(), self.settings.web_base_url.rstrip("/")
        cover, listen = await self.mail._music_links(works[0] if works else None)
        written = write_email(
            kind="GIFT", subject=gift.subject, body=gift.body, values=values,
            click_url=lambda pos: f"{api}/api/v1/artist-mail/c/{token}/{pos}", web_base_url=web,
            cover_url=cover, listen=listen if has_account else None, files=await self.mail._files_for(list(gift.file_ids or [])),
            stop_url=f"{web}/email-stop/{stop_token}" if stop_token else None,
            note=person.note if person else None,
            claim=None if has_account else (f"{web}/register", person.email if person else "your email address"),
        )
        return written, token

    async def _owns(self, user_id: UUID, work: dict[str, str]) -> bool:
        from cornerroom.modules.entitlements.application.service import EntitlementService

        ent = EntitlementService(self.session, clock=self.clock)
        if work["type"] == "RELEASE":
            return await ent.find_active_release(user_id, UUID(work["id"])) is not None
        return await ent.owns_by_purchase(user_id, UUID(work["id"]))

    async def _product(self, work: dict[str, str]) -> Product | None:
        return (
            await self.session.execute(
                select(Product)
                .where(Product.subject_id == UUID(work["id"]), Product.product_type == work["type"], Product.deleted_at.is_(None))
                .order_by((Product.status == "ACTIVE").desc(), Product.created_at)
            )
        ).scalars().first()

    async def _give_to_account(self, gift: MusicGift, person: MusicGiftRecipient, user_id: UUID) -> bool:
        """The music this person doesn't own yet, through a ৳0 order (no payment, never money).
        False when they owned all of it already."""
        from cornerroom.modules.commerce.application.service import CheckoutService

        missing = [w for w in (gift.works or []) if not await self._owns(user_id, w)]
        person.user_id = user_id
        if not missing:
            return False
        checkout = CheckoutService(self.session, settings=self.settings, clock=self.clock)
        products = [await self._product(w) for w in missing]
        currency = DEFAULT_CURRENCY
        order = Order(
            user_id=user_id, status="PENDING_PAYMENT", total_amount_minor=0, currency_code=currency,
            idempotency_key=f"music-gift:{person.id}", purpose="RELEASE" if any(w["type"] == "RELEASE" for w in missing) else "TRACK",
            music_gift_id=gift.id, created_by=gift.approved_by, updated_by=gift.approved_by,
        )
        self.session.add(order)
        await self.session.flush()
        for work, product in zip(missing, products):
            self.session.add(
                OrderItem(
                    order_id=order.id, item_type=work["type"], ref_id=UUID(work["id"]), product_id=product.id if product else None,
                    quantity=1, unit_amount_minor=0, amount_minor=0, currency_code=currency,
                )
            )
        await self.session.flush()
        checkout._add_tax_line(order)
        order_transition_action(order.status, "PAID")
        order.status = "PAID"
        await self.session.flush()
        ctx = AuthContext(user_id=user_id, request_id=f"music-gift:{person.id}", actor_type="system")
        organization_id = await checkout._fulfill_items(ctx, order)
        order_transition_action(order.status, "FULFILLED")
        order.status = "FULFILLED"
        await self.session.flush()
        person.order_id = order.id
        await self.mail._event(
            None, MUSIC_GIFT_GIVEN, "MusicGiftRecipient", person.id,
            {"gift_id": str(gift.id), "order_id": str(order.id), "user_id": str(user_id)}, organization_id or gift.organization_id,
        )
        return True

    async def _give_one(self, gift: MusicGift, person: MusicGiftRecipient, name: str) -> None:
        from cornerroom.modules.commerce.application.presales import PresaleService

        user = await PresaleService(self.session, self.settings, self.clock)._verified_user_by_email(person.email)
        now = self.clock.now()
        if user is not None:
            gave = await self._give_to_account(gift, person, user.id)
            person.status = "GIVEN" if gave else "ALREADY_OWNED"
            person.given_at = now
        else:
            person.status = "WAITING_ACCOUNT"
        stop_token = secrets.token_urlsafe(32)
        written, token = await self._write(gift, name, person, has_account=user is not None, stop_token=stop_token)
        message = await self.mail._message(
            written, token, kind="GIFT", profile_type=gift.profile_type, profile_id=gift.profile_id, user_id=user.id if user else None,
            email=person.email, from_name=from_name(name), stop_token=stop_token, music_gift_id=gift.id,
        )
        person.message_id = message.id
        person.emailed_at = now
        await self.session.flush()
        await self.mail._event(None, ARTIST_MAIL_QUEUED, "ArtistMailMessage", message.id, {"kind": "GIFT"}, gift.organization_id)

    async def _give_all(self, gift: MusicGift, name: str) -> None:
        for person in await self._recipients(gift.id):
            if person.status == "WAITING":
                await self._give_one(gift, person, name)
        gift.status = "SENT"
        gift.sent_at = self.clock.now()
        await self.session.flush()
        log.info("music_gift_given", gift_id=str(gift.id), people=(await self._counts(gift.id))["TOTAL"])

    async def claim_for_user(self, user_id: UUID) -> int:
        """A verified account picks up every gift waiting for its email address."""
        from cornerroom.modules.identity.domain.models import User

        user = await self.session.get(User, user_id)
        if user is None or user.deleted_at is not None or not user.email:
            return 0
        if user.status != "ACTIVE" or user.email_verified_at is None:
            return 0
        waiting = list(
            (
                await self.session.execute(
                    select(MusicGiftRecipient)
                    .where(MusicGiftRecipient.email == normalize_email(user.email), MusicGiftRecipient.status == "WAITING_ACCOUNT")
                    .with_for_update(skip_locked=True)
                )
            ).scalars()
        )
        claimed = 0
        for person in waiting:
            gift = await self.session.get(MusicGift, person.gift_id)
            if gift is None or gift.status != "SENT":
                continue
            gave = await self._give_to_account(gift, person, user.id)
            person.status = "GIVEN" if gave else "ALREADY_OWNED"
            person.given_at = self.clock.now()
            await self.session.flush()
            await self.audit.record(
                action="music_gift.claimed", entity_type="MusicGiftRecipient", entity_id=person.id, actor_id="system:music-gift",
                actor_type="system", new_state={"status": person.status}, organization_id=gift.organization_id,
            )
            claimed += 1
        return claimed


CLAIM_EVENTS = {USER_VERIFIED, USER_REGISTERED, USER_ACTIVATED}


async def consume_music_gift_event(event: DomainEvent, session: AsyncSession, settings: Settings | None = None) -> None:
    """Outbox side consumer: a verified account may have music gifts waiting under its email."""
    if event.event_type not in CLAIM_EVENTS or event.aggregate_type != "User":
        return
    await MusicGiftService(session, settings).claim_for_user(event.aggregate_id)
