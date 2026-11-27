"""One person's page for staff (owner, 2026-11-27, D-CUSTOMERS-03).

From Staff > Money > Customers and users, staff open anyone and see their whole story with Corner
Room in one place: who they are, every order with how its payment went (what they typed, who
checked it, refunds), the music they own, what they listen to, who they follow, gifts given and
received, emails acts sent them, where they signed in, and the things they did on their account,
newest first on one timeline.

Same access as the list (platform admins, or finance staff acting in the platform workspace;
others get 404) and every opening is audited. Read only: nothing here changes an order, a payment
or an account.

What is not here, on purpose: which links a person pressed in an act's email (D-MAIL-02 counts
clicks without saying who), pre-sale page visits (D-PRESALE-04 keeps nothing about a visitor) and
sign-in addresses (IP). Staff test buys are left out (D-TEST-BUY-01).
"""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import NotFoundError
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.commerce.application.customers import (
    CustomerService,
    _address_text,
    order_moment,
    overall_status,
    payment_status,
)
from cornerroom.modules.commerce.application.sales import SOLD_ORDER_STATUSES
from cornerroom.modules.commerce.domain.models import Order, OrderDeliveryAddress, OrderItem, PresaleClaim, Product
from cornerroom.modules.finance.domain.models_payments import Payment, PaymentSubmission, Refund
from cornerroom.modules.identity.domain.models import (
    CustomerProfile,
    DeliveryAddress,
    ExternalIdentity,
    Session,
    User,
)

# Technical ceilings for one page (not business rules).
MAX_ORDERS = 300
MAX_TIMELINE = 400
MAX_ACCOUNT_ACTIONS = 300
MAX_SIGN_INS = 40
MAX_EMAILS = 100
TOP_SONGS = 10

# Account actions already told by the person's orders, payments, listens, follows and gifts, or too
# small to mean anything to staff (a token refresh every few minutes).
COVERED_ACTIONS = (
    "order.",
    "payment.",
    "refund.",
    "entitlement.",
    "presale.",
    "fan_gift.",
    "music_gift.claimed",
    "follow.",
    "listening_session.",
    "auth.refresh",
    "user.registered",
    "user.verified",
    "credit.",
    "ticket_hold.",
    "customers.viewed",
    "customer.viewed",
    "followers.viewed",
)


def account_action_shown(action: str) -> bool:
    """Whether one of the person's own audited actions belongs on their timeline."""
    return not any(action == c or (c.endswith(".") and action.startswith(c)) for c in COVERED_ACTIONS)


def sign_in_groups(sessions: list[Any], now: datetime) -> list[dict[str, Any]]:
    """Sessions grouped by sign-in (a refresh rotates the session but keeps its family): when they
    signed in, when it was last used, the device, and whether it is still signed in."""
    families: dict[UUID, list[Any]] = defaultdict(list)
    for s in sessions:
        families[s.family_id].append(s)
    groups = []
    for rows in families.values():
        first = min(rows, key=lambda s: s.created_at)
        newest = max(rows, key=lambda s: s.created_at)
        used = [s.last_used_at or s.created_at for s in rows]
        active = any(
            s.status == "ACTIVE" and s.revoked_at is None and (s.expires_at is None or s.expires_at > now) for s in rows
        )
        groups.append(
            {
                "signed_in_at": first.created_at,
                "last_used_at": max(used),
                "device": newest.user_agent,
                "active": active,
            }
        )
    groups.sort(key=lambda g: g["signed_in_at"], reverse=True)
    return groups


def _money_add(bucket: dict[str, int], currency: str, amount: int) -> None:
    bucket[currency] = bucket.get(currency, 0) + amount


