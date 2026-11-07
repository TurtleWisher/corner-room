"""Gift campaigns (owner, 2026-10-28, D-CAMPAIGN-01, D-CAMPAIGN-02).

An artist or band (or staff helping them) sets up a gift for buyers of some or all of their
music: what it is, which songs and releases it covers, who sends it, whether pre-sale buyers count
and from when purchases count. Publishing and every later change wait for staff, and the profile's
own people can't approve them. Once live it can be paused and restarted at any time; purchases made
while it is paused don't count. Fans see it on the music's pages only while it is live.

Recipients: every buyer of a covered work whose order was paid while the campaign was live (and,
when chosen, the pre-sale buyers of that music). Each collectible is tracked (owner, 2026-11-06,
D-CAMPAIGN-03): not prepared yet, prepared, dispatched (now, or at a chosen time by the worker; the
buyer gets an email and a notice saying it is on its way), then received, returned or missing
(returned and missing tell the buyer too). The moves allowed are in `domain/gifts.py`. Free extras only: nothing
here touches prices, orders or money. Recipients' name, phone and address are shown to staff, and
to the artist only for campaigns they send themselves (owner, 2026-10-28).
"""

from __future__ import annotations

from datetime import datetime
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
    GIFT_CAMPAIGN_APPROVED,
    GIFT_CAMPAIGN_PAUSED,
    GIFT_CAMPAIGN_REJECTED,
    GIFT_CAMPAIGN_RESUMED,
    GIFT_CAMPAIGN_SUBMITTED,
    GIFT_DISPATCH_SCHEDULED,
    GIFT_DISPATCHED,
    GIFT_MARKED_MISSING,
    GIFT_PREPARED,
    GIFT_RECEIVED,
    GIFT_RETURNED,
    GIFT_UNPREPARED,
    DomainEvent,
)
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.commerce.domain.gifts import (
    MAX_PEOPLE_PER_ADD,
    RECIPIENT_STATUSES,
    RECIPIENT_TRANSITIONS,
    GiftCampaign,
    GiftCampaignPeriod,
    GiftRecipient,
    GiftStatusMail,
    can_move,
    clean_person,
    phone_key,
)
from cornerroom.modules.commerce.domain.models import Order, OrderDeliveryAddress, OrderItem, PresaleClaim, Product

# Paid orders that still count (a fully refunded order no longer earns the gift).
GIFT_ORDER_STATUSES = ("PAID", "FULFILLED", "PARTIALLY_REFUNDED")
EDITABLE_FIELDS = ("title", "gift_items", "description", "sender", "include_presale", "counts_from", "works")
MAX_WORKS = 200
# Campaign states whose gifts can be tracked (it has been live).
TRACKABLE = ("ACTIVE", "PAUSED", "ENDED")
# The event each move writes (dispatching writes GIFT_DISPATCHED with what the buyer email needs).
MOVE_EVENTS = {
    "PREPARED": GIFT_PREPARED,
    "YET_TO_SEND": GIFT_UNPREPARED,
    "RECEIVED": GIFT_RECEIVED,
    "RETURNED": GIFT_RETURNED,
    "MISSING": GIFT_MARKED_MISSING,
}


def _clean(value: Any, limit: int) -> str | None:
    text = " ".join(str(value or "").split())
    return text[:limit] or None


def in_periods(moment: datetime, periods: list[tuple[datetime, datetime | None]], now: datetime) -> bool:
    """Whether a purchase made at `moment` falls inside a stretch the campaign was live."""
    return any(start <= moment < (end or now) or (end is None and moment >= start) for start, end in periods)


