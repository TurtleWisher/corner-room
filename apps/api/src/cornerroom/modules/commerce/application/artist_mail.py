"""Artist emails (owner, 2026-11-02, D-MAIL-01, extended the same day by D-MAIL-02).

An artist or band (its owner and managers, or staff helping them) can:

- **Thank buyers.** Several thank-you emails, each for an audience: everyone or pre-sale buyers, of
  any of the act's music or of chosen songs and releases. When an order with the act's music is
  paid, the most specific version that fits is sent, once per order. Changes go live at once. A
  thank-you always sends (it is part of the purchase), with no stop link.
- **Write to buyers.** The buyers of chosen songs and releases, narrowed by filters (pre-sale only,
  leave out buyers of something, first-time or returning buyers, bought between two dates, own at
  least so many of the act's songs and releases) and then by ticking people in or out by name.
  Staff approve each email. It goes when approved, or at a chosen time; who gets it is worked out
  then. Every one carries a one-click "stop emails from {artist}" link.
- **Save templates**, give soft-copy files or links with an email, and see a report: how many it
  reached, were sent, stopped or failed, and how many people clicked which link (click counting,
  no open tracking, owner 2026-11-02).

Buyers: everyone whose paid order they still have (refunded orders are left out), plus pre-sale
buyers from before launch at the pre-sale sheet's address. Buying an album counts as buying each of
its songs (owner, 2026-11-02, for these emails only). Artists see names and counts only, never an
address (D-BUYERS-01); picking uses a reference made for that act, not the account id. Corner Room
sends every email from its own address; replies aren't read. How one email is written out lives in
``artist_mail_render``.
"""

from __future__ import annotations

import hashlib
import re
import secrets
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, NotFoundError
from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.infra.settings import Settings, get_settings
from cornerroom.infra.review_policy import second_review_on
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
from cornerroom.modules.commerce.application.artist_mail_render import (
    SUBJECT_MAX,
    Written,
    link_addresses,
    music_line,
    values_for,
    write_email,
)
from cornerroom.modules.commerce.domain.artist_mail import (
    ArtistMail,
    ArtistMailClick,
    ArtistMailFile,
    ArtistMailMessage,
    ArtistMailOptOut,
    ArtistMailTemplate,
    ArtistMailThankYou,
)
from cornerroom.modules.commerce.domain.models import Order, OrderItem, PresaleClaim, Product

log = structlog.get_logger("commerce.artist_mail")

# Orders the buyer still has (a fully refunded order is left out, owner 2026-11-02).
KEPT_ORDER_STATUSES = ("PAID", "FULFILLED", "PARTIALLY_REFUNDED")
WHO = ("ALL", "PRESALE")
BUYER_TYPES = ("ANY", "FIRST_TIME", "RETURNING")
PICK_MODES = ("ALL_BUT", "ONLY")
OCCASIONS = ("NOTE", "NEW_RELEASE", "PRESALE_THANKS", "MILESTONE", "BEHIND_THE_SCENES", "SHOW", "GIFT")
BODY_MAX = 10000
MAX_PICKED = 5000
NO_NAME_LIST = "Name not given"
# Days and dates in the audience filters are Bangladesh days (the product's home, OD-01).
LOCAL_TZ = ZoneInfo("Asia/Dhaka")
_URL = re.compile(r"^https?://[^\s()<>\"']{1,2000}$")

# Re-exported for older imports and tests.
__all__ = ["ArtistMailService", "consume_artist_mail_event", "music_line", "buyer_ref"]


def buyer_ref(kind: str, pid: UUID, key: str) -> str:
    """A buyer's reference for one act: stable, but not their account id and different per act."""
    return hashlib.sha256(f"{kind}:{pid}:{key}".encode()).hexdigest()[:24]


def _text(value: Any, limit: int) -> str:
    return str(value or "").replace("\r\n", "\n").strip()[:limit]


def _line(value: Any, limit: int) -> str:
    return " ".join(_text(value, limit).split())


def _key(work: dict[str, Any]) -> str:
    return f"{work['type']}:{work['id']}"


def _local_day(moment: datetime | None) -> date | None:
    if moment is None:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(LOCAL_TZ).date()


def _day(value: Any, field: str) -> str | None:
    if value in (None, ""):
        return None
    try:
        return date.fromisoformat(str(value)[:10]).isoformat()
    except ValueError as exc:
        raise AppError("VALIDATION_ERROR", "Use a real date", 422, extras={"field": field}) from exc


