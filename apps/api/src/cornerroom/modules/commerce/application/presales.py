"""Pre-sales: sales made before Corner Room existed (owner, 2026-10-25, D-PRESALE-01).

About 90 people paid for the MIZULS single before launch. Finance staff list them per product
(email, name, amount, date paid). Nothing is created for them up front: when a listed email becomes
a verified Corner Room account, `claim_for_user` turns each waiting pre-sale into a normal order
and a captured payment (provider event `presale:<id>`) and fulfils it through the usual checkout
pipeline. So the buyer owns the song (streaming and offline saving) and the sale counts in the
artist's sales, finance and royalties from then on, alongside sales made on Corner Room.

Claims run from the outbox (`consume_presale_event`: UserVerified, and UserRegistered for accounts
that start verified, such as Continue with Google), and once at upload for buyers who already have
a verified account. Every step is idempotent: a pre-sale is claimed once, by its own email only.
"""

from __future__ import annotations

from datetime import date
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, ForbiddenError, NotFoundError
from cornerroom.infra.settings import Settings, get_settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import DomainEvent, USER_ACTIVATED, USER_REGISTERED, USER_VERIFIED
from cornerroom.kernel.money import Money
from cornerroom.kernel.payment import PaymentCallback
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.authorization.application.service import AuthorizationService
from cornerroom.modules.commerce.domain.lifecycle import assert_sellable_type
from cornerroom.modules.commerce.domain.models import Order, OrderItem, PresaleClaim, Product
from cornerroom.modules.identity.domain.models import User

log = structlog.get_logger("commerce.presales")

# Technical limits for one upload (not business rules).
MAX_ROWS_PER_UPLOAD = 500
MAX_NAME_LENGTH = 200


def normalize_email(email: str) -> str:
    return (email or "").strip().lower()


