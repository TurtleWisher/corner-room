"""Gift campaigns (owner, 2026-10-28, D-CAMPAIGN-01, D-CAMPAIGN-02).

An artist or band (or staff helping them) sets up a gift for buyers of some or all of their
music: what it is, which songs and releases it covers, who sends it, whether pre-sale buyers count
and from when purchases count. Publishing and every later change wait for staff, and the profile's
own people can't approve them. Once live it can be paused and restarted at any time; purchases made
while it is paused don't count. Fans see it on the music's pages only while it is live.

Recipients: every buyer of a covered work whose order was paid while the campaign was live (and,
when chosen, the pre-sale buyers of that music). Each gift is yet to send, in process (dispatched:
the buyer gets an email and a notice saying it is on its way) or sent. Free extras only: nothing
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
    GIFT_DISPATCHED,
    GIFT_SENT,
    DomainEvent,
)
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.commerce.domain.gifts import GiftCampaign, GiftCampaignPeriod, GiftRecipient
from cornerroom.modules.commerce.domain.models import Order, OrderDeliveryAddress, OrderItem, PresaleClaim, Product

# Paid orders that still count (a fully refunded order no longer earns the gift).
GIFT_ORDER_STATUSES = ("PAID", "FULFILLED", "PARTIALLY_REFUNDED")
EDITABLE_FIELDS = ("title", "gift_items", "description", "sender", "include_presale", "counts_from", "works")
MAX_WORKS = 200


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
                .where((GiftCampaign.status == "IN_REVIEW") | GiftCampaign.pending.is_not(None))
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
            select(GiftRecipient.status, func.count()).where(GiftRecipient.campaign_id == campaign_id).group_by(GiftRecipient.status)
        )
        counts = {"YET_TO_SEND": 0, "IN_PROCESS": 0, "SENT": 0}
        for status, n in rows:
            counts[status] = int(n)
        counts["TOTAL"] = sum(counts.values())
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
            out[r.id] = {
                "name": (names.get(r.user_id) if r.user_id else None) or (address.recipient_name if address else None)
                or (claim.buyer_name if claim else None),
                "phone": (address.phone if address else None) or (getattr(claim, "phone", None) if claim else None),
                "address": _address_text(address) if address else (getattr(claim, "address", None) if claim else None),
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
        }

    async def detail(self, ctx: AuthContext, campaign_id: UUID) -> dict[str, Any]:
        campaign, role, name = await self._campaign(ctx, campaign_id)
        await self.sync_recipients(campaign)
        out = await self._summary(campaign, name)
        # Staff always; the artist only when they send the gifts themselves (owner, 2026-10-28).
        show_contact = role == "staff" or campaign.sender == "ARTIST"
        can_dispatch = campaign.status in ("ACTIVE", "PAUSED", "ENDED") and (role == "staff" or campaign.sender == "ARTIST")
        recipients = (
            await self.session.execute(
                select(GiftRecipient).where(GiftRecipient.campaign_id == campaign.id).order_by(GiftRecipient.created_at)
            )
        ).scalars().all()
        contact = await self._contact(list(recipients)) if show_contact else {}
        out["viewer_role"] = role
        out["can_dispatch"] = can_dispatch
        out["shows_contact"] = show_contact
        out["recipients"] = [
            {
                "id": r.id,
                "status": r.status,
                "has_account": r.user_id is not None,
                "dispatched_at": r.dispatched_at,
                "sent_at": r.sent_at,
                **({"email": r.email} if role == "staff" else {}),
                **(contact.get(r.id, {}) if show_contact else {}),
            }
            for r in recipients
        ]
        return out

    async def _recipients_for_action(self, ctx: AuthContext, campaign_id: UUID, ids: list[UUID]) -> tuple[GiftCampaign, list[GiftRecipient], str]:
        campaign, role, name = await self._campaign(ctx, campaign_id)
        if campaign.status not in ("ACTIVE", "PAUSED", "ENDED"):
            raise AppError("INVALID_TRANSITION", "The campaign isn't live yet", 409)
        if role != "staff" and campaign.sender != "ARTIST":
            raise AppError("FORBIDDEN", "Corner Room sends these gifts", 403)
        if not ids:
            raise AppError("VALIDATION_ERROR", "Choose who to update", 422)
        rows = (
            await self.session.execute(
                select(GiftRecipient).where(GiftRecipient.campaign_id == campaign.id, GiftRecipient.id.in_(ids[:500]))
            )
        ).scalars().all()
        return campaign, list(rows), name

    async def dispatch(self, ctx: AuthContext, campaign_id: UUID, ids: list[UUID]) -> dict[str, Any]:
        """Gifts leaving now: each buyer is told it is on its way (once per recipient)."""
        campaign, rows, name = await self._recipients_for_action(ctx, campaign_id, ids)
        titles = [w["title"] for w in await self._work_names(campaign.works or [])]
        music = ", ".join(titles[:3]) + (f" and {len(titles) - 3} more" if len(titles) > 3 else "")
        now = self.clock.now()
        moved = 0
        for r in rows:
            if r.status != "YET_TO_SEND":
                continue
            r.status = "IN_PROCESS"
            r.dispatched_at = now
            r.dispatched_by = ctx.user_id
            moved += 1
            await self._event(
                ctx, GIFT_DISPATCHED, "GiftRecipient", r.id,
                {"user_id": str(r.user_id) if r.user_id else None, "email": None if r.user_id else r.email,
                 "artist": name, "gift": campaign.gift_items, "music": music, "campaign_id": str(campaign.id)},
                campaign.organization_id,
            )
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx, action="gift_campaign.dispatched", entity_type="GiftCampaign", entity_id=campaign.id,
            new_state={"count": moved}, organization_id=campaign.organization_id,
        )
        return await self.detail(ctx, campaign.id)

    async def mark_sent(self, ctx: AuthContext, campaign_id: UUID, ids: list[UUID]) -> dict[str, Any]:
        campaign, rows, _name = await self._recipients_for_action(ctx, campaign_id, ids)
        now = self.clock.now()
        moved = 0
        for r in rows:
            if r.status == "SENT":
                continue
            r.status = "SENT"
            r.sent_at = now
            r.sent_by = ctx.user_id
            if r.dispatched_at is None:
                r.dispatched_at = now
                r.dispatched_by = ctx.user_id
            moved += 1
            await self._event(ctx, GIFT_SENT, "GiftRecipient", r.id, {"campaign_id": str(campaign.id)}, campaign.organization_id)
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx, action="gift_campaign.sent", entity_type="GiftCampaign", entity_id=campaign.id,
            new_state={"count": moved}, organization_id=campaign.organization_id,
        )
        return await self.detail(ctx, campaign.id)

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


GIFT_EMAIL_SUBJECT = "A gift is on its way"
GIFT_EMAIL_BODY = (
    "Good news from {artist}: a gift for buying {music} is on its way to you ({gift}). It should reach you in the next few days."
)


def build_gift_email(*, artist: str, gift: str, music: str, web_base_url: str) -> tuple[str, str]:
    """Subject and plain-text body for a buyer without a Corner Room account."""
    body = GIFT_EMAIL_BODY.format(artist=artist, gift=gift, music=music)
    return GIFT_EMAIL_SUBJECT, "\n".join(
        [body, "", "You can listen to your music and keep track of your orders on Corner Room:", web_base_url.rstrip("/"), "", "Corner Room"]
    )


async def consume_gift_email_event(event: DomainEvent, session: AsyncSession, settings: Settings | None = None) -> None:
    """Outbox side consumer: email a pre-sale buyer without an account that their gift is on its
    way (account holders get it through notifications, in-app and by email)."""
    import structlog

    from cornerroom.infra.logging import mask_email
    from cornerroom.modules.notifications.infra.email import email_sender_for

    if event.event_type != GIFT_DISPATCHED:
        return
    payload = event.payload or {}
    to = str(payload.get("email") or "").strip()
    if not to or payload.get("user_id"):
        return
    settings = settings or get_settings()
    log = structlog.get_logger("commerce.gifts")
    sender = email_sender_for(settings)
    if sender is None:
        log.warning("gift_email_skipped", reason="no_email_provider", event_id=str(event.event_id))
        return
    subject, body = build_gift_email(
        artist=str(payload.get("artist") or "The artist"), gift=str(payload.get("gift") or "a gift"),
        music=str(payload.get("music") or "their music"), web_base_url=settings.web_base_url,
    )
    # A failed send raises, so the outbox retries the event.
    await sender.send(to=to, subject=subject, body=body)
    log.info("gift_email_sent", to=mask_email(to), recipient_id=str(event.aggregate_id))