class CustomerProfileService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.customers = CustomerService(session)

    # ---------- who ----------
    async def _resolve(self, key: str) -> tuple[User | None, list[PresaleClaim]]:
        """A key is an account id, or "presale-<claim id>" for a pre-sale buyer. A pre-sale buyer
        who has since signed up opens as their account."""
        if key.startswith("presale-"):
            try:
                claim_id = UUID(key.removeprefix("presale-"))
            except ValueError as exc:
                raise NotFoundError("Not found") from exc
            claim = await self.session.get(PresaleClaim, claim_id)
            if claim is None:
                raise NotFoundError("Not found")
            email = claim.email.lower()
            user = (
                await self.session.execute(
                    select(User).where(func.lower(User.email) == email, User.deleted_at.is_(None))
                )
            ).scalars().first()
            claims = (
                await self.session.execute(
                    select(PresaleClaim).where(func.lower(PresaleClaim.email) == email).order_by(PresaleClaim.created_at)
                )
            ).scalars().all()
            return user, list(claims)
        try:
            user_id = UUID(key)
        except ValueError as exc:
            raise NotFoundError("Not found") from exc
        user = await self.session.get(User, user_id)
        if user is None or user.deleted_at is not None:
            raise NotFoundError("Not found")
        claims = []
        if user.email:
            claims = (
                await self.session.execute(
                    select(PresaleClaim)
                    .where(func.lower(PresaleClaim.email) == user.email.lower())
                    .order_by(PresaleClaim.created_at)
                )
            ).scalars().all()
        return user, list(claims)

    # ---------- names ----------
    async def _titles(self, *, products: set[UUID], tracks: set[UUID], releases: set[UUID], ticket_types: set[UUID]) -> dict[UUID, str]:
        from cornerroom.modules.events.domain.models import Event
        from cornerroom.modules.music.domain.models import Release, Track
        from cornerroom.modules.ticketing.domain.models import TicketType

        names: dict[UUID, str] = {}
        none = {UUID(int=0)}
        for p in (await self.session.execute(select(Product).where(Product.id.in_(products or none)))).scalars():
            names[p.id] = p.name
        for t in (await self.session.execute(select(Track).where(Track.id.in_(tracks or none)))).scalars():
            names[t.id] = t.title
        for r in (await self.session.execute(select(Release).where(Release.id.in_(releases or none)))).scalars():
            names[r.id] = r.title
        for tt, event in (
            await self.session.execute(
                select(TicketType, Event).join(Event, Event.id == TicketType.event_id).where(TicketType.id.in_(ticket_types or none))
            )
        ).all():
            names[tt.id] = f"{event.title} ({tt.name})"
        return names

    async def _act_names(self, ids: set[UUID]) -> dict[UUID, str]:
        from cornerroom.modules.artists.domain.models import Artist, Band

        none = {UUID(int=0)}
        names = {a.id: a.stage_name for a in (await self.session.execute(select(Artist).where(Artist.id.in_(ids or none)))).scalars()}
        for b in (await self.session.execute(select(Band).where(Band.id.in_(ids or none)))).scalars():
            names.setdefault(b.id, b.name)
        return names

    # ---------- the page ----------
    async def profile(self, ctx: AuthContext, key: str) -> dict[str, Any]:
        await self.customers._check_access(ctx)
        user, claims = await self._resolve(key)
        product_ids = {c.product_id for c in claims}
        claim_titles = await self._titles(products=product_ids, tracks=set(), releases=set(), ticket_types=set())

        presales = [
            {
                "product": claim_titles.get(c.product_id),
                "amount_minor": c.amount_minor,
                "currency_code": c.currency_code,
                "paid_on": c.paid_on,
                "status": c.status,
                "claimed_at": c.claimed_at,
                "listed_at": c.created_at,
            }
            for c in claims
        ]
        timeline: list[dict[str, Any]] = []
        for c in claims:
            timeline.append(
                {
                    "at": c.created_at,
                    "kind": "PRESALE_PAID",
                    "title": claim_titles.get(c.product_id) or "",
                    "detail": c.paid_on.isoformat() if c.paid_on else None,
                    "amount_minor": c.amount_minor,
                    "currency_code": c.currency_code,
                }
            )
            if c.claimed_at:
                timeline.append({"at": c.claimed_at, "kind": "PRESALE_CLAIMED", "title": claim_titles.get(c.product_id) or ""})

        if user is None:
            # A pre-sale buyer who has not signed up yet: only what the pre-sale sheet holds.
            first = claims[0]
            person = {
                "key": key,
                "user_id": None,
                "name": next((c.buyer_name for c in claims if c.buyer_name), None),
                "email": first.email,
                "phone": next((c.phone for c in claims if c.phone), None),
                "address": next((c.address for c in claims if c.address), None),
                "account_status": None,
                "email_verified": False,
                "verified_at": None,
                "joined_at": None,
                "account_types": [],
                "manages": [],
                "sources": ["PRESALE"],
                "sign_in_methods": [],
                "locale": None,
                "security_locked": False,
            }
            spent: dict[str, int] = {}
            for c in claims:
                if c.status != "CANCELLED":
                    _money_add(spent, c.currency_code, c.amount_minor)
            await self._audit(ctx, entity_id=first.id, entity_type="PresaleClaim")
            return self._page(
                person=person,
                summary=self._summary(spent=spent, payment_status="PAID", presales=len(claims)),
                timeline=timeline,
                presales=presales,
            )

        uid = user.id
        email = (user.email or "").lower()
        profile = (
            await self.session.execute(select(CustomerProfile).where(CustomerProfile.user_id == uid))
        ).scalars().first()
        saved_address = (
            await self.session.execute(
                select(DeliveryAddress).where(DeliveryAddress.user_id == uid).order_by(DeliveryAddress.created_at.desc())
            )
        ).scalars().first()
        providers = sorted(
            {
                e.provider.upper()
                for e in (
                    await self.session.execute(
                        select(ExternalIdentity).where(ExternalIdentity.user_id == uid, ExternalIdentity.unlinked_at.is_(None))
                    )
                ).scalars()
            }
        )
        manages, types = await self.customers._profiles_and_types([uid])

        # ---------- orders and payments ----------
        orders = (
            await self.session.execute(
                select(Order)
                .where(
                    Order.user_id == uid,
                    Order.deleted_at.is_(None),
                    Order.is_test.is_(False),
                    Order.status != "DRAFT",
                )
                .order_by(Order.created_at.desc())
                .limit(MAX_ORDERS)
            )
        ).scalars().all()
        order_ids = [o.id for o in orders] or [UUID(int=0)]
        items_by_order: dict[UUID, list[OrderItem]] = defaultdict(list)
        for item in (await self.session.execute(select(OrderItem).where(OrderItem.order_id.in_(order_ids)))).scalars():
            items_by_order[item.order_id].append(item)
        subs_by_order: dict[UUID, list[PaymentSubmission]] = defaultdict(list)
        for sub in (
            await self.session.execute(
                select(PaymentSubmission).where(PaymentSubmission.order_id.in_(order_ids)).order_by(PaymentSubmission.created_at)
            )
        ).scalars():
            if sub.order_id:
                subs_by_order[sub.order_id].append(sub)
        payments = (await self.session.execute(select(Payment).where(Payment.order_id.in_(order_ids)))).scalars().all()
        payment_order = {p.id: p.order_id for p in payments}
        refunds_by_order: dict[UUID, list[Refund]] = defaultdict(list)
        if payments:
            for r in (
                await self.session.execute(
                    select(Refund).where(Refund.payment_id.in_(list(payment_order))).order_by(Refund.created_at)
                )
            ).scalars():
                oid = payment_order.get(r.payment_id)
                if oid:
                    refunds_by_order[oid].append(r)
        delivery: dict[UUID, OrderDeliveryAddress] = {}
        for addr in (
            await self.session.execute(
                select(OrderDeliveryAddress).where(OrderDeliveryAddress.order_id.in_(order_ids)).order_by(OrderDeliveryAddress.created_at)
            )
        ).scalars():
            delivery[addr.order_id] = addr

        from cornerroom.modules.commerce.domain.fan_gifts import FanGift, FanGiftRecipient

        gifts_by_order = {
            g.order_id: g
            for g in (await self.session.execute(select(FanGift).where(FanGift.order_id.in_(order_ids)))).scalars()
        }
        all_items = [i for rows in items_by_order.values() for i in rows]
        titles = await self._titles(
            products={i.product_id for i in all_items if i.product_id},
            tracks={i.ref_id for i in all_items if i.item_type == "TRACK"},
            releases={i.ref_id for i in all_items if i.item_type == "RELEASE"},
            ticket_types={i.ref_id for i in all_items if i.item_type == "TICKET"},
        )

        def item_name(i: OrderItem) -> str:
            return titles.get(i.product_id) if i.product_id and i.product_id in titles else titles.get(i.ref_id) or i.item_type.title()

        spent: dict[str, int] = {}
        refunded: dict[str, int] = {}
        order_views = []
        counts = defaultdict(int)
        for o in orders:
            subs = subs_by_order.get(o.id, [])
            latest = subs[-1] if subs else None
            status = payment_status(o.status, latest.status if latest else None)
            counts[status] += 1
            names = [item_name(i) for i in items_by_order.get(o.id, [])]
            if o.status in SOLD_ORDER_STATUSES:
                _money_add(spent, o.currency_code, o.total_amount_minor)
            refunds = refunds_by_order.get(o.id, [])
            for r in refunds:
                if r.status == "COMPLETED":
                    _money_add(refunded, r.currency_code, r.amount_minor)
            gift = gifts_by_order.get(o.id)
            addr = delivery.get(o.id)
            order_views.append(
                {
                    "order_id": o.id,
                    "status": status,
                    "order_status": o.status,
                    "purpose": o.purpose,
                    "is_presale": o.is_presale,
                    "is_gift": gift is not None,
                    "is_music_gift": o.music_gift_id is not None,
                    "paid_with_credit_minor": o.paid_with_credit_minor,
                    "amount_minor": o.total_amount_minor,
                    "currency_code": o.currency_code,
                    "created_at": o.created_at,
                    "updated_at": o.updated_at,
                    "items": [
                        {
                            "name": item_name(i),
                            "kind": i.item_type,
                            "quantity": i.quantity,
                            "amount_minor": i.amount_minor,
                            "currency_code": i.currency_code,
                        }
                        for i in items_by_order.get(o.id, [])
                    ],
                    "submissions": [
                        {
                            "status": s.status,
                            "transaction_ref": s.transaction_ref,
                            "paid_from": s.paid_from,
                            "paid_with": s.paid_with,
                            "sent_at": s.created_at,
                            "decided_at": s.decided_at,
                            "decision_note": s.decision_note,
                        }
                        for s in subs
                    ],
                    "refunds": [
                        {
                            "status": r.status,
                            "amount_minor": r.amount_minor,
                            "currency_code": r.currency_code,
                            "reason_code": r.reason_code,
                            "requested_at": r.created_at,
                        }
                        for r in refunds
                    ],
                    "delivery_address": _address_text(addr) if addr else None,
                }
            )
            # The order's story on the timeline: opened the payment page, sent payments, decisions.
            money = {"amount_minor": o.total_amount_minor, "currency_code": o.currency_code, "order_id": o.id}
            title = ", ".join(names)
            timeline.append({"at": o.created_at, "kind": "CHECKOUT_OPENED", "title": title, **money})
            for s in subs:
                timeline.append(
                    {
                        "at": s.created_at,
                        "kind": "PAYMENT_SENT",
                        "title": title,
                        "detail": " · ".join(x for x in [s.transaction_ref, s.paid_from, s.paid_with] if x),
                        **money,
                    }
                )
                if s.decided_at and s.status in ("CONFIRMED", "REJECTED"):
                    timeline.append(
                        {
                            "at": s.decided_at,
                            "kind": "PAID" if s.status == "CONFIRMED" else "PAYMENT_REJECTED",
                            "title": title,
                            "detail": s.decision_note,
                            **money,
                        }
                    )
            kind, at = order_moment(
                order_status=o.status,
                created_at=o.created_at,
                updated_at=o.updated_at,
                sub_status=latest.status if latest else None,
                sub_created_at=latest.created_at if latest else None,
                sub_decided_at=latest.decided_at if latest else None,
            )
            if kind == "PAID" and not (latest and latest.status == "CONFIRMED"):
                # Paid without a checked payment (gift credit, a ৳0 order or a card provider).
                timeline.append({"at": at, "kind": "PAID", "title": title, **money})
            if kind == "CHECKOUT_EXPIRED":
                timeline.append({"at": at, "kind": "CHECKOUT_EXPIRED", "title": title, **money})
            for r in refunds:
                timeline.append(
                    {
                        "at": r.created_at,
                        "kind": "REFUND",
                        "title": title,
                        "detail": r.status,
                        "amount_minor": r.amount_minor,
                        "currency_code": r.currency_code,
                        "order_id": o.id,
                    }
                )

        # ---------- music they own ----------
        from cornerroom.modules.entitlements.domain.models import Entitlement

        ents = (
            await self.session.execute(
                select(Entitlement).where(Entitlement.user_id == uid, Entitlement.deleted_at.is_(None)).order_by(Entitlement.created_at.desc())
            )
        ).scalars().all()
        ent_titles = await self._titles(
            products=set(),
            tracks={e.ref_id for e in ents if e.scope == "TRACK"},
            releases={e.ref_id for e in ents if e.scope == "RELEASE"},
            ticket_types=set(),
        )
        library = [
            {
                "title": ent_titles.get(e.ref_id) or "Not available",
                "kind": e.scope,
                "status": e.status,
                "source": e.source_type,
                "since": e.created_at,
            }
            for e in ents
            if e.scope in ("TRACK", "RELEASE")
        ]

        # ---------- listening ----------
        from cornerroom.modules.streaming.domain.models import Listen

        listens_total = (await self.session.execute(select(func.count()).select_from(Listen).where(Listen.user_id == uid))).scalar_one()
        top_rows = (
            await self.session.execute(
                select(Listen.track_id, func.count(), func.max(Listen.counted_at))
                .where(Listen.user_id == uid)
                .group_by(Listen.track_id)
                .order_by(func.count().desc())
                .limit(TOP_SONGS)
            )
        ).all()
        day_rows = (
            await self.session.execute(
                select(Listen.listen_day, Listen.track_id, func.count(), func.max(Listen.counted_at))
                .where(Listen.user_id == uid)
                .group_by(Listen.listen_day, Listen.track_id)
                .order_by(Listen.listen_day.desc())
                .limit(120)
            )
        ).all()
        song_titles = await self._titles(
            products=set(), tracks={r[0] for r in top_rows} | {r[1] for r in day_rows}, releases=set(), ticket_types=set()
        )
        top_songs = [
            {"title": song_titles.get(tid) or "Not available", "listens": n, "last_at": last} for tid, n, last in top_rows
        ]
        for _day, tid, n, last in day_rows:
            timeline.append({"at": last, "kind": "LISTENED", "title": song_titles.get(tid) or "", "count": n})

        # ---------- follows ----------
        from cornerroom.modules.artists.domain.models import Follow

        follows = (
            await self.session.execute(
                select(Follow).where(Follow.user_id == uid, Follow.deleted_at.is_(None)).order_by(Follow.created_at.desc())
            )
        ).scalars().all()
        act_names = await self._act_names({f.target_id for f in follows})
        follow_views = [
            {"name": act_names.get(f.target_id) or "Not available", "kind": f.target_type, "since": f.created_at, "active": f.status == "ACTIVE"}
            for f in follows
        ]
        for f in follows:
            timeline.append({"at": f.created_at, "kind": "FOLLOWED", "title": act_names.get(f.target_id) or ""})

        # ---------- gifts and credit ----------
        from cornerroom.modules.commerce.domain.fan_gifts import GiftCredit
        from cornerroom.modules.commerce.domain.music_gifts import MusicGift, MusicGiftRecipient

        given = (
            await self.session.execute(select(FanGift).where(FanGift.giver_user_id == uid).order_by(FanGift.created_at.desc()))
        ).scalars().all()
        given_people: dict[UUID, list[FanGiftRecipient]] = defaultdict(list)
        received_fan = []
        recipient_filter = [FanGiftRecipient.user_id == uid]
        if email:
            recipient_filter.append(func.lower(FanGiftRecipient.email) == email)
        for r in (
            await self.session.execute(
                select(FanGiftRecipient).where(
                    or_(FanGiftRecipient.gift_id.in_([g.id for g in given] or [UUID(int=0)]), *recipient_filter)
                )
            )
        ).scalars():
            if r.gift_id in {g.id for g in given}:
                given_people[r.gift_id].append(r)
            if r.user_id == uid or (email and r.email.lower() == email):
                received_fan.append(r)
        received_gifts = {
            g.id: g
            for g in (
                await self.session.execute(select(FanGift).where(FanGift.id.in_([r.gift_id for r in received_fan] or [UUID(int=0)])))
            ).scalars()
        }
        gift_titles = await self._titles(
            products={g.product_id for g in [*given, *received_gifts.values()]}, tracks=set(), releases=set(), ticket_types=set()
        )
        giver_names = {
            p.user_id: p.display_name
            for p in (
                await self.session.execute(
                    select(CustomerProfile).where(CustomerProfile.user_id.in_([g.giver_user_id for g in received_gifts.values()] or [UUID(int=0)]))
                )
            ).scalars()
        }
        gifts_given = [
            {
                "music": gift_titles.get(g.product_id) or "Not available",
                "status": g.status,
                "people": len(given_people.get(g.id, [])),
                "people_states": sorted({r.status for r in given_people.get(g.id, [])}),
                "amount_minor": g.unit_amount_minor,
                "currency_code": g.currency_code,
                "at": g.paid_at or g.created_at,
            }
            for g in given
        ]
        gifts_received = [
            {
                "music": gift_titles.get(received_gifts[r.gift_id].product_id) if r.gift_id in received_gifts else None,
                "from": giver_names.get(received_gifts[r.gift_id].giver_user_id) if r.gift_id in received_gifts else None,
                "kind": "FAN_GIFT",
                "status": r.status,
                "at": r.resolved_at or r.emailed_at or r.created_at,
            }
            for r in received_fan
        ]
        mg_filter = [MusicGiftRecipient.user_id == uid]
        if email:
            mg_filter.append(func.lower(MusicGiftRecipient.email) == email)
        for r, mg in (
            await self.session.execute(
                select(MusicGiftRecipient, MusicGift).join(MusicGift, MusicGift.id == MusicGiftRecipient.gift_id).where(or_(*mg_filter))
            )
        ).all():
            act = (await self._act_names({mg.profile_id})).get(mg.profile_id)
            gifts_received.append(
                {"music": mg.title, "from": act, "kind": "MUSIC_GIFT", "status": r.status, "at": r.given_at or r.emailed_at or r.created_at}
            )
        gifts_received.sort(key=lambda g: g["at"], reverse=True)
        for g in gifts_given:
            timeline.append({"at": g["at"], "kind": "GIFT_GIVEN", "title": g["music"], "count": g["people"]})
        for g in gifts_received:
            timeline.append({"at": g["at"], "kind": "GIFT_RECEIVED", "title": g["music"] or "", "detail": g["from"]})
        credit: dict[str, int] = {}
        for c in (await self.session.execute(select(GiftCredit).where(GiftCredit.user_id == uid))).scalars():
            _money_add(credit, c.currency_code, c.amount_minor)
        credit = {k: v for k, v in credit.items() if v}

        # ---------- emails acts sent them (no click details, D-MAIL-02) ----------
        from cornerroom.modules.commerce.domain.artist_mail import ArtistMailMessage

        mail_filter = [ArtistMailMessage.user_id == uid]
        if email:
            mail_filter.append(func.lower(ArtistMailMessage.email) == email)
        mails = (
            await self.session.execute(
                select(ArtistMailMessage).where(or_(*mail_filter)).order_by(ArtistMailMessage.created_at.desc()).limit(MAX_EMAILS)
            )
        ).scalars().all()
        email_views = [
            {"from_name": m.from_name, "subject": m.subject, "kind": m.kind, "status": m.status, "at": m.sent_at or m.created_at}
            for m in mails
        ]
        for m in email_views:
            timeline.append({"at": m["at"], "kind": "EMAIL_FROM_ACT", "title": m["subject"], "detail": m["from_name"]})

        # ---------- sign-ins ----------
        sessions = (
            await self.session.execute(select(Session).where(Session.user_id == uid).order_by(Session.created_at.desc()).limit(500))
        ).scalars().all()
        sign_ins = sign_in_groups(list(sessions), datetime.now(UTC))[:MAX_SIGN_INS]
        last_seen = max((g["last_used_at"] for g in sign_ins), default=None)

        # ---------- their own recorded actions ----------
        from cornerroom.modules.audit.domain.models import AuditLog

        actions = [
            a
            for a in (
                await self.session.execute(
                    select(AuditLog)
                    .where(AuditLog.actor_id == str(uid))
                    .order_by(AuditLog.occurred_at.desc())
                    .limit(MAX_ACCOUNT_ACTIONS * 3)
                )
            ).scalars()
            if account_action_shown(a.action)
        ][:MAX_ACCOUNT_ACTIONS]
        for a in actions:
            timeline.append({"at": a.occurred_at, "kind": "ACCOUNT_ACTION", "title": a.action, "detail": a.entity_type})

        timeline.append({"at": user.created_at, "kind": "SIGNED_UP", "title": ""})
        if user.email_verified_at:
            timeline.append({"at": user.email_verified_at, "kind": "EMAIL_VERIFIED", "title": ""})

        address = _address_text(saved_address) if saved_address else None
        if not address:
            address = next((v["delivery_address"] for v in order_views if v["delivery_address"]), None) or next(
                (c.address for c in claims if c.address), None
            )
        person = {
            "key": str(uid),
            "user_id": uid,
            "name": (profile.display_name if profile else None)
            or (saved_address.recipient_name if saved_address else None)
            or next((c.buyer_name for c in claims if c.buyer_name), None)
            or next(iter(manages.get(uid, [])), None),
            "email": user.email,
            "phone": user.phone or (saved_address.phone if saved_address else None) or next((c.phone for c in claims if c.phone), None),
            "address": address,
            "account_status": user.status,
            "email_verified": user.email_verified_at is not None,
            "verified_at": user.email_verified_at,
            "joined_at": user.created_at,
            "account_types": types.get(uid, ["fan"]),
            "manages": manages.get(uid, []),
            "sources": ["WEBSITE"] + (["PRESALE"] if claims else []),
            "sign_in_methods": (["PASSWORD"] if user.password_hash else []) + providers,
            "locale": profile.locale if profile else None,
            "security_locked": user.security_locked_at is not None,
        }
        for c in claims:
            if c.status != "CANCELLED" and not c.order_id:
                _money_add(spent, c.currency_code, c.amount_minor)
        summary = self._summary(
            spent=spent,
            refunded=refunded,
            credit=credit,
            payment_status=overall_status([v["status"] for v in order_views] + (["PAID"] if claims else [])),
            orders_paid=counts["PAID"] + counts["REFUNDED"],
            waiting=counts["WAITING"],
            rejected=counts["REJECTED"],
            unfinished=counts["NOT_SENT"] + counts["EXPIRED"],
            refunds=sum(len(v) for v in refunds_by_order.values()),
            owned=sum(1 for item in library if item["status"] == "ACTIVE"),
            listens=listens_total,
            follows=sum(1 for f in follow_views if f["active"]),
            gifts_given=len(gifts_given),
            gifts_received=len(gifts_received),
            presales=len(claims),
            last_seen_at=last_seen,
        )
        await self._audit(ctx, entity_id=uid, entity_type="User")
        return self._page(
            person=person,
            summary=summary,
            timeline=timeline,
            orders=order_views,
            presales=presales,
            library=library,
            top_songs=top_songs,
            follows=follow_views,
            gifts_given=gifts_given,
            gifts_received=gifts_received,
            emails=email_views,
            sign_ins=sign_ins,
        )

    @staticmethod
    def _summary(**values: Any) -> dict[str, Any]:
        base: dict[str, Any] = {
            "spent": {},
            "refunded": {},
            "credit": {},
            "payment_status": None,
            "orders_paid": 0,
            "waiting": 0,
            "rejected": 0,
            "unfinished": 0,
            "refunds": 0,
            "owned": 0,
            "listens": 0,
            "follows": 0,
            "gifts_given": 0,
            "gifts_received": 0,
            "presales": 0,
            "last_seen_at": None,
        }
        base.update(values)
        return base

    @staticmethod
    def _page(*, person: dict[str, Any], summary: dict[str, Any], timeline: list[dict[str, Any]], **parts: Any) -> dict[str, Any]:
        dated = [t for t in timeline if t.get("at") is not None]
        dated.sort(key=lambda t: t["at"].replace(tzinfo=None), reverse=True)
        summary["last_activity_at"] = dated[0]["at"] if dated else None
        page = {
            "person": person,
            "summary": summary,
            "timeline": dated[:MAX_TIMELINE],
            "timeline_truncated": len(dated) > MAX_TIMELINE,
            "orders": [],
            "presales": [],
            "library": [],
            "top_songs": [],
            "follows": [],
            "gifts_given": [],
            "gifts_received": [],
            "emails": [],
            "sign_ins": [],
        }
        page.update(parts)
        return page

    async def _audit(self, ctx: AuthContext, *, entity_id: UUID, entity_type: str) -> None:
        # Who looked at whom, never what they saw.
        await self.customers.audit.record_from_auth(
            ctx,
            action="customer.viewed",
            entity_type=entity_type,
            entity_id=entity_id,
            organization_id=ctx.organization_id,
        )
