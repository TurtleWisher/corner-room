"""The staff portal's one-page view and its staff activity log (owner, 2026-11-28).

Owner: "a very clear dashboard of which admin has done which thing, or the entire Corner Room
portal dashboard in a single section, where through a single page an admin or a staff member
can see and operate every functioning part". `/staff` shows the numbers below (each block only
to people whose permissions already let them read that part), the review queues, the latest
staff activity and every page of the portal. The activity log reads the audit log (append-only,
written by every service) for staff accounts only.

Counts only, read straight from the operational tables. Money shows only to finance readers
(analytics honesty: no money in tiles anyone else sees). Staff test buys are never sales.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.pagination import clamp_limit
from cornerroom.modules.administration.application.staff_accounts import StaffAccountsService
from cornerroom.modules.administration.domain.activity_areas import AREA_NAMES, area_for, prefixes_for
from cornerroom.modules.administration.domain.staff_levels import level_for
from cornerroom.modules.audit.domain.models import AuditLog
from cornerroom.modules.authorization.application.service import AuthorizationService
from cornerroom.modules.commerce.application.sales import SOLD_ORDER_STATUSES
from cornerroom.modules.commerce.domain.models import Order
from cornerroom.modules.identity.domain.models import User
from cornerroom.modules.identity.domain.staff_invites import StaffInvite
from cornerroom.modules.royalties.domain.artist_rates import ArtistRoyaltyRate

# Bangladesh keeps one offset all year (D-TIME-01 shows times in Asia/Dhaka).
DHAKA = timezone(timedelta(hours=6))
SERIES_DAYS = 14


def dhaka_day(when: datetime) -> str:
    return when.astimezone(DHAKA).date().isoformat()


class StaffPortalService:
    def __init__(self, session: AsyncSession, *, clock: Clock | None = None) -> None:
        self.session = session
        self.clock = clock or SystemClock()
        self.authz = AuthorizationService(session, clock=self.clock)
        self.accounts = StaffAccountsService(session, clock=self.clock)

    async def permissions(self, ctx: AuthContext) -> frozenset[str]:
        return await self.authz.permission_keys(ctx.user_id, organization_id=ctx.organization_id)

    # ----- overview ------------------------------------------------------------------------

    async def overview(self, ctx: AuthContext) -> dict[str, Any]:
        perms = await self.permissions(ctx)
        now = self.clock.now()
        out: dict[str, Any] = {"generated_at": now}
        if perms & {"commerce.write", "finance.read", "royalty.read", "analytics.read"}:
            out["sales"] = await self._sales(now, with_money="finance.read" in perms)
        if perms & {"user.admin", "finance.read", "analytics.read"}:
            out["people"] = await self._people(now)
        if perms & {"music.approve", "music.write", "analytics.read", "music.intake_assist"}:
            out["music"] = await self._music(now)
        if "event.read" in perms:
            out["live"] = await self._live(now)
        if "royalty.read" in perms:
            out["royalties"] = await self._royalties()
        if perms & {"audit.read", "user.admin"}:
            out["staff"] = await self._staff(now)
        return out

    async def _sales(self, now: datetime, *, with_money: bool) -> dict[str, Any]:
        since = now - timedelta(days=30)
        rows = (
            await self.session.execute(
                select(Order.created_at, Order.purpose, Order.total_amount_minor, Order.currency_code).where(
                    Order.status.in_(SOLD_ORDER_STATUSES),
                    Order.deleted_at.is_(None),
                    Order.is_test.is_(False),
                    Order.created_at >= since,
                )
            )
        ).all()
        today = dhaka_day(now)
        week = now - timedelta(days=7)
        music = [r for r in rows if r.purpose in ("TRACK", "RELEASE")]
        tickets = [r for r in rows if r.purpose == "TICKET"]
        days = [dhaka_day(now - timedelta(days=i)) for i in range(SERIES_DAYS - 1, -1, -1)]
        per_day = Counter(dhaka_day(r.created_at) for r in music)
        block: dict[str, Any] = {
            "music_orders_today": sum(1 for r in music if dhaka_day(r.created_at) == today),
            "music_orders_7d": sum(1 for r in music if r.created_at >= week),
            "music_orders_30d": len(music),
            "ticket_orders_7d": sum(1 for r in tickets if r.created_at >= week),
            "series": [{"day": d, "music_orders": per_day.get(d, 0)} for d in days],
        }
        if with_money:
            money: dict[str, dict[str, int]] = defaultdict(lambda: {"amount_7d_minor": 0, "amount_30d_minor": 0})
            for r in rows:
                money[r.currency_code]["amount_30d_minor"] += int(r.total_amount_minor)
                if r.created_at >= week:
                    money[r.currency_code]["amount_7d_minor"] += int(r.total_amount_minor)
            block["money"] = [{"currency_code": c, **v} for c, v in sorted(money.items())]
        return block

    async def _people(self, now: datetime) -> dict[str, Any]:
        total, new_7d, new_today = (
            await self.session.execute(
                select(
                    func.count(),
                    func.count().filter(User.created_at >= now - timedelta(days=7)),
                    func.count().filter(User.created_at >= now - timedelta(days=1)),
                ).where(User.deleted_at.is_(None))
            )
        ).one()
        return {"accounts": int(total), "new_7d": int(new_7d), "new_24h": int(new_today)}

    async def _music(self, now: datetime) -> dict[str, Any]:
        from cornerroom.modules.artists.domain.models import Artist
        from cornerroom.modules.music.domain.models import Release, Track
        from cornerroom.modules.streaming.domain.models import Listen

        releases = await self.session.scalar(
            select(func.count()).select_from(Release).where(Release.status == "RELEASED", Release.deleted_at.is_(None))
        )
        songs = await self.session.scalar(
            select(func.count()).select_from(Track).where(Track.status == "RELEASED", Track.deleted_at.is_(None))
        )
        artists = await self.session.scalar(
            select(func.count()).select_from(Artist).where(Artist.status == "ACTIVE", Artist.deleted_at.is_(None))
        )
        listens = await self.session.scalar(
            select(func.count()).select_from(Listen).where(Listen.counted_at >= now - timedelta(days=7))
        )
        return {
            "releases_out": int(releases or 0),
            "songs_out": int(songs or 0),
            "active_artists": int(artists or 0),
            "listens_7d": int(listens or 0),
        }

    async def _live(self, now: datetime) -> dict[str, Any]:
        from cornerroom.modules.events.domain.models import Event

        upcoming = await self.session.scalar(
            select(func.count())
            .select_from(Event)
            .where(
                Event.status.in_(("PUBLISHED", "TICKETING_OPEN", "SALES_CLOSED")),
                Event.starts_at > now,
                Event.deleted_at.is_(None),
            )
        )
        drafts = await self.session.scalar(
            select(func.count()).select_from(Event).where(Event.status.in_(("DRAFT", "PLANNED")), Event.deleted_at.is_(None))
        )
        return {"upcoming_events": int(upcoming or 0), "draft_events": int(drafts or 0)}

    async def _royalties(self) -> dict[str, Any]:
        from cornerroom.modules.royalties.application.artist_rates import ArtistRatesService, _spans
        from cornerroom.modules.royalties.domain.artist_rates import rate_at

        svc = ArtistRatesService(self.session, clock=self.clock)
        lines = await svc.sale_lines()
        ids = list({line.artist_id for line in lines})
        rates = await svc.rates_for(ids)
        no_rate = 0
        acts_without = set()
        for line in lines:
            if rate_at(_spans(rates.get(line.artist_id, [])), line.made_at) is None:
                no_rate += 1
                acts_without.add(line.artist_id)
        with_rate = await self.session.scalar(
            select(func.count(func.distinct(ArtistRoyaltyRate.artist_id))).where(ArtistRoyaltyRate.effective_to.is_(None))
        )
        return {
            "artists_with_rate": int(with_rate or 0),
            "sales_without_rate": no_rate,
            "artists_waiting_for_rate": len(acts_without),
        }

    async def _staff(self, now: datetime) -> dict[str, Any]:
        roles = await self.accounts.platform_roles()
        levels = Counter(level_for(keys) for keys in roles.values())
        waiting = await self.session.scalar(
            select(func.count()).select_from(StaffInvite).where(StaffInvite.status == "WAITING")
        )
        ids = [str(i) for i in roles]
        actions_24h = 0
        if ids:
            actions_24h = int(
                await self.session.scalar(
                    select(func.count())
                    .select_from(AuditLog)
                    .where(
                        AuditLog.actor_id.in_(ids),
                        AuditLog.actor_type == "user",
                        AuditLog.occurred_at >= now - timedelta(days=1),
                    )
                )
                or 0
            )
        return {
            "owners": levels.get("OWNER", 0),
            "admins": levels.get("ADMIN", 0),
            "staff": levels.get("STAFF", 0),
            "waiting_invites": int(waiting or 0),
            "actions_24h": actions_24h,
        }

    # ----- activity ------------------------------------------------------------------------

    async def activity(
        self,
        ctx: AuthContext,
        *,
        actor: UUID | None = None,
        area: str | None = None,
        q: str | None = None,
        before: datetime | None = None,
        limit: int | None = None,
        include_sign_ins: bool = False,
    ) -> dict[str, Any]:
        """Staff accounts' audited actions, newest first, with who did each one."""
        roles = await self.accounts.platform_roles()
        staff_ids = [str(i) for i in roles]
        size = clamp_limit(limit, default=50)
        items: list[dict[str, Any]] = []
        next_before = None
        if staff_ids:
            stmt = select(AuditLog).where(AuditLog.actor_type == "user", AuditLog.actor_id.in_(staff_ids))
            if actor is not None:
                stmt = stmt.where(AuditLog.actor_id == str(actor))
            if area and area in AREA_NAMES and area != "Other":
                stmt = stmt.where(or_(*[AuditLog.action.like(f"{p}.%") for p in prefixes_for(area)]))
            elif not include_sign_ins and area != "Other":
                stmt = stmt.where(~or_(*[AuditLog.action.like(f"{p}.%") for p in prefixes_for("Sign-ins")]))
            if q and q.strip():
                needle = f"%{q.strip()[:80]}%"
                stmt = stmt.where(
                    or_(AuditLog.action.ilike(needle), AuditLog.entity_type.ilike(needle), AuditLog.entity_id.ilike(needle))
                )
            if before is not None:
                stmt = stmt.where(AuditLog.occurred_at < before)
            rows = list(
                (await self.session.execute(stmt.order_by(AuditLog.occurred_at.desc()).limit(size + 1))).scalars()
            )
            if area == "Other":
                rows = [r for r in rows if area_for(r.action) == "Other"]
            if len(rows) > size:
                rows = rows[:size]
                next_before = rows[-1].occurred_at
            people = await self.accounts.people([UUID(r.actor_id) for r in rows])
            for r in rows:
                who = people.get(UUID(r.actor_id), {})
                items.append(
                    {
                        "id": r.id,
                        "occurred_at": r.occurred_at,
                        "actor_id": UUID(r.actor_id),
                        "actor_name": who.get("name") or "Staff member",
                        "actor_picture_url": who.get("picture_url"),
                        "actor_level": level_for(roles.get(UUID(r.actor_id), set())),
                        "action": r.action,
                        "area": area_for(r.action),
                        "entity_type": r.entity_type,
                        "entity_id": r.entity_id,
                        "reason": r.reason,
                    }
                )
        return {"items": items, "next_before": next_before, "areas": list(AREA_NAMES)}

    async def activity_summary(self, ctx: AuthContext) -> list[dict[str, Any]]:
        """Per staff account: actions today, this week and in 30 days, last action, top areas."""
        now = self.clock.now()
        roles = await self.accounts.platform_roles()
        if not roles:
            return []
        ids = [str(i) for i in roles]
        rows = (
            await self.session.execute(
                select(AuditLog.actor_id, AuditLog.action, AuditLog.occurred_at).where(
                    AuditLog.actor_type == "user",
                    AuditLog.actor_id.in_(ids),
                    AuditLog.occurred_at >= now - timedelta(days=30),
                )
            )
        ).all()
        last_any = dict(
            (
                await self.session.execute(
                    select(AuditLog.actor_id, func.max(AuditLog.occurred_at))
                    .where(AuditLog.actor_type == "user", AuditLog.actor_id.in_(ids))
                    .group_by(AuditLog.actor_id)
                )
            ).all()
        )
        people = await self.accounts.people(list(roles))
        today = dhaka_day(now)
        per: dict[str, dict[str, Any]] = {i: {"today": 0, "d7": 0, "d30": 0, "areas": Counter()} for i in ids}
        for actor, action, when in rows:
            area = area_for(action)
            if area == "Sign-ins":
                continue
            bucket = per[actor]
            bucket["d30"] += 1
            bucket["areas"][area] += 1
            if when >= now - timedelta(days=7):
                bucket["d7"] += 1
            if dhaka_day(when) == today:
                bucket["today"] += 1
        out = []
        for uid, keys in roles.items():
            level = level_for(keys)
            if level is None:
                continue
            b = per[str(uid)]
            who = people.get(uid, {})
            out.append(
                {
                    "user_id": uid,
                    "name": who.get("name") or "Staff member",
                    "picture_url": who.get("picture_url"),
                    "level": level,
                    "actions_today": b["today"],
                    "actions_7d": b["d7"],
                    "actions_30d": b["d30"],
                    "last_active_at": last_any.get(str(uid)),
                    "top_areas": [name for name, _n in b["areas"].most_common(3)],
                }
            )
        out.sort(key=lambda p: (-p["actions_7d"], p["name"].lower()))
        return out

