"""Payment application service. Capture is never a checkout boolean."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, NotFoundError
from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.infra.settings import Settings, get_settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import DomainEvent, PAYMENT_CAPTURED, PAYMENT_FAILED, REFUND_COMPLETED, REFUND_REQUESTED
from cornerroom.kernel.money import Money
from cornerroom.kernel.payment import PaymentCallback, PaymentProvider
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.commerce.domain.models import Order
from cornerroom.modules.finance.application.sandbox import SandboxPaymentProvider
from cornerroom.modules.finance.domain.models import Payment, PaymentAttempt, Refund
from cornerroom.modules.ticketing.domain.models import RefundPolicy

PAYMENT_CAPTURED_EVENT = PAYMENT_CAPTURED
PAYMENT_FAILED_EVENT = PAYMENT_FAILED


class PaymentService:
    def __init__(
        self,
        session: AsyncSession,
        settings: Settings | None = None,
        clock: Clock | None = None,
        provider: PaymentProvider | None = None,
    ) -> None:
        self.session = session
        self.settings = settings or get_settings()
        self.clock = clock or SystemClock()
        self.audit = AuditService(session)
        self.provider = provider or SandboxPaymentProvider()

    def webhook_secret(self) -> str:
        return self.settings.sandbox_payment_secret or self.settings.jwt_secret

    async def _emit(
        self,
        ctx: AuthContext | None,
        *,
        event_type: str,
        aggregate_id: UUID,
        payload: dict[str, Any],
        actor_id: UUID | None = None,
    ) -> None:
        domain = DomainEvent(
            event_type=event_type,
            producer="finance",
            aggregate_type="Payment",
            aggregate_id=aggregate_id,
            payload=payload,
            occurred_at=self.clock.now(),
            actor_id=actor_id or (ctx.user_id if ctx else None),
            correlation_id=ctx.request_id if ctx else None,
        )
        await enqueue_outbox(self.session, domain)

    async def create_intent(
        self,
        ctx: AuthContext,
        *,
        order: Order,
        idempotency_key: str,
    ) -> Payment:
        existing = (
            await self.session.execute(select(Payment).where(Payment.idempotency_key == idempotency_key))
        ).scalar_one_or_none()
        if existing is not None:
            return existing
        money = Money(amount_minor=order.total_amount_minor, currency_code=order.currency_code)
        payment = Payment(
            order_id=order.id,
            user_id=order.user_id,
            status="CREATED",
            amount_minor=money.amount_minor,
            currency_code=money.currency_code,
            provider=self.provider.name,
            idempotency_key=idempotency_key,
            created_by=ctx.user_id,
            updated_by=ctx.user_id,
        )
        self.session.add(payment)
        await self.session.flush()
        intent = self.provider.create_intent(
            payment_id=payment.id,
            amount_minor=payment.amount_minor,
            currency_code=payment.currency_code,
        )
        payment.provider = intent.provider
        payment.provider_ref = intent.provider_ref
        payment.status = intent.next_status
        attempt = PaymentAttempt(payment_id=payment.id, status="STARTED", raw_status=intent.next_status)
        self.session.add(attempt)
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx,
            action="payment.intent_created",
            entity_type="Payment",
            entity_id=payment.id,
            new_state={"status": payment.status, "amount_minor": payment.amount_minor},
        )
        return payment

    async def get_payment(self, payment_id: UUID) -> Payment:
        row = await self.session.get(Payment, payment_id)
        if row is None:
            raise NotFoundError("Payment not found")
        return row

    def parse_callback(self, payload: dict[str, object], signature: str | None) -> PaymentCallback:
        return self.provider.parse_callback(payload, signature=signature, secret=self.webhook_secret())

    async def apply_callback(self, callback: PaymentCallback) -> Payment:
        payment = await self.get_payment(callback.payment_id)
        if callback.amount_minor != payment.amount_minor or callback.currency_code != payment.currency_code:
            payment.status = "FAILED"
            await self._record_amount_mismatch(payment, callback)
            await self._emit(
                None,
                event_type=PAYMENT_FAILED,
                aggregate_id=payment.id,
                payload={
                    "payment_id": str(payment.id),
                    "reason": "amount_mismatch",
                },
            )
            raise AppError(
                "PAYMENT_AMOUNT_MISMATCH",
                "Payment amount does not match",
                409,
                "Webhook amount must match the Payment. No fulfill.",
            )
        existing_attempt = (
            await self.session.execute(
                select(PaymentAttempt).where(PaymentAttempt.provider_event_id == callback.provider_event_id)
            )
        ).scalar_one_or_none()
        if existing_attempt is not None:
            return payment
        if payment.status == "CAPTURED":
            return payment
        attempt = PaymentAttempt(
            payment_id=payment.id,
            status="SUCCEEDED" if callback.captured else "FAILED",
            provider_event_id=callback.provider_event_id,
            raw_status="CAPTURED" if callback.captured else "FAILED",
        )
        self.session.add(attempt)
        try:
            await self.session.flush()
        except IntegrityError:
            current = await self.get_payment(payment.id)
            return current
        if not callback.captured:
            payment.status = "FAILED"
            await self._emit(
                None,
                event_type=PAYMENT_FAILED,
                aggregate_id=payment.id,
                payload={"payment_id": str(payment.id)},
            )
            return payment
        payment.status = "CAPTURED"
        await self._emit(
            None,
            event_type=PAYMENT_CAPTURED,
            aggregate_id=payment.id,
            payload={
                "payment_id": str(payment.id),
                "order_id": str(payment.order_id) if payment.order_id else None,
                "amount_minor": payment.amount_minor,
                "currency_code": payment.currency_code,
            },
        )
        await self.audit.record(
            action="payment.captured",
            entity_type="Payment",
            entity_id=payment.id,
            actor_id="system:payments",
            actor_type="system",
            new_state={"status": "CAPTURED"},
        )
        from cornerroom.modules.finance.application.recognition import RecognitionService

        await RecognitionService(self.session, clock=self.clock).ingest_captured_payment(None, payment)
        return payment

    async def sandbox_confirm(self, ctx: AuthContext, payment_id: UUID) -> Payment:
        """Owner-authenticated sandbox capture. Same pipeline as a signed callback. Not checkout."""
        payment = await self.get_payment(payment_id)
        if payment.user_id != ctx.user_id:
            raise NotFoundError("Payment not found")
        if payment.provider != "sandbox":
            raise AppError("PAYMENT_PROVIDER_UNSUPPORTED", "Sandbox confirm is only for the sandbox adapter", 409)
        if payment.status == "CAPTURED":
            return payment
        if payment.status not in {"CREATED", "REQUIRES_ACTION", "AUTHORIZED"}:
            raise AppError("INVALID_TRANSITION", "Payment cannot be captured", 409)
        callback = PaymentCallback(
            payment_id=payment.id,
            amount_minor=payment.amount_minor,
            currency_code=payment.currency_code,
            provider_event_id=f"sandbox:{payment.id}",
            captured=True,
        )
        return await self.apply_callback(callback)

    async def remaining_refundable(self, payment: Payment) -> int:
        rows = list(
            (
                await self.session.execute(
                    select(Refund).where(
                        Refund.payment_id == payment.id,
                        Refund.status == "COMPLETED",
                    )
                )
            ).scalars()
        )
        spent = sum(row.amount_minor for row in rows)
        remaining = payment.amount_minor - spent
        return remaining if remaining > 0 else 0

    async def _policy_for(self, reason_code: str, *, scope_id: UUID | None) -> RefundPolicy | None:
        stmt = select(RefundPolicy).where(RefundPolicy.reason_code == reason_code)
        rows = list((await self.session.execute(stmt)).scalars())
        for row in rows:
            if scope_id is not None and row.scope_id == scope_id:
                return row
        for row in rows:
            if row.scope_type == "PLATFORM" and row.scope_id is None:
                return row
        return None

    async def request_refund(
        self,
        ctx: AuthContext,
        *,
        payment_id: UUID,
        amount_minor: int,
        reason_code: str,
        idempotency_key: str,
        scope_id: UUID | None = None,
    ) -> Refund:
        existing = (
            await self.session.execute(select(Refund).where(Refund.idempotency_key == idempotency_key))
        ).scalar_one_or_none()
        if existing is not None:
            return existing
        payment = await self.get_payment(payment_id)
        if payment.user_id != ctx.user_id:
            # Staff with finance.post may request for any captured payment.
            await self.audit.record_from_auth(
                ctx,
                action="refund.authorize_staff",
                entity_type="Payment",
                entity_id=payment.id,
                new_state={"reason_code": reason_code},
            )
            from cornerroom.modules.authorization.application.service import AuthorizationService

            authz = AuthorizationService(self.session, clock=self.clock)
            await authz.authorize(ctx.user_id, "finance.post")
        if payment.status != "CAPTURED":
            raise AppError("INVALID_TRANSITION", "Only captured payments can be refunded", 409)
        money = Money(amount_minor=amount_minor, currency_code=payment.currency_code)
        remaining = await self.remaining_refundable(payment)
        if money.amount_minor <= 0 or money.amount_minor > remaining:
            raise AppError(
                "REFUND_AMOUNT_INVALID",
                "Refund amount exceeds remaining refundable",
                409,
                "Do not invent a refund percentage (Q-P9-06)",
            )
        policy = await self._policy_for(reason_code, scope_id=scope_id)
        if policy is None:
            raise AppError(
                "REFUND_POLICY_REQUIRED",
                "No refund policy row matches this reason",
                409,
                "Refund eligibility is data, not a coded percentage (Q-P0-05)",
            )
        status = "REQUESTED" if policy.requires_finance_approve else "APPROVED"
        row = Refund(
            payment_id=payment.id,
            status=status,
            amount_minor=money.amount_minor,
            currency_code=payment.currency_code,
            reason_code=reason_code,
            policy_id=policy.id,
            idempotency_key=idempotency_key,
            created_by=ctx.user_id,
            updated_by=ctx.user_id,
        )
        self.session.add(row)
        await self.session.flush()
        await self._emit(
            ctx,
            event_type=REFUND_REQUESTED,
            aggregate_id=row.id,
            payload={
                "refund_id": str(row.id),
                "payment_id": str(payment.id),
                "amount_minor": row.amount_minor,
                "status": row.status,
            },
            actor_id=ctx.user_id,
        )
        await self.audit.record_from_auth(
            ctx,
            action="refund.requested",
            entity_type="Refund",
            entity_id=row.id,
            new_state={"status": row.status, "amount_minor": row.amount_minor},
        )
        return row

    async def approve_refund(self, ctx: AuthContext, refund_id: UUID) -> Refund:
        from cornerroom.modules.authorization.application.service import AuthorizationService

        authz = AuthorizationService(self.session, clock=self.clock)
        await authz.authorize(ctx.user_id, "finance.post")
        row = await self.session.get(Refund, refund_id)
        if row is None:
            raise NotFoundError("Refund not found")
        if row.status in {"APPROVED", "PROCESSING", "COMPLETED"}:
            return row
        if row.status != "REQUESTED":
            raise AppError("INVALID_TRANSITION", "Refund cannot be approved", 409)
        row.status = "APPROVED"
        row.approved_by = ctx.user_id
        row.updated_by = ctx.user_id
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx,
            action="refund.approved",
            entity_type="Refund",
            entity_id=row.id,
            new_state={"status": row.status},
        )
        return row

    async def complete_sandbox_refund(self, ctx: AuthContext, refund_id: UUID) -> Refund:
        """Marks COMPLETED in-process. Not a production PSP payout."""
        from cornerroom.modules.authorization.application.service import AuthorizationService

        authz = AuthorizationService(self.session, clock=self.clock)
        await authz.authorize(ctx.user_id, "finance.post")
        row = await self.session.get(Refund, refund_id)
        if row is None:
            raise NotFoundError("Refund not found")
        if row.status == "COMPLETED":
            return row
        if row.status not in {"APPROVED", "PROCESSING"}:
            raise AppError("INVALID_TRANSITION", "Refund is not approved", 409)
        payment = await self.get_payment(row.payment_id)
        if payment.provider != "sandbox":
            raise AppError(
                "PAYMENT_PROVIDER_UNSUPPORTED",
                "Sandbox complete is only for the sandbox adapter",
                409,
            )
        # Never mutate the original payment amount.
        if payment.status != "CAPTURED":
            raise AppError("INVALID_TRANSITION", "Payment must remain CAPTURED", 409)
        row.status = "COMPLETED"
        row.updated_by = ctx.user_id
        await self.session.flush()
        await self._emit(
            ctx,
            event_type=REFUND_COMPLETED,
            aggregate_id=row.id,
            payload={
                "refund_id": str(row.id),
                "payment_id": str(payment.id),
                "amount_minor": row.amount_minor,
                "currency_code": row.currency_code,
            },
            actor_id=ctx.user_id,
        )
        await self.audit.record_from_auth(
            ctx,
            action="refund.completed",
            entity_type="Refund",
            entity_id=row.id,
            new_state={"status": row.status, "payment_status": payment.status},
        )
        from cornerroom.modules.finance.application.recognition import RecognitionService

        await RecognitionService(self.session, clock=self.clock).reverse_refund(ctx, row)
        return row

    async def get_refund(self, refund_id: UUID) -> Refund:
        row = await self.session.get(Refund, refund_id)
        if row is None:
            raise NotFoundError("Refund not found")
        return row

    async def _record_amount_mismatch(self, payment: Payment, callback: PaymentCallback) -> None:
        from cornerroom.modules.finance.application.operations import FinanceOpsService
        from cornerroom.modules.finance.application.recognition import RecognitionService

        rec = RecognitionService(self.session, clock=self.clock)
        org_id = None
        if payment.order_id is not None:
            from cornerroom.modules.commerce.domain.models import Order

            order = await self.session.get(Order, payment.order_id)
            if order is not None and order.purpose == "TICKET":
                _event_id, org_id = await rec._event_for_ticket_order(order)
        if org_id is None:
            return
        ops = FinanceOpsService(self.session, clock=self.clock)
        await ops.record_mismatch(
            None,
            organization_id=org_id,
            expected_amount_minor=payment.amount_minor,
            actual_amount_minor=callback.amount_minor,
            currency_code=payment.currency_code,
            provider_ref=callback.provider_event_id,
            payment_id=payment.id,
            idempotency_key=f"mismatch:{callback.provider_event_id}",
            notes="Webhook amount does not match Payment. Visible mismatch; not auto-fixed.",
        )
