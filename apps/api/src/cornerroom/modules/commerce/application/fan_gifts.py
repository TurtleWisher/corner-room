"""Fan gifts and gift credit (owner, 2026-11-20, D-GIFT-FAN-01). Rules in `domain/fan_gifts.py`.

A gift is one normal paid order from the giver, with one line per person; the payment goes through
the usual pipeline (Bangla QR, staff verification), so the sale and its royalties count when the
giver pays. Fulfilment gives the music to the people on the gift, never to the giver."""

from __future__ import annotations

import hashlib
import secrets
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, NotFoundError
from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.infra.settings import Settings, get_settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import (
    FAN_GIFT_RETURNED,
    FAN_GIFT_SENT,
    USER_ACTIVATED,
    USER_REGISTERED,
    USER_VERIFIED,
    DomainEvent,
)
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.commerce.domain.fan_gifts import (
    FanGift,
    FanGiftRecipient,
    GiftCredit,
    act_of,
    clean_note,
    clean_people,
    credit_back_reason,
    expires_from,
    giver_state,
    is_expired,
    may_choose,
    normalize_email,
)
from cornerroom.modules.commerce.domain.models import Offer, Order, OrderItem, Product

log = structlog.get_logger("commerce.fan_gifts")

PEOPLE_PROBLEMS = {
    "NO_PEOPLE": "Add at least one email address",
    "BAD_EMAIL": "One of those email addresses isn't complete",
    "OWN_EMAIL": "A gift is for someone else, so leave out your own email address",
    "SAME_EMAIL_TWICE": "Each email address can be on a gift once",
    "TOO_MANY_PEOPLE": "That's more people than one gift can go to",
    "NOTE_TOO_LONG": "Keep the note to 300 characters",
}


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def mask_email(email: str) -> str:
    name, _, host = email.partition("@")
    return f"{name[:1]}•••@{host}" if host else "•••"


