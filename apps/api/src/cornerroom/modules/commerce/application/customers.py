"""All customers, for admins and finance staff (owner, 2026-10-27, D-CUSTOMERS-01).

One list of everyone who is a Corner Room customer: website accounts (signed up, bought, or both)
and pre-sale buyers who paid before launch (listed whether or not they have signed up yet). A
pre-sale buyer who signed up appears once, with both. Filter by an artist or band to see that
profile's customers (anyone who bought or pre-bought its songs or releases).

Personal data (email, phone, address) is shown only to staff with platform user administration,
or finance staff acting in Corner Room's platform workspace; every view is audited (counts and the
filter only, never the people). Read only: nothing here changes an order, a payment or an account.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import ForbiddenError, NotFoundError
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.authorization.application.service import AuthorizationService
from cornerroom.modules.commerce.application.sales import SOLD_ORDER_STATUSES
from cornerroom.modules.commerce.domain.models import Order, OrderDeliveryAddress, OrderItem, PresaleClaim, Product
from cornerroom.modules.identity.domain.models import CustomerProfile, DeliveryAddress, Organization, User

# A technical ceiling for one screen (not a business rule); the list is filtered before it applies.
MAX_ROWS = 5000


def _address_text(row: Any) -> str:
    parts = [row.house_road, row.area, row.upazila, row.district, row.division, getattr(row, "postcode", None)]
    return ", ".join(p.strip() for p in parts if p and p.strip())


class CustomerService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.authz = AuthorizationService(session)
        self.audit = AuditService(session)

    async def _check_access(self, ctx: AuthContext) -> None:
        """Platform admins, or finance staff working in the platform workspace. Others: 404."""
        try:
            await self.authz.authorize(ctx.user_id, "user.admin")
            return
        except ForbiddenError:
            pass
        org = await self.session.get(Organization, ctx.organization_id) if ctx.organization_id else None
        if org is None or org.type != "PLATFORM" or org.deleted_at is not None:
            raise NotFoundError("Not found")
        try:
            await self.authz.authorize(
                ctx.user_id, "finance.read", resource_type="organization", resource_id=org.id, scope_organization_id=org.id
            )
        except ForbiddenError as exc:
            raise NotFoundError("Not found") from exc

    async def _profile_products(self, kind: str, profile_id: UUID) -> tuple[set[UUID], set[UUID]]:
        """Product ids and song/release ids of one artist or band."""
        from cornerroom.modules.music.domain.models import Release, Track

        release_col = Release.primary_artist_id if kind == "artist" else Release.primary_band_id
        track_col = Track.primary_artist_id if kind == "artist" else Track.primary_band_id
        subjects = set((await self.session.execute(select(Release.id).where(release_col == profile_id))).scalars())
        subjects |= set((await self.session.execute(select(Track.id).where(track_col == profile_id))).scalars())
        products = (
            set((await self.session.execute(select(Product.id).where(Product.subject_id.in_(subjects)))).scalars())
            if subjects
            else set()
        )
        return products, subjects

    async def _scope_products(self, scope: str, scope_id: UUID) -> tuple[set[UUID], set[UUID]]:
        """Products and order-line subjects for one song, release or event (owner, 2026-10-27).
        A song's buyers include those who bought a release it is on; a release's include those who
        bought its songs one by one; an event's are its ticket buyers."""
        from cornerroom.modules.music.domain.models import Release, ReleaseTrack

        subjects: set[UUID] = {scope_id}
        if scope == "track":
            subjects |= set(
                (
                    await self.session.execute(
                        select(ReleaseTrack.release_id)
                        .join(Release, Release.id == ReleaseTrack.release_id)
                        .where(ReleaseTrack.track_id == scope_id, Release.deleted_at.is_(None))
                    )
                ).scalars()
            )
        elif scope == "release":
            subjects |= set(
                (await self.session.execute(select(ReleaseTrack.track_id).where(ReleaseTrack.release_id == scope_id))).scalars()
            )
        elif scope == "event":
            from cornerroom.modules.ticketing.domain.models import TicketType

            subjects = set(
                (await self.session.execute(select(TicketType.id).where(TicketType.event_id == scope_id))).scalars()
            )
            return set(), subjects
        else:
            raise NotFoundError("Not found")
        products = set((await self.session.execute(select(Product.id).where(Product.subject_id.in_(subjects)))).scalars())
        return products, subjects

    async def list_followers(self, ctx: AuthContext, *, kind: str, target_id: UUID) -> dict[str, Any]:
        """Followers of an artist or band, for CSV export (owner, 2026-10-27). Same access as the
        customer list; the view is audited."""
        await self._check_access(ctx)
        from cornerroom.modules.artists.domain.models import Follow

        target_type = {"artist": "ARTIST", "band": "BAND"}.get(kind)
        if target_type is None:
            raise NotFoundError("Not found")
        follows = (
            await self.session.execute(
                select(Follow)
                .where(
                    Follow.target_type == target_type,
                    Follow.target_id == target_id,
                    Follow.status == "ACTIVE",
                    Follow.deleted_at.is_(None),
                )
                .order_by(Follow.created_at.desc())
            )
        ).scalars().all()
        users = {
            u.id: u
            for u in (
                await self.session.execute(select(User).where(User.id.in_([f.user_id for f in follows] or [UUID(int=0)])))
            ).scalars()
        }
        names = {
            p.user_id: p.display_name
            for p in (
                await self.session.execute(select(CustomerProfile).where(CustomerProfile.user_id.in_(list(users) or [UUID(int=0)])))
            ).scalars()
        }
        items = [
            {
                "user_id": f.user_id,
                "name": names.get(f.user_id),
                "email": users[f.user_id].email,
                "phone": users[f.user_id].phone,
                "followed_at": f.created_at,
            }
            for f in follows
            if f.user_id in users and users[f.user_id].deleted_at is None
        ]
        await self.audit.record_from_auth(
            ctx,
            action="followers.viewed",
            entity_type=target_type.title(),
            entity_id=target_id,
            new_state={"count": len(items)},
            organization_id=ctx.organization_id,
        )
        return {"items": items[:MAX_ROWS], "total": len(items)}

    async def list_customers(
        self,
        ctx: AuthContext,
        *,
        q: str | None = None,
        profile_kind: str | None = None,
        profile_id: UUID | None = None,
        scope: str | None = None,
        scope_id: UUID | None = None,
    ) -> dict[str, Any]:
        await self._check_access(ctx)
        products: set[UUID] | None = None
        subjects: set[UUID] = set()
        if profile_kind and profile_id:
            if profile_kind not in {"artist", "band"}:
                raise NotFoundError("Not found")
            products, subjects = await self._profile_products(profile_kind, profile_id)
        elif scope and scope_id:
            products, subjects = await self._scope_products(scope, scope_id)

        # Orders that count as sales, with what they were for.
        order_rows = (
            await self.session.execute(
                select(Order).where(Order.status.in_(SOLD_ORDER_STATUSES), Order.deleted_at.is_(None))
            )
        ).scalars().all()
        items_by_order: dict[UUID, list[OrderItem]] = defaultdict(list)
        if order_rows:
            for item in (
                await self.session.execute(select(OrderItem).where(OrderItem.order_id.in_([o.id for o in order_rows])))
            ).scalars():
                items_by_order[item.order_id].append(item)

        def counts(order: Order) -> bool:
            if products is None:
                return True
            return any(
                (i.product_id in products) or (i.ref_id in subjects) for i in items_by_order.get(order.id, [])
            )

        orders_by_user: dict[UUID, list[Order]] = defaultdict(list)
        for order in order_rows:
            if order.user_id and counts(order):
                orders_by_user[order.user_id].append(order)

        presale_query = select(PresaleClaim).where(PresaleClaim.status != "CANCELLED")
        if products is not None:
            presale_query = presale_query.where(PresaleClaim.product_id.in_(products or {UUID(int=0)}))
        presales = (await self.session.execute(presale_query)).scalars().all()
        product_names = {
            p.id: p.name
            for p in (
                await self.session.execute(select(Product).where(Product.id.in_({c.product_id for c in presales} or {UUID(int=0)})))
            ).scalars()
        }

        # Which accounts to show: everyone (no filter), or this profile's buyers.
        user_query = select(User).where(User.deleted_at.is_(None))
        if products is not None:
            wanted = set(orders_by_user) | {c.claimed_user_id for c in presales if c.claimed_user_id}
            user_query = user_query.where(User.id.in_(wanted or {UUID(int=0)}))
        users = (await self.session.execute(user_query)).scalars().all()
        user_ids = [u.id for u in users]
        names = {
            p.user_id: p.display_name
            for p in (
                await self.session.execute(select(CustomerProfile).where(CustomerProfile.user_id.in_(user_ids or [UUID(int=0)])))
            ).scalars()
        }
        saved = {}
        for addr in (
            await self.session.execute(
                select(DeliveryAddress)
                .where(DeliveryAddress.user_id.in_(user_ids or [UUID(int=0)]))
                .order_by(DeliveryAddress.created_at.asc())
            )
        ).scalars():
            saved[addr.user_id] = addr  # the newest wins
        delivered = {}
        all_user_orders = [o.id for o in order_rows if o.user_id in set(user_ids)]
        if all_user_orders:
            order_owner = {o.id: o.user_id for o in order_rows}
            for addr in (
                await self.session.execute(
                    select(OrderDeliveryAddress)
                    .where(OrderDeliveryAddress.order_id.in_(all_user_orders))
                    .order_by(OrderDeliveryAddress.created_at.asc())
                )
            ).scalars():
                delivered[order_owner[addr.order_id]] = addr

        presales_by_email: dict[str, list[PresaleClaim]] = defaultdict(list)
        for claim in presales:
            presales_by_email[claim.email].append(claim)

        def presale_view(claims: list[PresaleClaim]) -> list[dict[str, Any]]:
            return [
                {
                    "product": product_names.get(c.product_id),
                    "amount_minor": c.amount_minor,
                    "currency_code": c.currency_code,
                    "paid_on": c.paid_on,
                    "status": c.status,
                }
                for c in claims
            ]

        rows: list[dict[str, Any]] = []
        seen_emails: set[str] = set()
        for user in users:
            email = (user.email or "").lower()
            seen_emails.add(email)
            claims = presales_by_email.get(email, [])
            orders = orders_by_user.get(user.id, [])
            spent: dict[str, int] = defaultdict(int)
            for order in orders:
                spent[order.currency_code] += order.total_amount_minor
            address = saved.get(user.id) or delivered.get(user.id)
            phone = user.phone or (address.phone if address else None) or next((c.phone for c in claims if c.phone), None)
            rows.append(
                {
                    "key": str(user.id),
                    "name": names.get(user.id) or (address.recipient_name if address else None)
                    or next((c.buyer_name for c in claims if c.buyer_name), None),
                    "email": user.email,
                    "phone": phone,
                    "address": _address_text(address) if address else next((c.address for c in claims if c.address), None),
                    "user_id": user.id,
                    "account_status": user.status,
                    "email_verified": user.email_verified_at is not None,
                    "joined_at": user.created_at,
                    "orders": len(orders),
                    "spent": dict(spent),
                    "last_order_at": max((o.created_at for o in orders), default=None),
                    "presales": presale_view(claims),
                    "sources": (["WEBSITE"] if orders or products is None else []) + (["PRESALE"] if claims else []),
                }
            )
        # Pre-sale buyers who have not signed up yet.
        for email, claims in presales_by_email.items():
            if email in seen_emails:
                continue
            first = claims[0]
            rows.append(
                {
                    "key": f"presale:{email}",
                    "name": next((c.buyer_name for c in claims if c.buyer_name), None),
                    "email": email,
                    "phone": next((c.phone for c in claims if c.phone), None),
                    "address": next((c.address for c in claims if c.address), None),
                    "user_id": None,
                    "account_status": None,
                    "email_verified": False,
                    "joined_at": None,
                    "orders": 0,
                    "spent": {},
                    "last_order_at": None,
                    "presales": presale_view(claims),
                    "sources": ["PRESALE"],
                    "_first_paid": first.created_at,
                }
            )

        if q:
            needle = q.strip().lower()
            rows = [
                r for r in rows
                if any(needle in str(r.get(f) or "").lower() for f in ("name", "email", "phone", "address"))
            ]

        def sort_key(r: dict[str, Any]) -> datetime:
            when = r["last_order_at"] or r["joined_at"] or r.get("_first_paid")
            return when.replace(tzinfo=None) if when else datetime.min

        # Most recent activity first.
        rows.sort(key=sort_key, reverse=True)
        for r in rows:
            r.pop("_first_paid", None)
        total = len(rows)
        await self.audit.record_from_auth(
            ctx,
            action="customers.viewed",
            entity_type="CustomerList",
            entity_id=ctx.user_id,
            new_state={
                "filter": {
                    "q": bool(q),
                    "profile_kind": profile_kind,
                    "profile_id": str(profile_id) if profile_id else None,
                    "scope": scope,
                    "scope_id": str(scope_id) if scope_id else None,
                },
                "count": total,
            },
            organization_id=ctx.organization_id,
        )
        return {
            "items": rows[:MAX_ROWS],
            "total": total,
            "truncated": total > MAX_ROWS,
            "presale_buyers": sum(1 for r in rows if "PRESALE" in r["sources"]),
            "website_customers": sum(1 for r in rows if r["user_id"] is not None),
        }

