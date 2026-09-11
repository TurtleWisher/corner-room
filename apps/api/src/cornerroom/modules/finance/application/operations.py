"""Expenses, invoices, adjustments, reconciliation, config. No invented rates."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, ConflictError, ForbiddenError, NotFoundError
from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import ADJUSTMENT_POSTED, DomainEvent, EXPENSE_RECOGNIZED, INVOICE_ISSUED
from cornerroom.kernel.money import Money
from cornerroom.kernel.pagination import clamp_limit, decode_cursor, encode_cursor
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.authorization.application.service import AuthorizationService
from cornerroom.modules.finance.application.ledger import LedgerLineInput, LedgerService
from cornerroom.modules.finance.domain.coa import CODE_AP, CODE_AR, CODE_EXPENSE
from cornerroom.modules.finance.domain.lifecycle import (
    expense_transition_action,
    invoice_transition_action,
)
from cornerroom.modules.finance.domain.models import (
    Adjustment,
    Expense,
    ExpenseCategory,
    FinanceConfig,
    FinanceTransaction,
    Invoice,
    InvoiceLine,
    LedgerAccount,
    LedgerEntry,
    PayeeCompliance,
    PayoutMethod,
    ReconciliationItem,
    Revenue,
)
from cornerroom.modules.finance.domain.payout_gates import PayeeComplianceView, PayoutConfigView


class FinanceOpsService:
    def __init__(self, session: AsyncSession, clock: Clock | None = None) -> None:
        self.session = session
        self.clock = clock or SystemClock()
        self.audit = AuditService(session)
        self.authz = AuthorizationService(session, clock=self.clock)
        self.ledger = LedgerService(session, clock=self.clock)

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

    async def list_ledger(
        self,
        ctx: AuthContext,
        *,
        cursor: str | None = None,
        limit: int = 50,
    ) -> tuple[list[FinanceTransaction], str | None]:
        org_id = self._workspace(ctx)
        await self._staff(ctx, "finance.read", org_id)
        stmt = (
            select(FinanceTransaction)
            .where(FinanceTransaction.organization_id == org_id)
            .order_by(FinanceTransaction.occurred_at.desc(), FinanceTransaction.id.desc())
        )
        if cursor:
            data = decode_cursor(cursor)
            stmt = stmt.where(FinanceTransaction.occurred_at < data["t"])
        size = clamp_limit(limit)
        rows = list((await self.session.execute(stmt.limit(size + 1))).scalars().all())
        next_cursor = None
        if len(rows) > size:
            last = rows[size - 1]
            next_cursor = encode_cursor(last.occurred_at.isoformat(), last.id)
            rows = rows[:size]
        return rows, next_cursor

    async def event_pnl(self, ctx: AuthContext, event_id: UUID) -> dict[str, Any]:
        org_id = self._workspace(ctx)
        await self._staff(ctx, "finance.read", org_id)
        rev = (
            await self.session.execute(
                select(func.coalesce(func.sum(Revenue.amount_minor), 0)).where(
                    Revenue.organization_id == org_id,
                    Revenue.event_id == event_id,
                    Revenue.status == "RECOGNIZED",
                )
            )
        ).scalar_one()
        exp = (
            await self.session.execute(
                select(func.coalesce(func.sum(Expense.amount_minor), 0)).where(
                    Expense.organization_id == org_id,
                    Expense.event_id == event_id,
                    Expense.status == "RECOGNIZED",
                )
            )
        ).scalar_one()
        return {
            "event_id": str(event_id),
            "revenue_minor": int(rev),
            "expense_minor": int(exp),
            "net_minor": int(rev) - int(exp),
        }

    async def create_expense(
        self,
        ctx: AuthContext,
        *,
        category: str,
        amount_minor: int,
        currency_code: str,
        source_type: str,
        source_id: UUID,
        event_id: UUID | None = None,
        campaign_id: UUID | None = None,
    ) -> Expense:
        org_id = self._workspace(ctx)
        await self._staff(ctx, "finance.post", org_id)
        return await self._insert_draft_expense(
            ctx,
            organization_id=org_id,
            category=category,
            amount_minor=amount_minor,
            currency_code=currency_code,
            source_type=source_type,
            source_id=source_id,
            event_id=event_id,
            campaign_id=campaign_id,
        )

    async def create_campaign_expense_draft(
        self,
        ctx: AuthContext,
        *,
        campaign_id: UUID,
        category: str,
        amount_minor: int,
        currency_code: str,
        source_id: UUID,
    ) -> Expense:
        """DRAFT only. Caller is Campaigns (campaign.write). Does not post ledger."""
        org_id = self._workspace(ctx)
        return await self._insert_draft_expense(
            ctx,
            organization_id=org_id,
            category=category,
            amount_minor=amount_minor,
            currency_code=currency_code,
            source_type="CAMPAIGN_EXPENSE_REQUEST",
            source_id=source_id,
            campaign_id=campaign_id,
        )

    async def _insert_draft_expense(
        self,
        ctx: AuthContext,
        *,
        organization_id: UUID,
        category: str,
        amount_minor: int,
        currency_code: str,
        source_type: str,
        source_id: UUID,
        event_id: UUID | None = None,
        campaign_id: UUID | None = None,
    ) -> Expense:
        cat = (
            await self.session.execute(
                select(ExpenseCategory).where(
                    ExpenseCategory.organization_id == organization_id,
                    ExpenseCategory.code == category,
                    ExpenseCategory.status == "ACTIVE",
                )
            )
        ).scalar_one_or_none()
        if cat is None:
            raise AppError(
                "EXPENSE_CATEGORY_REQUIRED",
                "Expense category is not configured",
                409,
                "Categories are data. Do not invent an expense type in code.",
            )
        money = Money(amount_minor, currency_code)
        row = Expense(
            organization_id=organization_id,
            status="DRAFT",
            category=category,
            source_type=source_type,
            source_id=source_id,
            amount_minor=money.amount_minor,
            currency_code=money.currency_code,
            event_id=event_id,
            campaign_id=campaign_id,
            created_by=ctx.user_id,
            updated_by=ctx.user_id,
        )
        self.session.add(row)
        try:
            await self.session.flush()
        except IntegrityError as exc:
            raise ConflictError("Duplicate expense recognition key") from exc
        await self.audit.record_from_auth(
            ctx,
            action="expense.drafted",
            entity_type="Expense",
            entity_id=row.id,
            new_state={
                "status": row.status,
                "amount_minor": row.amount_minor,
                "campaign_id": str(campaign_id) if campaign_id else None,
            },
            organization_id=organization_id,
        )
        return row

    async def committed_campaign_spend(
        self,
        organization_id: UUID,
        campaign_id: UUID,
    ) -> tuple[int, str | None]:
        rows = list(
            (
                await self.session.execute(
                    select(Expense).where(
                        Expense.organization_id == organization_id,
                        Expense.campaign_id == campaign_id,
                        Expense.status.in_(("DRAFT", "APPROVED", "RECOGNIZED")),
                    )
                )
            ).scalars()
        )
        if not rows:
            return 0, None
        currencies = {row.currency_code for row in rows}
        if len(currencies) > 1:
            raise AppError(
                "CURRENCY_MISMATCH",
                "Campaign expenses mix currencies",
                409,
            )
        return sum(row.amount_minor for row in rows), next(iter(currencies))

    async def list_campaign_expenses(self, organization_id: UUID, campaign_id: UUID) -> list[Expense]:
        rows = (
            await self.session.execute(
                select(Expense)
                .where(
                    Expense.organization_id == organization_id,
                    Expense.campaign_id == campaign_id,
                )
                .order_by(Expense.created_at.asc(), Expense.id.asc())
            )
        ).scalars().all()
        return list(rows)

    async def approve_expense(self, ctx: AuthContext, expense_id: UUID) -> Expense:
        org_id = self._workspace(ctx)
        await self._staff(ctx, "finance.post", org_id)
        row = await self.session.get(Expense, expense_id)
        if row is None or row.organization_id != org_id:
            raise NotFoundError("Expense not found")
        expense_transition_action(row.status, "APPROVED")
        row.status = "APPROVED"
        row.approved_by = ctx.user_id
        row.updated_by = ctx.user_id
        await self.session.flush()
        return row

    async def recognize_expense(self, ctx: AuthContext, expense_id: UUID) -> Expense:
        org_id = self._workspace(ctx)
        await self._staff(ctx, "finance.post", org_id)
        row = await self.session.get(Expense, expense_id)
        if row is None or row.organization_id != org_id:
            raise NotFoundError("Expense not found")
        expense_transition_action(row.status, "RECOGNIZED")
        cat = (
            await self.session.execute(
                select(ExpenseCategory).where(
                    ExpenseCategory.organization_id == org_id,
                    ExpenseCategory.code == row.category,
                )
            )
        ).scalar_one_or_none()
        account_code = cat.account_code if cat else CODE_EXPENSE
        source_module = "CAMPAIGNS" if row.campaign_id is not None else "FINANCE"
        journal = await self.ledger.post(
            ctx,
            organization_id=org_id,
            journal_type="EXPENSE",
            source_module=source_module,
            source_type="EXPENSE",
            source_id=row.id,
            currency_code=row.currency_code,
            idempotency_key=f"expense:{row.id}",
            lines=[
                LedgerLineInput(
                    account_code,
                    "DEBIT",
                    row.amount_minor,
                    event_id=row.event_id,
                    campaign_id=row.campaign_id,
                ),
                LedgerLineInput(
                    CODE_AP,
                    "CREDIT",
                    row.amount_minor,
                    event_id=row.event_id,
                    campaign_id=row.campaign_id,
                ),
            ],
        )
        row.status = "RECOGNIZED"
        row.recognized_at = self.clock.now()
        row.transaction_id = journal.id
        row.updated_by = ctx.user_id
        await self.session.flush()
        await self._emit(
            ctx,
            EXPENSE_RECOGNIZED,
            row.id,
            org_id,
            {"amount_minor": row.amount_minor, "category": row.category},
            aggregate_type="Expense",
        )
        await self.audit.record_from_auth(
            ctx,
            action="expense.recognized",
            entity_type="Expense",
            entity_id=row.id,
            new_state={"status": row.status},
            organization_id=org_id,
        )
        return row

    async def post_adjustment(
        self,
        ctx: AuthContext,
        *,
        reason_code: str,
        amount_minor: int,
        currency_code: str,
        target_type: str,
        target_id: UUID,
        debit_account_code: str,
        credit_account_code: str,
        idempotency_key: str,
    ) -> Adjustment:
        org_id = self._workspace(ctx)
        await self._staff(ctx, "finance.post", org_id)
        existing = (
            await self.session.execute(
                select(Adjustment).where(Adjustment.idempotency_key == idempotency_key)
            )
        ).scalar_one_or_none()
        if existing is not None:
            return existing
        money = Money(amount_minor, currency_code)
        journal = await self.ledger.post(
            ctx,
            organization_id=org_id,
            journal_type="ADJUSTMENT",
            source_module="FINANCE",
            source_type=target_type,
            source_id=target_id,
            currency_code=money.currency_code,
            idempotency_key=f"adj:{idempotency_key}",
            lines=[
                LedgerLineInput(debit_account_code, "DEBIT", money.amount_minor),
                LedgerLineInput(credit_account_code, "CREDIT", money.amount_minor),
            ],
        )
        row = Adjustment(
            organization_id=org_id,
            status="POSTED",
            reason_code=reason_code,
            amount_minor=money.amount_minor,
            currency_code=money.currency_code,
            target_type=target_type,
            target_id=target_id,
            transaction_id=journal.id,
            idempotency_key=idempotency_key,
            created_by=ctx.user_id,
            updated_by=ctx.user_id,
        )
        self.session.add(row)
        await self.session.flush()
        await self._emit(
            ctx,
            ADJUSTMENT_POSTED,
            row.id,
            org_id,
            {"reason_code": reason_code, "amount_minor": money.amount_minor},
            aggregate_type="Adjustment",
        )
        await self.audit.record_from_auth(
            ctx,
            action="adjustment.posted",
            entity_type="Adjustment",
            entity_id=row.id,
            new_state={"status": row.status, "reason_code": reason_code},
            organization_id=org_id,
        )
        return row

    async def create_invoice(
        self,
        ctx: AuthContext,
        *,
        direction: str,
        counterparty_type: str,
        counterparty_id: UUID,
        currency_code: str,
        lines: list[tuple[str, int]],
    ) -> Invoice:
        org_id = self._workspace(ctx)
        await self._staff(ctx, "finance.post", org_id)
        if direction not in {"AR", "AP"}:
            raise AppError("VALIDATION_ERROR", "Invoice direction must be AR or AP", 422)
        total = sum(amount for _, amount in lines)
        money = Money(total, currency_code)
        invoice = Invoice(
            organization_id=org_id,
            direction=direction,
            counterparty_type=counterparty_type,
            counterparty_id=counterparty_id,
            status="DRAFT",
            total_amount_minor=money.amount_minor,
            currency_code=money.currency_code,
            created_by=ctx.user_id,
            updated_by=ctx.user_id,
        )
        self.session.add(invoice)
        await self.session.flush()
        for description, amount in lines:
            self.session.add(
                InvoiceLine(invoice_id=invoice.id, description=description, amount_minor=amount)
            )
        await self.session.flush()
        return invoice

    async def issue_invoice(self, ctx: AuthContext, invoice_id: UUID) -> Invoice:
        org_id = self._workspace(ctx)
        await self._staff(ctx, "finance.post", org_id)
        invoice = await self.session.get(Invoice, invoice_id)
        if invoice is None or invoice.organization_id != org_id:
            raise NotFoundError("Invoice not found")
        invoice_transition_action(invoice.status, "ISSUED")
        from cornerroom.modules.finance.domain.coa import CODE_SPONSORSHIP_REVENUE

        if invoice.direction == "AR":
            debit, credit = CODE_AR, CODE_SPONSORSHIP_REVENUE
        else:
            debit, credit = CODE_EXPENSE, CODE_AP
        journal = await self.ledger.post(
            ctx,
            organization_id=org_id,
            journal_type="OTHER_INCOME" if invoice.direction == "AR" else "EXPENSE",
            source_module="FINANCE",
            source_type="INVOICE",
            source_id=invoice.id,
            currency_code=invoice.currency_code,
            idempotency_key=f"invoice-issue:{invoice.id}",
            lines=[
                LedgerLineInput(debit, "DEBIT", invoice.total_amount_minor),
                LedgerLineInput(credit, "CREDIT", invoice.total_amount_minor),
            ],
        )
        invoice.status = "ISSUED"
        invoice.issued_at = self.clock.now()
        invoice.transaction_id = journal.id
        invoice.updated_by = ctx.user_id
        await self.session.flush()
        await self._emit(
            ctx,
            INVOICE_ISSUED,
            invoice.id,
            org_id,
            {"direction": invoice.direction, "amount_minor": invoice.total_amount_minor},
            aggregate_type="Invoice",
        )
        return invoice

    async def record_mismatch(
        self,
        ctx: AuthContext | None,
        *,
        organization_id: UUID,
        expected_amount_minor: int,
        actual_amount_minor: int | None,
        currency_code: str,
        provider_ref: str | None,
        payment_id: UUID | None,
        idempotency_key: str,
        notes: str | None = None,
    ) -> ReconciliationItem:
        existing = (
            await self.session.execute(
                select(ReconciliationItem).where(ReconciliationItem.idempotency_key == idempotency_key)
            )
        ).scalar_one_or_none()
        if existing is not None:
            return existing
        status = "UNRECONCILED"
        if actual_amount_minor is not None:
            status = "MATCHED" if actual_amount_minor == expected_amount_minor else "MISMATCH"
        row = ReconciliationItem(
            organization_id=organization_id,
            status=status,
            expected_amount_minor=expected_amount_minor,
            actual_amount_minor=actual_amount_minor,
            currency_code=currency_code,
            provider_ref=provider_ref,
            payment_id=payment_id,
            notes=notes,
            idempotency_key=idempotency_key,
            created_by=ctx.user_id if ctx else None,
            updated_by=ctx.user_id if ctx else None,
        )
        self.session.add(row)
        try:
            await self.session.flush()
        except IntegrityError:
            current = (
                await self.session.execute(
                    select(ReconciliationItem).where(ReconciliationItem.idempotency_key == idempotency_key)
                )
            ).scalar_one_or_none()
            if current is not None:
                return current
            raise
        return row

    async def list_reconciliations(self, ctx: AuthContext) -> list[ReconciliationItem]:
        org_id = self._workspace(ctx)
        await self._staff(ctx, "finance.read", org_id)
        return list(
            (
                await self.session.execute(
                    select(ReconciliationItem)
                    .where(ReconciliationItem.organization_id == org_id)
                    .order_by(ReconciliationItem.created_at.desc())
                )
            ).scalars()
        )

    async def upsert_config(
        self,
        ctx: AuthContext,
        key: str,
        *,
        int_value: int | None = None,
        text_value: str | None = None,
    ) -> FinanceConfig:
        org_id = self._workspace(ctx)
        await self._staff(ctx, "finance.post", org_id)
        allowed = {
            "tax_rate_bps",
            "payout_second_approver_threshold_minor",
            "payout_minimum_threshold_minor",
            "payout_schedule",
        }
        if key not in allowed:
            raise AppError("VALIDATION_ERROR", "Unknown finance_config key", 422)
        row = (
            await self.session.execute(
                select(FinanceConfig).where(
                    FinanceConfig.organization_id == org_id,
                    FinanceConfig.key == key,
                )
            )
        ).scalar_one_or_none()
        if row is None:
            row = FinanceConfig(
                organization_id=org_id,
                key=key,
                created_by=ctx.user_id,
                updated_by=ctx.user_id,
            )
            self.session.add(row)
        row.int_value = int_value
        row.text_value = text_value
        row.updated_by = ctx.user_id
        await self.session.flush()
        return row

    async def upsert_compliance(
        self,
        ctx: AuthContext,
        *,
        payee_type: str,
        payee_id: UUID,
        kyc_present: bool,
        tax_record_present: bool,
    ) -> PayeeCompliance:
        org_id = self._workspace(ctx)
        await self._staff(ctx, "finance.post", org_id)
        row = (
            await self.session.execute(
                select(PayeeCompliance).where(
                    PayeeCompliance.organization_id == org_id,
                    PayeeCompliance.payee_type == payee_type,
                    PayeeCompliance.payee_id == payee_id,
                )
            )
        ).scalar_one_or_none()
        if row is None:
            row = PayeeCompliance(
                organization_id=org_id,
                payee_type=payee_type,
                payee_id=payee_id,
                created_by=ctx.user_id,
            )
            self.session.add(row)
        row.kyc_present = kyc_present
        row.tax_record_present = tax_record_present
        row.updated_by = ctx.user_id
        await self.session.flush()
        return row

    async def create_payout_method(
        self,
        ctx: AuthContext,
        *,
        payee_type: str,
        payee_id: UUID,
        token_ref: str,
    ) -> PayoutMethod:
        org_id = self._workspace(ctx)
        await self._staff(ctx, "finance.post", org_id)
        row = PayoutMethod(
            payee_type=payee_type,
            payee_id=payee_id,
            organization_id=org_id,
            provider="SANDBOX",
            token_ref=token_ref,
            status="ACTIVE",
            created_by=ctx.user_id,
            updated_by=ctx.user_id,
        )
        self.session.add(row)
        await self.session.flush()
        return row

    async def create_expense_category(self, ctx: AuthContext, code: str, name: str) -> ExpenseCategory:
        org_id = self._workspace(ctx)
        await self._staff(ctx, "finance.post", org_id)
        row = ExpenseCategory(
            organization_id=org_id,
            code=code,
            name=name,
            account_code=CODE_EXPENSE,
            status="ACTIVE",
            created_by=ctx.user_id,
            updated_by=ctx.user_id,
        )
        self.session.add(row)
        try:
            await self.session.flush()
        except IntegrityError as exc:
            raise ConflictError("Expense category already exists") from exc
        return row

    async def list_accounts(self, ctx: AuthContext) -> list[LedgerAccount]:
        org_id = self._workspace(ctx)
        await self._staff(ctx, "finance.read", org_id)
        await self.ledger.ensure_provisional_coa(org_id, ctx.user_id)
        return list(
            (
                await self.session.execute(
                    select(LedgerAccount).where(LedgerAccount.organization_id == org_id)
                )
            ).scalars()
        )

    async def journal_lines(self, ctx: AuthContext, transaction_id: UUID) -> list[LedgerEntry]:
        org_id = self._workspace(ctx)
        await self._staff(ctx, "finance.read", org_id)
        header = await self.session.get(FinanceTransaction, transaction_id)
        if header is None or header.organization_id != org_id:
            raise NotFoundError("Journal not found")
        return list(
            (
                await self.session.execute(
                    select(LedgerEntry).where(LedgerEntry.transaction_id == header.id)
                )
            ).scalars()
        )

    async def payout_config_view(self, organization_id: UUID) -> PayoutConfigView:
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

    async def compliance_view(
        self, organization_id: UUID, payee_type: str, payee_id: UUID
    ) -> PayeeComplianceView | None:
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

    async def _emit(
        self,
        ctx: AuthContext | None,
        event_type: str,
        aggregate_id: UUID,
        organization_id: UUID,
        payload: dict[str, Any],
        aggregate_type: str,
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
