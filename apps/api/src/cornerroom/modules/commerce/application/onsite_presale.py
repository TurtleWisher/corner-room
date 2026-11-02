"""Pre-sales on Corner Room (owner, 2026-10-28, D-PRESALE-02).

A release that staff approved and scheduled for a date can be pre-ordered at its own pre-sale
price (an offer with audience PRESALE, proposed by the artist and agreed by Corner Room like any
price). Pre-orders are ordinary orders marked `is_presale`; the music unlocks on release day,
because songs only play once released. At the scheduled time the release goes public by itself
and every pre-order buyer is told it is out. A new date tells them the new date (they keep their
pre-order; a refund on request goes through the normal refund approval). A cancelled pre-sale
asks finance to refund every pre-order in full and tells the buyers.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, NotFoundError
from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.infra.settings import Settings, get_settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import (
    PRESALE_CANCELLED,
    PRESALE_RELEASED,
    DomainEvent,
)
from cornerroom.modules.commerce.domain.models import Offer, Order, OrderItem, Product

log = structlog.get_logger("commerce.presale")

PRESALE_ORDER_STATUSES = ("PAID", "FULFILLED", "PARTIALLY_REFUNDED")
# Bangladesh has no daylight saving: Dhaka is always UTC+6.
DHAKA = timezone(timedelta(hours=6), "Dhaka")
# Who the scheduler acts as in release history (no person pressed release).
SYSTEM_ACTOR = UUID(int=0)


# Before release: the release is still being made or reviewed (an early pre-sale, D-PRESALE-03).
BEFORE_RELEASE_STATUSES = frozenset({"IDEA", "DEMO", "IN_PRODUCTION", "QC", "METADATA_REVIEW", "APPROVED"})


def presale_listed(release: Any) -> bool:
    """Fans can see the pre-sale page: the release is scheduled (D-PRESALE-02), or staff approved an
    early pre-sale for it and it isn't out yet (D-PRESALE-03). The date may have passed while the
    release waits to be finished; then the page stays, without the button."""
    if release is None or getattr(release, "deleted_at", None) is not None or release.release_at is None:
        return False
    if release.status == "SCHEDULED":
        return True
    return getattr(release, "presale_status", None) == "APPROVED" and release.status in BEFORE_RELEASE_STATUSES


def presale_open(release: Any, now: datetime) -> bool:
    """Pre-orders are taken while the pre-sale page is up and the date is still to come."""
    return presale_listed(release) and release.release_at > now


def release_date_text(moment: datetime | None) -> str:
    if moment is None:
        return "a date to be announced"
    return moment.astimezone(DHAKA).strftime("%d %b %Y, %I:%M %p") + " (Dhaka time)"


class PresaleService:
    def __init__(self, session: AsyncSession, settings: Settings | None = None, clock: Clock | None = None) -> None:
        self.session = session
        self.settings = settings or get_settings()
        self.clock = clock or SystemClock()

    async def presale_offers(self, release_id: UUID) -> list[Offer]:
        rows = await self.session.execute(
            select(Offer)
            .join(Product, Product.id == Offer.product_id)
            .where(
                Product.subject_id == release_id,
                Product.product_type == "RELEASE",
                Product.status == "ACTIVE",
                Product.deleted_at.is_(None),
                Offer.audience == "PRESALE",
                Offer.status == "ACTIVE",
                Offer.deleted_at.is_(None),
            )
            .order_by(Offer.created_at.desc())
        )
        return list(rows.scalars())

    async def public_view(self, release_id: UUID) -> dict[str, Any]:
        """What fans see of a release on pre-sale: title, artist, date and the offer only (owner,
        2026-11-02). The cover only once the artist reveals it early (D-COVER-02); never the songs.
        `open` is false once the date has passed while the release waits to be finished."""
        from cornerroom.modules.documents.application.covers import CoverService
        from cornerroom.modules.music.application.studio import StudioService
        from cornerroom.modules.music.domain.cover_reveal import cover_revealed
        from cornerroom.modules.music.domain.models import Release

        release = await self.session.get(Release, release_id)
        offers = await self.presale_offers(release_id) if release is not None else []
        if not presale_listed(release) or not offers:
            raise NotFoundError("Release not found")
        studio = StudioService(self.session, self.settings, self.clock)
        kind, pid = studio.music.profile_of(release)
        artist = None
        if kind is not None and pid is not None:
            _row, _org, artist = await studio._profile(kind, pid)
        offer = offers[0]
        show_cover = release.cover_asset_id is not None and cover_revealed(release, self.clock.now())
        return {
            "id": release.id,
            "title": release.title,
            "release_type": release.release_type,
            "release_at": release.release_at,
            "artist": artist,
            "artist_kind": kind,
            "artist_id": pid,
            "cover_url": CoverService(self.session, self.settings).signed_path(release.cover_asset_id, 1200) if show_cover else None,
            "offer": {"id": offer.id, "amount_minor": offer.amount_minor, "currency_code": offer.currency_code},
            "open": presale_open(release, self.clock.now()),
        }

    async def presale_orders(self, release_id: UUID) -> list[Order]:
        rows = await self.session.execute(
            select(Order)
            .join(OrderItem, OrderItem.order_id == Order.id)
            .where(
                Order.is_presale.is_(True),
                Order.status.in_(PRESALE_ORDER_STATUSES),
                Order.deleted_at.is_(None),
                OrderItem.ref_id == release_id,
            )
            .distinct()
        )
        return list(rows.scalars())

    async def tell_buyers(self, release: Any, event_type: str, *, actor: UUID | None, extra: dict[str, Any] | None = None) -> int:
        """One event per pre-order buyer; notifications turn each into an in-app notice and email."""
        told: set[UUID] = set()
        for order in await self.presale_orders(release.id):
            if order.user_id in told:
                continue
            told.add(order.user_id)
            await enqueue_outbox(
                self.session,
                DomainEvent(
                    event_type=event_type, producer="commerce", aggregate_type="Order", aggregate_id=order.id,
                    payload={"user_id": str(order.user_id), "title": release.title,
                             "release_date": release_date_text(release.release_at), **(extra or {})},
                    occurred_at=self.clock.now(), actor_id=actor, organization_id=release.primary_org_id,
                ),
            )
        return len(told)

    async def release_due(self, *, batch: int = 20) -> int:
        """Scheduler: releases whose date has come go public by themselves (owner, 2026-10-28)."""
        from cornerroom.modules.music.application.review import ReviewService
        from cornerroom.modules.music.domain.models import Release

        due = (
            await self.session.execute(
                select(Release)
                .where(Release.status == "SCHEDULED", Release.release_at.is_not(None), Release.release_at <= self.clock.now(), Release.deleted_at.is_(None))
                .order_by(Release.release_at)
                .limit(batch)
            )
        ).scalars().all()
        released = 0
        review = ReviewService(self.session, self.settings, self.clock)
        for release in due:
            if not await review.system_release(release, actor=SYSTEM_ACTOR):
                continue
            await self.after_release(release, actor=None)
            released += 1
        await self.session.flush()
        return released

    async def after_release(self, release: Any, *, actor: UUID | None) -> None:
        """A release just came out (on its date, or staff pressed Release now): the pre-sale price
        ends and the normal price takes over, pre-order buyers are told, and the artist's approved
        release-day email (D-PRESALE-03) goes out with the next run of the email worker."""
        from cornerroom.modules.commerce.domain.artist_mail import ArtistMail

        for offer in await self.presale_offers(release.id):
            offer.status = "RETIRED"
        await self.tell_buyers(release, PRESALE_RELEASED, actor=actor)
        waiting = (
            await self.session.execute(
                select(ArtistMail).where(
                    ArtistMail.send_with_release_id == release.id, ArtistMail.status == "SCHEDULED", ArtistMail.send_at.is_(None)
                )
            )
        ).scalars().all()
        for mail in waiting:
            mail.send_at = self.clock.now()
        await self.session.flush()

    async def cancel(self, ctx: AuthContext, release_id: UUID, note: str | None) -> dict[str, Any]:
        """Staff: cancel a pre-sale. A scheduled release goes back to approved without a date; an early
        pre-sale (D-PRESALE-03) is closed and the release stays where it is in the making, without a
        date. The pre-sale price stops, every pre-order is sent to finance for a full refund, and
        buyers are told."""
        from cornerroom.modules.authorization.application.service import AuthorizationService
        from cornerroom.modules.audit.application.service import AuditService
        from cornerroom.modules.finance.application.service import PaymentService
        from cornerroom.modules.finance.domain.models_payments import Payment
        from cornerroom.modules.music.application.service import MusicService
        from cornerroom.modules.music.domain.models import Release, ReleaseReview, ReleaseTrack, Track

        music = MusicService(self.session, settings=self.settings)
        release = await self.session.get(Release, release_id)
        if release is None or release.primary_org_id is None or not await music._is_allowed(
            ctx.user_id, "music.approve", resource_type="release", resource_id=release.id, organization_id=release.primary_org_id
        ):
            raise NotFoundError("Release not found")
        if release.status != "SCHEDULED" and not presale_listed(release):
            raise AppError("INVALID_TRANSITION", "This release has no pre-sale to cancel", 409)
        if ctx.organization_id != release.primary_org_id:
            raise AppError("WORKSPACE_REQUIRED", "Switch to this release's workspace to cancel its pre-sale", 409)
        # Refunds need finance rights in this workspace (Q-P0-05): check before changing anything.
        await AuthorizationService(self.session).authorize(
            ctx.user_id, "finance.post", resource_type="organization", resource_id=release.primary_org_id,
            scope_organization_id=release.primary_org_id,
        )
        text = " ".join((note or "").split())[:2000] or None
        previous = release.status
        if release.status == "SCHEDULED":
            release.status = "APPROVED"
        release.release_at = None
        release.presale_status = None
        tracks = (
            await self.session.execute(
                select(Track).join(ReleaseTrack, ReleaseTrack.track_id == Track.id).where(ReleaseTrack.release_id == release.id)
            )
        ).scalars().all()
        for t in tracks:
            if t.status == "SCHEDULED":
                t.status = "APPROVED"
        for offer in await self.presale_offers(release.id):
            offer.status = "RETIRED"
        release.updated_by = ctx.user_id
        await music._flush_versioned()
        finance = PaymentService(self.session, self.settings)
        refunds = 0
        for order in await self.presale_orders(release.id):
            payment = (
                await self.session.execute(select(Payment).where(Payment.order_id == order.id, Payment.status == "CAPTURED"))
            ).scalars().first()
            if payment is None or payment.amount_minor <= 0:
                continue
            remaining = await finance.remaining_refundable(payment)
            if remaining <= 0:
                continue
            await finance.request_refund(
                ctx, payment_id=payment.id, amount_minor=remaining, reason_code="PRESALE_CANCELLED",
                idempotency_key=f"presale-cancel:{order.id}",
            )
            refunds += 1
        told = await self.tell_buyers(release, PRESALE_CANCELLED, actor=ctx.user_id)
        self.session.add(
            ReleaseReview(release_id=release.id, reviewer_id=ctx.user_id, action="cancel_presale", note=text, from_status=previous, to_status=release.status)
        )
        await self.session.flush()
        await AuditService(self.session).record_from_auth(
            ctx, action="release.presale_cancelled", entity_type="Release", entity_id=release.id,
            previous_state={"status": previous}, new_state={"status": release.status, "refunds": refunds, "told": told, "note": text},
            organization_id=release.primary_org_id,
        )
        return {"status": release.status, "refunds_requested": refunds, "buyers_told": told}