class FanGiftService:
    def __init__(self, session: AsyncSession, settings: Settings | None = None, clock: Clock | None = None) -> None:
        self.session = session
        self.settings = settings or get_settings()
        self.clock = clock or SystemClock()
        self.audit = AuditService(session)

    # ---- the music and its act -----------------------------------------------------------------

    async def _work(self, product: Product) -> tuple[str, Any]:
        from cornerroom.modules.music.domain.models import Release, Track

        if product.product_type == "RELEASE":
            row = await self.session.get(Release, product.subject_id)
            return "RELEASE", row
        if product.product_type == "TRACK":
            row = await self.session.get(Track, product.subject_id)
            return "TRACK", row
        raise AppError("GIFT_NOT_POSSIBLE", "Only a song or a release can be given as a gift", 409)

    async def _act_name(self, act_id: UUID) -> str:
        from cornerroom.modules.artists.domain.models import Artist

        row = await self.session.get(Artist, act_id)
        return row.stage_name if row is not None else "this artist"

    async def _title(self, gift: FanGift) -> str:
        from cornerroom.modules.music.domain.models import Release, Track

        row = await self.session.get(Release if gift.work_type == "RELEASE" else Track, gift.work_id)
        return row.title if row is not None else "the music"

    async def _person_name(self, user_id: UUID) -> str | None:
        from cornerroom.modules.identity.domain.models import CustomerProfile

        name = (
            await self.session.execute(
                select(CustomerProfile.display_name).where(
                    CustomerProfile.user_id == user_id, CustomerProfile.deleted_at.is_(None)
                )
            )
        ).scalars().first()
        return " ".join(str(name).split()) or None if name else None

    async def act_for_product(self, product: Product) -> UUID | None:
        _kind, row = await self._work(product)
        return act_of(getattr(row, "primary_artist_id", None), getattr(row, "primary_band_id", None)) if row else None

    async def _owns(self, user_id: UUID, gift: FanGift) -> bool:
        from cornerroom.modules.entitlements.application.service import EntitlementService

        ent = EntitlementService(self.session, clock=self.clock)
        if gift.work_type == "RELEASE":
            return await ent.find_active_release(user_id, gift.work_id) is not None
        return await ent.owns_by_purchase(user_id, gift.work_id)

    async def _verified_user(self, email: str):
        from cornerroom.modules.commerce.application.presales import PresaleService

        return await PresaleService(self.session, self.settings, self.clock)._verified_user_by_email(email)

    # ---- checkout ------------------------------------------------------------------------------

    async def checkout(
        self,
        ctx: AuthContext,
        *,
        offer_id: UUID,
        people: Any,
        note: Any,
        idempotency_key: str,
        chosen_amount_minor: int | None = None,
    ):
        """The giver's order: one line per person, paid like any order. Nothing about the people is
        looked up before paying (whether they have an account or own the music stays private)."""
        from cornerroom.modules.commerce.application.service import ORDER_PLACED_EVENT, CheckoutService
        from cornerroom.modules.commerce.domain.lifecycle import assert_sellable_type
        from cornerroom.modules.commerce.domain.open_price import amount_to_charge
        from cornerroom.modules.identity.domain.models import User

        checkout = CheckoutService(self.session, settings=self.settings, clock=self.clock)
        found = await checkout._existing_order(ctx, idempotency_key)
        if found is not None:
            return found
        offer = await self.session.get(Offer, offer_id)
        if offer is None or offer.deleted_at is not None or offer.status != "ACTIVE":
            raise NotFoundError("Offer not found")
        product = await self.session.get(Product, offer.product_id)
        if product is None or product.deleted_at is not None or product.status != "ACTIVE":
            raise NotFoundError("Offer not found")
        assert_sellable_type(product.product_type)
        if offer.audience != "EVERYONE":
            # Pre-orders and owners' prices aren't gifts (owner: pre-order gifts later, if wanted).
            raise AppError("GIFT_NOT_POSSIBLE", "This price can't be given as a gift", 409)
        kind, work = await self._work(product)
        if work is None or work.deleted_at is not None or work.status != "RELEASED":
            raise AppError("RELEASE_NOT_AVAILABLE", "Only music that is out can be given as a gift", 409)
        if kind == "TRACK":
            from cornerroom.modules.commerce.application.catalog import CatalogCommerceService

            await CatalogCommerceService(self.session).assert_track_sold_separately(work.id)
        act_id = act_of(work.primary_artist_id, work.primary_band_id)
        if act_id is None:
            raise AppError("GIFT_NOT_POSSIBLE", "This music can't be given as a gift", 409)
        giver = await self.session.get(User, ctx.user_id)
        try:
            people_rows = clean_people(
                people, giver_email=giver.email if giver else None, max_people=int(self.settings.fan_gift_max_people)
            )
            note_text = clean_note(note)
        except ValueError as exc:
            code = str(exc)
            raise AppError(code, PEOPLE_PROBLEMS.get(code, "Check the gift's details"), 422) from exc
        unit = amount_to_charge(
            lowest_minor=offer.amount_minor,
            open_price=bool(offer.open_price),
            chosen_minor=chosen_amount_minor,
            min_minor=int(self.settings.open_price_min_minor),
            max_minor=int(self.settings.open_price_max_minor),
        )
        if unit <= 0:
            raise AppError("GIFT_NOT_POSSIBLE", "Free music can't be given as a paid gift", 409)
        order = Order(
            user_id=ctx.user_id,
            status="PENDING_PAYMENT",
            total_amount_minor=unit * len(people_rows),
            currency_code=offer.currency_code,
            idempotency_key=idempotency_key,
            purpose="RELEASE" if kind == "RELEASE" else "TRACK",
            created_by=ctx.user_id,
            updated_by=ctx.user_id,
        )
        self.session.add(order)
        await self.session.flush()
        gift = FanGift(
            giver_user_id=ctx.user_id, order_id=order.id, organization_id=product.organization_id,
            product_id=product.id, work_type=kind, work_id=work.id, act_id=act_id, unit_amount_minor=unit,
            currency_code=offer.currency_code, note=note_text, note_state="WAITING" if note_text else "NONE",
            status="PENDING_PAYMENT",
        )
        self.session.add(gift)
        await self.session.flush()
        for person in people_rows:
            item = OrderItem(
                order_id=order.id, item_type=kind, ref_id=work.id, product_id=product.id, quantity=1,
                unit_amount_minor=unit, amount_minor=unit, currency_code=offer.currency_code,
            )
            self.session.add(item)
            await self.session.flush()
            self.session.add(
                FanGiftRecipient(gift_id=gift.id, order_item_id=item.id, email=person["email"], name=person["name"])
            )
        await self.session.flush()
        checkout._add_tax_line(order)
        payment = await checkout.payments.create_intent(ctx, order=order, idempotency_key=f"pay:{idempotency_key}")
        await checkout._emit(
            ctx,
            event_type=ORDER_PLACED_EVENT,
            aggregate_id=order.id,
            organization_id=product.organization_id,
            payload={
                "order_id": str(order.id), "offer_id": str(offer.id), "fan_gift_id": str(gift.id),
                "total_amount_minor": order.total_amount_minor, "currency_code": order.currency_code,
            },
        )
        await self.audit.record_from_auth(
            ctx, action="fan_gift.placed", entity_type="FanGift", entity_id=gift.id,
            new_state={"people": len(people_rows), "note": bool(note_text)}, organization_id=product.organization_id,
        )
        return order, payment

    async def gift_for_order(self, order_id: UUID) -> FanGift | None:
        return (await self.session.execute(select(FanGift).where(FanGift.order_id == order_id))).scalar_one_or_none()

    async def on_paid(self, gift: FanGift) -> UUID:
        """Called by fulfilment once the giver's payment is captured. Returns the gift's label."""
        if gift.status != "PENDING_PAYMENT":
            return gift.organization_id
        gift.paid_at = self.clock.now()
        if gift.note_state == "WAITING":
            gift.status = "WAITING_NOTE"
            await self.session.flush()
        else:
            await self._deliver(gift)
        return gift.organization_id

    # ---- delivery ------------------------------------------------------------------------------

    async def _recipients(self, gift_id: UUID) -> list[FanGiftRecipient]:
        return list(
            (
                await self.session.execute(
                    select(FanGiftRecipient).where(FanGiftRecipient.gift_id == gift_id).order_by(FanGiftRecipient.created_at)
                )
            ).scalars()
        )

    async def _deliver(self, gift: FanGift) -> None:
        for person in await self._recipients(gift.id):
            if person.status == "WAITING":
                await self._send_one(gift, person)
        gift.status = "DELIVERED"
        gift.delivered_at = self.clock.now()
        await self.session.flush()
        log.info("fan_gift_delivered", gift_id=str(gift.id))

    async def _give(self, gift: FanGift, person: FanGiftRecipient, user_id: UUID) -> None:
        from cornerroom.modules.entitlements.application.service import EntitlementService
        from cornerroom.modules.streaming.domain.models import LibraryItem

        scope = "RELEASE" if gift.work_type == "RELEASE" else "TRACK"
        await EntitlementService(self.session, clock=self.clock).grant(
            None, user_id=user_id, entitlement_type="PURCHASE", ref_id=gift.work_id, scope=scope,
            source_type="ORDER_ITEM", source_id=person.order_item_id, organization_id=gift.organization_id,
            actor_id=gift.giver_user_id,
        )
        item_type = "release" if scope == "RELEASE" else "track"
        exists = (
            await self.session.execute(
                select(LibraryItem.id).where(
                    LibraryItem.user_id == user_id, LibraryItem.item_type == item_type,
                    LibraryItem.item_id == gift.work_id, LibraryItem.kind == "PURCHASE_REF",
                )
            )
        ).first()
        if exists is None:
            self.session.add(
                LibraryItem(user_id=user_id, item_type=item_type, item_id=gift.work_id, kind="PURCHASE_REF", created_at=self.clock.now())
            )

    async def _settle(self, gift: FanGift, person: FanGiftRecipient, user_id: UUID) -> None:
        """A verified account: owns it now, or chooses because it already did."""
        person.user_id = user_id
        if await self._owns(user_id, gift):
            person.status = "CHOOSING"
        else:
            await self._give(gift, person, user_id)
            person.status = "GIVEN"
            person.resolved_at = self.clock.now()
        await self.session.flush()

    async def _send_one(self, gift: FanGift, person: FanGiftRecipient, *, passed_by: str | None = None) -> None:
        now = self.clock.now()
        token = secrets.token_urlsafe(32)
        person.token_hash = _hash(token)
        user = await self._verified_user(person.email)
        if user is not None:
            await self._settle(gift, person, user.id)
        else:
            person.status = "WAITING_ACCOUNT"
        person.emailed_at = now
        person.expires_at = expires_from(now, int(self.settings.fan_gift_claim_days)) if person.status in ("WAITING_ACCOUNT", "CHOOSING") else None
        await self.session.flush()
        await enqueue_outbox(
            self.session,
            DomainEvent(
                event_type=FAN_GIFT_SENT, producer="commerce", aggregate_type="FanGiftRecipient", aggregate_id=person.id,
                payload={"gift_id": str(gift.id), "token": token, "passed_by": passed_by},
                occurred_at=now, organization_id=gift.organization_id,
            ),
        )

    async def claim_for_user(self, user_id: UUID) -> int:
        """A verified account picks up every gift waiting for its email address."""
        from cornerroom.modules.identity.domain.models import User

        user = await self.session.get(User, user_id)
        if user is None or user.deleted_at is not None or not user.email:
            return 0
        if user.status != "ACTIVE" or user.email_verified_at is None:
            return 0
        now = self.clock.now()
        waiting = list(
            (
                await self.session.execute(
                    select(FanGiftRecipient)
                    .where(FanGiftRecipient.email == normalize_email(user.email), FanGiftRecipient.status == "WAITING_ACCOUNT")
                    .with_for_update(skip_locked=True)
                )
            ).scalars()
        )
        claimed = 0
        for person in waiting:
            if is_expired(person.status, person.expires_at, now):
                continue
            gift = await self.session.get(FanGift, person.gift_id)
            if gift is None or gift.status != "DELIVERED":
                continue
            await self._settle(gift, person, user.id)
            await self.audit.record(
                action="fan_gift.claimed", entity_type="FanGiftRecipient", entity_id=person.id,
                actor_id="system:fan-gift", actor_type="system", new_state={"status": person.status},
                organization_id=gift.organization_id,
            )
            claimed += 1
        return claimed

    # ---- credit --------------------------------------------------------------------------------

    async def balance(self, user_id: UUID, act_id: UUID, currency_code: str, *, lock: bool = False) -> int:
        stmt = select(GiftCredit.amount_minor).where(
            GiftCredit.user_id == user_id, GiftCredit.act_id == act_id, GiftCredit.currency_code == currency_code
        )
        if lock:
            stmt = stmt.with_for_update()
        return int(sum((await self.session.execute(stmt)).scalars().all()))

    async def _credit(self, user_id: UUID, gift: FanGift, person: FanGiftRecipient, reason: str) -> None:
        self.session.add(
            GiftCredit(
                user_id=user_id, act_id=gift.act_id, amount_minor=gift.unit_amount_minor,
                currency_code=gift.currency_code, reason=reason, fan_gift_recipient_id=person.id,
            )
        )
        await self.session.flush()

    async def _back_to_giver(self, gift: FanGift, person: FanGiftRecipient) -> None:
        reason = credit_back_reason(person.status)
        if reason is None:
            return
        await self._credit(gift.giver_user_id, gift, person, reason)
        await enqueue_outbox(
            self.session,
            DomainEvent(
                event_type=FAN_GIFT_RETURNED, producer="commerce", aggregate_type="FanGiftRecipient", aggregate_id=person.id,
                payload={"gift_id": str(gift.id), "status": person.status, "user_id": str(gift.giver_user_id)},
                occurred_at=self.clock.now(), organization_id=gift.organization_id,
            ),
        )

    async def spend(self, ctx: AuthContext, *, act_id: UUID, amount_minor: int, currency_code: str, order: Order) -> None:
        """Pay a whole order with the person's credit for that act (no partial payments)."""
        if await self.balance(ctx.user_id, act_id, currency_code, lock=True) < amount_minor:
            raise AppError("NOT_ENOUGH_CREDIT", "Your gift credit doesn't cover this", 409)
        self.session.add(
            GiftCredit(
                user_id=ctx.user_id, act_id=act_id, amount_minor=-amount_minor, currency_code=currency_code,
                reason="SPENT", order_id=order.id,
            )
        )
        await self.session.flush()

    async def credit_for_offer(self, ctx: AuthContext, offer_id: UUID) -> dict[str, Any]:
        offer = await self.session.get(Offer, offer_id)
        product = await self.session.get(Product, offer.product_id) if offer is not None else None
        if offer is None or product is None or offer.deleted_at is not None or offer.status != "ACTIVE":
            raise NotFoundError("Offer not found")
        act_id = await self.act_for_product(product) if product.product_type in ("TRACK", "RELEASE") else None
        if act_id is None or offer.audience == "PRESALE":
            return {"usable": False, "balance": None, "act_name": None}
        balance = await self.balance(ctx.user_id, act_id, offer.currency_code)
        if balance <= 0:
            return {"usable": False, "balance": None, "act_name": None}
        return {
            "usable": balance >= offer.amount_minor,
            "balance": {"amount_minor": balance, "currency_code": offer.currency_code},
            "act_name": await self._act_name(act_id),
        }

    async def my_credit(self, ctx: AuthContext) -> list[dict[str, Any]]:
        rows = (
            await self.session.execute(
                select(GiftCredit.act_id, GiftCredit.currency_code, func.sum(GiftCredit.amount_minor))
                .where(GiftCredit.user_id == ctx.user_id)
                .group_by(GiftCredit.act_id, GiftCredit.currency_code)
            )
        ).all()
        out = []
        for act_id, currency, total in rows:
            if int(total or 0) > 0:
                out.append({
                    "act_id": act_id, "act_name": await self._act_name(act_id),
                    "balance": {"amount_minor": int(total), "currency_code": currency},
                })
        return sorted(out, key=lambda r: r["act_name"].lower())

    async def _spend_on(self, user_id: UUID, act_id: UUID, currency_code: str) -> list[dict[str, Any]]:
        """The act's released music this credit pays for in full and the person doesn't own."""
        from cornerroom.modules.entitlements.application.service import EntitlementService
        from cornerroom.modules.music.domain.models import Release, Track

        balance = await self.balance(user_id, act_id, currency_code)
        if balance <= 0:
            return []
        ent = EntitlementService(self.session, clock=self.clock)
        rows = (
            await self.session.execute(
                select(Offer, Product)
                .join(Product, Product.id == Offer.product_id)
                .where(
                    Offer.status == "ACTIVE", Offer.deleted_at.is_(None), Offer.audience == "EVERYONE",
                    Offer.currency_code == currency_code, Offer.amount_minor <= balance,
                    Product.status == "ACTIVE", Product.deleted_at.is_(None), Product.product_type.in_(("TRACK", "RELEASE")),
                )
                .order_by(Offer.amount_minor.desc())
            )
        ).all()
        out = []
        for offer, product in rows:
            model = Release if product.product_type == "RELEASE" else Track
            work = await self.session.get(model, product.subject_id)
            if work is None or work.deleted_at is not None or work.status != "RELEASED":
                continue
            if act_of(work.primary_artist_id, work.primary_band_id) != act_id:
                continue
            owned = (
                await ent.find_active_release(user_id, work.id) is not None
                if product.product_type == "RELEASE"
                else await ent.owns_by_purchase(user_id, work.id)
            )
            if owned:
                continue
            out.append({
                "offer_id": offer.id, "kind": product.product_type, "subject_id": work.id, "title": work.title,
                "price": {"amount_minor": offer.amount_minor, "currency_code": offer.currency_code},
                "open_price": bool(offer.open_price),
            })
            if len(out) >= 24:
                break
        return out

    # ---- the gift page ---------------------------------------------------------------------------

    async def _by_token(self, token: str) -> tuple[FanGiftRecipient, FanGift]:
        person = (
            await self.session.execute(select(FanGiftRecipient).where(FanGiftRecipient.token_hash == _hash(token or "")))
        ).scalar_one_or_none()
        gift = await self.session.get(FanGift, person.gift_id) if person is not None else None
        if person is None or gift is None:
            raise NotFoundError("Gift not found")
        return person, gift

    async def _is_recipient(self, ctx: AuthContext | None, person: FanGiftRecipient) -> bool:
        if ctx is None or ctx.user_id is None:
            return False
        if person.user_id is not None:
            return person.user_id == ctx.user_id
        user = await self._verified_user(person.email)
        return user is not None and user.id == ctx.user_id

    async def open(self, ctx: AuthContext | None, token: str) -> dict[str, Any]:
        person, gift = await self._by_token(token)
        now = self.clock.now()
        if is_expired(person.status, person.expires_at, now):
            await self._expire(gift, person)
        mine = await self._is_recipient(ctx, person)
        if mine and person.status == "WAITING_ACCOUNT":
            await self._settle(gift, person, ctx.user_id)  # type: ignore[union-attr]
        giver = await self._person_name(gift.giver_user_id)
        passed_from = await self.session.get(FanGiftRecipient, person.passed_from_id) if person.passed_from_id else None
        out: dict[str, Any] = {
            "giver_name": giver,
            "passed_on_by": (passed_from.name or None) if passed_from else None,
            "work_type": gift.work_type,
            "work_id": gift.work_id,
            "title": await self._title(gift),
            "act_name": await self._act_name(gift.act_id),
            "note": gift.note if gift.note_state == "APPROVED" else None,
            "for_email": mask_email(person.email),
            "viewer": "RECIPIENT" if mine else ("SIGNED_IN" if ctx is not None and ctx.user_id else "SIGNED_OUT"),
            "status": person.status if mine else None,
            "expires_at": person.expires_at if mine and person.status in ("WAITING_ACCOUNT", "CHOOSING") else None,
            "amount": {"amount_minor": gift.unit_amount_minor, "currency_code": gift.currency_code} if mine else None,
            "credit": None,
            "spend_on": [],
        }
        if mine and person.status == "KEPT_CREDIT":
            out["credit"] = {"amount_minor": await self.balance(ctx.user_id, gift.act_id, gift.currency_code), "currency_code": gift.currency_code}  # type: ignore[union-attr]
            out["spend_on"] = await self._spend_on(ctx.user_id, gift.act_id, gift.currency_code)  # type: ignore[union-attr]
        return out

    async def choose(self, ctx: AuthContext, token: str, *, choice: str, email: Any = None, name: Any = None) -> dict[str, Any]:
        person, gift = await self._by_token(token)
        person = (
            await self.session.execute(select(FanGiftRecipient).where(FanGiftRecipient.id == person.id).with_for_update())
        ).scalar_one()
        if not await self._is_recipient(ctx, person):
            raise NotFoundError("Gift not found")
        if is_expired(person.status, person.expires_at, self.clock.now()):
            await self._expire(gift, person)
        if not may_choose(person.status, choice):
            raise AppError("GIFT_CHOSEN", "This gift has no choice to make now", 409)
        now = self.clock.now()
        if choice == "KEEP_CREDIT":
            person.status = "KEPT_CREDIT"
            await self._credit(ctx.user_id, gift, person, "GIFT_KEPT")
        elif choice == "DECLINE":
            person.status = "DECLINED"
            await self._back_to_giver(gift, person)
        else:
            from cornerroom.modules.identity.domain.models import User

            me = await self.session.get(User, ctx.user_id)
            try:
                rows = clean_people([{"email": email, "name": name}], giver_email=me.email if me else None, max_people=1)
            except ValueError as exc:
                code = str(exc)
                words = "Pass it on to someone else's email address" if code == "OWN_EMAIL" else PEOPLE_PROBLEMS.get(code, "Check the email address")
                raise AppError(code, words, 422) from exc
            person.status = "PASSED_ON"
            nxt = FanGiftRecipient(
                gift_id=gift.id, order_item_id=person.order_item_id, email=rows[0]["email"], name=rows[0]["name"],
                passed_from_id=person.id,
            )
            self.session.add(nxt)
            await self.session.flush()
            await self._send_one(gift, nxt, passed_by=await self._person_name(ctx.user_id))
        person.resolved_at = now
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx, action="fan_gift.chosen", entity_type="FanGiftRecipient", entity_id=person.id,
            new_state={"status": person.status}, organization_id=gift.organization_id,
        )
        return await self.open(ctx, token)

    # ---- not claimed ---------------------------------------------------------------------------

    async def _expire(self, gift: FanGift, person: FanGiftRecipient) -> None:
        if person.status not in ("WAITING_ACCOUNT", "CHOOSING"):
            return
        person.status = "EXPIRED"
        person.resolved_at = self.clock.now()
        await self.session.flush()
        await self._back_to_giver(gift, person)

    async def expire_due(self, *, batch: int = 200) -> int:
        now = self.clock.now()
        rows = list(
            (
                await self.session.execute(
                    select(FanGiftRecipient)
                    .where(
                        FanGiftRecipient.status.in_(("WAITING_ACCOUNT", "CHOOSING")),
                        FanGiftRecipient.expires_at.is_not(None),
                        FanGiftRecipient.expires_at <= now,
                    )
                    .limit(batch)
                    .with_for_update(skip_locked=True)
                )
            ).scalars()
        )
        for person in rows:
            gift = await self.session.get(FanGift, person.gift_id)
            if gift is not None:
                await self._expire(gift, person)
        return len(rows)

    # ---- the giver's list ----------------------------------------------------------------------

    async def mine(self, ctx: AuthContext) -> list[dict[str, Any]]:
        gifts = (
            await self.session.execute(
                select(FanGift).where(FanGift.giver_user_id == ctx.user_id).order_by(FanGift.created_at.desc()).limit(100)
            )
        ).scalars().all()
        out = []
        for gift in gifts:
            people = [
                {"email": p.email, "name": p.name, "state": giver_state(p.status)}
                for p in await self._recipients(gift.id)
                if p.passed_from_id is None
            ]
            out.append({
                "id": gift.id, "order_id": gift.order_id, "work_type": gift.work_type, "work_id": gift.work_id,
                "title": await self._title(gift), "act_name": await self._act_name(gift.act_id),
                "status": gift.status, "note_state": gift.note_state, "created_at": gift.created_at,
                "each": {"amount_minor": gift.unit_amount_minor, "currency_code": gift.currency_code},
                "people": people,
            })
        return out

    # ---- staff: the giver's note ---------------------------------------------------------------

    async def _staff_org(self, ctx: AuthContext) -> UUID:
        from cornerroom.modules.music.application.studio import StudioService

        return await StudioService(self.session, self.settings, self.clock)._require_staff_workspace(ctx, "music.approve")

    async def note_queue(self, ctx: AuthContext) -> list[dict[str, Any]]:
        org = await self._staff_org(ctx)
        gifts = (
            await self.session.execute(
                select(FanGift)
                .where(FanGift.organization_id == org, FanGift.status == "WAITING_NOTE", FanGift.note_state == "WAITING")
                .order_by(FanGift.paid_at)
            )
        ).scalars().all()
        return [
            {
                "id": g.id, "note": g.note, "title": await self._title(g), "act_name": await self._act_name(g.act_id),
                "giver_name": await self._person_name(g.giver_user_id), "people": len(await self._recipients(g.id)),
                "paid_at": g.paid_at,
            }
            for g in gifts
        ]

    async def review_note(self, ctx: AuthContext, gift_id: UUID, *, approve: bool) -> dict[str, Any]:
        org = await self._staff_org(ctx)
        gift = (await self.session.execute(select(FanGift).where(FanGift.id == gift_id).with_for_update())).scalar_one_or_none()
        if gift is None or gift.organization_id != org:
            raise NotFoundError("Gift not found")
        if gift.status != "WAITING_NOTE" or gift.note_state != "WAITING":
            raise AppError("NOTE_REVIEWED", "This note has already been checked", 409)
        gift.note_state = "APPROVED" if approve else "REMOVED"
        gift.note_reviewed_by = ctx.user_id
        gift.note_reviewed_at = self.clock.now()
        await self.session.flush()
        await self._deliver(gift)
        await self.audit.record_from_auth(
            ctx, action="fan_gift.note_reviewed", entity_type="FanGift", entity_id=gift.id,
            new_state={"note_state": gift.note_state}, organization_id=gift.organization_id,
        )
        return {"id": gift.id, "note_state": gift.note_state, "status": gift.status}