class GiftCampaignService:
    def __init__(self, session: AsyncSession, settings: Settings | None = None, clock: Clock | None = None) -> None:
        from cornerroom.modules.music.application.studio import StudioService

        self.session = session
        self.settings = settings or get_settings()
        self.clock = clock or SystemClock()
        self.studio = StudioService(session, self.settings, self.clock)
        self.music = self.studio.music
        self.audit = AuditService(session)

    # --- access ------------------------------------------------------------------------------

    async def _profile_role(self, ctx: AuthContext, kind: str, pid: UUID) -> tuple[str, UUID | None, str]:
        if kind not in ("artist", "band"):
            raise NotFoundError("Profile not found")
        role, org, name, _row = await self.studio._role_for_profile(ctx, kind, pid)
        return role, org, name

    async def _campaign(self, ctx: AuthContext, campaign_id: UUID) -> tuple[GiftCampaign, str, str]:
        campaign = await self.session.get(GiftCampaign, campaign_id)
        if campaign is None:
            raise NotFoundError("Campaign not found")
        role, _org, name = await self._profile_role(ctx, campaign.profile_type, campaign.profile_id)
        return campaign, role, name

    async def _event(self, ctx: AuthContext | None, event_type: str, agg: str, agg_id: UUID, payload: dict[str, Any], org: UUID | None) -> None:
        await enqueue_outbox(
            self.session,
            DomainEvent(
                event_type=event_type, producer="commerce", aggregate_type=agg, aggregate_id=agg_id, payload=payload,
                occurred_at=self.clock.now(), actor_id=ctx.user_id if ctx else None, organization_id=org,
                correlation_id=ctx.request_id if ctx else None,
            ),
        )

    # --- what it covers ------------------------------------------------------------------------

    async def _clean_works(self, kind: str, pid: UUID, works: Any) -> list[dict[str, str]]:
        """The profile's own songs and releases only."""
        from cornerroom.modules.music.domain.models import Release, Track

        if not isinstance(works, list) or not works:
            raise AppError("VALIDATION_ERROR", "Choose at least one song or release", 422, extras={"field": "works"})
        if len(works) > MAX_WORKS:
            raise AppError("VALIDATION_ERROR", "Too many songs and releases", 422, extras={"field": "works"})
        out: list[dict[str, str]] = []
        seen: set[tuple[str, str]] = set()
        for item in works:
            kind_ = str((item or {}).get("type", "")).upper()
            try:
                wid = UUID(str((item or {}).get("id")))
            except ValueError as exc:
                raise AppError("VALIDATION_ERROR", "Unknown song or release", 422, extras={"field": "works"}) from exc
            model = Release if kind_ == "RELEASE" else Track if kind_ == "TRACK" else None
            row = await self.session.get(model, wid) if model is not None else None
            owner_col = "primary_artist_id" if kind == "artist" else "primary_band_id"
            if row is None or getattr(row, "deleted_at", None) is not None or getattr(row, owner_col) != pid:
                raise AppError("VALIDATION_ERROR", "Choose songs and releases of this artist or band", 422, extras={"field": "works"})
            if (kind_, str(wid)) not in seen:
                seen.add((kind_, str(wid)))
                out.append({"type": kind_, "id": str(wid)})
        return out

    async def _subjects(self, works: list[dict[str, str]]) -> set[UUID]:
        """Song and release ids whose purchase counts. A single's song and the single itself are the
        same music, so either counts for the other. Whether an album counts for a song-only
        campaign is not decided yet (owner, 2026-10-28), so it doesn't."""
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
                singles = await self.session.execute(
                    select(Release.id)
                    .join(ReleaseTrack, ReleaseTrack.release_id == Release.id)
                    .where(ReleaseTrack.track_id == wid, Release.release_type == "SINGLE", Release.deleted_at.is_(None))
                )
                subjects |= set(singles.scalars())
        return subjects

    async def _work_names(self, works: list[dict[str, str]]) -> list[dict[str, Any]]:
        from cornerroom.modules.music.domain.models import Release, Track

        out = []
        for w in works:
            row = await self.session.get(Release if w["type"] == "RELEASE" else Track, UUID(w["id"]))
            out.append({"type": w["type"], "id": w["id"], "title": row.title if row is not None else "Not available"})
        return out

    async def _clean_fields(self, campaign_kind: str, pid: UUID, data: dict[str, Any], *, partial: bool) -> dict[str, Any]:
        out: dict[str, Any] = {}
        if "title" in data or not partial:
            title = _clean(data.get("title"), 200)
            if not title:
                raise AppError("VALIDATION_ERROR", "Give the campaign a name", 422, extras={"field": "title"})
            out["title"] = title
        if "gift_items" in data or not partial:
            items = _clean(data.get("gift_items"), 500)
            if not items:
                raise AppError("VALIDATION_ERROR", "Say what the gift is", 422, extras={"field": "gift_items"})
            out["gift_items"] = items
        if "description" in data:
            text = str(data.get("description") or "").strip()[:4000]
            out["description"] = text or None
        if "sender" in data or not partial:
            sender = str(data.get("sender") or "ARTIST").upper()
            if sender not in ("ARTIST", "CORNER_ROOM"):
                raise AppError("VALIDATION_ERROR", "Choose who sends the gifts", 422, extras={"field": "sender"})
            out["sender"] = sender
        if "include_presale" in data:
            out["include_presale"] = bool(data.get("include_presale"))
        if "counts_from" in data:
            out["counts_from"] = data.get("counts_from")
        if "works" in data or not partial:
            out["works"] = await self._clean_works(campaign_kind, pid, data.get("works"))
        return out

    # --- Studio: set up and change ---------------------------------------------------------------

    async def list_for_profile(self, ctx: AuthContext, kind: str, pid: UUID) -> list[dict[str, Any]]:
        role, _org, name = await self._profile_role(ctx, kind, pid)
        rows = (
            await self.session.execute(
                select(GiftCampaign)
                .where(GiftCampaign.profile_type == kind, GiftCampaign.profile_id == pid)
                .order_by(GiftCampaign.created_at.desc())
            )
        ).scalars().all()
        return [await self._summary(c, name) for c in rows]

    async def create(self, ctx: AuthContext, kind: str, pid: UUID, data: dict[str, Any]) -> dict[str, Any]:
        role, org, name = await self._profile_role(ctx, kind, pid)
        fields = await self._clean_fields(kind, pid, data, partial=False)
        campaign = GiftCampaign(
            profile_type=kind, profile_id=pid, organization_id=org, status="DRAFT", created_by=ctx.user_id,
            include_presale=bool(fields.pop("include_presale", False)), **fields,
        )
        self.session.add(campaign)
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx, action="gift_campaign.created", entity_type="GiftCampaign", entity_id=campaign.id,
            new_state={"title": campaign.title, "works": len(campaign.works)}, organization_id=org,
        )
        return await self.detail(ctx, campaign.id)

    async def update(self, ctx: AuthContext, campaign_id: UUID, data: dict[str, Any]) -> dict[str, Any]:
        """A draft changes at once. A live or paused campaign's change waits for staff."""
        campaign, _role, _name = await self._campaign(ctx, campaign_id)
        if campaign.status in ("IN_REVIEW", "ENDED"):
            raise AppError("INVALID_TRANSITION", "This campaign can't be changed now", 409)
        fields = await self._clean_fields(campaign.profile_type, campaign.profile_id, {k: v for k, v in data.items() if k in EDITABLE_FIELDS}, partial=True)
        if campaign.status == "DRAFT":
            for key, value in fields.items():
                setattr(campaign, key, value)
        else:
            pending = dict(campaign.pending or {})
            for key, value in fields.items():
                stored = value.isoformat() if isinstance(value, datetime) else value
                current = getattr(campaign, key)
                current = current.isoformat() if isinstance(current, datetime) else current
                if stored == current:
                    pending.pop(key, None)
                else:
                    pending[key] = stored
            campaign.pending = pending or None
            campaign.pending_at = self.clock.now() if pending else None
            campaign.pending_by = ctx.user_id if pending else None
            if pending:
                campaign.review_note = None
                await self._event(ctx, GIFT_CAMPAIGN_SUBMITTED, "GiftCampaign", campaign.id, {"change": True}, campaign.organization_id)
        await self.music._flush_versioned()
        await self.audit.record_from_auth(
            ctx, action="gift_campaign.changed", entity_type="GiftCampaign", entity_id=campaign.id,
            new_state={"fields": sorted(fields), "waiting": campaign.pending is not None}, organization_id=campaign.organization_id,
        )
        return await self.detail(ctx, campaign.id)

    async def submit(self, ctx: AuthContext, campaign_id: UUID) -> dict[str, Any]:
        campaign, _role, _name = await self._campaign(ctx, campaign_id)
        if campaign.status != "DRAFT":
            raise AppError("INVALID_TRANSITION", "Only a draft campaign is sent for review", 409)
        campaign.status = "IN_REVIEW"
        campaign.submitted_by = ctx.user_id
        campaign.submitted_at = self.clock.now()
        campaign.review_note = None
        await self.music._flush_versioned()
        await self._event(ctx, GIFT_CAMPAIGN_SUBMITTED, "GiftCampaign", campaign.id, {}, campaign.organization_id)
        await self.audit.record_from_auth(
            ctx, action="gift_campaign.submitted", entity_type="GiftCampaign", entity_id=campaign.id, new_state={},
            organization_id=campaign.organization_id,
        )
        return await self.detail(ctx, campaign.id)

    async def withdraw_change(self, ctx: AuthContext, campaign_id: UUID) -> dict[str, Any]:
        """Take back a waiting change (live campaign) or a draft sent for review."""
        campaign, _role, _name = await self._campaign(ctx, campaign_id)
        if campaign.status == "IN_REVIEW":
            campaign.status = "DRAFT"
        campaign.pending = None
        campaign.pending_at = None
        campaign.pending_by = None
        await self.music._flush_versioned()
        return await self.detail(ctx, campaign.id)

    async def _open_period(self, campaign: GiftCampaign, start: datetime) -> None:
        self.session.add(GiftCampaignPeriod(campaign_id=campaign.id, started_at=start))
        await self.session.flush()

    async def _close_period(self, campaign: GiftCampaign) -> None:
        open_ = (
            await self.session.execute(
                select(GiftCampaignPeriod).where(GiftCampaignPeriod.campaign_id == campaign.id, GiftCampaignPeriod.ended_at.is_(None))
            )
        ).scalars().all()
        for period in open_:
            period.ended_at = self.clock.now()
        await self.session.flush()

    async def pause(self, ctx: AuthContext, campaign_id: UUID) -> dict[str, Any]:
        campaign, _role, _name = await self._campaign(ctx, campaign_id)
        if campaign.status != "ACTIVE":
            raise AppError("INVALID_TRANSITION", "Only a live campaign can be paused", 409)
        campaign.status = "PAUSED"
        await self._close_period(campaign)
        await self.music._flush_versioned()
        await self._event(ctx, GIFT_CAMPAIGN_PAUSED, "GiftCampaign", campaign.id, {}, campaign.organization_id)
        await self.audit.record_from_auth(
            ctx, action="gift_campaign.paused", entity_type="GiftCampaign", entity_id=campaign.id, new_state={},
            organization_id=campaign.organization_id,
        )
        return await self.detail(ctx, campaign.id)

    async def resume(self, ctx: AuthContext, campaign_id: UUID) -> dict[str, Any]:
        """Restart at once: it was approved before (owner: pause or restart any time)."""
        campaign, _role, _name = await self._campaign(ctx, campaign_id)
        if campaign.status != "PAUSED":
            raise AppError("INVALID_TRANSITION", "Only a paused campaign can be restarted", 409)
        campaign.status = "ACTIVE"
        await self._open_period(campaign, self.clock.now())
        await self.music._flush_versioned()
        await self._event(ctx, GIFT_CAMPAIGN_RESUMED, "GiftCampaign", campaign.id, {}, campaign.organization_id)
        await self.audit.record_from_auth(
            ctx, action="gift_campaign.resumed", entity_type="GiftCampaign", entity_id=campaign.id, new_state={},
            organization_id=campaign.organization_id,
        )
        return await self.detail(ctx, campaign.id)

    # --- staff review ----------------------------------------------------------------------------

    async def _reviewer(self, ctx: AuthContext, campaign: GiftCampaign) -> None:
        org = campaign.organization_id
        if org is None or not await self.music._is_allowed(
            ctx.user_id, "music.approve", resource_type="release", resource_id=campaign.id, organization_id=org
        ):
            raise NotFoundError("Campaign not found")

    async def review_queue(self, ctx: AuthContext) -> list[dict[str, Any]]:
        org = await self.studio._require_staff_workspace(ctx, "music.approve")
        rows = (
            await self.session.execute(
                select(GiftCampaign)
                .where(GiftCampaign.organization_id == org)
                .where(
                    (GiftCampaign.status == "IN_REVIEW")
                    | GiftCampaign.pending.is_not(None)
                    # People the act added, waiting for staff (D-CAMPAIGN-04).
                    | GiftCampaign.id.in_(select(GiftRecipient.campaign_id).where(GiftRecipient.waiting.is_(True)))
                    # The act's own status emails, waiting for staff (D-CAMPAIGN-05).
                    | GiftCampaign.id.in_(select(GiftStatusMail.campaign_id).where(GiftStatusMail.state == "IN_REVIEW"))
                )
                .order_by(GiftCampaign.updated_at)
            )
        ).scalars().all()
        out = []
        for c in rows:
            _row, _org, name = await self.studio._profile(c.profile_type, c.profile_id)
            out.append(await self._summary(c, name))
        return out

    async def review(self, ctx: AuthContext, campaign_id: UUID, *, approve: bool, note: str | None) -> dict[str, Any]:
        campaign = await self.session.get(GiftCampaign, campaign_id)
        if campaign is None:
            raise NotFoundError("Campaign not found")
        await self._reviewer(ctx, campaign)
        if campaign.status != "IN_REVIEW" and campaign.pending is None:
            raise AppError("INVALID_TRANSITION", "Nothing is waiting for review on this campaign", 409)
        text = _clean(note, 2000)
        if approve:
            owners = await self.music.catalog_owner_ids(
                campaign.profile_id if campaign.profile_type == "artist" else None,
                campaign.profile_id if campaign.profile_type == "band" else None,
            )
            if ctx.user_id in owners or ctx.user_id in {campaign.created_by, campaign.submitted_by, campaign.pending_by}:
                raise AppError("SAME_PERSON_REVIEW", "Someone else must approve this", 403, "You set up or changed this campaign")
            if campaign.status == "IN_REVIEW":
                campaign.status = "ACTIVE"
                campaign.approved_by = ctx.user_id
                campaign.approved_at = self.clock.now()
                start = campaign.counts_from or self.clock.now()
                await self._open_period(campaign, min(start, self.clock.now()))
            if campaign.pending:
                for key, value in campaign.pending.items():
                    if key == "counts_from" and value:
                        value = datetime.fromisoformat(value)
                    setattr(campaign, key, value)
                await self._reshape_first_period(campaign)
            campaign.review_note = None
        else:
            if not text:
                raise AppError("VALIDATION_ERROR", "Tell the artist what to change", 422)
            if campaign.status == "IN_REVIEW":
                campaign.status = "DRAFT"
            campaign.review_note = text
        campaign.pending = None
        campaign.pending_at = None
        campaign.pending_by = None
        await self.music._flush_versioned()
        await self._event(
            ctx, GIFT_CAMPAIGN_APPROVED if approve else GIFT_CAMPAIGN_REJECTED, "GiftCampaign", campaign.id, {"note": text},
            campaign.organization_id,
        )
        await self.audit.record_from_auth(
            ctx, action="gift_campaign.approved" if approve else "gift_campaign.rejected", entity_type="GiftCampaign",
            entity_id=campaign.id, new_state={"status": campaign.status, "note": text}, organization_id=campaign.organization_id,
        )
        _row, _org, name = await self.studio._profile(campaign.profile_type, campaign.profile_id)
        return await self._summary(campaign, name)

    async def _reshape_first_period(self, campaign: GiftCampaign) -> None:
        """An approved new "counts from" date moves the start of the first live stretch."""
        if campaign.counts_from is None:
            return
        first = (
            await self.session.execute(
                select(GiftCampaignPeriod).where(GiftCampaignPeriod.campaign_id == campaign.id).order_by(GiftCampaignPeriod.started_at).limit(1)
            )
        ).scalar_one_or_none()
        if first is not None:
            first.started_at = min(campaign.counts_from, first.ended_at or self.clock.now())
            await self.session.flush()

    # --- recipients --------------------------------------------------------------------------------

    async def _periods(self, campaign: GiftCampaign) -> list[tuple[datetime, datetime | None]]:
        rows = (
            await self.session.execute(select(GiftCampaignPeriod).where(GiftCampaignPeriod.campaign_id == campaign.id))
        ).scalars().all()
        return [(p.started_at, p.ended_at) for p in rows]

    async def sync_recipients(self, campaign: GiftCampaign) -> None:
        """Add everyone who has earned the gift since the last look. Nobody is removed."""
        from cornerroom.modules.identity.domain.models import User

        if campaign.status not in ("ACTIVE", "PAUSED", "ENDED"):
            return
        subjects = await self._subjects(campaign.works or [])
        if not subjects:
            return
        products = set((await self.session.execute(select(Product.id).where(Product.subject_id.in_(subjects)))).scalars())
        periods = await self._periods(campaign)
        now = self.clock.now()
        existing = {
            r.email.lower(): r
            for r in (await self.session.execute(select(GiftRecipient).where(GiftRecipient.campaign_id == campaign.id))).scalars()
            if r.email
        }
        by_user = {r.user_id: r for r in existing.values() if r.user_id}
        wanted: dict[str, dict[str, Any]] = {}
        orders = (
            await self.session.execute(
                select(Order)
                .join(OrderItem, OrderItem.order_id == Order.id)
                .where(
                    Order.status.in_(GIFT_ORDER_STATUSES),
                    Order.deleted_at.is_(None),
                    # Music an artist gave away (D-GIFT-MUSIC-01) wasn't bought: it earns no campaign gift.
                    Order.music_gift_id.is_(None),
                    (OrderItem.product_id.in_(products or {UUID(int=0)})) | (OrderItem.ref_id.in_(subjects)),
                )
                .distinct()
            )
        ).scalars().all()
        users = {
            u.id: u
            for u in (await self.session.execute(select(User).where(User.id.in_({o.user_id for o in orders} or {UUID(int=0)})))).scalars()
        }
        claims: list[PresaleClaim] = []
        if campaign.include_presale and products:
            claims = list(
                (await self.session.execute(
                    select(PresaleClaim).where(PresaleClaim.product_id.in_(products), PresaleClaim.status != "CANCELLED")
                )).scalars()
            )
        claimed_orders = {c.order_id for c in claims if getattr(c, "order_id", None)}
        # Pre-orders on Corner Room are pre-sale buyers too (D-PRESALE-02).
        if campaign.include_presale:
            claimed_orders |= {o.id for o in orders if o.is_presale}
        for order in orders:
            user = users.get(order.user_id)
            if user is None or user.deleted_at is not None:
                continue
            if order.id not in claimed_orders and not in_periods(order.created_at, periods, now):
                continue
            wanted.setdefault(user.email.lower(), {"user_id": user.id, "email": user.email, "order_id": order.id})
        for claim in claims:
            email = claim.email.lower()
            if claim.claimed_user_id:
                user = await self.session.get(User, claim.claimed_user_id)
                if user is not None and user.deleted_at is None:
                    email = user.email.lower()
                    wanted.setdefault(email, {"user_id": user.id, "email": user.email, "order_id": getattr(claim, "order_id", None)})
                    wanted[email]["presale_claim_id"] = claim.id
                    continue
            wanted.setdefault(email, {"user_id": None, "email": claim.email, "order_id": None, "presale_claim_id": claim.id})
        for email, item in wanted.items():
            row = existing.get(email) or (by_user.get(item["user_id"]) if item.get("user_id") else None)
            if row is not None:
                if row.user_id is None and item.get("user_id"):
                    row.user_id = item["user_id"]
                if row.order_id is None and item.get("order_id"):
                    row.order_id = item["order_id"]
                if row.presale_claim_id is None and item.get("presale_claim_id"):
                    row.presale_claim_id = item["presale_claim_id"]
                # Someone added by hand who turns out to be a real buyer needs no approval.
                if row.waiting:
                    row.waiting = False
                    row.approved_at = now
                continue
            self.session.add(
                GiftRecipient(
                    campaign_id=campaign.id, user_id=item.get("user_id"), email=item["email"], order_id=item.get("order_id"),
                    presale_claim_id=item.get("presale_claim_id"), status="YET_TO_SEND",
                )
            )
        await self.session.flush()

    async def _counts(self, campaign_id: UUID) -> dict[str, int]:
        rows = await self.session.execute(
            select(GiftRecipient.status, func.count())
            .where(GiftRecipient.campaign_id == campaign_id, GiftRecipient.waiting.is_(False))
            .group_by(GiftRecipient.status)
        )
        counts = {status: 0 for status in RECIPIENT_STATUSES}
        for status, n in rows:
            counts[status] = int(n)
        counts["TOTAL"] = sum(counts.values())
        # People the act added who wait for staff (D-CAMPAIGN-04): not part of the total.
        counts["WAITING"] = int(
            await self.session.scalar(
                select(func.count()).where(GiftRecipient.campaign_id == campaign_id, GiftRecipient.waiting.is_(True))
            )
            or 0
        )
        # Prepared gifts with a dispatch time set (part of PREPARED, not added to the total).
        counts["SCHEDULED"] = int(
            await self.session.scalar(
                select(func.count()).where(
                    GiftRecipient.campaign_id == campaign_id,
                    GiftRecipient.status == "PREPARED",
                    GiftRecipient.dispatch_at.is_not(None),
                )
            )
            or 0
        )
        return counts

    async def _contact(self, recipients: list[GiftRecipient]) -> dict[UUID, dict[str, Any]]:
        """Name, phone and address to post the gift to: the address confirmed on the order, else the
        account's saved one, else what the pre-sale sheet gave."""
        from cornerroom.modules.commerce.application.customers import _address_text
        from cornerroom.modules.identity.domain.models import CustomerProfile, DeliveryAddress

        user_ids = [r.user_id for r in recipients if r.user_id]
        names = {
            p.user_id: p.display_name
            for p in (await self.session.execute(select(CustomerProfile).where(CustomerProfile.user_id.in_(user_ids or [UUID(int=0)])))).scalars()
        }
        saved = {
            a.user_id: a
            for a in (await self.session.execute(select(DeliveryAddress).where(DeliveryAddress.user_id.in_(user_ids or [UUID(int=0)])))).scalars()
        }
        order_ids = [r.order_id for r in recipients if r.order_id]
        on_order = {
            a.order_id: a
            for a in (await self.session.execute(select(OrderDeliveryAddress).where(OrderDeliveryAddress.order_id.in_(order_ids or [UUID(int=0)])))).scalars()
        }
        claim_ids = [r.presale_claim_id for r in recipients if r.presale_claim_id]
        claims = {
            c.id: c
            for c in (await self.session.execute(select(PresaleClaim).where(PresaleClaim.id.in_(claim_ids or [UUID(int=0)])))).scalars()
        }
        out: dict[UUID, dict[str, Any]] = {}
        for r in recipients:
            address = (on_order.get(r.order_id) if r.order_id else None) or (saved.get(r.user_id) if r.user_id else None)
            claim = claims.get(r.presale_claim_id) if r.presale_claim_id else None
            # Details typed in for someone added by hand come first (D-CAMPAIGN-04).
            out[r.id] = {
                "name": r.name or (names.get(r.user_id) if r.user_id else None) or (address.recipient_name if address else None)
                or (claim.buyer_name if claim else None),
                "phone": r.phone or (address.phone if address else None) or (getattr(claim, "phone", None) if claim else None),
                "address": r.address
                or (_address_text(address) if address else (getattr(claim, "address", None) if claim else None)),
            }
        return out

    async def _summary(self, campaign: GiftCampaign, profile_name: str) -> dict[str, Any]:
        return {
            "id": campaign.id,
            "profile": {"kind": campaign.profile_type, "id": campaign.profile_id, "display_name": profile_name},
            "title": campaign.title,
            "gift_items": campaign.gift_items,
            "description": campaign.description,
            "sender": campaign.sender,
            "include_presale": campaign.include_presale,
            "counts_from": campaign.counts_from,
            "works": await self._work_names(campaign.works or []),
            "status": campaign.status,
            "pending": campaign.pending,
            "review_note": campaign.review_note,
            "submitted_at": campaign.submitted_at,
            "approved_at": campaign.approved_at,
            "counts": await self._counts(campaign.id),
            # The act's own status emails waiting for staff (D-CAMPAIGN-05).
            "emails_waiting": int(
                (
                    await self.session.execute(
                        select(func.count()).select_from(GiftStatusMail).where(
                            GiftStatusMail.campaign_id == campaign.id, GiftStatusMail.state == "IN_REVIEW"
                        )
                    )
                ).scalar_one()
            ),
        }

    async def detail(self, ctx: AuthContext, campaign_id: UUID) -> dict[str, Any]:
        campaign, role, name = await self._campaign(ctx, campaign_id)
        await self.sync_recipients(campaign)
        out = await self._summary(campaign, name)
        # Staff always; the artist only when they send the gifts themselves (owner, 2026-10-28).
        show_contact = role == "staff" or campaign.sender == "ARTIST"
        can_dispatch = campaign.status in TRACKABLE and (role == "staff" or campaign.sender == "ARTIST")
        rows = (
            await self.session.execute(
                select(GiftRecipient).where(GiftRecipient.campaign_id == campaign.id).order_by(GiftRecipient.created_at)
            )
        ).scalars().all()
        recipients = [r for r in rows if not r.waiting]
        waiting = [r for r in rows if r.waiting]
        contact = await self._contact(list(recipients)) if show_contact else {}
        out["viewer_role"] = role
        out["can_dispatch"] = can_dispatch
        out["shows_contact"] = show_contact
        # D-CAMPAIGN-04: staff and the act's team may add people once the campaign has been live;
        # the team's additions wait for staff, who approve or turn them away.
        out["can_add"] = campaign.status in TRACKABLE
        out["can_review"] = role == "staff"
        # Where each status may go next; the page offers only these (it never hard-codes them).
        out["transitions"] = {k: list(v) for k, v in RECIPIENT_TRANSITIONS.items()}
        out["recipients"] = [
            {
                "id": r.id,
                "status": r.status,
                "source": r.source,
                "has_account": r.user_id is not None,
                "prepared_at": r.prepared_at,
                "dispatch_at": r.dispatch_at if r.status == "PREPARED" else None,
                "dispatched_at": r.dispatched_at,
                "outcome_at": r.outcome_at,
                **({"email": r.email} if role == "staff" else {}),
                **(contact.get(r.id, {}) if show_contact else {}),
            }
            for r in recipients
        ]
        # The act typed these details in themselves, so its team sees them as well as staff.
        out["waiting"] = [
            {
                "id": r.id, "status": r.status, "source": r.source, "has_account": r.user_id is not None,
                "name": r.name, "email": r.email, "phone": r.phone, "address": r.address,
            }
            for r in waiting
        ]
        return out

    # --- people added by hand (D-CAMPAIGN-04) ---------------------------------------------------------

    async def add_people(self, ctx: AuthContext, campaign_id: UUID, people: list[dict[str, Any]]) -> dict[str, Any]:
        """Add people who bought outside Corner Room (owner, 2026-11-07): typed in or pasted from a
        sheet. Anyone already in the campaign (same email, or same phone) is skipped; an email that
        belongs to an account is linked to it. Staff additions count at once; the act's wait for
        staff. Every problem is reported before anything is added."""
        from cornerroom.modules.identity.domain.models import User

        campaign, role, _name = await self._campaign(ctx, campaign_id)
        if campaign.status not in TRACKABLE:
            raise AppError("INVALID_TRANSITION", "The campaign isn't live yet", 409)
        if not people:
            raise AppError("VALIDATION_ERROR", "Add at least one person", 422)
        if len(people) > MAX_PEOPLE_PER_ADD:
            raise AppError("VALIDATION_ERROR", f"Add at most {MAX_PEOPLE_PER_ADD} people at a time", 422)
        cleaned: list[dict[str, Any]] = []
        problems: list[str] = []
        for i, raw in enumerate(people):
            person, problem = clean_person(raw if isinstance(raw, dict) else {})
            if problem:
                problems.append(f"Row {i + 1}: {problem}")
            elif person:
                cleaned.append(person)
        if problems:
            raise AppError("VALIDATION_ERROR", "; ".join(problems[:5]) + (f" (and {len(problems) - 5} more)" if len(problems) > 5 else ""), 422)
        await self.sync_recipients(campaign)
        rows = (await self.session.execute(select(GiftRecipient).where(GiftRecipient.campaign_id == campaign.id))).scalars().all()
        emails = {r.email.lower() for r in rows if r.email}
        phones = {k for k in (phone_key(r.phone) for r in rows) if k}
        accounts = {
            u.email.lower(): u.id
            for u in (
                await self.session.execute(
                    select(User).where(
                        func.lower(User.email).in_({p["email"] for p in cleaned if p["email"]} or {""}), User.deleted_at.is_(None)
                    )
                )
            ).scalars()
        }
        now = self.clock.now()
        waiting = role != "staff"
        added = skipped = 0
        for p in cleaned:
            key = phone_key(p["phone"])
            if (p["email"] and p["email"] in emails) or (key and key in phones):
                skipped += 1
                continue
            self.session.add(
                GiftRecipient(
                    campaign_id=campaign.id, user_id=accounts.get(p["email"] or ""), email=p["email"], status="YET_TO_SEND",
                    source="ADDED", name=p["name"], phone=p["phone"], address=p["address"], added_by=ctx.user_id,
                    waiting=waiting, approved_by=None if waiting else ctx.user_id, approved_at=None if waiting else now,
                )
            )
            if p["email"]:
                emails.add(p["email"])
            if key:
                phones.add(key)
            added += 1
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx, action="gift_campaign.people_added", entity_type="GiftCampaign", entity_id=campaign.id,
            new_state={"added": added, "skipped": skipped, "waiting": waiting}, organization_id=campaign.organization_id,
        )
        out = await self.detail(ctx, campaign.id)
        out["added"] = added
        out["skipped"] = skipped
        return out

    async def review_people(self, ctx: AuthContext, campaign_id: UUID, ids: list[UUID], *, approve: bool) -> dict[str, Any]:
        """Staff approve the act's additions (they then count like any buyer) or turn them away
        (they are removed)."""
        campaign, role, _name = await self._campaign(ctx, campaign_id)
        if role != "staff":
            raise AppError("FORBIDDEN", "Corner Room approves people added by the act", 403)
        if not ids:
            raise AppError("VALIDATION_ERROR", "Choose who to approve", 422)
        rows = (
            await self.session.execute(
                select(GiftRecipient).where(
                    GiftRecipient.campaign_id == campaign.id, GiftRecipient.waiting.is_(True), GiftRecipient.id.in_(ids[:MAX_PEOPLE_PER_ADD])
                )
            )
        ).scalars().all()
        now = self.clock.now()
        for r in rows:
            if approve:
                r.waiting = False
                r.approved_by = ctx.user_id
                r.approved_at = now
            else:
                await self.session.delete(r)
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx, action="gift_campaign.people_approved" if approve else "gift_campaign.people_turned_away",
            entity_type="GiftCampaign", entity_id=campaign.id, new_state={"people": len(rows)}, organization_id=campaign.organization_id,
        )
        out = await self.detail(ctx, campaign.id)
        out["moved"] = len(rows)
        return out

    async def remove_person(self, ctx: AuthContext, campaign_id: UUID, recipient_id: UUID) -> dict[str, Any]:
        """Take back someone added by hand by mistake, while nothing has happened to their gift:
        staff any such person, the act only its own additions still waiting."""
        campaign, role, _name = await self._campaign(ctx, campaign_id)
        r = await self.session.get(GiftRecipient, recipient_id)
        if r is None or r.campaign_id != campaign.id or r.source != "ADDED":
            raise NotFoundError("Person not found")
        if r.status != "YET_TO_SEND":
            raise AppError("INVALID_TRANSITION", "Their gift is already on its way, so they stay on the list", 409)
        if role != "staff" and not r.waiting:
            raise AppError("FORBIDDEN", "Ask Corner Room to remove someone they approved", 403)
        await self.session.delete(r)
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx, action="gift_campaign.person_removed", entity_type="GiftCampaign", entity_id=campaign.id,
            new_state={"recipient_id": str(recipient_id)}, organization_id=campaign.organization_id,
        )
        return await self.detail(ctx, campaign.id)

    async def _recipients_for_action(
        self, ctx: AuthContext, campaign_id: UUID, ids: list[UUID] | None, every: str | None = None
    ) -> tuple[GiftCampaign, list[GiftRecipient], str]:
        """The chosen gifts, or every gift in one status (`every`, e.g. all not prepared yet)."""
        campaign, role, name = await self._campaign(ctx, campaign_id)
        if campaign.status not in TRACKABLE:
            raise AppError("INVALID_TRANSITION", "The campaign isn't live yet", 409)
        if role != "staff" and campaign.sender != "ARTIST":
            raise AppError("FORBIDDEN", "Corner Room sends these gifts", 403)
        # People still waiting for staff can't be tracked yet (D-CAMPAIGN-04).
        query = select(GiftRecipient).where(GiftRecipient.campaign_id == campaign.id, GiftRecipient.waiting.is_(False))
        if every is not None:
            if every not in RECIPIENT_STATUSES:
                raise AppError("VALIDATION_ERROR", "Unknown status", 422)
            await self.sync_recipients(campaign)
            query = query.where(GiftRecipient.status == every)
        elif ids:
            query = query.where(GiftRecipient.id.in_(ids[:500]))
        else:
            raise AppError("VALIDATION_ERROR", "Choose who to update", 422)
        rows = (await self.session.execute(query.order_by(GiftRecipient.created_at))).scalars().all()
        return campaign, list(rows), name

    async def _music_line(self, campaign: GiftCampaign) -> str:
        titles = [w["title"] for w in await self._work_names(campaign.works or [])]
        return ", ".join(titles[:3]) + (f" and {len(titles) - 3} more" if len(titles) > 3 else "")

    def _buyer_payload(self, r: GiftRecipient, campaign: GiftCampaign, name: str, music: str, artist_mail: bool = False) -> dict[str, Any]:
        """What a buyer email needs: account holders through notifications, others by address.
        `artist_mail`: the act's own approved email for this status sends instead of Corner Room's
        (D-CAMPAIGN-05), to account holders too; their in-app note stays."""
        return {
            "user_id": str(r.user_id) if r.user_id else None, "email": None if r.user_id else r.email,
            "artist": name, "gift": campaign.gift_items, "music": music, "campaign_id": str(campaign.id),
            **({"artist_mail": True} if artist_mail else {}),
        }

    async def _live_mails(self, campaign: GiftCampaign) -> set[str]:
        from cornerroom.modules.commerce.application.gift_status_mails import GiftStatusMailService

        return await GiftStatusMailService(self.session, self.settings, self.clock).live_statuses(campaign.id)

    async def _dispatch_one(
        self, ctx: AuthContext | None, campaign: GiftCampaign, r: GiftRecipient, name: str, music: str, artist_mail: bool = False
    ) -> None:
        """A prepared gift leaves now: the buyer is told it is on its way (once per dispatch)."""
        r.status = "DISPATCHED"
        r.dispatched_at = self.clock.now()
        r.dispatched_by = ctx.user_id if ctx else r.dispatch_set_by
        r.dispatch_at = None
        payload = self._buyer_payload(r, campaign, name, music, artist_mail)
        await self._event(ctx, GIFT_DISPATCHED, "GiftRecipient", r.id, payload, campaign.organization_id)

    async def transition(
        self,
        ctx: AuthContext,
        campaign_id: UUID,
        *,
        to: str,
        ids: list[UUID] | None = None,
        every: str | None = None,
        dispatch_at: datetime | None = None,
    ) -> dict[str, Any]:
        """Move chosen gifts (or every gift in one status) to `to`. Dispatching with a future
        `dispatch_at` keeps them prepared with that time set; the worker sends them when it comes.
        Moving a scheduled gift to PREPARED again clears its time. Gifts that can't make the move
        are left as they are and counted as skipped."""
        if to not in RECIPIENT_STATUSES:
            raise AppError("VALIDATION_ERROR", "Unknown status", 422)
        now = self.clock.now()
        if dispatch_at is not None:
            if to != "DISPATCHED":
                raise AppError("VALIDATION_ERROR", "A time can only be set for dispatching", 422)
            if dispatch_at.tzinfo is None:
                raise AppError("VALIDATION_ERROR", "Give the dispatch time with its time zone", 422)
            if dispatch_at <= now:
                raise AppError("DISPATCH_TIME_PASSED", "That time has already gone. Dispatch now or choose a later time.", 422)
        campaign, rows, name = await self._recipients_for_action(ctx, campaign_id, ids, every)
        tells_buyer = to in ("DISPATCHED", "RETURNED", "MISSING")
        music = await self._music_line(campaign) if tells_buyer else ""
        live_mails = await self._live_mails(campaign) if tells_buyer else set()
        moved = skipped = 0
        for r in rows:
            unschedule = to == "PREPARED" and r.status == "PREPARED" and r.dispatch_at is not None
            if not unschedule and not can_move(r.status, to):
                skipped += 1
                continue
            moved += 1
            if to == "DISPATCHED":
                if dispatch_at is None:
                    await self._dispatch_one(ctx, campaign, r, name, music, "DISPATCHED" in live_mails)
                else:
                    r.dispatch_at = dispatch_at
                    r.dispatch_set_by = ctx.user_id
                    await self._event(
                        ctx, GIFT_DISPATCH_SCHEDULED, "GiftRecipient", r.id,
                        {"campaign_id": str(campaign.id), "dispatch_at": dispatch_at.isoformat()}, campaign.organization_id,
                    )
                continue
            payload: dict[str, Any] = {"campaign_id": str(campaign.id)}
            if unschedule:
                r.dispatch_at = None
                r.dispatch_set_by = None
            elif to == "PREPARED":
                r.status = "PREPARED"
                r.prepared_at = now
                r.prepared_by = ctx.user_id
                r.dispatch_at = None
                r.outcome_at = None
                r.outcome_by = None
            elif to == "YET_TO_SEND":
                r.status = "YET_TO_SEND"
                r.prepared_at = None
                r.prepared_by = None
                r.dispatch_at = None
                r.dispatch_set_by = None
            else:  # an outcome: received, returned or missing
                r.status = to
                r.outcome_at = now
                r.outcome_by = ctx.user_id
                if to == "RECEIVED":
                    r.sent_at = r.sent_at or now
                    r.sent_by = r.sent_by or ctx.user_id
                else:
                    # Returned and missing tell the buyer (owner, 2026-11-06).
                    payload = self._buyer_payload(r, campaign, name, music, to in live_mails)
            await self._event(ctx, MOVE_EVENTS[to], "GiftRecipient", r.id, payload, campaign.organization_id)
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx, action="gift_campaign.tracked", entity_type="GiftCampaign", entity_id=campaign.id,
            new_state={"to": to, "count": moved, "skipped": skipped, "every": every,
                       "dispatch_at": dispatch_at.isoformat() if dispatch_at else None},
            organization_id=campaign.organization_id,
        )
        out = await self.detail(ctx, campaign.id)
        out["moved"] = moved
        out["skipped"] = skipped
        return out

    async def dispatch_due(self) -> int:
        """Worker, every minute: prepared gifts whose dispatch time has come leave now."""
        due = (
            await self.session.execute(
                select(GiftRecipient)
                .where(
                    GiftRecipient.status == "PREPARED",
                    GiftRecipient.dispatch_at.is_not(None),
                    GiftRecipient.dispatch_at <= self.clock.now(),
                )
                .order_by(GiftRecipient.dispatch_at)
                .limit(1000)
            )
        ).scalars().all()
        by_campaign: dict[UUID, list[GiftRecipient]] = {}
        for r in due:
            by_campaign.setdefault(r.campaign_id, []).append(r)
        sent = 0
        for campaign_id, rows in by_campaign.items():
            campaign = await self.session.get(GiftCampaign, campaign_id)
            if campaign is None or campaign.status not in TRACKABLE:
                continue
            try:
                _row, _org, name = await self.studio._profile(campaign.profile_type, campaign.profile_id)
            except (NotFoundError, AppError):
                continue
            music = await self._music_line(campaign)
            live_mails = await self._live_mails(campaign)
            for r in rows:
                await self._dispatch_one(None, campaign, r, name, music, "DISPATCHED" in live_mails)
                sent += 1
            await self.audit.record(
                action="gift_campaign.dispatched_on_time", entity_type="GiftCampaign", entity_id=campaign.id,
                actor_id="system:gift-dispatch", actor_type="system", new_state={"count": len(rows)},
            )
        await self.session.flush()
        return sent

    async def for_release(self, ctx: AuthContext, release_id: UUID) -> list[dict[str, Any]]:
        """Collectible campaigns covering this release (or its songs), with how far their gifts
        have got: for the release's team and catalog staff of its workspace (404 for anyone else)."""
        release, _role = await self.studio._release(ctx, release_id)
        rows = (
            await self.session.execute(
                select(GiftCampaign).where(GiftCampaign.status.in_(TRACKABLE)).order_by(GiftCampaign.created_at)
            )
        ).scalars().all()
        out = []
        for c in rows:
            if release.id not in await self._subjects(c.works or []):
                continue
            await self.sync_recipients(c)
            _row, _org, name = await self.studio._profile(c.profile_type, c.profile_id)
            out.append(await self._summary(c, name))
        return out

    # --- public -----------------------------------------------------------------------------------

    async def public_for(self, *, release_id: UUID | None = None, track_id: UUID | None = None) -> list[dict[str, Any]]:
        """Live campaigns covering this music, for its public page."""
        target = release_id or track_id
        if target is None:
            return []
        rows = (await self.session.execute(select(GiftCampaign).where(GiftCampaign.status == "ACTIVE"))).scalars().all()
        out = []
        for c in rows:
            if target in await self._subjects(c.works or []):
                _row, _org, name = await self.studio._profile(c.profile_type, c.profile_id)
                out.append({"id": c.id, "title": c.title, "gift_items": c.gift_items, "description": c.description, "artist": name})
        return out