class PresaleService:
    def __init__(self, session: AsyncSession, settings: Settings | None = None, clock: Clock | None = None) -> None:
        self.session = session
        self.settings = settings or get_settings()
        self.clock = clock or SystemClock()
        self.audit = AuditService(session)

    # --- staff ---------------------------------------------------------------------------------

    async def _product_for_staff(self, ctx: AuthContext, product_id: UUID) -> Product:
        """The product, if this staff member may record money for its label (finance.post there).
        Anything else is 404, never 403 (Q-SEC-03)."""
        product = await self.session.get(Product, product_id)
        if product is None or product.deleted_at is not None or product.organization_id is None:
            raise NotFoundError("Product not found")
        try:
            await AuthorizationService(self.session, clock=self.clock).authorize(
                ctx.user_id,
                "finance.post",
                resource_type="organization",
                resource_id=product.organization_id,
                scope_organization_id=product.organization_id,
            )
        except ForbiddenError as exc:
            raise NotFoundError("Product not found") from exc
        if product.product_type not in {"TRACK", "RELEASE"}:
            raise AppError("VALIDATION_ERROR", "Pre-sales are for a song or a release", 422, extras={"field": "product_id"})
        assert_sellable_type(product.product_type)
        return product

    async def upload(self, ctx: AuthContext, *, product_id: UUID, rows: list[dict[str, Any]]) -> dict[str, Any]:
        """Add buyers to a product's pre-sale list. Rows already listed for this product are skipped
        (reported back), so the same file can be uploaded again safely. Buyers who already have a
        verified account are claimed at once."""
        product = await self._product_for_staff(ctx, product_id)
        if not rows:
            raise AppError("VALIDATION_ERROR", "The list is empty", 422, extras={"field": "rows"})
        if len(rows) > MAX_ROWS_PER_UPLOAD:
            raise AppError("VALIDATION_ERROR", f"Upload at most {MAX_ROWS_PER_UPLOAD} buyers at a time", 422, extras={"field": "rows"})
        existing = set(
            (
                await self.session.execute(
                    select(PresaleClaim.email).where(PresaleClaim.product_id == product.id, PresaleClaim.status != "CANCELLED")
                )
            ).scalars()
        )
        added: list[PresaleClaim] = []
        skipped: list[str] = []
        seen: set[str] = set()
        for row in rows:
            email = normalize_email(str(row.get("email") or ""))
            if email in existing or email in seen:
                skipped.append(email)
                continue
            seen.add(email)
            money = Money(amount_minor=int(row["amount_minor"]), currency_code=str(row.get("currency_code") or "BDT").upper())
            name = " ".join(str(row.get("buyer_name") or "").split())[:MAX_NAME_LENGTH] or None
            paid_on = row.get("paid_on")
            claim = PresaleClaim(
                organization_id=product.organization_id,
                product_id=product.id,
                email=email,
                buyer_name=name,
                amount_minor=money.amount_minor,
                currency_code=money.currency_code,
                paid_on=paid_on if isinstance(paid_on, date) else None,
                status="WAITING",
                created_by=ctx.user_id,
                updated_by=ctx.user_id,
            )
            self.session.add(claim)
            added.append(claim)
        await self.session.flush()
        # Audit the fact, not the people: counts and totals only (names and emails stay in the table).
        await self.audit.record_from_auth(
            ctx,
            action="presale.list_uploaded",
            entity_type="Product",
            entity_id=product.id,
            new_state={"added": len(added), "skipped": len(skipped), "amount_minor": sum(c.amount_minor for c in added)},
            organization_id=product.organization_id,
        )
        claimed = 0
        for claim in added:
            user = await self._verified_user_by_email(claim.email)
            if user is not None and await self._claim(claim, user):
                claimed += 1
        return {"added": len(added), "skipped": skipped, "claimed_now": claimed}

    async def list_for_product(self, ctx: AuthContext, product_id: UUID) -> dict[str, Any]:
        product = await self._product_for_staff(ctx, product_id)
        rows = list(
            (
                await self.session.execute(
                    select(PresaleClaim)
                    .where(PresaleClaim.product_id == product.id)
                    .order_by(PresaleClaim.created_at, PresaleClaim.email)
                )
            ).scalars()
        )
        totals: dict[str, dict[str, int]] = {}
        for row in rows:
            if row.status == "CANCELLED":
                continue
            bucket = totals.setdefault(row.currency_code, {"buyers": 0, "claimed": 0, "amount_minor": 0, "claimed_amount_minor": 0})
            bucket["buyers"] += 1
            bucket["amount_minor"] += row.amount_minor
            if row.status == "CLAIMED":
                bucket["claimed"] += 1
                bucket["claimed_amount_minor"] += row.amount_minor
        return {"product_id": product.id, "items": rows, "totals": totals}

    async def cancel(self, ctx: AuthContext, presale_id: UUID) -> PresaleClaim:
        """Take a mistaken row off the list. A claimed pre-sale is a real sale: it goes through a
        refund like any other order, never through this."""
        row = await self.session.get(PresaleClaim, presale_id)
        if row is None:
            raise NotFoundError("Pre-sale not found")
        await self._product_for_staff(ctx, row.product_id)
        if row.status != "WAITING":
            raise AppError("INVALID_TRANSITION", "Only a pre-sale that is still waiting can be removed", 409)
        row.status = "CANCELLED"
        row.updated_by = ctx.user_id
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx,
            action="presale.cancelled",
            entity_type="PresaleClaim",
            entity_id=row.id,
            previous_state={"status": "WAITING"},
            new_state={"status": "CANCELLED"},
            organization_id=row.organization_id,
        )
        return row

    # --- claiming ------------------------------------------------------------------------------

    async def _verified_user_by_email(self, email: str) -> User | None:
        user = (
            await self.session.execute(
                select(User).where(func.lower(User.email) == email, User.deleted_at.is_(None))
            )
        ).scalar_one_or_none()
        if user is None or user.status != "ACTIVE" or user.email_verified_at is None:
            return None
        return user

    async def claim_for_user(self, user_id: UUID) -> int:
        """Claim every waiting pre-sale listed under this account's email, once it is verified."""
        user = await self.session.get(User, user_id)
        if user is None or user.deleted_at is not None or not user.email:
            return 0
        if user.status != "ACTIVE" or user.email_verified_at is None:
            return 0
        waiting = list(
            (
                await self.session.execute(
                    select(PresaleClaim)
                    .where(PresaleClaim.email == normalize_email(user.email), PresaleClaim.status == "WAITING")
                    .with_for_update(skip_locked=True)
                )
            ).scalars()
        )
        claimed = 0
        for claim in waiting:
            if await self._claim(claim, user):
                claimed += 1
        return claimed

    async def _claim(self, claim: PresaleClaim, user: User) -> bool:
        """One pre-sale -> order + captured payment + fulfilment, through the normal pipeline."""
        from cornerroom.modules.commerce.application.service import CheckoutService

        if claim.status != "WAITING":
            return False
        product = await self.session.get(Product, claim.product_id)
        if product is None or product.deleted_at is not None:
            log.warning("presale_product_missing", presale_id=str(claim.id))
            return False
        checkout = CheckoutService(self.session, settings=self.settings, clock=self.clock)
        ctx = AuthContext(user_id=user.id, request_id=f"presale:{claim.id}", actor_type="system")
        key = f"presale:{claim.id}"
        is_release = product.product_type == "RELEASE"
        order = Order(
            user_id=user.id,
            status="PENDING_PAYMENT",
            total_amount_minor=claim.amount_minor,
            currency_code=claim.currency_code,
            idempotency_key=key,
            purpose="RELEASE" if is_release else "TRACK",
            created_by=user.id,
            updated_by=user.id,
        )
        self.session.add(order)
        await self.session.flush()
        self.session.add(
            OrderItem(
                order_id=order.id,
                item_type="RELEASE" if is_release else "TRACK",
                ref_id=product.subject_id,
                product_id=product.id,
                quantity=1,
                unit_amount_minor=claim.amount_minor,
                amount_minor=claim.amount_minor,
                currency_code=claim.currency_code,
            )
        )
        await self.session.flush()
        checkout._add_tax_line(order)
        payment = await checkout.payments.create_intent(ctx, order=order, idempotency_key=f"pay:{key}")
        payment = await checkout.payments.apply_callback(
            PaymentCallback(
                payment_id=payment.id,
                amount_minor=claim.amount_minor,
                currency_code=claim.currency_code,
                provider_event_id=key,
                captured=True,
            )
        )
        order = await checkout.fulfill_captured_payment(ctx, payment)
        claim.status = "CLAIMED"
        claim.claimed_user_id = user.id
        claim.order_id = order.id
        claim.claimed_at = self.clock.now()
        await self.session.flush()
        await self.audit.record(
            action="presale.claimed",
            entity_type="PresaleClaim",
            entity_id=claim.id,
            actor_id="system:presale",
            actor_type="system",
            request_id=key,
            previous_state={"status": "WAITING"},
            new_state={"status": "CLAIMED", "order_id": str(order.id), "paid_on": claim.paid_on.isoformat() if claim.paid_on else None},
            organization_id=claim.organization_id,
        )
        log.info("presale_claimed", presale_id=str(claim.id), order_id=str(order.id))
        return True


CLAIM_EVENTS = {USER_VERIFIED, USER_REGISTERED, USER_ACTIVATED}


async def consume_presale_event(event: DomainEvent, session: AsyncSession) -> None:
    """Outbox side consumer: a verified account may have pre-sales waiting under its email."""
    if event.event_type not in CLAIM_EVENTS or event.aggregate_type != "User":
        return
    await PresaleService(session).claim_for_user(event.aggregate_id)