def specificity(audience: dict[str, Any]) -> tuple[int, int, int]:
    """How narrow a thank-you's audience is: chosen music beats any music, pre-sale beats
    everyone, fewer chosen songs and releases beat more (D-MAIL-02)."""
    works = audience.get("works") or []
    return (1 if works else 0, 1 if audience.get("who") == "PRESALE" else 0, -len(works))


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

    async def _event(self, ctx: AuthContext | None, event_type: str, agg: str, agg_id: UUID, payload: dict[str, Any], org: UUID | None) -> Any:
        return await enqueue_outbox(
            self.session,
            DomainEvent(
                event_type=event_type, producer="commerce", aggregate_type=agg, aggregate_id=agg_id, payload=payload,
                occurred_at=self.clock.now(), actor_id=ctx.user_id if ctx else None, organization_id=org,
                correlation_id=ctx.request_id if ctx else None,
            ),
        )

    # --- who bought what ---------------------------------------------------------------------

    async def _work_subjects(self, works: list[dict[str, str]]) -> dict[str, set[UUID]]:
        """For each chosen song or release, the song and release ids whose purchase counts. A song
        counts when bought on its own or in any release that has it (owner, 2026-11-02); a single
        counts for its song too."""
        from cornerroom.modules.music.domain.models import Release, ReleaseTrack

        out: dict[str, set[UUID]] = {}
        for w in works:
            wid = UUID(w["id"])
            subjects = {wid}
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
            out[_key(w)] = subjects
        return out

    async def _act_subjects(self, kind: str, pid: UUID) -> set[UUID]:
        from cornerroom.modules.music.domain.models import Release, Track

        out: set[UUID] = set()
        for model in (Track, Release):
            owner = model.primary_artist_id if kind == "artist" else model.primary_band_id
            out |= set((await self.session.execute(select(model.id).where(owner == pid, model.deleted_at.is_(None)))).scalars())
        return out

    async def _purchases(self, subjects: set[UUID]) -> list[dict[str, Any]]:
        """Every kept purchase of these songs and releases, one row per order or waiting pre-sale
        claim: who (personal data stays in here), when, whether in a pre-sale, and what."""
        from cornerroom.modules.identity.domain.models import CustomerProfile, User

        if not subjects:
            return []
        none = {UUID(int=0)}
        products = {
            p.id: p.subject_id for p in (await self.session.execute(select(Product).where(Product.subject_id.in_(subjects)))).scalars()
        }
        rows = (
            await self.session.execute(
                select(Order, OrderItem.product_id, OrderItem.ref_id)
                .join(OrderItem, OrderItem.order_id == Order.id)
                .where(
                    Order.status.in_(KEPT_ORDER_STATUSES),
                    Order.deleted_at.is_(None),
                    (OrderItem.product_id.in_(set(products) or none)) | (OrderItem.ref_id.in_(subjects)),
                )
            )
        ).all()
        orders: dict[UUID, Order] = {}
        bought: dict[UUID, set[UUID]] = defaultdict(set)
        for order, product_id, ref_id in rows:
            orders[order.id] = order
            if product_id in products:
                bought[order.id].add(products[product_id])
            if ref_id in subjects:
                bought[order.id].add(ref_id)
        claims = (
            await self.session.execute(
                select(PresaleClaim).where(PresaleClaim.product_id.in_(set(products) or none), PresaleClaim.status != "CANCELLED")
            )
        ).scalars().all()
        claimed_orders = {c.order_id for c in claims if c.order_id}
        user_ids = {o.user_id for o in orders.values()}
        users = {u.id: u for u in (await self.session.execute(select(User).where(User.id.in_(user_ids or none)))).scalars()}
        names = {
            p.user_id: (p.display_name or "").strip()
            for p in (
                await self.session.execute(
                    select(CustomerProfile).where(CustomerProfile.user_id.in_(user_ids or none), CustomerProfile.deleted_at.is_(None))
                )
            ).scalars()
        }
        out: list[dict[str, Any]] = []
        for order in orders.values():
            user = users.get(order.user_id)
            if user is None or user.deleted_at is not None:
                continue
            out.append({
                "key": f"user:{user.id}", "user_id": user.id, "email": user.email, "name": names.get(user.id) or None,
                "presale": bool(order.is_presale or order.id in claimed_orders), "at": order.created_at,
                "order_id": order.id, "subjects": bought[order.id],
            })
        # Pre-sale buyers from before launch who haven't claimed yet: the sheet's address and name.
        for claim in claims:
            if claim.status != "WAITING":
                continue
            out.append({
                "key": f"presale:{claim.id}", "user_id": None, "email": claim.email, "name": (claim.buyer_name or "").strip() or None,
                "presale": True, "at": claim.created_at, "order_id": None, "subjects": {products[claim.product_id]},
            })
        return out

    async def _buyers(self, kind: str, pid: UUID, works: list[dict[str, str]]) -> list[dict[str, Any]]:
        """Everyone who bought any of these works and still has it, once each: whether they bought
        in a pre-sale, which of the works they bought, and when."""
        per_work = await self._work_subjects(works)
        every = set().union(*per_work.values()) if per_work else set()
        by_email: dict[str, dict[str, Any]] = {}
        for p in await self._purchases(every):
            row = by_email.get(p["email"].lower())
            if row is None:
                row = by_email[p["email"].lower()] = {
                    "ref": buyer_ref(kind, pid, p["key"]), "user_id": p["user_id"], "email": p["email"], "name": p["name"],
                    "presale": False, "bought": [], "dates": [],
                }
            elif row["user_id"] is None and p["user_id"] is not None:
                # The same person bought with an account too: their account is who we write to.
                row.update(ref=buyer_ref(kind, pid, p["key"]), user_id=p["user_id"], email=p["email"], name=p["name"] or row["name"])
            row["presale"] = row["presale"] or p["presale"]
            row["dates"].append(p["at"])
            for w in works:
                if _key(w) not in row["bought"] and per_work[_key(w)] & p["subjects"]:
                    row["bought"].append(_key(w))
        return sorted(by_email.values(), key=lambda b: ((b["name"] or "~").lower(), b["ref"]))

    async def _act_counts(self, kind: str, pid: UUID) -> dict[str, tuple[int, int]]:
        """Per buyer address: how many orders with the act's music, and how many of its songs and
        releases they own."""
        orders: dict[str, set[Any]] = defaultdict(set)
        owned: dict[str, set[UUID]] = defaultdict(set)
        for p in await self._purchases(await self._act_subjects(kind, pid)):
            email = p["email"].lower()
            orders[email].add(p["order_id"] or p["key"])
            owned[email] |= p["subjects"]
        return {e: (len(orders[e]), len(owned[e])) for e in orders}

    async def _stopped(self, kind: str, pid: UUID) -> tuple[set[str], set[UUID]]:
        rows = (
            await self.session.execute(
                select(ArtistMailOptOut).where(ArtistMailOptOut.profile_type == kind, ArtistMailOptOut.profile_id == pid)
            )
        ).scalars().all()
        return {r.email.lower() for r in rows}, {r.user_id for r in rows if r.user_id}

    # --- audiences -----------------------------------------------------------------------------

    async def _works(self, kind: str, pid: UUID, raw: Any, *, required: bool) -> list[dict[str, str]]:
        if not raw and not required:
            return []
        return await self.gifts._clean_works(kind, pid, raw)

    async def _clean_audience(self, kind: str, pid: UUID, data: Any, *, thank_you: bool = False) -> dict[str, Any]:
        """{"works", "who", "exclude_works", "buyer_type", "bought_from", "bought_to", "min_owned",
        "pick": {"mode": "ALL_BUT"|"ONLY", "refs"}}. A thank-you keeps works (none = any of the act's
        music) and who only. Emails saved before D-MAIL-02 ("who": "PICKED") read as ONLY."""
        data = data if isinstance(data, dict) else {}
        who = str(data.get("who") or "ALL").upper()
        pick = data.get("pick") if isinstance(data.get("pick"), dict) else {}
        if who == "PICKED":
            who, pick = "ALL", {"mode": "ONLY", "refs": data.get("picked") or []}
        if who not in WHO:
            raise AppError("VALIDATION_ERROR", "Choose who gets this email", 422, extras={"field": "audience"})
        works = await self._works(kind, pid, data.get("works"), required=not thank_you)
        if thank_you:
            return {"works": works, "who": who}
        buyer_type = str(data.get("buyer_type") or "ANY").upper()
        if buyer_type not in BUYER_TYPES:
            raise AppError("VALIDATION_ERROR", "Choose a kind of buyer", 422, extras={"field": "buyer_type"})
        bought_from, bought_to = _day(data.get("bought_from"), "bought_from"), _day(data.get("bought_to"), "bought_to")
        if bought_from and bought_to and bought_from > bought_to:
            raise AppError("VALIDATION_ERROR", "The first date must come before the last", 422, extras={"field": "bought_from"})
        min_owned = data.get("min_owned")
        try:
            min_owned = int(min_owned) if min_owned not in (None, "") else None
        except (TypeError, ValueError) as exc:
            raise AppError("VALIDATION_ERROR", "Use a whole number", 422, extras={"field": "min_owned"}) from exc
        if min_owned is not None and min_owned < 2:
            min_owned = None
        mode = str(pick.get("mode") or "ALL_BUT").upper()
        if mode not in PICK_MODES:
            raise AppError("VALIDATION_ERROR", "Choose how people are picked", 422, extras={"field": "pick"})
        refs = sorted({str(r)[:64] for r in (pick.get("refs") or []) if r})[:MAX_PICKED]
        if mode == "ONLY" and not refs:
            raise AppError("VALIDATION_ERROR", "Pick at least one person", 422, extras={"field": "pick"})
        return {
            "works": works, "who": who,
            "exclude_works": await self._works(kind, pid, data.get("exclude_works"), required=False),
            "buyer_type": buyer_type, "bought_from": bought_from, "bought_to": bought_to,
            "min_owned": min(min_owned, 1000) if min_owned else None,
            "pick": {"mode": mode, "refs": refs},
        }

    async def _people(self, kind: str, pid: UUID, audience: dict[str, Any]) -> list[dict[str, Any]]:
        """Who the filters let through, before ticking people in or out and before stops."""
        buyers = await self._buyers(kind, pid, audience.get("works") or [])
        if audience.get("who") == "PRESALE":
            buyers = [b for b in buyers if b["presale"]]
        if audience.get("exclude_works"):
            left_out = {b["email"].lower() for b in await self._buyers(kind, pid, audience["exclude_works"])}
            buyers = [b for b in buyers if b["email"].lower() not in left_out]
        start, end = audience.get("bought_from"), audience.get("bought_to")
        if start or end:
            lo = date.fromisoformat(start) if start else date.min
            hi = date.fromisoformat(end) if end else date.max
            buyers = [b for b in buyers if any(lo <= (_local_day(d) or date.min) <= hi for d in b["dates"])]
        buyer_type, min_owned = audience.get("buyer_type") or "ANY", audience.get("min_owned")
        if buyer_type != "ANY" or min_owned:
            counts = await self._act_counts(kind, pid)
            if buyer_type == "FIRST_TIME":
                buyers = [b for b in buyers if counts.get(b["email"].lower(), (1, 1))[0] <= 1]
            elif buyer_type == "RETURNING":
                buyers = [b for b in buyers if counts.get(b["email"].lower(), (1, 1))[0] >= 2]
            if min_owned:
                buyers = [b for b in buyers if counts.get(b["email"].lower(), (1, 1))[1] >= min_owned]
        return buyers

    @staticmethod
    def _picked(audience: dict[str, Any], ref: str) -> bool:
        pick = audience.get("pick") or {}
        refs = set(pick.get("refs") or [])
        return ref in refs if pick.get("mode") == "ONLY" else ref not in refs

    async def _recipients(self, kind: str, pid: UUID, audience: dict[str, Any]) -> tuple[list[dict[str, Any]], int]:
        """Who this audience reaches now, and how many of them stopped the act's emails."""
        people = [p for p in await self._people(kind, pid, audience) if self._picked(audience, p["ref"])]
        emails, user_ids = await self._stopped(kind, pid)
        reach = [b for b in people if b["email"].lower() not in emails and b["user_id"] not in user_ids]
        return reach, len(people) - len(reach)

    async def _titles(self, works: list[dict[str, str]]) -> dict[str, str]:
        return {_key(w): w["title"] for w in await self.gifts._work_names(works)}

    async def _audience_out(self, audience: dict[str, Any]) -> dict[str, Any]:
        out = dict(audience)
        out["works"] = await self.gifts._work_names(audience.get("works") or [])
        if "exclude_works" in audience:
            out["exclude_works"] = await self.gifts._work_names(audience.get("exclude_works") or [])
        if audience.get("who") == "PICKED":
            out.update(who="ALL", pick={"mode": "ONLY", "refs": list(audience.get("picked") or [])})
        out.pop("picked", None)
        return out

    async def people(self, ctx: AuthContext, kind: str, pid: UUID, audience: Any) -> dict[str, Any]:
        """The people an audience's filters let through, by name only (D-BUYERS-01), each with
        what they bought of the chosen music, whether they're ticked and whether they stopped the
        act's emails. Studio uses it to tick people in or out and to preview the email as them."""
        await self._act(ctx, kind, pid)
        clean = await self._clean_audience(kind, pid, audience)
        titles = await self._titles(clean["works"])
        emails, user_ids = await self._stopped(kind, pid)
        rows = []
        for p in await self._people(kind, pid, clean):
            rows.append({
                "ref": p["ref"], "name": p["name"] or NO_NAME_LIST, "has_name": bool(p["name"]), "presale": p["presale"],
                "bought": [titles[k] for k in p["bought"] if k in titles], "picked": self._picked(clean, p["ref"]),
                "stopped": p["email"].lower() in emails or p["user_id"] in user_ids,
            })
        reach = sum(1 for r in rows if r["picked"] and not r["stopped"])
        stopped = sum(1 for r in rows if r["picked"] and r["stopped"])
        return {"people": rows, "reach": {"count": reach, "stopped": stopped}}

    async def audience_size(self, ctx: AuthContext, kind: str, pid: UUID, audience: Any) -> dict[str, int]:
        await self._act(ctx, kind, pid)
        clean = await self._clean_audience(kind, pid, audience)
        reach, stopped = await self._recipients(kind, pid, clean)
        return {"count": len(reach), "stopped": stopped}

    # --- files ---------------------------------------------------------------------------------

    def _file_out(self, f: ArtistMailFile) -> dict[str, Any]:
        return {"id": f.id, "kind": f.kind, "name": f.name, "url": f.url if f.kind == "LINK" else None,
                "content_type": f.content_type, "byte_size": f.byte_size, "created_at": f.created_at}

    async def _files(self, kind: str, pid: UUID) -> list[ArtistMailFile]:
        return list(
            (
                await self.session.execute(
                    select(ArtistMailFile)
                    .where(ArtistMailFile.profile_type == kind, ArtistMailFile.profile_id == pid, ArtistMailFile.deleted_at.is_(None))
                    .order_by(ArtistMailFile.created_at.desc())
                )
            ).scalars()
        )

    async def _clean_file_ids(self, kind: str, pid: UUID, raw: Any) -> list[str]:
        if not raw:
            return []
        if not isinstance(raw, list):
            raise AppError("VALIDATION_ERROR", "Choose files from your list", 422, extras={"field": "file_ids"})
        mine = {str(f.id) for f in await self._files(kind, pid)}
        out: list[str] = []
        for item in raw:
            if str(item) not in mine:
                raise AppError("VALIDATION_ERROR", "Choose files from your list", 422, extras={"field": "file_ids"})
            if str(item) not in out:
                out.append(str(item))
        return out

    async def _files_for(self, file_ids: list[str]) -> list[dict[str, Any]]:
        out = []
        for fid in file_ids or []:
            f = await self.session.get(ArtistMailFile, UUID(fid))
            if f is not None and f.deleted_at is None:
                out.append({"id": f.id, "name": f.name, "kind": f.kind, "url": f.url if f.kind == "LINK" else ""})
        return out

    async def add_file(self, ctx: AuthContext, kind: str, pid: UUID, *, filename: str, content_type: str | None, data: bytes) -> dict[str, Any]:
        """A soft copy kept by Corner Room. Same size limit as other uploads (media_cover_max_bytes)."""
        from cornerroom.infra.storage import get_storage

        _role, org, _name = await self._act(ctx, kind, pid)
        if not data:
            raise AppError("VALIDATION_ERROR", "That file is empty", 422, extras={"field": "file"})
        name = _line(filename, 200) or "file"
        safe = re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("-")[:120] or "file"
        row = ArtistMailFile(profile_type=kind, profile_id=pid, organization_id=org, kind="FILE", name=name,
                             content_type=(content_type or "application/octet-stream")[:120], byte_size=len(data), created_by=ctx.user_id)
        row.id = uuid4()
        row.object_key = f"artist-mail/{kind}/{pid}/{row.id}/{safe}"
        await get_storage(self.settings).put(object_key=row.object_key, data=data, mime=row.content_type, storage_class="artist_mail")
        self.session.add(row)
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx, action="artist_mail.file_added", entity_type="ArtistMailFile", entity_id=row.id,
            new_state={"kind": "FILE", "name": name, "byte_size": len(data)}, organization_id=org,
        )
        return self._file_out(row)

    async def add_link(self, ctx: AuthContext, kind: str, pid: UUID, data: dict[str, Any]) -> dict[str, Any]:
        _role, org, _name = await self._act(ctx, kind, pid)
        name, url = _line(data.get("name"), 200), _line(data.get("url"), 2000)
        if not name:
            raise AppError("VALIDATION_ERROR", "Name what people get", 422, extras={"field": "name"})
        if not _URL.match(url):
            raise AppError("VALIDATION_ERROR", "Use a full web address starting with https://", 422, extras={"field": "url"})
        row = ArtistMailFile(profile_type=kind, profile_id=pid, organization_id=org, kind="LINK", name=name, url=url, created_by=ctx.user_id)
        self.session.add(row)
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx, action="artist_mail.file_added", entity_type="ArtistMailFile", entity_id=row.id,
            new_state={"kind": "LINK", "name": name}, organization_id=org,
        )
        return self._file_out(row)

    async def delete_file(self, ctx: AuthContext, file_id: UUID) -> None:
        """Taken out of the list; links already sent to it then say it is no longer there."""
        row = await self.session.get(ArtistMailFile, file_id)
        if row is None or row.deleted_at is not None:
            raise NotFoundError("File not found")
        _role, org, _name = await self._act(ctx, row.profile_type, row.profile_id)
        row.deleted_at = self.clock.now()
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx, action="artist_mail.file_removed", entity_type="ArtistMailFile", entity_id=row.id,
            previous_state={"name": row.name}, organization_id=org,
        )

    # --- writing one email ---------------------------------------------------------------------

    def _api_base(self) -> str:
        return (self.settings.public_api_base_url or self.settings.web_base_url).rstrip("/")

    async def _music_links(self, work: dict[str, str] | None) -> tuple[str | None, tuple[str, str] | None]:
        """The cover image and the Listen page for the music an email is about."""
        from cornerroom.modules.documents.application.covers import CoverService
        from cornerroom.modules.music.domain.models import Release, Track

        if work is None:
            return None, None
        is_release = work["type"] == "RELEASE"
        row = await self.session.get(Release if is_release else Track, UUID(work["id"]))
        if row is None or row.deleted_at is not None:
            return None, None
        covers = CoverService(self.session, self.settings)
        has_cover = await (covers.public_release_cover(row.id) if is_release else covers.public_track_cover(row.id))
        api, web = self._api_base(), self.settings.web_base_url.rstrip("/")
        cover = f"{api}/api/v1/covers/{'releases' if is_release else 'tracks'}/{row.id}/480" if has_cover else None
        listen = (f"{web}/{'releases' if is_release else 'tracks'}/{row.id}", row.title) if row.status == "RELEASED" else None
        return cover, listen

    async def _write(
        self, *, kind: str, subject: str, body: str, values: dict[str, str], work: dict[str, str] | None,
        file_ids: list[str], stop_token: str | None, button: tuple[str, str] | None = None,
    ) -> tuple[Written, str]:
        token = secrets.token_urlsafe(24)
        api, web = self._api_base(), self.settings.web_base_url.rstrip("/")
        cover, listen = await self._music_links(work)
        written = write_email(
            kind=kind, subject=subject, body=body, values=values,
            click_url=lambda pos: f"{api}/api/v1/artist-mail/c/{token}/{pos}", web_base_url=web,
            cover_url=cover, listen=listen, files=await self._files_for(file_ids),
            stop_url=f"{web}/email-stop/{stop_token}" if stop_token else None, button=button,
        )
        return written, token

    async def _message(self, written: Written, token: str, **fields: Any) -> ArtistMailMessage:
        message = ArtistMailMessage(
            subject=written.subject, body=written.text, html=written.html, links=written.links, link_token=token,
            status="PENDING", **fields,
        )
        self.session.add(message)
        await self.session.flush()
        return message

    # --- Studio: overview ----------------------------------------------------------------------

    async def _counts(self, mail_id: UUID) -> dict[str, int]:
        rows = await self.session.execute(
            select(ArtistMailMessage.status, func.count()).where(ArtistMailMessage.mail_id == mail_id).group_by(ArtistMailMessage.status)
        )
        counts = {"PENDING": 0, "SENT": 0, "SUPPRESSED": 0, "FAILED": 0}
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
            "occasion": mail.occasion,
            "file_ids": list(mail.file_ids or []),
            "send_at": mail.send_at,
            "sent_at": mail.sent_at,
            "created_at": mail.created_at,
            "submitted_at": mail.submitted_at,
            "approved_at": mail.approved_at,
            "recipient_count": mail.recipient_count,
            "counts": await self._counts(mail.id),
            # D-PRESALE-03: goes out when this release does.
            "send_with_release_id": mail.send_with_release_id,
        }

    def _template_out(self, t: ArtistMailTemplate, audience: dict[str, Any]) -> dict[str, Any]:
        return {"id": t.id, "name": t.name, "subject": t.subject, "body": t.body, "audience": audience,
                "occasion": t.occasion, "file_ids": list(t.file_ids or []), "updated_at": t.updated_at}

    async def _thank_you_counts(self, kind: str, pid: UUID) -> tuple[dict[UUID, int], dict[UUID, int]]:
        sent = dict(
            (
                await self.session.execute(
                    select(ArtistMailMessage.thank_you_id, func.count()).where(
                        ArtistMailMessage.profile_type == kind, ArtistMailMessage.profile_id == pid,
                        ArtistMailMessage.kind == "THANK_YOU", ArtistMailMessage.status == "SENT",
                    ).group_by(ArtistMailMessage.thank_you_id)
                )
            ).all()
        )
        clicks = dict(
            (
                await self.session.execute(
                    select(ArtistMailMessage.thank_you_id, func.count(func.distinct(ArtistMailClick.message_id)))
                    .join(ArtistMailClick, ArtistMailClick.message_id == ArtistMailMessage.id)
                    .where(ArtistMailMessage.profile_type == kind, ArtistMailMessage.profile_id == pid, ArtistMailMessage.kind == "THANK_YOU")
                    .group_by(ArtistMailMessage.thank_you_id)
                )
            ).all()
        )
        return sent, clicks

    async def _thank_you_out(self, row: ArtistMailThankYou, sent: dict[UUID, int], clicks: dict[UUID, int]) -> dict[str, Any]:
        return {
            "id": row.id, "audience": await self._audience_out(row.audience or {}), "subject": row.subject, "body": row.body,
            "on": row.is_on, "file_ids": list(row.file_ids or []), "sent_count": int(sent.get(row.id, 0)),
            "people_clicked": int(clicks.get(row.id, 0)), "updated_at": row.updated_at,
        }

    async def _thank_yous(self, kind: str, pid: UUID) -> list[ArtistMailThankYou]:
        return list(
            (
                await self.session.execute(
                    select(ArtistMailThankYou)
                    .where(ArtistMailThankYou.profile_type == kind, ArtistMailThankYou.profile_id == pid)
                    .order_by(ArtistMailThankYou.created_at)
                )
            ).scalars()
        )

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
        sent, clicks = await self._thank_you_counts(kind, pid)
        return {
            "profile": {"kind": kind, "id": pid, "display_name": name},
            "viewer_role": role,
            "thank_yous": [await self._thank_you_out(t, sent, clicks) for t in await self._thank_yous(kind, pid)],
            "templates": [self._template_out(t, await self._audience_out(t.audience or {})) for t in templates],
            "mails": [await self._mail_out(m, name) for m in mails],
            "files": [self._file_out(f) for f in await self._files(kind, pid)],
            "stopped_count": len(emails),
            "weekly_limit": self.settings.artist_mail_weekly_limit,
            "file_max_bytes": self.settings.media_cover_max_bytes,
        }

    # --- Studio: thank-you versions ------------------------------------------------------------

    async def _clean_body(self, data: dict[str, Any], *, partial: bool) -> dict[str, Any]:
        out: dict[str, Any] = {}
        if "subject" in data or not partial:
            subject = _line(data.get("subject"), SUBJECT_MAX)
            if not subject:
                raise AppError("VALIDATION_ERROR", "Write a subject", 422, extras={"field": "subject"})
            out["subject"] = subject
        if "body" in data or not partial:
            body = _text(data.get("body"), BODY_MAX)
            if not body:
                raise AppError("VALIDATION_ERROR", "Write a message", 422, extras={"field": "body"})
            if "](" in body and len(link_addresses(body)) != body.count("]("):
                raise AppError("VALIDATION_ERROR", "A link needs a full web address starting with https://", 422, extras={"field": "body"})
            out["body"] = body
        return out

    async def save_thank_you(self, ctx: AuthContext, kind: str, pid: UUID, data: dict[str, Any], thank_you_id: UUID | None = None) -> dict[str, Any]:
        """Add or change one thank-you version. Goes live at once (owner, 2026-11-02)."""
        _role, org, _name = await self._act(ctx, kind, pid)
        if thank_you_id is None:
            row = ArtistMailThankYou(profile_type=kind, profile_id=pid, organization_id=org, created_by=ctx.user_id)
            fields = await self._clean_body(data, partial=False)
            row.audience = await self._clean_audience(kind, pid, data.get("audience"), thank_you=True)
            self.session.add(row)
        else:
            row = await self.session.get(ArtistMailThankYou, thank_you_id)
            if row is None or row.profile_type != kind or row.profile_id != pid:
                raise NotFoundError("Thank-you email not found")
            fields = await self._clean_body(data, partial=True)
            if "audience" in data:
                row.audience = await self._clean_audience(kind, pid, data.get("audience"), thank_you=True)
        for key, value in fields.items():
            setattr(row, key, value)
        if "on" in data:
            row.is_on = bool(data["on"])
        if "file_ids" in data:
            row.file_ids = await self._clean_file_ids(kind, pid, data.get("file_ids"))
        row.updated_by = ctx.user_id
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx, action="artist_mail.thank_you_changed", entity_type="ArtistMailThankYou", entity_id=row.id,
            new_state={"on": row.is_on, "who": row.audience.get("who"), "works": len(row.audience.get("works") or [])},
            organization_id=org,
        )
        sent, clicks = await self._thank_you_counts(kind, pid)
        return await self._thank_you_out(row, sent, clicks)

    async def update_thank_you(self, ctx: AuthContext, thank_you_id: UUID, data: dict[str, Any]) -> dict[str, Any]:
        row = await self.session.get(ArtistMailThankYou, thank_you_id)
        if row is None:
            raise NotFoundError("Thank-you email not found")
        return await self.save_thank_you(ctx, row.profile_type, row.profile_id, data, thank_you_id)

    async def delete_thank_you(self, ctx: AuthContext, thank_you_id: UUID) -> None:
        row = await self.session.get(ArtistMailThankYou, thank_you_id)
        if row is None:
            raise NotFoundError("Thank-you email not found")
        _role, org, _name = await self._act(ctx, row.profile_type, row.profile_id)
        await self.audit.record_from_auth(
            ctx, action="artist_mail.thank_you_deleted", entity_type="ArtistMailThankYou", entity_id=row.id,
            previous_state={"who": (row.audience or {}).get("who")}, organization_id=org,
        )
        await self.session.delete(row)
        await self.session.flush()

    async def send_test(self, ctx: AuthContext, kind: str, pid: UUID, data: dict[str, Any]) -> dict[str, Any]:
        """The email as written, to the person asking, at their own account address, filled in as
        the buyer they are previewing it as (names only ever reach the act's own people)."""
        from cornerroom.modules.identity.domain.models import User

        _role, org, name = await self._act(ctx, kind, pid)
        user = await self.session.get(User, ctx.user_id)
        if user is None:
            raise NotFoundError("Account not found")
        fields = await self._clean_body(data, partial=False)
        preview = data.get("preview") if isinstance(data.get("preview"), dict) else {}
        works = await self._works(kind, pid, data.get("works"), required=False)
        titles = [_line(t, 200) for t in (preview.get("music") or []) if _line(t, 200)][:20] or [
            w["title"] for w in await self.gifts._work_names(works)
        ]
        values = values_for(_line(preview.get("name"), 120) or None, titles, name)
        is_thanks = str(data.get("kind") or "").upper() == "THANK_YOU"
        written, token = await self._write(
            kind="THANK_YOU" if is_thanks else "MANUAL", subject=fields["subject"], body=fields["body"], values=values,
            work=works[0] if works else None, file_ids=await self._clean_file_ids(kind, pid, data.get("file_ids")),
            stop_token=None if is_thanks else "test-link",
        )
        written.subject = f"[Test] {written.subject}"[:SUBJECT_MAX]
        message = await self._message(
            written, token, kind="TEST", profile_type=kind, profile_id=pid, user_id=user.id, email=user.email, from_name=from_name(name),
        )
        await self._event(ctx, ARTIST_MAIL_QUEUED, "ArtistMailMessage", message.id, {"kind": "TEST"}, org)
        return {"sent_to": "your account email"}

    # --- Studio: templates -------------------------------------------------------------------

    async def _clean_template(self, kind: str, pid: UUID, data: dict[str, Any]) -> dict[str, Any]:
        name = _line(data.get("name"), 120)
        if not name:
            raise AppError("VALIDATION_ERROR", "Give the template a name", 422, extras={"field": "name"})
        return {
            "name": name, **await self._clean_body(data, partial=False),
            "audience": await self._clean_audience(kind, pid, data.get("audience")),
            "occasion": self._occasion(data.get("occasion")),
            "file_ids": await self._clean_file_ids(kind, pid, data.get("file_ids")),
        }

    @staticmethod
    def _occasion(value: Any) -> str | None:
        occasion = str(value or "").upper() or None
        return occasion if occasion in OCCASIONS else None

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

    def _send_at(self, value: Any) -> datetime | None:
        if value in (None, ""):
            return None
        try:
            moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError as exc:
            raise AppError("VALIDATION_ERROR", "Use a real date and time", 422, extras={"field": "send_at"}) from exc
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=LOCAL_TZ)
        return moment.astimezone(timezone.utc)

    async def _clean_mail(self, kind: str, pid: UUID, data: dict[str, Any], *, partial: bool) -> dict[str, Any]:
        out = await self._clean_body(data, partial=partial)
        if "audience" in data or not partial:
            out["audience"] = await self._clean_audience(kind, pid, data.get("audience"))
        if "send_at" in data:
            out["send_at"] = self._send_at(data.get("send_at"))
        if "occasion" in data:
            out["occasion"] = self._occasion(data.get("occasion"))
        if "file_ids" in data:
            out["file_ids"] = await self._clean_file_ids(kind, pid, data.get("file_ids"))
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

    async def copy_mail(self, ctx: AuthContext, mail_id: UUID) -> dict[str, Any]:
        """A new draft from any earlier email: same words, audience and files, no time set."""
        mail, _role, _name = await self._mail(ctx, mail_id)
        still_there = {str(f.id) for f in await self._files(mail.profile_type, mail.profile_id)}
        return await self.create_mail(ctx, mail.profile_type, mail.profile_id, {
            "subject": mail.subject, "body": mail.body, "audience": dict(mail.audience or {}), "occasion": mail.occasion,
            "file_ids": [f for f in (mail.file_ids or []) if f in still_there],
        })

    async def mail_detail(self, ctx: AuthContext, mail_id: UUID) -> dict[str, Any]:
        mail, _role, name = await self._mail(ctx, mail_id)
        out = await self._mail_out(mail, name)
        if mail.status in ("DRAFT", "IN_REVIEW", "SCHEDULED"):
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
            new_state={"fields": sorted(k for k in data if k in ("subject", "body", "audience", "send_at", "occasion", "file_ids"))},
            organization_id=mail.organization_id,
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
        if mail.send_at is not None and mail.send_at <= self.clock.now():
            raise AppError("VALIDATION_ERROR", "Pick a sending time that hasn't passed, or send it when approved", 422, extras={"field": "send_at"})
        reach, _stopped = await self._recipients(mail.profile_type, mail.profile_id, mail.audience or {})
        # A release-day email (D-PRESALE-03) is written before anyone has pre-ordered; who gets it is
        # worked out when the release comes out.
        if not reach and mail.send_with_release_id is None:
            raise AppError("VALIDATION_ERROR", "Nobody would get this email yet", 422, extras={"field": "audience"})
        limit = self.settings.artist_mail_weekly_limit
        if limit > 0:
            recent = await self.session.scalar(
                select(func.count()).select_from(ArtistMail).where(
                    ArtistMail.profile_type == mail.profile_type, ArtistMail.profile_id == mail.profile_id,
                    ArtistMail.status.in_(("IN_REVIEW", "SCHEDULED", "SENDING", "SENT")),
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
            new_state={"reach": len(reach), "send_at": mail.send_at.isoformat() if mail.send_at else None},
            organization_id=mail.organization_id,
        )
        return await self.mail_detail(ctx, mail.id)

    async def withdraw_mail(self, ctx: AuthContext, mail_id: UUID) -> dict[str, Any]:
        """Back to a draft while waiting for review or for its time (it needs approving again)."""
        mail, _role, _name = await self._mail(ctx, mail_id)
        if mail.status not in ("IN_REVIEW", "SCHEDULED"):
            raise AppError("INVALID_TRANSITION", "Only an email that hasn't gone yet can be taken back", 409)
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
            item["files"] = await self._files_for(list(mail.file_ids or []))
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
        text = _line(note, 2000) or None
        _row, _org, name = await self.studio._profile(mail.profile_type, mail.profile_id)
        if approve:
            owners = await self.music.catalog_owner_ids(
                mail.profile_id if mail.profile_type == "artist" else None,
                mail.profile_id if mail.profile_type == "band" else None,
            )
            if second_review_on(self.settings) and (ctx.user_id in owners or ctx.user_id in {mail.created_by, mail.submitted_by}):
                raise AppError("SAME_PERSON_REVIEW", "Someone else must approve this", 403, "You wrote or sent this email")
            mail.approved_by = ctx.user_id
            mail.approved_at = self.clock.now()
            mail.review_note = None
            if mail.send_with_release_id is not None and not await self._release_out(mail.send_with_release_id):
                # D-PRESALE-03: waits for its release; the release sets its time when it comes out.
                mail.status = "SCHEDULED"
                mail.send_at = None
            elif mail.send_at is not None and mail.send_at > self.clock.now():
                # Who gets it is worked out at its time (D-MAIL-02).
                mail.status = "SCHEDULED"
            else:
                await self._send_now(ctx, mail, name)
        else:
            if not text:
                raise AppError("VALIDATION_ERROR", "Tell the artist what to change", 422)
            mail.status = "DRAFT"
            mail.review_note = text
        await self.music._flush_versioned()
        await self._event(
            ctx, ARTIST_MAIL_APPROVED if approve else ARTIST_MAIL_REJECTED, "ArtistMail", mail.id,
            {"note": text, "recipients": mail.recipient_count if approve else None,
             "send_at": mail.send_at.isoformat() if approve and mail.status == "SCHEDULED" and mail.send_at else None}, org,
        )
        await self.audit.record_from_auth(
            ctx, action="artist_mail.approved" if approve else "artist_mail.rejected", entity_type="ArtistMail",
            entity_id=mail.id, new_state={"status": mail.status, "note": text, "recipients": mail.recipient_count}, organization_id=org,
        )
        return await self._mail_out(mail, name)

    async def _release_out(self, release_id: UUID) -> bool:
        from cornerroom.modules.music.domain.models import Release

        release = await self.session.get(Release, release_id)
        return release is not None and release.status == "RELEASED"

    async def _send_now(self, ctx: AuthContext | None, mail: ArtistMail, name: str) -> None:
        queued = await self._queue_mail(ctx, mail, name)
        mail.recipient_count = queued
        mail.sent_at = self.clock.now()
        mail.status = "SENDING" if queued else "SENT"

    async def send_due(self) -> int:
        """Worker, every minute: scheduled emails whose time has come go out (D-MAIL-02)."""
        due = (
            await self.session.execute(
                select(ArtistMail).where(ArtistMail.status == "SCHEDULED", ArtistMail.send_at <= self.clock.now()).order_by(ArtistMail.send_at)
            )
        ).scalars().all()
        for mail in due:
            try:
                _row, _org, name = await self.studio._profile(mail.profile_type, mail.profile_id)
            except (NotFoundError, AppError):
                continue
            await self._send_now(None, mail, name)
            await self.music._flush_versioned()
            await self.audit.record(
                action="artist_mail.sent_on_time", entity_type="ArtistMail", entity_id=mail.id, actor_id="system:artist-mail",
                actor_type="system", new_state={"recipients": mail.recipient_count},
            )
        return len(due)

    async def _queue_mail(self, ctx: AuthContext | None, mail: ArtistMail, name: str) -> int:
        """Write one message per person the audience reaches now, and queue each to send."""
        audience = mail.audience or {}
        reach, _stopped = await self._recipients(mail.profile_type, mail.profile_id, audience)
        works = audience.get("works") or []
        titles = await self._titles(works)
        by_key = {_key(w): w for w in works}
        for person in reach:
            stop_token = secrets.token_urlsafe(32)
            bought = [k for k in person["bought"] if k in titles] or list(titles)
            values = values_for(person["name"], [titles[k] for k in bought], name)
            written, token = await self._write(
                kind="MANUAL", subject=mail.subject, body=mail.body, values=values, work=by_key.get(bought[0]) if bought else None,
                file_ids=list(mail.file_ids or []), stop_token=stop_token,
            )
            message = await self._message(
                written, token, kind="MANUAL", profile_type=mail.profile_type, profile_id=mail.profile_id, mail_id=mail.id,
                user_id=person["user_id"], email=person["email"], from_name=from_name(name), stop_token=stop_token,
            )
            await self._event(ctx, ARTIST_MAIL_QUEUED, "ArtistMailMessage", message.id, {"kind": "MANUAL"}, mail.organization_id)
        return len(reach)

    # --- thank-you on purchase -----------------------------------------------------------------

    async def _choose_thank_you(self, versions: list[ArtistMailThankYou], subjects: set[UUID], presale: bool) -> ArtistMailThankYou | None:
        fitting = []
        for v in versions:
            audience = v.audience or {}
            if audience.get("who") == "PRESALE" and not presale:
                continue
            works = audience.get("works") or []
            if works:
                per_work = await self._work_subjects(works)
                if not any(s & subjects for s in per_work.values()):
                    continue
            fitting.append(v)
        if not fitting:
            return None
        return max(fitting, key=lambda v: (specificity(v.audience or {}), v.updated_at or v.created_at))

    async def thank_buyer(self, order_id: UUID) -> int:
        """One thank-you per act whose music is in this paid order: the act's most specific version
        that fits (D-MAIL-02), if it has one switched on."""
        from cornerroom.modules.identity.domain.models import CustomerProfile, User
        from cornerroom.modules.music.domain.models import Release, Track

        order = await self.session.get(Order, order_id)
        if order is None or order.deleted_at is not None or order.status not in KEPT_ORDER_STATUSES:
            return 0
        user = await self.session.get(User, order.user_id)
        if user is None or user.deleted_at is not None:
            return 0
        items = (await self.session.execute(select(OrderItem).where(OrderItem.order_id == order.id).order_by(OrderItem.created_at))).scalars().all()
        acts: dict[tuple[str, UUID], list[tuple[dict[str, str], str]]] = {}
        for item in items:
            model = Track if item.item_type == "TRACK" else Release if item.item_type == "RELEASE" else None
            row = await self.session.get(model, item.ref_id) if model is not None else None
            if row is None:
                continue
            key = ("band", row.primary_band_id) if row.primary_band_id else ("artist", row.primary_artist_id) if row.primary_artist_id else None
            if key is not None:
                acts.setdefault(key, []).append(({"type": item.item_type, "id": str(row.id)}, row.title))
        presale = order.is_presale or (
            await self.session.scalar(select(PresaleClaim.id).where(PresaleClaim.order_id == order.id).limit(1))
        ) is not None
        profile = (await self.session.execute(select(CustomerProfile).where(CustomerProfile.user_id == user.id))).scalars().first()
        buyer_name = ((profile.display_name if profile else "") or "").strip() or None
        queued = 0
        for (kind, pid), bought in acts.items():
            versions = [v for v in await self._thank_yous(kind, pid) if v.is_on]
            if not versions:
                continue
            done = await self.session.scalar(
                select(ArtistMailMessage.id).where(
                    ArtistMailMessage.kind == "THANK_YOU", ArtistMailMessage.profile_type == kind,
                    ArtistMailMessage.profile_id == pid, ArtistMailMessage.order_id == order.id,
                )
            )
            if done is not None:
                continue
            version = await self._choose_thank_you(versions, {UUID(w["id"]) for w, _t in bought}, presale)
            if version is None:
                continue
            try:
                _row, org, name = await self.studio._profile(kind, pid)
            except (NotFoundError, AppError):
                continue
            written, token = await self._write(
                kind="THANK_YOU", subject=version.subject, body=version.body,
                values=values_for(buyer_name, [t for _w, t in bought], name), work=bought[0][0],
                file_ids=list(version.file_ids or []), stop_token=None,
            )
            message = await self._message(
                written, token, kind="THANK_YOU", profile_type=kind, profile_id=pid, order_id=order.id, user_id=user.id,
                email=user.email, from_name=from_name(name), thank_you_id=version.id,
            )
            await self._event(None, ARTIST_MAIL_QUEUED, "ArtistMailMessage", message.id, {"kind": "THANK_YOU"}, org)
            queued += 1
        return queued

    # --- sending -------------------------------------------------------------------------------

    async def deliver(self, message_id: UUID) -> str | None:
        """Send one queued message. A failed send is tried again later (the outbox's back-off) and
        marked FAILED after the outbox's number of tries; it never makes the other consumers of the
        event run again."""
        from cornerroom.infra.logging import mask_email
        from cornerroom.modules.notifications.infra.email import email_sender_for

        message = await self.session.get(ArtistMailMessage, message_id)
        if message is None or message.status != "PENDING":
            return None
        # A music gift's email respects "stop emails from this act" too (D-GIFT-MUSIC-01); the music
        # itself is still given to an account.
        if message.kind in ("MANUAL", "GIFT"):
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
        try:
            await sender.send(to=message.email, subject=message.subject, body=message.body, from_name=message.from_name, html=message.html)
        except Exception as exc:  # noqa: BLE001 - any provider failure is retried, then recorded
            message.attempts += 1
            message.last_error = f"{type(exc).__name__}: {exc}"[:300]
            if message.attempts >= self.settings.outbox_max_attempts:
                message.status = "FAILED"
                await self.session.flush()
                await self._finish_mail(message.mail_id)
                log.warning("artist_mail_failed", message_id=str(message.id), attempts=message.attempts)
                return message.status
            await self.session.flush()
            retry = await self._event(None, ARTIST_MAIL_QUEUED, "ArtistMailMessage", message.id, {"kind": message.kind, "retry": message.attempts}, None)
            retry.next_attempt_at = datetime.now(timezone.utc) + timedelta(seconds=self.settings.outbox_backoff_seconds * message.attempts)
            log.warning("artist_mail_retry", message_id=str(message.id), attempts=message.attempts)
            return None
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

    # --- clicks and files ----------------------------------------------------------------------

    async def click(self, token: str, position: int) -> dict[str, Any]:
        """A link in an email: counted, then opened (D-MAIL-02). A file kept by Corner Room comes
        back as its bytes; anything else as the address to send the person on to."""
        from cornerroom.infra.storage import get_storage

        message = (
            await self.session.execute(select(ArtistMailMessage).where(ArtistMailMessage.link_token == token[:64]))
        ).scalar_one_or_none() if token else None
        links = list(message.links or []) if message is not None else []
        if message is None or not 0 <= position < len(links):
            raise NotFoundError("Link not found")
        link = links[position]
        kind = link.get("kind") if link.get("kind") in ("LINK", "LISTEN", "FILE") else "LINK"
        self.session.add(ArtistMailClick(message_id=message.id, position=position, kind=kind, clicked_at=self.clock.now()))
        await self.session.flush()
        if kind == "FILE":
            row = await self.session.get(ArtistMailFile, UUID(link["file_id"])) if link.get("file_id") else None
            if row is None or row.deleted_at is not None:
                raise NotFoundError("This file is no longer available")
            if row.kind == "LINK":
                return {"redirect": row.url}
            data = await get_storage(self.settings).get_bytes(row.object_key or "")
            return {"file": data, "content_type": row.content_type or "application/octet-stream", "name": row.name}
        url = str(link.get("url") or "")
        if not _URL.match(url):
            raise NotFoundError("Link not found")
        return {"redirect": url}

    # --- reports -------------------------------------------------------------------------------

    @staticmethod
    def _rate(part: int, whole: int) -> float | None:
        """A share, or None (shown as "Not available") when nothing has been sent yet."""
        return round(part / whole, 4) if whole else None

    async def _clicks_for(self, message_filter: Any) -> list[tuple[UUID, int, str, datetime]]:
        return list(
            (
                await self.session.execute(
                    select(ArtistMailClick.message_id, ArtistMailClick.position, ArtistMailClick.kind, ArtistMailClick.clicked_at)
                    .join(ArtistMailMessage, ArtistMailMessage.id == ArtistMailClick.message_id)
                    .where(message_filter)
                )
            ).all()
        )

    async def mail_report(self, ctx: AuthContext, mail_id: UUID) -> dict[str, Any]:
        """One email to buyers: reach, delivery, clicks per link and over time, and stops."""
        mail, _role, name = await self._mail(ctx, mail_id)
        counts = await self._counts(mail.id)
        sent = counts["SENT"]
        clicks = await self._clicks_for(ArtistMailMessage.mail_id == mail.id)
        sample = (
            await self.session.execute(select(ArtistMailMessage.links).where(ArtistMailMessage.mail_id == mail.id).limit(1))
        ).scalar_one_or_none() or []
        per_link: dict[int, dict[str, Any]] = {}
        for message_id, position, kind, _at in clicks:
            entry = per_link.setdefault(position, {"position": position, "kind": kind, "clicks": 0, "people": set()})
            entry["clicks"] += 1
            entry["people"].add(message_id)
        links = []
        for position, link in enumerate(sample):
            entry = per_link.get(position, {"clicks": 0, "people": set()})
            links.append({
                "position": position, "kind": link.get("kind"), "label": link.get("label"),
                "url": link.get("url") if link.get("kind") == "LINK" else None,
                "clicks": entry["clicks"], "people": len(entry["people"]),
            })
        stops = await self.session.scalar(
            select(func.count()).select_from(ArtistMailOptOut)
            .join(ArtistMailMessage, ArtistMailMessage.id == ArtistMailOptOut.message_id)
            .where(ArtistMailMessage.mail_id == mail.id)
        )
        people_clicked = len({c[0] for c in clicks})
        sends = (
            await self.session.execute(
                select(ArtistMailMessage.sent_at).where(ArtistMailMessage.mail_id == mail.id, ArtistMailMessage.sent_at.is_not(None))
            )
        ).scalars().all()
        return {
            "mail": await self._mail_out(mail, name),
            "reached": mail.recipient_count,
            "sent": sent, "waiting": counts["PENDING"], "stopped_before": counts["SUPPRESSED"], "failed": counts["FAILED"],
            "clicks": len(clicks), "people_clicked": people_clicked, "click_rate": self._rate(people_clicked, sent),
            "downloads": sum(1 for c in clicks if c[2] == "FILE"),
            "stops": int(stops or 0), "stop_rate": self._rate(int(stops or 0), sent),
            "links": links,
            "timeline": self._timeline([s for s in sends if s], [c[3] for c in clicks]),
        }

    @staticmethod
    def _timeline(sends: list[datetime], clicks: list[datetime]) -> list[dict[str, Any]]:
        """Sends and clicks by hour for the first two days, then by day (Bangladesh time)."""
        if not sends and not clicks:
            return []
        start = min([*sends, *clicks])
        buckets: dict[str, dict[str, Any]] = {}

        def bucket(moment: datetime) -> str:
            local = moment.astimezone(LOCAL_TZ)
            if moment - start < timedelta(hours=48):
                return local.strftime("%Y-%m-%dT%H:00")
            return local.strftime("%Y-%m-%d")

        for moment in sends:
            buckets.setdefault(bucket(moment), {"at": bucket(moment), "sent": 0, "clicks": 0})["sent"] += 1
        for moment in clicks:
            buckets.setdefault(bucket(moment), {"at": bucket(moment), "sent": 0, "clicks": 0})["clicks"] += 1
        return [buckets[k] for k in sorted(buckets)]

    async def act_report(self, ctx: AuthContext, kind: str, pid: UUID, days: int = 90) -> dict[str, Any]:
        """The act's email dashboard over the last ``days`` (30, 90 or 365): emails and thank-yous
        sent, people who clicked, stops, each email's results, and a day-by-day series."""
        _role, _org, name = await self._act(ctx, kind, pid)
        days = days if days in (30, 90, 365) else 90
        since = self.clock.now() - timedelta(days=days)
        mine = (ArtistMailMessage.profile_type == kind) & (ArtistMailMessage.profile_id == pid) & (ArtistMailMessage.kind != "TEST")
        sent_rows = (
            await self.session.execute(
                select(ArtistMailMessage.id, ArtistMailMessage.kind, ArtistMailMessage.sent_at, ArtistMailMessage.mail_id)
                .where(mine, ArtistMailMessage.status == "SENT", ArtistMailMessage.sent_at >= since)
            )
        ).all()
        clicks = await self._clicks_for(mine & (ArtistMailClick.clicked_at >= since))
        failed = await self.session.scalar(
            select(func.count()).select_from(ArtistMailMessage).where(mine, ArtistMailMessage.status == "FAILED", ArtistMailMessage.created_at >= since)
        )
        stops = await self.session.scalar(
            select(func.count()).select_from(ArtistMailOptOut).where(
                ArtistMailOptOut.profile_type == kind, ArtistMailOptOut.profile_id == pid, ArtistMailOptOut.created_at >= since
            )
        )
        kind_of = {r[0]: r[1] for r in sent_rows}
        emails_sent = sum(1 for r in sent_rows if r[1] == "MANUAL")
        thanks_sent = sum(1 for r in sent_rows if r[1] == "THANK_YOU")
        clicked = {c[0] for c in clicks}
        series: dict[str, dict[str, Any]] = {}
        today = _local_day(self.clock.now()) or date.today()
        for i in range(days - 1, -1, -1):
            d = (today - timedelta(days=i)).isoformat()
            series[d] = {"day": d, "emails": 0, "thank_yous": 0, "clicks": 0}
        for _id, k, at, _mail in sent_rows:
            d = _local_day(at)
            if d and d.isoformat() in series:
                series[d.isoformat()]["emails" if k == "MANUAL" else "thank_yous"] += 1
        for _mid, _pos, _k, at in clicks:
            d = _local_day(at)
            if d and d.isoformat() in series:
                series[d.isoformat()]["clicks"] += 1
        mails = (
            await self.session.execute(
                select(ArtistMail).where(
                    ArtistMail.profile_type == kind, ArtistMail.profile_id == pid, ArtistMail.status.in_(("SENDING", "SENT")),
                    ArtistMail.sent_at >= since,
                ).order_by(ArtistMail.sent_at.desc())
            )
        ).scalars().all()
        campaigns = []
        for mail in mails:
            counts = await self._counts(mail.id)
            mail_clicks = await self._clicks_for(ArtistMailMessage.mail_id == mail.id)
            people = len({c[0] for c in mail_clicks})
            mail_stops = await self.session.scalar(
                select(func.count()).select_from(ArtistMailOptOut)
                .join(ArtistMailMessage, ArtistMailMessage.id == ArtistMailOptOut.message_id)
                .where(ArtistMailMessage.mail_id == mail.id)
            )
            campaigns.append({
                "id": mail.id, "subject": mail.subject, "occasion": mail.occasion, "sent_at": mail.sent_at,
                "reached": mail.recipient_count, "sent": counts["SENT"], "failed": counts["FAILED"],
                "people_clicked": people, "click_rate": self._rate(people, counts["SENT"]), "stops": int(mail_stops or 0),
            })
        sent_ty, clicks_ty = await self._thank_you_counts(kind, pid)
        thank_yous = [
            {"id": t.id, "audience": await self._audience_out(t.audience or {}), "on": t.is_on,
             "sent": int(sent_ty.get(t.id, 0)), "people_clicked": int(clicks_ty.get(t.id, 0)),
             "click_rate": self._rate(int(clicks_ty.get(t.id, 0)), int(sent_ty.get(t.id, 0)))}
            for t in await self._thank_yous(kind, pid)
        ]
        by_kind = {"LINK": 0, "LISTEN": 0, "FILE": 0}
        for _mid, _pos, k, _at in clicks:
            by_kind[k] = by_kind.get(k, 0) + 1
        return {
            "profile": {"kind": kind, "id": pid, "display_name": name},
            "days": days,
            "emails_sent": emails_sent, "thank_yous_sent": thanks_sent,
            "people_clicked": len(clicked), "clicks": len(clicks),
            "click_rate": self._rate(len({m for m in clicked if m in kind_of}), len(sent_rows)),
            "failed": int(failed or 0), "stops": int(stops or 0),
            "clicks_by_kind": by_kind,
            "series": list(series.values()),
            "campaigns": campaigns,
            "thank_yous": thank_yous,
        }

    # --- buyers stopping emails ----------------------------------------------------------------

    async def _stop(self, kind: str, pid: UUID, email: str, user_id: UUID | None, message_id: UUID | None = None) -> ArtistMailOptOut:
        row = (
            await self.session.execute(
                select(ArtistMailOptOut).where(
                    ArtistMailOptOut.profile_type == kind, ArtistMailOptOut.profile_id == pid,
                    func.lower(ArtistMailOptOut.email) == email.lower(),
                )
            )
        ).scalar_one_or_none()
        if row is None:
            row = ArtistMailOptOut(profile_type=kind, profile_id=pid, email=email, user_id=user_id, message_id=message_id)
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
            row = await self._stop(message.profile_type, message.profile_id, message.email, message.user_id, message.id)
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


def from_name(artist: str) -> str:
    return f"{artist} via Corner Room"[:200]


async def consume_artist_mail_event(event: DomainEvent, session: AsyncSession, settings: Settings | None = None) -> None:
    """Outbox side consumer: a paid order queues the acts' thank-yous; each queued message is sent."""
    if event.event_type == ORDER_PAID and event.aggregate_type == "Order":
        await ArtistMailService(session, settings).thank_buyer(event.aggregate_id)
    elif event.event_type == ARTIST_MAIL_QUEUED:
        await ArtistMailService(session, settings).deliver(event.aggregate_id)
