"""Payouts against Phase 10 Settlement. Dual control. No self-approve."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.exc import StaleDataError

from cornerroom.infra.errors import AppError, ConflictError, ForbiddenError, NotFoundError
from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import DomainEvent, PAYOUT_COMPLETED, PAYOUT_FAILED, SETTLEMENT_COMPLETED
from cornerroom.kernel.money import Money
from cornerroom.kernel.payout import PayoutProvider
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.authorization.application.service import AuthorizationService
from cornerroom.modules.finance.application.ledger import LedgerLineInput, LedgerService
from cornerroom.modules.finance.application.sandbox_payout import SandboxPayoutProvider
from cornerroom.modules.finance.domain.coa import CODE_PSP_CLEARING, CODE_ROYALTY_LIABILITY
from cornerroom.modules.finance.domain.lifecycle import (
    finance_settlement_transition_action,
    payout_transition_action,
)
from cornerroom.modules.finance.domain.models import (
    FinanceConfig,
    PayeeCompliance,
    Payout,
    PayoutMethod,
)
from cornerroom.modules.finance.domain.payout_gates import (
    PayeeComplianceView,
    PayoutConfigView,
    approvals_complete,
    assert_distinct_second,
    assert_no_self_approve,
    require_compliance,
    require_minimum,
    require_payout_config,
)
from cornerroom.modules.royalties.domain.models import Settlement


class PayoutService:
    def __init__(
        self,
        session: AsyncSession,
        clock: Clock | None = None,
        provider: PayoutProvider | None = None,
    ) -> None:
        self.session = session
        self.clock = clock or SystemClock()
        self.audit = AuditService(session)
        self.authz = AuthorizationService(session, clock=self.clock)
        self.ledger = LedgerService(session, clock=self.clock)
        self.provider = provider or SandboxPayoutProvider()

    def _workspace(self, ctx: AuthContext) -> UUID:
        if ctx.organization_id is None:
            raise AppError("WORKSPACE_REQUIRED", "Active organization workspace is required", 409)
        return ctx.organization_id

    async def _staff(self, ctx: AuthContext, permission: str, org_id: UUID) -> None:
        try:
            await self.authz.authorize(
                ctx.user_id,
                permission,
                resource_type="organization",
                resource_id=org_id,
                scope_organization_id=org_id,
            )
        except ForbiddenError as exc:
            raise NotFoundError("Not found") from exc

    async def _config(self, organization_id: UUID) -> PayoutConfigView:
        rows = list(
            (
                await self.session.execute(
                    select(FinanceConfig).where(FinanceConfig.organization_id == organization_id)
                )
            ).scalars()
        )
        by_key = {row.key: row for row in rows}
        second = by_key.get("payout_second_approver_threshold_minor")
        minimum = by_key.get("payout_minimum_threshold_minor")
        schedule = by_key.get("payout_schedule")
        return PayoutConfigView(
            second_approver_threshold_minor=second.int_value if second else None,
            minimum_threshold_minor=minimum.int_value if minimum else None,
            schedule=schedule.text_value if schedule else None,
        )

    async def _compliance(self, organization_id: UUID, payee_type: str, payee_id: UUID) -> PayeeComplianceView | None:
        row = (
            await self.session.execute(
                select(PayeeCompliance).where(
                    PayeeCompliance.organization_id == organization_id,
                    PayeeCompliance.payee_type == payee_type,
                    PayeeCompliance.payee_id == payee_id,
                )
            )
        ).scalar_one_or_none()
        if row is None:
            return None
        return PayeeComplianceView(kyc_present=row.kyc_present, tax_record_present=row.tax_record_present)

    async def initiate(
        self,
        ctx: AuthContext,
        *,
        settlement_id: UUID,
        payout_method_id: UUID,
        idempotency_key: str,
    ) -> Payout:
        org_id = self._workspace(ctx)
        await self._staff(ctx, "finance.payout_approve", org_id)
        existing = (
            await self.session.execute(select(Payout).where(Payout.idempotency_key == idempotency_key))
        ).scalar_one_or_none()
        if existing is not None:
            return existing
        settlement = await self.session.get(Settlement, settlement_id)
        if settlement is None:
            raise NotFoundError("Settlement not found")
        if settlement.status != "APPROVED":
            raise AppError("INVALID_TRANSITION", "Payout requires an APPROVED settlement", 409)
        money = Money(settlement.amount_minor, settlement.currency_code)
        config = await self._config(org_id)
        require_payout_config(config)
        require_minimum(money.amount_minor, config)
        require_compliance(await self._compliance(org_id, settlement.payee_type, settlement.payee_id))
        method = await self.session.get(PayoutMethod, payout_method_id)
        if method is None or method.status != "ACTIVE" or method.organization_id != org_id:
            raise NotFoundError("Payout method not found")
        if method.payee_type != settlement.payee_type or method.payee_id != settlement.payee_id:
            raise AppError("PAYOUT_METHOD_MISMATCH", "Payout method does not belong to this payee", 409)
        row = Payout(
            organization_id=org_id,
            settlement_id=settlement.id,
            status="PENDING",
            amount_minor=money.amount_minor,
            currency_code=money.currency_code,
            provider=self.provider.name,
            payout_method_id=method.id,
            initiated_by=ctx.user_id,
            idempotency_key=idempotency_key,
            created_by=ctx.user_id,
            updated_by=ctx.user_id,
        )
        self.session.add(row)
        try:
            await self.session.flush()
        except IntegrityError as exc:
            current = (
                await self.session.execute(select(Payout).where(Payout.idempotency_key == idempotency_key))
            ).scalar_one_or_none()
            if current is not None:
                return current
            raise ConflictError("Duplicate payout") from exc
        await self.audit.record_from_auth(
            ctx,
            action="payout.initiated",
            entity_type="Payout",
            entity_id=row.id,
            new_state={"status": row.status, "amount_minor": row.amount_minor},
            organization_id=org_id,
        )
        return row

    async def approve(self, ctx: AuthContext, payout_id: UUID) -> Payout:
        org_id = self._workspace(ctx)
        await self._staff(ctx, "finance.payout_approve", org_id)
        row = await self.session.get(Payout, payout_id)
        if row is None or row.organization_id != org_id:
            raise NotFoundError("Payout not found")
        if row.status != "PENDING":
            return row
        config = await self._config(org_id)
        require_payout_config(config)
        if row.approved_by is None:
            assert_no_self_approve(actor_id=ctx.user_id, initiator_id=row.initiated_by)
            row.approved_by = ctx.user_id
        elif row.second_approved_by is None:
            assert_distinct_second(
                actor_id=ctx.user_id,
                first_approver_id=row.approved_by,
                initiator_id=row.initiated_by,
            )
            row.second_approved_by = ctx.user_id
        else:
            return row
        row.updated_by = ctx.user_id
        try:
            await self.session.flush()
        except StaleDataError as exc:
            raise ConflictError("The payout was updated concurrently") from exc
        await self.audit.record_from_auth(
            ctx,
            action="payout.approved",
            entity_type="Payout",
            entity_id=row.id,
            new_state={
                "approved_by": str(row.approved_by) if row.approved_by else None,
                "second_approved_by": str(row.second_approved_by) if row.second_approved_by else None,
            },
            organization_id=org_id,
        )
        return row

    async def process_sandbox(self, ctx: AuthContext, payout_id: UUID) -> Payout:
        org_id = self._workspace(ctx)
        await self._staff(ctx, "finance.payout_approve", org_id)
        row = await self.session.get(Payout, payout_id)
        if row is None or row.organization_id != org_id:
            raise NotFoundError("Payout not found")
        if row.status == "PAID":
            return row
        config = await self._config(org_id)
        if not approvals_complete(
            amount_minor=row.amount_minor,
            config=config,
            approved_by=row.approved_by,
            second_approved_by=row.second_approved_by,
        ):
            raise AppError("PAYOUT_APPROVALS_INCOMPLETE", "Required payout approvals are missing", 409)
        if row.settlement_id is None:
            raise AppError("SETTLEMENT_REQUIRED", "Payout has no settlement", 409)
        settlement = await self.session.get(Settlement, row.settlement_id)
        if settlement is None:
            raise NotFoundError("Settlement not found")
        require_compliance(await self._compliance(org_id, settlement.payee_type, settlement.payee_id))
        method = await self.session.get(PayoutMethod, row.payout_method_id) if row.payout_method_id else None
        if method is None:
            raise NotFoundError("Payout method not found")
        payout_transition_action(row.status, "PROCESSING")
        finance_settlement_transition_action(settlement.status, "PROCESSING")
        row.status = "PROCESSING"
        settlement.status = "PROCESSING"
        result = self.provider.instruct(
            payout_id=row.id,
            amount_minor=row.amount_minor,
            currency_code=row.currency_code,
            method_token_ref=method.token_ref,
        )
        row.provider = result.provider
        row.provider_ref = result.provider_ref
        if not result.accepted:
            payout_transition_action(row.status, "FAILED")
            finance_settlement_transition_action(settlement.status, "FAILED")
            row.status = "FAILED"
            settlement.status = "FAILED"
            await self.session.flush()
            await self._emit(ctx, PAYOUT_FAILED, row.id, org_id, {"payout_id": str(row.id)})
            return row
        journal = await self.ledger.post(
            ctx,
            organization_id=org_id,
            journal_type="SETTLEMENT_PAYOUT",
            source_module="FINANCE",
            source_type="PAYOUT",
            source_id=row.id,
            currency_code=row.currency_code,
            idempotency_key=f"payout-paid:{row.id}",
            lines=[
                LedgerLineInput(
                    CODE_ROYALTY_LIABILITY,
                    "DEBIT",
                    row.amount_minor,
                    payee_type=settlement.payee_type,
                    payee_id=settlement.payee_id,
                ),
                LedgerLineInput(CODE_PSP_CLEARING, "CREDIT", row.amount_minor),
            ],
        )
        payout_transition_action("PROCESSING", "PAID")
        finance_settlement_transition_action("PROCESSING", "PAID")
        finance_settlement_transition_action("PAID", "COMPLETED")
        row.status = "PAID"
        row.transaction_id = journal.id
        settlement.status = "COMPLETED"
        row.updated_by = ctx.user_id
        await self.session.flush()
        await self._emit(
            ctx,
            PAYOUT_COMPLETED,
            row.id,
            org_id,
            {"payout_id": str(row.id), "settlement_id": str(settlement.id), "amount_minor": row.amount_minor},
        )
        await self._emit(
            ctx,
            SETTLEMENT_COMPLETED,
            settlement.id,
            org_id,
            {"settlement_id": str(settlement.id), "payout_id": str(row.id)},
            aggregate_type="Settlement",
        )
        await self.audit.record_from_auth(
            ctx,
            action="payout.paid",
            entity_type="Payout",
            entity_id=row.id,
            new_state={"status": row.status},
            organization_id=org_id,
        )
        return row

    async def list_payouts(self, ctx: AuthContext) -> list[Payout]:
        org_id = self._workspace(ctx)
        await self._staff(ctx, "finance.read", org_id)
        return list(
            (
                await self.session.execute(
                    select(Payout).where(Payout.organization_id == org_id).order_by(Payout.created_at.desc())
                )
            ).scalars()
        )

    async def _emit(
        self,
        ctx: AuthContext | None,
        event_type: str,
        aggregate_id: UUID,
        organization_id: UUID,
        payload: dict[str, Any],
        aggregate_type: str = "Payout",
    ) -> None:
        event = DomainEvent(
            event_type=event_type,
            producer="finance",
            aggregate_type=aggregate_type,
            aggregate_id=aggregate_id,
            payload=payload,
            occurred_at=self.clock.now(),
            actor_id=ctx.user_id if ctx else None,
            organization_id=organization_id,
            correlation_id=ctx.request_id if ctx else None,
        )
        await enqueue_outbox(self.session, event)