# Emails for buyers without an account (account holders get the same words as notifications,
# seeded in infra/seed.py). Returned and missing: owner, 2026-11-06 (D-CAMPAIGN-03).
GIFT_EMAILS: dict[str, tuple[str, str]] = {
    GIFT_DISPATCHED: (
        "A gift is on its way",
        "Good news from {artist}: a gift for buying {music} is on its way to you ({gift}). It should reach you in the next few days.",
    ),
    GIFT_RETURNED: (
        "Your gift couldn't be delivered",
        "Your gift from {artist} ({gift}), for buying {music}, couldn't be delivered and came back. Please check that "
        "the delivery address you gave us is correct. Once your address is right, it will be sent again. We'll email "
        "you again when there's news.",
    ),
    GIFT_MARKED_MISSING: (
        "Your gift is taking longer than expected",
        "Your gift from {artist} ({gift}), for buying {music}, hasn't arrived yet. We're finding out where it is and "
        "will email you as soon as we know more. If it doesn't turn up, we'll send another. You don't need to do "
        "anything for now.",
    ),
}
GIFT_EMAIL_SUBJECT, GIFT_EMAIL_BODY = GIFT_EMAILS[GIFT_DISPATCHED]


def build_gift_email(*, artist: str, gift: str, music: str, web_base_url: str, event_type: str = GIFT_DISPATCHED) -> tuple[str, str]:
    """Subject and plain-text body for a buyer without a Corner Room account."""
    subject, template = GIFT_EMAILS[event_type]
    body = template.format(artist=artist, gift=gift, music=music)
    return subject, "\n".join(
        [body, "", "You can listen to your music and keep track of your orders on Corner Room:", web_base_url.rstrip("/"), "", "Corner Room"]
    )


