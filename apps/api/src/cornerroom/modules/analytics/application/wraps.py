"""Corner Room Wrap (owner, 2026-11-28, D-WRAP-01): building each person's Wrap and running it.

Fans: `open_list` (Wraps they can open now) and `read` (their own Wrap). The first read builds the
person's numbers and keeps them (`WrapSnapshot`) so the Wrap reads the same every time; staff
rebuild them after changing the period. Staff (platform admins only, `is_platform_staff`; anyone
else 404): create, settings, go live, end, rebuild, numbers, and a preview built from their own
activity that is never kept.

Rules live in `domain/wraps.py`. Never money; counts of what happened only.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import and_, delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, NotFoundError
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.analytics.domain import wraps as rules
from cornerroom.modules.analytics.domain.wraps import WrapCount, WrapSeason, WrapSnapshot


def _now() -> datetime:
    return datetime.now(UTC)


def _day_start(d: date) -> datetime:
    """The first moment of a Dhaka day, as UTC."""
    return datetime(d.year, d.month, d.day, tzinfo=rules.DHAKA).astimezone(UTC)


def first_name(display_name: str | None) -> str | None:
    """The name a Wrap calls the person by (owner, 2026-11-28): the first word of their name, or the
    next one when it holds a digit ("Mizuls1 Samiul" is Samiul). None when no word fits."""
    for word in (display_name or "").split():
        word = word.strip(".,;:!?()[]{}\"'")
        if word and not any(ch.isdigit() for ch in word):
            return word
    return None


class WrapService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # --- access ------------------------------------------------------------------------------------

    async def _check_staff(self, ctx: AuthContext) -> None:
        from cornerroom.modules.streaming.application.stream_access import StreamAccess

        if not await StreamAccess(self.session).is_platform_staff(ctx.user_id):
            raise NotFoundError("Not found")

    async def is_staff(self, ctx: AuthContext) -> bool:
        try:
            await self._check_staff(ctx)
        except NotFoundError:
            return False
        return True

    async def _season(self, season_id: UUID) -> WrapSeason:
        season = await self.session.get(WrapSeason, season_id)
        if season is None or season.deleted_at is not None:
            raise NotFoundError("Not found")
        return season

    # --- views -------------------------------------------------------------------------------------

    def season_view(self, s: WrapSeason, *, staff: bool = False) -> dict[str, Any]:
        settings = rules.merged_settings(s.settings)
        now = _now()
        view: dict[str, Any] = {
            "id": s.id,
            "name": s.name,
            "starts_on": s.starts_on,
            "ends_on": s.ends_on,
            "year": s.ends_on.year,
            "opens_at": s.opens_at,
            "closes_at": s.closes_at,
            "fan_state": rules.fan_state(s.status, s.opens_at, s.closes_at, now),
            "tagline": settings["tagline"],
            "intro": settings["intro"],
            "outro": settings["outro"],
            "look": settings["look"],
            "dither": settings["dither"],
            "slide_seconds": settings["slide_seconds"],
            "sharing": settings["sharing"],
        }
        if staff:
            view.update(
                status=s.status,
                version=s.version,
                settings=settings,
                transitions=list(rules.TRANSITIONS.get(s.status, ())),
                went_live_at=s.went_live_at,
                ended_at=s.ended_at,
                updated_at=s.updated_at,
            )
        return view

    # --- fans --------------------------------------------------------------------------------------

    async def open_list(self, ctx: AuthContext | None) -> list[dict[str, Any]]:
        """Wraps fans can open now, newest period first. Staff also see drafts and scheduled ones
        (marked), so they can preview the real page."""
        staff = ctx is not None and await self.is_staff(ctx)
        seasons = (
            await self.session.execute(
                select(WrapSeason).where(WrapSeason.deleted_at.is_(None)).order_by(WrapSeason.ends_on.desc(), WrapSeason.created_at.desc())
            )
        ).scalars().all()
        out = []
        for s in seasons:
            view = self.season_view(s)
            if view["fan_state"] == "OPEN" or staff:
                view["staff_only"] = view["fan_state"] != "OPEN"
                out.append(view)
        return out

    async def read(self, ctx: AuthContext, season_id: UUID, *, preview: bool = False) -> dict[str, Any]:
        """The person's own Wrap. Fans only while it is open; staff any time (`preview`), built from
        their own activity and never kept, so a draft's numbers never stick."""
        season = await self._season(season_id)
        state = rules.fan_state(season.status, season.opens_at, season.closes_at, _now())
        staff_preview = False
        if state != "OPEN" or preview:
            if not await self.is_staff(ctx):
                raise NotFoundError("Not found")
            staff_preview = True
        settings = rules.merged_settings(season.settings)
        if staff_preview:
            stats = rules.jsonable(await self.build(ctx.user_id, season, settings))
        else:
            snap = (
                await self.session.execute(
                    select(WrapSnapshot).where(WrapSnapshot.season_id == season.id, WrapSnapshot.user_id == ctx.user_id)
                )
            ).scalars().first()
            if snap is None:
                stats = rules.jsonable(await self.build(ctx.user_id, season, settings))
                # Two tabs opening at once: the first one keeps its numbers.
                await self.session.execute(
                    insert(WrapSnapshot)
                    .values(season_id=season.id, user_id=ctx.user_id, stats=stats)
                    .on_conflict_do_nothing(constraint="uq_wrap_snapshots_season_user")
                )
                await self.count(season.id, "OPENED")
            else:
                stats = snap.stats
        name = await self._display_name(ctx.user_id)
        enough = rules.has_enough(stats, settings["rules"]["min_listens"])
        return {
            "season": self.season_view(season),
            "preview": staff_preview,
            "person": {"name": name, "first_name": first_name(name)},
            "enough": enough,
            "min_listens": settings["rules"]["min_listens"],
            "cards": rules.cards_for(settings, stats) if enough else [],
            "stats": stats,
        }

    async def count(self, season_id: UUID, kind: str) -> None:
        if kind not in rules.COUNT_KINDS:
            raise AppError("VALIDATION_ERROR", "Unknown count", 422)
        day = rules.dhaka_day(_now())
        await self.session.execute(
            insert(WrapCount)
            .values(season_id=season_id, day=day, kind=kind, count=1)
            .on_conflict_do_update(constraint="uq_wrap_counts_season_day_kind", set_={"count": WrapCount.count + 1})
        )

    async def counted(self, ctx: AuthContext, season_id: UUID, kind: str) -> None:
        """A fan finished, shared or played their Wrap. Counts only; only for a Wrap that is open."""
        season = await self._season(season_id)
        if rules.fan_state(season.status, season.opens_at, season.closes_at, _now()) != "OPEN":
            return
        if kind.startswith("SHARED") and not rules.merged_settings(season.settings)["sharing"]["on"]:
            return
        await self.count(season.id, kind)

    async def _display_name(self, user_id: UUID) -> str | None:
        from cornerroom.modules.identity.domain.models import CustomerProfile

        return (
            await self.session.execute(
                select(CustomerProfile.display_name).where(CustomerProfile.user_id == user_id, CustomerProfile.deleted_at.is_(None))
            )
        ).scalars().first()

    # --- building the numbers ----------------------------------------------------------------------

    async def build(self, user_id: UUID, season: WrapSeason, settings: dict[str, Any]) -> dict[str, Any]:
        from cornerroom.modules.music.domain.models import Track
        from cornerroom.modules.streaming.domain.models import Listen

        start, end = season.starts_on, season.ends_on
        top_count = settings["rules"]["top_count"]
        act_col = func.coalesce(Track.primary_artist_id, Track.primary_band_id)
        rows = [
            rules.ListenRow(track_id=t, act_id=a, listened_ms=ms or 0, day=d, counted_at=at)
            for t, a, ms, d, at in (
                await self.session.execute(
                    select(Listen.track_id, act_col, Listen.listened_ms, Listen.listen_day, Listen.counted_at)
                    .join(Track, Track.id == Listen.track_id)
                    .where(Listen.user_id == user_id, Listen.listen_day >= start, Listen.listen_day <= end)
                    .order_by(Listen.counted_at)
                    .limit(rules.MAX_LISTEN_ROWS)
                )
            ).all()
        ]
        first_heard = dict(
            (
                await self.session.execute(
                    select(Listen.track_id, func.min(Listen.listen_day))
                    .where(Listen.user_id == user_id, Listen.listen_day <= end)
                    .group_by(Listen.track_id)
                )
            ).all()
        )
        stats = rules.summarise_listens(rows, starts_on=start, ends_on=end, top_count=top_count, first_heard=first_heard)

        # Where the person stands among their top act's listeners in the period.
        stats["fan_rank"] = None
        if stats["top_acts"]:
            top = stats["top_acts"][0]
            per_user = (
                await self.session.execute(
                    select(func.count())
                    .select_from(Listen)
                    .join(Track, Track.id == Listen.track_id)
                    .where(act_col == top["act_id"], Listen.listen_day >= start, Listen.listen_day <= end)
                    .group_by(Listen.user_id)
                )
            ).scalars().all()
            rank = rules.fan_rank(top["listens"], list(per_user), settings["rules"]["fan_rank_min_listeners"])
            if rank:
                stats["fan_rank"] = {"act_id": top["act_id"], **rank}

        stats["bought"] = await self._bought(user_id, start, end)
        stats["events"] = await self._events(user_id, start, end)
        stats["gifts"] = await self._gifts(user_id, start, end)
        stats["follows"] = await self._follows(user_id, start, end)
        await self._name_everything(stats)
        stats["period"] = {"starts_on": start, "ends_on": end}
        return stats

    async def _bought(self, user_id: UUID, start: date, end: date) -> dict[str, Any]:
        from cornerroom.modules.commerce.application.sales import KEPT_ORDER_STATUSES
        from cornerroom.modules.commerce.domain.models import Order, OrderItem

        rows = (
            await self.session.execute(
                select(OrderItem.item_type, OrderItem.ref_id, Order.is_presale, Order.music_gift_id, Order.created_at)
                .join(Order, Order.id == OrderItem.order_id)
                .where(
                    Order.user_id == user_id,
                    Order.deleted_at.is_(None),
                    Order.is_test.is_(False),
                    Order.status.in_(KEPT_ORDER_STATUSES),
                    Order.created_at >= _day_start(start),
                    Order.created_at < _day_start(end + timedelta(days=1)),
                    OrderItem.item_type.in_(("TRACK", "RELEASE")),
                )
                .order_by(Order.created_at)
            )
        ).all()
        # Music given to the person by an act arrives as a ৳0 order: it is a gift, not a buy.
        bought = [r for r in rows if r[3] is None]
        songs = {r[1] for r in bought if r[0] == "TRACK"}
        releases = {r[1] for r in bought if r[0] == "RELEASE"}
        first = bought[0] if bought else None
        return {
            "songs": len(songs),
            "releases": len(releases),
            "preorders": len({r[1] for r in bought if r[2]}),
            "first": {"kind": first[0], "id": first[1], "day": rules.dhaka_day(first[4])} if first else None,
        }

    async def _events(self, user_id: UUID, start: date, end: date) -> dict[str, Any]:
        from cornerroom.modules.events.domain.models import Event
        from cornerroom.modules.ticketing.domain.models import CheckIn, Ticket, TicketType

        rows = (
            await self.session.execute(
                select(Ticket.id, Ticket.status, Event.id, Event.title, Event.starts_at, Event.cover_asset_id, CheckIn.id)
                .join(TicketType, TicketType.id == Ticket.ticket_type_id)
                .join(Event, Event.id == TicketType.event_id)
                .outerjoin(CheckIn, and_(CheckIn.ticket_id == Ticket.id, CheckIn.status == "RECORDED"))
                .where(
                    Ticket.owner_user_id == user_id,
                    Ticket.deleted_at.is_(None),
                    Ticket.status.in_(("PAID", "ISSUED", "CHECKED_IN")),
                    Event.starts_at >= _day_start(start),
                    Event.starts_at < _day_start(end + timedelta(days=1)),
                )
                .order_by(Event.starts_at)
            )
        ).all()
        events: dict[UUID, dict[str, Any]] = {}
        for _tid, status, eid, title, starts_at, poster, check_in in rows:
            e = events.setdefault(
                eid, {"event_id": eid, "title": title, "starts_at": starts_at, "has_poster": bool(poster), "tickets": 0, "attended": False}
            )
            e["tickets"] += 1
            e["attended"] = e["attended"] or status == "CHECKED_IN" or check_in is not None
        listed = list(events.values())
        return {
            "tickets": sum(e["tickets"] for e in listed),
            "events": len(listed),
            "attended": sum(1 for e in listed if e["attended"]),
            "list": listed[:6],
        }

    async def _gifts(self, user_id: UUID, start: date, end: date) -> dict[str, Any]:
        from cornerroom.modules.commerce.domain.fan_gifts import FanGift, FanGiftRecipient
        from cornerroom.modules.commerce.domain.music_gifts import MusicGiftRecipient

        lo, hi = _day_start(start), _day_start(end + timedelta(days=1))
        given = (
            await self.session.execute(
                select(func.count(FanGiftRecipient.id))
                .join(FanGift, FanGift.id == FanGiftRecipient.gift_id)
                .where(FanGift.giver_user_id == user_id, FanGift.paid_at >= lo, FanGift.paid_at < hi, FanGift.status != "CANCELLED")
            )
        ).scalar_one()
        received_fan = (
            await self.session.execute(
                select(func.count(FanGiftRecipient.id)).where(
                    FanGiftRecipient.user_id == user_id,
                    FanGiftRecipient.status.in_(("GIVEN", "KEPT_CREDIT")),
                    FanGiftRecipient.created_at >= lo,
                    FanGiftRecipient.created_at < hi,
                )
            )
        ).scalar_one()
        received_music = (
            await self.session.execute(
                select(func.count(MusicGiftRecipient.id)).where(
                    MusicGiftRecipient.user_id == user_id,
                    MusicGiftRecipient.status == "GIVEN",
                    MusicGiftRecipient.given_at >= lo,
                    MusicGiftRecipient.given_at < hi,
                )
            )
        ).scalar_one()
        return {"given": int(given or 0), "received": int((received_fan or 0) + (received_music or 0))}

    async def _follows(self, user_id: UUID, start: date, end: date) -> int:
        from cornerroom.modules.artists.domain.models import Follow

        return int(
            (
                await self.session.execute(
                    select(func.count(Follow.id)).where(
                        Follow.user_id == user_id,
                        Follow.deleted_at.is_(None),
                        Follow.created_at >= _day_start(start),
                        Follow.created_at < _day_start(end + timedelta(days=1)),
                    )
                )
            ).scalar_one()
            or 0
        )

    async def _name_everything(self, stats: dict[str, Any]) -> None:
        """Titles, act names and picture ids, so the page and the share card need nothing else."""
        from cornerroom.modules.artists.domain.models import Artist, Band
        from cornerroom.modules.music.domain.models import Release, Track

        track_ids = {s["track_id"] for s in stats["top_songs"]}
        if stats.get("first_song"):
            track_ids.add(stats["first_song"]["track_id"])
        first_buy = (stats.get("bought") or {}).get("first")
        if first_buy and first_buy["kind"] == "TRACK":
            track_ids.add(first_buy["id"])
        tracks = {
            t.id: t for t in (await self.session.execute(select(Track).where(Track.id.in_(track_ids or {UUID(int=0)})))).scalars()
        }
        act_ids = {a["act_id"] for a in stats["top_acts"]} | set(stats.get("new_act_ids") or [])
        act_ids |= {t.primary_artist_id or t.primary_band_id for t in tracks.values() if t.primary_artist_id or t.primary_band_id}
        acts: dict[UUID, dict[str, Any]] = {}
        for a in (await self.session.execute(select(Artist).where(Artist.id.in_(act_ids or {UUID(int=0)})))).scalars():
            acts[a.id] = {"name": a.stage_name, "kind": a.kind, "picture": a.portrait_asset_id}
        for b in (await self.session.execute(select(Band).where(Band.id.in_(act_ids or {UUID(int=0)})))).scalars():
            acts.setdefault(b.id, {"name": b.name, "kind": "BAND", "picture": b.portrait_asset_id})

        def song(tid: UUID) -> dict[str, Any]:
            t = tracks.get(tid)
            act = (t.primary_artist_id or t.primary_band_id) if t else None
            return {
                "track_id": tid,
                "title": t.title if t else None,
                "act_id": act,
                "act": acts.get(act, {}).get("name") if act else None,
            }

        stats["top_songs"] = [{**s, **song(s["track_id"])} for s in stats["top_songs"]]
        stats["top_acts"] = [
            {**a, "name": acts.get(a["act_id"], {}).get("name"), "kind": acts.get(a["act_id"], {}).get("kind"), "picture": acts.get(a["act_id"], {}).get("picture")}
            for a in stats["top_acts"]
        ]
        if stats.get("first_song"):
            stats["first_song"] = {**stats["first_song"], **song(stats["first_song"]["track_id"])}
        stats["new_act_names"] = [acts[a]["name"] for a in stats.pop("new_act_ids", []) if a in acts]
        if stats.get("fan_rank"):
            stats["fan_rank"]["act"] = acts.get(stats["fan_rank"]["act_id"], {}).get("name")
        if first_buy:
            if first_buy["kind"] == "TRACK":
                first_buy["title"] = tracks[first_buy["id"]].title if first_buy["id"] in tracks else None
            else:
                release = await self.session.get(Release, first_buy["id"])
                first_buy["title"] = release.title if release else None

    # --- staff -------------------------------------------------------------------------------------

    async def staff_list(self, ctx: AuthContext) -> list[dict[str, Any]]:
        await self._check_staff(ctx)
        seasons = (
            await self.session.execute(
                select(WrapSeason).where(WrapSeason.deleted_at.is_(None)).order_by(WrapSeason.ends_on.desc(), WrapSeason.created_at.desc())
            )
        ).scalars().all()
        totals = await self._totals([s.id for s in seasons])
        return [{**self.season_view(s, staff=True), "numbers": totals.get(s.id, self._empty_numbers())} for s in seasons]

    async def staff_get(self, ctx: AuthContext, season_id: UUID) -> dict[str, Any]:
        await self._check_staff(ctx)
        season = await self._season(season_id)
        numbers = (await self._totals([season.id])).get(season.id, self._empty_numbers())
        return {**self.season_view(season, staff=True), "numbers": numbers, "days": await self._days(season.id)}

    async def create(self, ctx: AuthContext, *, name: str, starts_on: date, ends_on: date) -> WrapSeason:
        await self._check_staff(ctx)
        clean = rules.clean_words(name, rules.NAME_MAX, "The name", allow_empty=False)
        rules.check_period(starts_on, ends_on)
        settings = rules.clean_settings(
            {**rules.DEFAULT_SETTINGS, "tagline": f"Your {ends_on.year} in Corner Room" if starts_on.year == ends_on.year else rules.DEFAULT_SETTINGS["tagline"]}
        )
        season = WrapSeason(
            name=clean, starts_on=starts_on, ends_on=ends_on, settings=settings, status=rules.DRAFT, created_by=ctx.user_id, updated_by=ctx.user_id
        )
        self.session.add(season)
        await self.session.flush()
        await self._audit(ctx, "wrap.created", season, new_state={"name": clean, "starts_on": str(starts_on), "ends_on": str(ends_on)})
        return season

    async def update(
        self,
        ctx: AuthContext,
        season_id: UUID,
        *,
        version: int,
        name: str | None = None,
        starts_on: date | None = None,
        ends_on: date | None = None,
        opens_at: datetime | None = None,
        closes_at: datetime | None = None,
        window_sent: bool = False,
        settings: dict[str, Any] | None = None,
    ) -> WrapSeason:
        await self._check_staff(ctx)
        season = await self._season(season_id)
        if version != season.version:
            raise AppError("STALE_VERSION", "Someone else changed this Wrap. Reload to see their changes", 409)
        before = {"name": season.name, "starts_on": str(season.starts_on), "ends_on": str(season.ends_on), "settings": season.settings}
        if name is not None:
            season.name = rules.clean_words(name, rules.NAME_MAX, "The name", allow_empty=False) or season.name
        period_changed = False
        if starts_on is not None or ends_on is not None:
            new_start, new_end = starts_on or season.starts_on, ends_on or season.ends_on
            rules.check_period(new_start, new_end)
            period_changed = (new_start, new_end) != (season.starts_on, season.ends_on)
            season.starts_on, season.ends_on = new_start, new_end
        if window_sent:
            rules.check_window(opens_at, closes_at)
            season.opens_at, season.closes_at = opens_at, closes_at
        rules_changed = False
        if settings is not None:
            clean = rules.clean_settings(settings)
            old_rules = rules.merged_settings(season.settings)["rules"]
            rules_changed = old_rules["top_count"] != clean["rules"]["top_count"] or old_rules["fan_rank_min_listeners"] != clean["rules"]["fan_rank_min_listeners"]
            season.settings = clean
        season.version += 1
        season.updated_by = ctx.user_id
        season.updated_at = _now()
        cleared = 0
        # Kept numbers belong to the old period or lists: everyone gets theirs built again.
        if period_changed or rules_changed:
            cleared = await self._clear(season.id)
        await self.session.flush()
        await self._audit(
            ctx,
            "wrap.updated",
            season,
            previous_state=before,
            new_state={"name": season.name, "starts_on": str(season.starts_on), "ends_on": str(season.ends_on), "settings": season.settings},
            metadata={"rebuilt": cleared},
        )
        return season

    async def transition(self, ctx: AuthContext, season_id: UUID, target: str) -> WrapSeason:
        await self._check_staff(ctx)
        season = await self._season(season_id)
        rules.check_transition(season.status, target)
        previous = season.status
        season.status = target
        now = _now()
        if target == rules.LIVE:
            season.went_live_at = season.went_live_at or now
            season.ended_at = None
        if target == rules.ENDED:
            season.ended_at = now
        season.version += 1
        season.updated_by = ctx.user_id
        await self.session.flush()
        await self._audit(ctx, "wrap.transitioned", season, previous_state={"status": previous}, new_state={"status": target})
        return season

    async def rebuild(self, ctx: AuthContext, season_id: UUID) -> int:
        await self._check_staff(ctx)
        season = await self._season(season_id)
        cleared = await self._clear(season.id)
        await self._audit(ctx, "wrap.rebuilt", season, metadata={"cleared": cleared})
        return cleared

    async def remove(self, ctx: AuthContext, season_id: UUID) -> None:
        """Only a Wrap that never went live can be deleted; a live one is ended instead."""
        await self._check_staff(ctx)
        season = await self._season(season_id)
        if season.status != rules.DRAFT or season.went_live_at is not None:
            raise AppError("WAS_LIVE", "A Wrap people have seen can't be deleted. End it instead", 409)
        season.deleted_at = _now()
        await self._clear(season.id)
        await self.session.flush()
        await self._audit(ctx, "wrap.deleted", season)

    async def _clear(self, season_id: UUID) -> int:
        result = await self.session.execute(delete(WrapSnapshot).where(WrapSnapshot.season_id == season_id))
        return int(result.rowcount or 0)

    @staticmethod
    def _empty_numbers() -> dict[str, int]:
        return {"built": 0, **{k.lower(): 0 for k in rules.COUNT_KINDS}}

    async def _totals(self, season_ids: list[UUID]) -> dict[UUID, dict[str, int]]:
        if not season_ids:
            return {}
        out: dict[UUID, dict[str, int]] = defaultdict(self._empty_numbers)
        for sid, n in (
            await self.session.execute(
                select(WrapSnapshot.season_id, func.count()).where(WrapSnapshot.season_id.in_(season_ids)).group_by(WrapSnapshot.season_id)
            )
        ).all():
            out[sid]["built"] = int(n)
        for sid, kind, n in (
            await self.session.execute(
                select(WrapCount.season_id, WrapCount.kind, func.sum(WrapCount.count))
                .where(WrapCount.season_id.in_(season_ids))
                .group_by(WrapCount.season_id, WrapCount.kind)
            )
        ).all():
            out[sid][kind.lower()] = int(n or 0)
        return dict(out)

    async def _days(self, season_id: UUID) -> list[dict[str, Any]]:
        rows = (
            await self.session.execute(
                select(WrapCount.day, WrapCount.kind, WrapCount.count).where(WrapCount.season_id == season_id).order_by(WrapCount.day)
            )
        ).all()
        days: dict[date, dict[str, Any]] = {}
        for day, kind, n in rows:
            days.setdefault(day, {"day": day, **{k.lower(): 0 for k in rules.COUNT_KINDS}})[kind.lower()] = int(n)
        return list(days.values())[-60:]

    async def people_with_activity(self, ctx: AuthContext, season_id: UUID) -> int:
        """How many accounts have at least one counted listen in the period (a count, no names)."""
        await self._check_staff(ctx)
        from cornerroom.modules.streaming.domain.models import Listen

        season = await self._season(season_id)
        return int(
            (
                await self.session.execute(
                    select(func.count(func.distinct(Listen.user_id))).where(
                        Listen.listen_day >= season.starts_on, Listen.listen_day <= season.ends_on
                    )
                )
            ).scalar_one()
            or 0
        )

    async def _audit(
        self,
        ctx: AuthContext,
        action: str,
        season: WrapSeason,
        *,
        previous_state: dict[str, Any] | None = None,
        new_state: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        from cornerroom.modules.audit.application.service import AuditService

        await AuditService(self.session).record_from_auth(
            ctx, action=action, entity_type="WrapSeason", entity_id=season.id,
            previous_state=previous_state, new_state=new_state, metadata=metadata,
        )