# ---- emails (outbox side consumer) ----------------------------------------------------------------

CLAIM_EVENTS = {USER_VERIFIED, USER_REGISTERED, USER_ACTIVATED}


def gift_email(
    *, giver: str | None, passed_by: str | None, title: str, act: str, note: str | None, status: str, link: str,
    claim_days: int,
) -> tuple[str, str]:
    who = giver or "Someone"
    subject = f"{who} sent you {title} by {act}"
    lines = [f"{who} bought {title} by {act} on Corner Room as a gift for you."]
    if passed_by:
        lines = [f"{passed_by} passed on a gift to you: {title} by {act}, first given by {who}."]
    if note:
        lines += ["", f"{who} wrote:", note]
    lines.append("")
    if status == "GIVEN":
        lines.append("It's in your library now. Open your gift to listen:")
    elif status == "CHOOSING":
        lines.append("Open your gift to see what you can do with it:")
    else:
        wait = f" The gift waits {claim_days} days." if claim_days > 0 else ""
        lines.append(f"Create your free Corner Room account with this email address to get it.{wait}")
    lines += [link, "", "You got this email because someone typed your address into a gift on Corner Room."]
    return subject, "\n".join(lines)


def returned_email(*, title: str, act: str, status: str, amount: str, link: str) -> tuple[str, str]:
    what = "wasn't claimed in time" if status == "EXPIRED" else "was declined"
    subject = f"Your gift of {title} {what}"
    body = "\n".join([
        f"One of the gifts you sent of {title} by {act} {what}.",
        f"{amount} is back with you as gift credit to spend on {act}'s music on Corner Room.",
        "",
        link,
    ])
    return subject, body


