"""Pre-sale campaigns in Studio (owner, 2026-11-06, D-PRESALE-04).

A campaign is a release's pre-sale seen from the artist's side: setup, the fans' page, sharing,
and live numbers. Once the release is out the same numbers carry on, and the artist can look at
the pre-sale alone, at what happened since release, or at both together (owner: "200 pre-orders
plus 30 sales after release is 230", with the pre-sale history still there on its own).

Counting (`count`) is open to anyone, so it is careful: crawlers are skipped, the release's own
team and catalog staff are skipped (as their plays are, D-LISTEN-03), one internet address counts
at most `presale_count_max_per_hour` times per release per hour, and nothing about the visitor is
stored. Orders, buyers, refunds and money come from the orders (the same figures as Studio Sales,
`CatalogSales`), and money only for the people who may see Sales.
"""

from __future__ import annotations

import hashlib
import hmac
from collections import defaultdict
from datetime import datetime
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import and_, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, NotFoundError
from cornerroom.infra.redis import get_redis, namespaced_key
from cornerroom.infra.settings import Settings, get_settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.modules.commerce.application.onsite_presale import (
    BEFORE_RELEASE_STATUSES,
    PresaleService,
    presale_listed,
    presale_open,
)
from cornerroom.modules.commerce.application.sales import KEPT_ORDER_STATUSES, SOLD_ORDER_STATUSES
from cornerroom.modules.commerce.domain import presale_campaign as rules
from cornerroom.modules.commerce.domain.models import Order, OrderItem
from cornerroom.modules.commerce.domain.presale_campaign import PresaleCount, PresaleShareLink
from cornerroom.modules.finance.domain.models_payments import Payment, Refund

log = structlog.get_logger("commerce.presale_campaigns")

# Steps in a release's history that belong on a campaign's timeline.
MILESTONE_ACTIONS = (
    "request_presale", "approve_presale", "return_presale", "move_presale_date", "schedule", "release", "cancel_presale",
)
TOP_SITES = 10


