"""Each artist's royalty rate, and what it earns them on every sale (D-ROYALTY-RATE-01).

Owner, 2026-11-28: an admin sets a royalty percentage for a particular artist, as agreed with
that artist, and it applies to every sale of that artist's music: every song, release,
pre-order and gift purchase checked out. Answers the same day: the percentage is a share of
**what the fan paid**; sales made before a rate existed show "No rate yet" and the admin decides,
each time they save a rate, whether it also covers those earlier sales.

What an artist earns is worked out from the operational tables every time (orders, order lines,
refunds) and the rate spans (`royalties.artist_rates`), never stored twice:

    earned = (what the fan paid for the line - the line's share of refunds) * share_bps / 10000

rounded down to the minor unit. A sale belongs to the artist named first on the song or release
(`primary_artist_id`, else `primary_band_id`: a band's artist row has the band's id,
D-ARTIST-UNIFY-01). How credited or featured artists share stays OPEN (owner, 2026-10-17), and
nothing here posts to the ledger or pays anyone: payouts still go through statements and
settlements.

Sales are what Studio Sales counts: orders that reached PAID, staff test buys excluded
(D-TEST-BUY-01). ৳0 lines (the act's own gifts, credit orders) earn nothing and are left out.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from cornerroom.infra.errors import AppError, ForbiddenError, NotFoundError
from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import ARTIST_ROYALTY_RATE_ENDED, ARTIST_ROYALTY_RATE_SET, DomainEvent
from cornerroom.modules.artists.domain.models import Artist
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.authorization.application.service import AuthorizationService
from cornerroom.modules.commerce.application.sales import SOLD_ORDER_STATUSES
from cornerroom.modules.commerce.domain.fan_gifts import FanGift
from cornerroom.modules.commerce.domain.models import Order, OrderItem
from cornerroom.modules.finance.domain.models_payments import Payment, Refund
from cornerroom.modules.music.domain.models import Release, Track
from cornerroom.modules.royalties.domain.artist_rates import (
    NOTE_MAX,
    ArtistRoyaltyRate,
    RateSpan,
    earned_minor,
    line_refund,
    rate_at,
    uncovered_before,
    valid_bps,
)

READ_PERMISSION = "royalty.read"
WRITE_PERMISSION = "royalty.run"


@dataclass(frozen=True, slots=True)
class SaleLine:
    item_id: UUID
    order_id: UUID
    artist_id: UUID
    item_type: str
    ref_id: UUID
    title: str | None
    paid_minor: int
    refunded_minor: int
    currency_code: str
    made_at: datetime
    how: str | None  # GIFT, CREDIT, PRESALE or None


def _spans(rows: list[ArtistRoyaltyRate]) -> list[RateSpan]:
    return [RateSpan(r.share_bps, r.effective_from, r.effective_to) for r in rows]


class ArtistRatesService:
    def __init__(self, session: AsyncSession, *, clock: Clock | None = None) -> None:
        self.session = session
        self.clock = clock or SystemClock()
        self.authz = AuthorizationService(session, clock=self.clock)
        self.audit = AuditService(session)

    async def _require(self, ctx: AuthContext, permission: str) -> frozenset[str]:
        keys = await self.authz.permission_keys(ctx.user_id, organization_id=ctx.organization_id)
        if permission not in keys:
            raise ForbiddenError(f"Missing permission {permission}")
        return keys

    # ----- facts -----------------------------------------------------------------------

    async def sale_lines(self, artist_ids: list[UUID] | None = None, *, limit: int | None = None) -> list[SaleLine]:
        """Paid music sale lines (newest first), each with its artist and its share of refunds."""
        t = aliased(Track)
        r = aliased(Release)
        act = func.coalesce(t.primary_artist_id, t.primary_band_id, r.primary_artist_id, r.primary_band_id)
        title = func.coalesce(t.title, r.title)
        refunded = (
            select(Payment.order_id.label("order_id"), func.sum(Refund.amount_minor).label("refunded"))
            .join(Refund, Refund.payment_id == Payment.id)
            .where(Refund.status == "COMPLETED", Payment.order_id.is_not(None))
            .group_by(Payment.order_id)
            .subquery()
        )
        stmt = (
            select(
                OrderItem.id,
                OrderItem.order_id,
                act.label("artist_id"),
                OrderItem.item_type,
                OrderItem.ref_id,
                title.label("title"),
                OrderItem.amount_minor,
                OrderItem.currency_code,
                Order.created_at,
                Order.total_amount_minor,
                func.coalesce(refunded.c.refunded, 0).label("refunded"),
                FanGift.id.is_not(None).label("is_gift"),
                (Order.paid_with_credit_minor > 0).label("with_credit"),
                Order.is_presale,
            )
            .join(Order, Order.id == OrderItem.order_id)
            .outerjoin(t, (OrderItem.item_type == "TRACK") & (t.id == OrderItem.ref_id))
            .outerjoin(r, (OrderItem.item_type == "RELEASE") & (r.id == OrderItem.ref_id))
            .outerjoin(refunded, refunded.c.order_id == Order.id)
            .outerjoin(FanGift, FanGift.order_id == Order.id)
            .where(
                OrderItem.item_type.in_(("TRACK", "RELEASE")),
                OrderItem.amount_minor > 0,
                Order.status.in_(SOLD_ORDER_STATUSES),
                Order.deleted_at.is_(None),
                Order.is_test.is_(False),
                act.is_not(None),
            )
            .order_by(Order.created_at.desc(), OrderItem.id.desc())
        )
        if artist_ids is not None:
            if not artist_ids:
                return []
            stmt = stmt.where(act.in_(artist_ids))
        if limit is not None:
            stmt = stmt.limit(limit)
        out: list[SaleLine] = []
        for row in (await self.session.execute(stmt)).all():
            out.append(
                SaleLine(
                    item_id=row.id,
                    order_id=row.order_id,
                    artist_id=row.artist_id,
                    item_type=row.item_type,
                    ref_id=row.ref_id,
                    title=row.title,
                    paid_minor=int(row.amount_minor),
                    refunded_minor=line_refund(int(row.refunded), int(row.amount_minor), int(row.total_amount_minor or 0)),
                    currency_code=row.currency_code,
                    made_at=row.created_at,
                    how="GIFT" if row.is_gift else "CREDIT" if row.with_credit else "PRESALE" if row.is_presale else None,
                )
            )
        return out

    async def rates_for(self, artist_ids: list[UUID]) -> dict[UUID, list[ArtistRoyaltyRate]]:
        if not artist_ids:
            return {}
        rows = (
            await self.session.execute(
                select(ArtistRoyaltyRate)
                .where(ArtistRoyaltyRate.artist_id.in_(artist_ids))
                .order_by(ArtistRoyaltyRate.effective_from.asc().nulls_first(), ArtistRoyaltyRate.created_at.asc())
            )
        ).scalars()
        out: dict[UUID, list[ArtistRoyaltyRate]] = defaultdict(list)
        for row in rows:
            out[row.artist_id].append(row)
        return out

    @staticmethod
    def _current(rows: list[ArtistRoyaltyRate]) -> ArtistRoyaltyRate | None:
        return next((r for r in rows if r.effective_to is None), None)

    @staticmethod
    def totals(lines: list[SaleLine], spans: list[RateSpan]) -> dict[str, Any]:
        """Per currency: sales, what fans paid and kept paid, what the artist earned, and the
        sales no rate covers yet."""
        money: dict[str, dict[str, int]] = {}
        for line in lines:
            bucket = money.setdefault(
                line.currency_code,
                {"sales": 0, "paid_minor": 0, "refunded_minor": 0, "earned_minor": 0, "no_rate_sales": 0, "no_rate_paid_minor": 0},
            )
            bucket["sales"] += 1
            bucket["paid_minor"] += line.paid_minor
            bucket["refunded_minor"] += line.refunded_minor
            bps = rate_at(spans, line.made_at)
            earned = earned_minor(line.paid_minor, line.refunded_minor, bps)
            if earned is None:
                bucket["no_rate_sales"] += 1
                bucket["no_rate_paid_minor"] += line.paid_minor - line.refunded_minor
            else:
                bucket["earned_minor"] += earned
        return {
            "by_currency": [{"currency_code": code, **vals} for code, vals in sorted(money.items())],
            "sales": sum(v["sales"] for v in money.values()),
            "no_rate_sales": sum(v["no_rate_sales"] for v in money.values()),
            "last_sale_at": lines[0].made_at if lines else None,
        }

    # ----- staff reads -------------------------------------------------------------------

    async def list_artists(self, ctx: AuthContext, *, q: str | None = None) -> dict[str, Any]:
        keys = await self._require(ctx, READ_PERMISSION)
        stmt = select(Artist).where(Artist.deleted_at.is_(None))
        if q and q.strip():
            stmt = stmt.where(Artist.stage_name.ilike(f"%{q.strip()[:80]}%"))
        artists = list((await self.session.execute(stmt.order_by(Artist.stage_name.asc()).limit(300))).scalars())
        ids = [a.id for a in artists]
        lines = await self.sale_lines(ids)
        by_artist: dict[UUID, list[SaleLine]] = defaultdict(list)
        for line in lines:
            by_artist[line.artist_id].append(line)
        rates = await self.rates_for(ids)
        items = []
        for a in artists:
            rows = rates.get(a.id, [])
            current = self._current(rows)
            sold = by_artist.get(a.id, [])
            # Only acts that sell or have a rate, unless someone searched for them by name.
            if not sold and not rows and not (q and q.strip()) and a.status != "ACTIVE":
                continue
            items.append(
                {
                    "artist_id": a.id,
                    "name": a.stage_name,
                    "kind": a.kind,
                    "status": a.status,
                    "share_bps": current.share_bps if current else None,
                    "rate_since": current.effective_from if current else None,
                    "rate_set_at": current.created_at if current else None,
                    "has_history": bool(rows),
                    **self.totals(sold, _spans(rows)),
                }
            )
        items.sort(key=lambda i: (i["share_bps"] is not None, -(i["no_rate_sales"]), i["name"].lower()))
        return {"items": items, "can_set": WRITE_PERMISSION in keys}

    async def _artist(self, artist_id: UUID, *, lock: bool = False) -> Artist:
        stmt = select(Artist).where(Artist.id == artist_id, Artist.deleted_at.is_(None))
        if lock:
            stmt = stmt.with_for_update()
        artist = (await self.session.execute(stmt)).scalar_one_or_none()
        if artist is None:
            raise NotFoundError("Artist not found")
        return artist

    async def detail(self, ctx: AuthContext, artist_id: UUID) -> dict[str, Any]:
        from cornerroom.modules.administration.application.staff_accounts import StaffAccountsService

        keys = await self._require(ctx, READ_PERMISSION)
        artist = await self._artist(artist_id)
        rows = (await self.rates_for([artist_id])).get(artist_id, [])
        spans = _spans(rows)
        lines = await self.sale_lines([artist_id])
        people = await StaffAccountsService(self.session, clock=self.clock).people(
            list({r.created_by for r in rows if r.created_by} | {r.ended_by for r in rows if r.ended_by})
        )
        current = self._current(rows)
        now = self.clock.now()
        earlier = [line for line in lines if rate_at(spans, line.made_at) is None and line.made_at < now]
        return {
            "artist_id": artist.id,
            "name": artist.stage_name,
            "kind": artist.kind,
            "share_bps": current.share_bps if current else None,
            "can_set": WRITE_PERMISSION in keys,
            "totals": self.totals(lines, spans),
            "earlier_without_rate": {
                "sales": len(earlier),
                "by_currency": [
                    {"currency_code": code, "paid_minor": sum(x.paid_minor - x.refunded_minor for x in earlier if x.currency_code == code)}
                    for code in sorted({x.currency_code for x in earlier})
                ],
            },
            "history": [
                {
                    "id": r.id,
                    "share_bps": r.share_bps,
                    "effective_from": r.effective_from,
                    "effective_to": r.effective_to,
                    "covers_earlier": r.covers_earlier,
                    "note": r.note,
                    "set_at": r.created_at,
                    "set_by": (people.get(r.created_by) or {}).get("name") if r.created_by else None,
                    "ended_by": (people.get(r.ended_by) or {}).get("name") if r.ended_by else None,
                }
                for r in sorted(rows, key=lambda r: r.created_at, reverse=True)
            ],
            "sales": [self._line_out(line, spans) for line in lines[:100]],
        }

    @staticmethod
    def _line_out(line: SaleLine, spans: list[RateSpan]) -> dict[str, Any]:
        bps = rate_at(spans, line.made_at)
        return {
            "id": line.item_id,
            "kind": line.item_type,
            "title": line.title,
            "made_at": line.made_at,
            "paid_minor": line.paid_minor,
            "refunded_minor": line.refunded_minor,
            "currency_code": line.currency_code,
            "share_bps": bps,
            "earned_minor": earned_minor(line.paid_minor, line.refunded_minor, bps),
            "how": line.how,
        }

    # ----- staff writes ------------------------------------------------------------------

    async def set_rate(
        self,
        ctx: AuthContext,
        artist_id: UUID,
        *,
        share_bps: int,
        note: str | None,
        cover_earlier: bool,
    ) -> dict[str, Any]:
        await self._require(ctx, WRITE_PERMISSION)
        if not valid_bps(share_bps):
            raise AppError("BAD_RATE", "Type a percentage from 0 to 100, with at most two decimals.", 422)
        clean_note = (note or "").strip()[:NOTE_MAX] or None
        artist = await self._artist(artist_id, lock=True)  # one change per artist at a time
        rows = (await self.rates_for([artist_id])).get(artist_id, [])
        current = self._current(rows)
        now = self.clock.now()
        gaps = uncovered_before(_spans(rows), now) if cover_earlier else []
        if current is not None and current.share_bps == share_bps and not gaps:
            raise AppError("SAME_RATE", "That is already this artist's rate.", 409)
        previous = current.share_bps if current else None
        if current is not None:
            current.effective_to = now
            current.ended_by = ctx.user_id
            current.updated_by = ctx.user_id
            await self.session.flush()  # the one-current-rate index must see it closed first
        new_from: datetime | None = now
        added_earlier = 0
        for gap in gaps:
            if current is None and gap.end == now:
                # Nothing ever covered this artist: the new rate simply runs from the start.
                new_from = gap.start
                added_earlier += 1
                continue
            self.session.add(
                ArtistRoyaltyRate(
                    artist_id=artist_id,
                    share_bps=share_bps,
                    effective_from=gap.start,
                    effective_to=gap.end,
                    covers_earlier=True,
                    note=clean_note,
                    created_by=ctx.user_id,
                    updated_by=ctx.user_id,
                )
            )
            added_earlier += 1
        row = ArtistRoyaltyRate(
            artist_id=artist_id,
            share_bps=share_bps,
            effective_from=new_from,
            effective_to=None,
            covers_earlier=new_from != now,
            note=clean_note,
            created_by=ctx.user_id,
            updated_by=ctx.user_id,
        )
        self.session.add(row)
        await self.session.flush()
        state = {
            "artist_id": str(artist_id),
            "share_bps": share_bps,
            "previous_share_bps": previous,
            "covers_earlier": bool(gaps),
            "earlier_spans": added_earlier,
        }
        await self.audit.record_from_auth(
            ctx,
            action="royalty_rate.set",
            entity_type="Artist",
            entity_id=artist_id,
            previous_state={"share_bps": previous},
            new_state=state,
            reason=clean_note,
            organization_id=artist.primary_org_id,
        )
        await enqueue_outbox(
            self.session,
            DomainEvent(
                event_type=ARTIST_ROYALTY_RATE_SET,
                producer="royalties",
                aggregate_type="Artist",
                aggregate_id=artist_id,
                payload=state,
                occurred_at=now,
                actor_id=ctx.user_id,
                organization_id=artist.primary_org_id,
                correlation_id=ctx.request_id,
            ),
        )
        return await self.detail(ctx, artist_id)

    async def end_rate(self, ctx: AuthContext, artist_id: UUID, *, note: str | None) -> dict[str, Any]:
        await self._require(ctx, WRITE_PERMISSION)
        artist = await self._artist(artist_id, lock=True)
        current = self._current((await self.rates_for([artist_id])).get(artist_id, []))
        if current is None:
            raise AppError("NO_RATE", "This artist has no rate to stop.", 409)
        now = self.clock.now()
        current.effective_to = now
        current.ended_by = ctx.user_id
        current.updated_by = ctx.user_id
        await self.session.flush()
        clean_note = (note or "").strip()[:NOTE_MAX] or None
        await self.audit.record_from_auth(
            ctx,
            action="royalty_rate.ended",
            entity_type="Artist",
            entity_id=artist_id,
            previous_state={"share_bps": current.share_bps},
            new_state={"share_bps": None},
            reason=clean_note,
            organization_id=artist.primary_org_id,
        )
        await enqueue_outbox(
            self.session,
            DomainEvent(
                event_type=ARTIST_ROYALTY_RATE_ENDED,
                producer="royalties",
                aggregate_type="Artist",
                aggregate_id=artist_id,
                payload={"artist_id": str(artist_id), "previous_share_bps": current.share_bps},
                occurred_at=now,
                actor_id=ctx.user_id,
                organization_id=artist.primary_org_id,
                correlation_id=ctx.request_id,
            ),
        )
        return await self.detail(ctx, artist_id)

    # ----- the act's own view ------------------------------------------------------------

    async def for_team_member(self, user_id: UUID) -> list[dict[str, Any]]:
        """The rate and earnings of every act this account runs (owner or manager)."""
        from cornerroom.modules.artists.application.team import artist_ids_run_by

        ids = await artist_ids_run_by(self.session, user_id)
        if not ids:
            return []
        artists = {
            a.id: a
            for a in (await self.session.execute(select(Artist).where(Artist.id.in_(ids)))).scalars()
        }
        rates = await self.rates_for(ids)
        lines = await self.sale_lines(ids)
        by_artist: dict[UUID, list[SaleLine]] = defaultdict(list)
        for line in lines:
            by_artist[line.artist_id].append(line)
        out = []
        for aid in ids:
            artist = artists.get(aid)
            if artist is None:
                continue
            rows = rates.get(aid, [])
            current = self._current(rows)
            spans = _spans(rows)
            sold = by_artist.get(aid, [])
            out.append(
                {
                    "artist_id": aid,
                    "name": artist.stage_name,
                    "kind": artist.kind,
                    "share_bps": current.share_bps if current else None,
                    "rate_since": current.effective_from if current else None,
                    **self.totals(sold, spans),
                    "sales_lines": [self._line_out(line, spans) for line in sold[:30]],
                }
            )
        return out


__all__ = ["ArtistRatesService"]