async def consume_fan_gift_event(event: DomainEvent, session: AsyncSession, settings: Settings | None = None) -> None:
    """Outbox side consumer: claim gifts on a newly verified account, and send gift emails."""
    settings = settings or get_settings()
    if event.event_type in CLAIM_EVENTS and event.aggregate_type == "User":
        await FanGiftService(session, settings).claim_for_user(event.aggregate_id)
        return
    if event.event_type not in (FAN_GIFT_SENT, FAN_GIFT_RETURNED):
        return
    from cornerroom.modules.commerce.application.payment_alerts import _amount
    from cornerroom.modules.identity.domain.models import User
    from cornerroom.modules.notifications.infra.email import email_sender_for

    svc = FanGiftService(session, settings)
    person = await session.get(FanGiftRecipient, event.aggregate_id)
    gift = await session.get(FanGift, person.gift_id) if person is not None else None
    if person is None or gift is None:
        return
    base = settings.web_base_url.rstrip("/")
    title, act = await svc._title(gift), await svc._act_name(gift.act_id)
    payload = event.payload or {}
    if event.event_type == FAN_GIFT_SENT:
        to = person.email
        subject, body = gift_email(
            giver=await svc._person_name(gift.giver_user_id), passed_by=payload.get("passed_by"), title=title, act=act,
            note=gift.note if gift.note_state == "APPROVED" else None, status=person.status,
            link=f"{base}/gift/{payload.get('token')}", claim_days=int(settings.fan_gift_claim_days),
        )
    else:
        giver = await session.get(User, gift.giver_user_id)
        if giver is None or not giver.email:
            return
        to = giver.email
        amount = _amount(gift.unit_amount_minor, gift.currency_code)
        subject, body = returned_email(title=title, act=act, status=str(payload.get("status")), amount=amount, link=f"{base}/account/gifts")
    sender = email_sender_for(settings)
    if sender is None:
        log.warning("fan_gift_email_skipped", reason="no_email_provider", event_id=str(event.event_id))
        return
    # A failed send raises, so the outbox retries the event.
    await sender.send(to=to, subject=subject, body=body)
    log.info("fan_gift_email_sent", kind=event.event_type, to=mask_email(to))