class PresaleCampaignService:
    def __init__(self, session: AsyncSession, settings: Settings | None = None, clock: Clock | None = None) -> None:
        self.session = session
        self.settings = settings or get_settings()
        self.clock = clock or SystemClock()

    def _studio(self):
        from cornerroom.modules.music.application.studio import StudioService

        return StudioService(self.session, self.settings, self.clock)

    # --- counting (public) ---------------------------------------------------------------------

    async def count(
        self,
        release_id: UUID,
        *,
        kind: str,
        place: Any = None,
        code: Any = None,
        referrer: Any = None,
        user_agent: str | None = None,
        address: str | None = None,
        viewer: UUID | None = None,
    ) -> bool:
        """Add one page open or Pre-book press to the release's totals. Returns whether it was
        counted. Never raises for the visitor: a count that doesn't qualify is simply dropped."""
        from cornerroom.modules.music.domain.models import Release

        kind = str(kind or "").strip().upper()
        if kind not in rules.COUNT_KINDS or rules.looks_like_bot(user_agent):
            return False
        release = await self.session.get(Release, release_id)
        if release is None or release.deleted_at is not None:
            return False
        now = self.clock.now()
        if release.status == "RELEASED":
            phase = "RELEASED"
        elif presale_listed(release) and await PresaleService(self.session, self.settings, self.clock).presale_offers(release.id):
            phase = "PRESALE"
        else:
            return False
        if viewer is not None and await self._is_insider(viewer, release):
            return False
        if not await self._within_limit(address, release.id, now):
            return False
        link_code = rules.clean_code(code)
        if link_code:
            known = await self.session.scalar(
                select(PresaleShareLink.id).where(PresaleShareLink.release_id == release.id, PresaleShareLink.code == link_code)
            )
            if known is None:
                link_code = ""
        own = tuple(h for h in (_host(self.settings.web_base_url), "cornerroom.live") if h)
        values = {
            "release_id": release.id,
            "hour": rules.hour_of(now),
            "phase": phase,
            "kind": kind,
            "place": rules.clean_place(place),
            "link_code": link_code,
            # The site is worth knowing only for a visit to the page itself.
            "referrer_host": rules.referrer_host(referrer, own) if kind == "VIEW" else "",
            "total": 1,
        }
        stmt = pg_insert(PresaleCount).values(**values)
        stmt = stmt.on_conflict_do_update(
            constraint="uq_presale_counts_bucket", set_={"total": PresaleCount.total + 1}
        )
        await self.session.execute(stmt)
        return True

    async def _is_insider(self, user_id: UUID, release: Any) -> bool:
        """The release's own team and catalog staff of its workspace: their visits aren't fans'."""
        studio = self._studio()
        if user_id in await studio.music.catalog_owner_ids(release.primary_artist_id, release.primary_band_id):
            return True
        if release.primary_org_id is None:
            return False
        return await studio.music._is_allowed(
            user_id, "music.approve", resource_type="release", resource_id=release.id, organization_id=release.primary_org_id
        )

    async def _within_limit(self, address: str | None, release_id: UUID, now: datetime) -> bool:
        cap = self.settings.presale_count_max_per_hour
        if cap <= 0:
            return True
        # The address only ever exists as a keyed hash in a key that expires within the hour.
        secret = (self.settings.jwt_secret or "cornerroom").encode()
        token = hmac.new(secret, (address or "unknown").encode(), hashlib.sha256).hexdigest()[:24]
        key = namespaced_key("presale", "count", token, str(release_id), now.strftime("%Y%m%d%H"), settings=self.settings)
        try:
            client = get_redis()
            seen = await client.incr(key)
            if seen == 1:
                await client.expire(key, 3600)
        except Exception:
            # Without the limiter a count can't be trusted, so it is dropped rather than guessed.
            log.warning("presale_count_limiter_unavailable")
            return False
        return seen <= cap

    # --- public list ---------------------------------------------------------------------------

    async def public_list(self, *, artist_id: UUID | None = None, band_id: UUID | None = None, limit: int = 24) -> list[dict[str, Any]]:
        """Pre-sales fans can see now, soonest release first: what `PresaleService.public_view`
        shows for each, never the songs. For Releases, the home page and profiles."""
        from cornerroom.modules.music.domain.models import Release

        stmt = select(Release).where(
            Release.deleted_at.is_(None),
            Release.release_at.is_not(None),
            or_(
                Release.status == "SCHEDULED",
                and_(Release.presale_status == "APPROVED", Release.status.in_(tuple(BEFORE_RELEASE_STATUSES))),
            ),
        )
        if artist_id is not None:
            stmt = stmt.where(Release.primary_artist_id == artist_id)
        if band_id is not None:
            stmt = stmt.where(Release.primary_band_id == band_id)
        rows = (await self.session.execute(stmt.order_by(Release.release_at.asc()).limit(max(1, min(limit, 48))))).scalars().all()
        presales = PresaleService(self.session, self.settings, self.clock)
        out: list[dict[str, Any]] = []
        for release in rows:
            try:
                out.append(await presales.public_view(release.id))
            except NotFoundError:
                continue
        return out

    # --- Studio ---------------------------------------------------------------------------------

    async def _release(self, ctx: AuthContext, release_id: UUID) -> tuple[Any, str, bool]:
        """The release for its team or catalog staff of its workspace (404 for anyone else), and
        whether this person may see money (the team, or finance staff, as Studio Sales)."""
        studio = self._studio()
        release, role = await studio._release(ctx, release_id)
        if role == "owner":
            return release, role, True
        org = release.primary_org_id
        sees_money = org is not None and ctx.organization_id == org and await studio.music._is_allowed(
            ctx.user_id, "finance.read", resource_type="organization", resource_id=org, organization_id=org
        )
        return release, role, sees_money

    async def campaigns(self, ctx: AuthContext) -> dict[str, Any]:
        """Every pre-sale of the profiles this account runs, and the releases that could start one."""
        from cornerroom.modules.artists.application.team import artist_ids_run_by
        from cornerroom.modules.commerce.domain.models import OfferProposal
        from cornerroom.modules.music.domain.models import Release

        studio = self._studio()
        ids = await artist_ids_run_by(self.session, ctx.user_id)
        if not ids:
            return {"items": [], "can_start": []}
        releases = (
            await self.session.execute(
                select(Release)
                .where(
                    Release.deleted_at.is_(None),
                    or_(Release.primary_artist_id.in_(ids), Release.primary_band_id.in_(ids)),
                )
                .order_by(Release.created_at.desc())
            )
        ).scalars().all()
        if not releases:
            return {"items": [], "can_start": []}
        release_ids = [r.id for r in releases]
        priced = set(
            (
                await self.session.execute(
                    select(OfferProposal.release_id).where(
                        OfferProposal.release_id.in_(release_ids), OfferProposal.audience == "PRESALE"
                    )
                )
            ).scalars().all()
        )
        presale_orders = await self._presale_order_counts(release_ids)
        views = dict(
            (
                await self.session.execute(
                    select(PresaleCount.release_id, func.sum(PresaleCount.total))
                    .where(PresaleCount.release_id.in_(release_ids), PresaleCount.phase == "PRESALE", PresaleCount.kind == "VIEW")
                    .group_by(PresaleCount.release_id)
                )
            ).all()
        )
        presales = PresaleService(self.session, self.settings, self.clock)
        now = self.clock.now()
        names: dict[tuple[str, UUID], str] = {}
        items: list[dict[str, Any]] = []
        can_start: list[dict[str, Any]] = []
        for release in releases:
            kind, pid = studio.music.profile_of(release)
            if kind is None or pid is None:
                continue
            if (kind, pid) not in names:
                try:
                    names[(kind, pid)] = (await studio._profile(kind, pid))[2]
                except NotFoundError:
                    continue
            sold = presale_orders.get(release.id, 0)
            is_campaign = release.id in priced or release.presale_status is not None or sold > 0
            if not is_campaign:
                if release.status in BEFORE_RELEASE_STATUSES:
                    can_start.append({"id": release.id, "title": release.title, "release_type": release.release_type, "artist": names[(kind, pid)]})
                continue
            has_offer = bool(await presales.presale_offers(release.id))
            listed = presale_listed(release) and has_offer
            items.append({
                "id": release.id,
                "title": release.title,
                "release_type": release.release_type,
                "release_status": release.status,
                "release_at": release.release_at,
                "artist": names[(kind, pid)],
                "artist_kind": kind,
                "artist_id": pid,
                "cover_url": studio._cover_url(release, 160),
                "state": rules.campaign_state(release, listed=listed, open_now=listed and presale_open(release, now), has_price=has_offer, has_orders=sold > 0),
                "preorders": sold,
                "views": int(views.get(release.id, 0) or 0),
            })
        order = {"LIVE": 0, "WAITING": 1, "APPROVED": 2, "IN_REVIEW": 3, "RETURNED": 4, "DRAFT": 5, "RELEASED": 6, "ENDED": 7}
        items.sort(key=lambda i: (order.get(i["state"], 9), i["release_at"] or now))
        return {"items": items, "can_start": can_start}

    async def _presale_order_counts(self, release_ids: list[UUID]) -> dict[UUID, int]:
        rows = await self.session.execute(
            select(OrderItem.ref_id, func.count(func.distinct(Order.id)))
            .join(Order, Order.id == OrderItem.order_id)
            .where(
                OrderItem.item_type == "RELEASE",
                OrderItem.ref_id.in_(release_ids),
                Order.is_presale.is_(True),
                Order.status.in_(SOLD_ORDER_STATUSES),
                Order.deleted_at.is_(None),
            )
            .group_by(OrderItem.ref_id)
        )
        return {r[0]: int(r[1]) for r in rows.all()}

    async def numbers(self, ctx: AuthContext, release_id: UUID) -> dict[str, Any]:
        """Live numbers for one release: the pre-sale on its own, since release, and both."""
        from cornerroom.modules.music.domain.models import ReleaseReview, ReleaseTrack
        from cornerroom.modules.music.domain.cover_reveal import reveal_at

        release, _role, sees_money = await self._release(ctx, release_id)
        now = self.clock.now()
        reviews = (
            await self.session.execute(
                select(ReleaseReview.action, ReleaseReview.created_at)
                .where(ReleaseReview.release_id == release.id, ReleaseReview.action.in_(MILESTONE_ACTIONS))
                .order_by(ReleaseReview.created_at)
            )
        ).all()
        released_at = None
        if release.status == "RELEASED":
            released = [r.created_at for r in reviews if r.action == "release"]
            released_at = released[-1] if released else release.release_at
        track_ids = list(
            (await self.session.execute(select(ReleaseTrack.track_id).where(ReleaseTrack.release_id == release.id))).scalars().all()
        )
        counts = (
            await self.session.execute(
                select(PresaleCount.phase, PresaleCount.kind, PresaleCount.place, PresaleCount.link_code,
                       PresaleCount.referrer_host, PresaleCount.hour, PresaleCount.total)
                .where(PresaleCount.release_id == release.id)
            )
        ).all()
        orders = await self._order_lines(release.id, track_ids)
        links = (
            await self.session.execute(
                select(PresaleShareLink).where(PresaleShareLink.release_id == release.id).order_by(PresaleShareLink.created_at)
            )
        ).scalars().all()
        labels = {link.code: link.label for link in links}

        def view(phase: str | None) -> dict[str, Any]:
            c = [r for r in counts if phase is None or r.phase == phase]
            o = [r for r in orders if phase is None or r["phase"] == phase]
            return _summary(c, o, labels, sees_money, include_songs=phase != "PRESALE")

        milestones = [{"kind": r.action, "at": r.created_at} for r in reviews]
        revealed = reveal_at(release)
        if revealed is not None and revealed <= now:
            milestones.append({"kind": "cover_revealed", "at": revealed})
        first = min((r["at"] for r in orders if r["phase"] == "PRESALE" and r["sold"]), default=None)
        if first is not None:
            milestones.append({"kind": "first_preorder", "at": first})
        milestones.sort(key=lambda m: m["at"])
        had_presale = any(r["phase"] == "PRESALE" for r in orders) or any(r.phase == "PRESALE" for r in counts) or release.presale_status is not None
        return {
            "release_id": release.id,
            "title": release.title,
            "release_status": release.status,
            "release_at": release.release_at,
            "released_at": released_at,
            "had_presale": had_presale,
            "money_visible": sees_money,
            "as_of": now,
            "presale": view("PRESALE"),
            "since_release": view("RELEASED") if released_at is not None else None,
            "all": view(None),
            "milestones": milestones,
        }

    async def _order_lines(self, release_id: UUID, track_ids: list[UUID]) -> list[dict[str, Any]]:
        """Every order line for this release, or for one of its songs bought on its own, with the
        refunded money of its order (music orders have one line), from any status."""
        refunded = (
            select(Payment.order_id.label("order_id"), func.sum(Refund.amount_minor).label("refunded"))
            .join(Refund, Refund.payment_id == Payment.id)
            .where(Refund.status == "COMPLETED", Payment.order_id.is_not(None))
            .group_by(Payment.order_id)
            .subquery()
        )
        subjects = [and_(OrderItem.item_type == "RELEASE", OrderItem.ref_id == release_id)]
        if track_ids:
            subjects.append(and_(OrderItem.item_type == "TRACK", OrderItem.ref_id.in_(track_ids)))
        rows = (
            await self.session.execute(
                select(
                    Order.id, Order.user_id, Order.status, Order.created_at, Order.is_presale,
                    OrderItem.item_type, OrderItem.amount_minor, OrderItem.currency_code,
                    func.coalesce(refunded.c.refunded, 0).label("refunded"),
                )
                .join(Order, Order.id == OrderItem.order_id)
                .outerjoin(refunded, refunded.c.order_id == Order.id)
                .where(or_(*subjects), Order.deleted_at.is_(None))
            )
        ).all()
        return [
            {
                "order_id": r.id,
                "user_id": r.user_id,
                "status": r.status,
                "at": r.created_at,
                # A pre-order is a whole-release order bought at the pre-sale price; everything
                # else for this release (or its songs) happened once it was out.
                "phase": "PRESALE" if (r.is_presale and r.item_type == "RELEASE") else "RELEASED",
                "song": r.item_type == "TRACK",
                "sold": r.status in SOLD_ORDER_STATUSES,
                "kept": r.status in KEPT_ORDER_STATUSES,
                "amount_minor": int(r.amount_minor),
                "refunded_minor": min(int(r.refunded), int(r.amount_minor)),
                "currency_code": r.currency_code,
            }
            for r in rows
        ]

    # --- share links ----------------------------------------------------------------------------

    async def share_links(self, ctx: AuthContext, release_id: UUID) -> list[dict[str, Any]]:
        release, _role, _money = await self._release(ctx, release_id)
        return await self._links_view(release.id)

    async def _links_view(self, release_id: UUID) -> list[dict[str, Any]]:
        links = (
            await self.session.execute(
                select(PresaleShareLink).where(PresaleShareLink.release_id == release_id).order_by(PresaleShareLink.created_at)
            )
        ).scalars().all()
        totals: dict[tuple[str, str], int] = defaultdict(int)
        for code, kind, total in (
            await self.session.execute(
                select(PresaleCount.link_code, PresaleCount.kind, func.sum(PresaleCount.total))
                .where(PresaleCount.release_id == release_id, PresaleCount.link_code != "")
                .group_by(PresaleCount.link_code, PresaleCount.kind)
            )
        ).all():
            totals[(code, kind)] = int(total or 0)
        base = self.settings.web_base_url.rstrip("/")
        return [
            {
                "id": link.id,
                "label": link.label,
                "code": link.code,
                "url": f"{base}/releases/{release_id}?from={link.code}",
                "created_at": link.created_at,
                "archived": link.archived_at is not None,
                "views": totals[(link.code, "VIEW")],
                "prebook_clicks": totals[(link.code, "PREBOOK")],
            }
            for link in links
        ]

    async def add_share_link(self, ctx: AuthContext, release_id: UUID, label: Any) -> list[dict[str, Any]]:
        from cornerroom.modules.audit.application.service import AuditService

        release, _role, _money = await self._release(ctx, release_id)
        text = rules.clean_label(label)
        if text is None:
            raise AppError("VALIDATION_ERROR", "Give the link a name, like \"Instagram bio\"", 422, extras={"field": "label"})
        active = await self.session.scalar(
            select(func.count()).select_from(PresaleShareLink).where(
                PresaleShareLink.release_id == release.id, PresaleShareLink.archived_at.is_(None)
            )
        )
        if (active or 0) >= rules.SHARE_LINKS_MAX:
            raise AppError("SHARE_LINKS_FULL", f"Up to {rules.SHARE_LINKS_MAX} links at a time: put an old one away first", 409)
        for _ in range(5):
            code = rules.new_share_code()
            taken = await self.session.scalar(select(PresaleShareLink.id).where(PresaleShareLink.code == code))
            if taken is None:
                break
        else:  # pragma: no cover - 32^8 codes
            raise AppError("SHARE_CODE_UNAVAILABLE", "Try again", 503)
        link = PresaleShareLink(release_id=release.id, code=code, label=text, created_by=ctx.user_id)
        self.session.add(link)
        await self.session.flush()
        await AuditService(self.session).record_from_auth(
            ctx, action="release.share_link.created", entity_type="Release", entity_id=release.id,
            new_state={"code": code, "label": text}, organization_id=release.primary_org_id,
        )
        return await self._links_view(release.id)

    async def archive_share_link(self, ctx: AuthContext, release_id: UUID, link_id: UUID) -> list[dict[str, Any]]:
        """Put a link away: it stops appearing as current, but visits through it still count, so
        a link already posted somewhere keeps its history."""
        from cornerroom.modules.audit.application.service import AuditService

        release, _role, _money = await self._release(ctx, release_id)
        link = await self.session.get(PresaleShareLink, link_id)
        if link is None or link.release_id != release.id:
            raise NotFoundError("Link not found")
        if link.archived_at is None:
            link.archived_at = self.clock.now()
            await self.session.flush()
            await AuditService(self.session).record_from_auth(
                ctx, action="release.share_link.archived", entity_type="Release", entity_id=release.id,
                new_state={"code": link.code}, organization_id=release.primary_org_id,
            )
        return await self._links_view(release.id)