async def consume_gift_email_event(event: DomainEvent, session: AsyncSession, settings: Settings | None = None) -> None:
    """Outbox side consumer: email a pre-sale buyer without an account that their gift is on its
    way, came back or went missing (account holders get it through notifications, in-app and by
    email)."""
    import structlog

    from cornerroom.infra.logging import mask_email
    from cornerroom.modules.notifications.infra.email import email_sender_for

    if event.event_type not in GIFT_EMAILS:
        return
    payload = event.payload or {}
    settings = settings or get_settings()
    log = structlog.get_logger("commerce.gifts")
    if payload.get("artist_mail"):
        # The act's own approved words (D-CAMPAIGN-05), to every buyer by email.
        from cornerroom.modules.commerce.application.gift_status_mails import send_artist_status_mail

        sender = email_sender_for(settings)
        if sender is None:
            log.warning("gift_email_skipped", reason="no_email_provider", event_id=str(event.event_id))
            return
        if await send_artist_status_mail(event, session, settings, sender):
            log.info("gift_artist_email_sent", recipient_id=str(event.aggregate_id), kind=event.event_type)
            return
        # Taken back since: Corner Room's wording, to account holders too (their note sent no email).
        if not payload.get("email") and payload.get("user_id"):
            from cornerroom.modules.identity.domain.models import User

            user = await session.get(User, UUID(str(payload["user_id"])))
            payload = {**payload, "email": user.email if user else None, "user_id": None}
    to = str(payload.get("email") or "").strip()
    if not to or payload.get("user_id"):
        return
    sender = email_sender_for(settings)
    if sender is None:
        log.warning("gift_email_skipped", reason="no_email_provider", event_id=str(event.event_id))
        return
    subject, body = build_gift_email(
        artist=str(payload.get("artist") or "The artist"), gift=str(payload.get("gift") or "a gift"),
        music=str(payload.get("music") or "their music"), web_base_url=settings.web_base_url, event_type=event.event_type,
    )
    # A failed send raises, so the outbox retries the event.
    await sender.send(to=to, subject=subject, body=body)
    log.info("gift_email_sent", to=mask_email(to), recipient_id=str(event.aggregate_id), kind=event.event_type)