def _host(url: str | None) -> str:
    return rules.referrer_host(url or "")


def _summary(
    counts: list[Any], orders: list[dict[str, Any]], labels: dict[str, str], sees_money: bool, *, include_songs: bool
) -> dict[str, Any]:
    """One view's numbers. Counts are totals already; orders are lines. Money is per currency."""
    views = sum(int(r.total) for r in counts if r.kind == "VIEW")
    presses = sum(int(r.total) for r in counts if r.kind == "PREBOOK")
    whole = [o for o in orders if not o["song"]]
    songs = [o for o in orders if o["song"]]
    sold = [o for o in whole if o["sold"]]

    places: dict[str, dict[str, int]] = defaultdict(lambda: {"views": 0, "prebook_clicks": 0})
    links: dict[str, dict[str, int]] = defaultdict(lambda: {"views": 0, "prebook_clicks": 0})
    sites: dict[str, int] = defaultdict(int)
    for r in counts:
        key = "views" if r.kind == "VIEW" else "prebook_clicks"
        places[r.place or "PAGE"][key] += int(r.total)
        if r.link_code:
            links[r.link_code][key] += int(r.total)
        if r.kind == "VIEW":
            sites[r.referrer_host or ""] += int(r.total)

    days: dict[str, dict[str, int]] = defaultdict(lambda: {"views": 0, "prebook_clicks": 0, "orders": 0})
    for r in counts:
        days[rules.dhaka_day(r.hour)]["views" if r.kind == "VIEW" else "prebook_clicks"] += int(r.total)
    for o in sold:
        days[rules.dhaka_day(o["at"])]["orders"] += 1

    out: dict[str, Any] = {
        "views": views,
        "prebook_clicks": presses,
        "checkout_started": len({o["order_id"] for o in whole}),
        "orders": len(sold),
        "free_copies": sum(1 for o in sold if o["amount_minor"] == 0),
        "refunded_orders": sum(1 for o in sold if o["status"] == "REFUNDED"),
        "buyers": len({o["user_id"] for o in whole if o["kept"]}),
        "conversion_bps": rules.conversion_bps(len(sold), views),
        "money": _money(sold) if sees_money else None,
        "places": [{"place": p, **v} for p, v in sorted(places.items(), key=lambda kv: -kv[1]["views"])],
        "links": [
            {"code": c, "label": labels.get(c, c), **v} for c, v in sorted(links.items(), key=lambda kv: -kv[1]["views"])
        ],
        # "" is a visit with no site named: typed in, a saved link, or an app that hides it.
        "sites": [{"host": h or None, "views": v} for h, v in sorted(sites.items(), key=lambda kv: -kv[1])[:TOP_SITES]],
        "timeline": [{"day": d, **v} for d, v in sorted(days.items())],
    }
    if include_songs:
        song_sold = [o for o in songs if o["sold"]]
        out["songs"] = {
            "orders": len(song_sold),
            "buyers": len({o["user_id"] for o in songs if o["kept"]}),
            "money": _money(song_sold) if sees_money else None,
        }
    return out


def _money(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """What fans paid, refunds and what stayed, per currency: the same sums as Studio Sales."""
    totals: dict[str, dict[str, Any]] = {}
    for o in lines:
        t = totals.setdefault(
            o["currency_code"],
            {"currency_code": o["currency_code"], "gross_amount_minor": 0, "refunded_amount_minor": 0, "net_amount_minor": 0},
        )
        t["gross_amount_minor"] += o["amount_minor"]
        t["refunded_amount_minor"] += o["refunded_minor"]
        t["net_amount_minor"] += o["amount_minor"] - o["refunded_minor"]
    return sorted(totals.values(), key=lambda t: t["currency_code"])
