"""Finance HTTP API. Thin — rules live in Finance application services."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel, Field

from cornerroom.api.deps import (
    finance_ops_service,
    get_auth_context,
    payout_service,
    recognition_service,
)
from cornerroom.infra.errors import AppError
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.finance.application.operations import FinanceOpsService
from cornerroom.modules.finance.application.payout import PayoutService
from cornerroom.modules.finance.application.recognition import RecognitionService
from cornerroom.modules.finance.domain.models import (
    FinanceTransaction,
    Payout,
)

router = APIRouter(tags=["finance"])


class JournalOut(BaseModel):
    id: UUID
    type: str
    status: str
    source_module: str
    source_type: str
    amount_minor: int | None = None
    currency_code: str
    occurred_at: datetime
    organization_id: UUID


class JournalPage(BaseModel):
    items: list[JournalOut]
    next_cursor: str | None


class AccountOut(BaseModel):
    id: UUID
    code: str
    name: str
    type: str
    provisional: bool
    status: str


class PnLOut(BaseModel):
    event_id: str
    revenue_minor: int
    expense_minor: int
    net_minor: int


class PeriodRecognizeIn(BaseModel):
    period_id: UUID


class RevenueOut(BaseModel):
    id: UUID
    status: str
    category: str
    amount_minor: int
    currency_code: str


class ExpenseCreate(BaseModel):
    category: str
    amount_minor: int = Field(ge=0)
    currency_code: str = Field(min_length=3, max_length=3)
    source_type: str
    source_id: UUID
    event_id: UUID | None = None
    campaign_id: UUID | None = None


class ExpenseOut(BaseModel):
    id: UUID
    status: str
    category: str
    amount_minor: int
    currency_code: str
    campaign_id: UUID | None = None


class ExpenseCategoryCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=120)


class ExpenseCategoryOut(BaseModel):
    id: UUID
    code: str
    name: str
    status: str


class AdjustmentCreate(BaseModel):
    reason_code: str
    amount_minor: int = Field(gt=0)
    currency_code: str = Field(min_length=3, max_length=3)
    target_type: str
    target_id: UUID
    debit_account_code: str
    credit_account_code: str


class AdjustmentOut(BaseModel):
    id: UUID
    status: str
    reason_code: str
    amount_minor: int
    currency_code: str


class InvoiceLineIn(BaseModel):
    description: str
    amount_minor: int = Field(ge=0)


class InvoiceCreate(BaseModel):
    direction: str
    counterparty_type: str
    counterparty_id: UUID
    currency_code: str = Field(min_length=3, max_length=3)
    lines: list[InvoiceLineIn]


class InvoiceOut(BaseModel):
    id: UUID
    direction: str
    status: str
    total_amount_minor: int
    currency_code: str


class PayoutCreate(BaseModel):
    settlement_id: UUID
    payout_method_id: UUID


class PayoutOut(BaseModel):
    id: UUID
    settlement_id: UUID | None
    status: str
    amount_minor: int
    currency_code: str
    provider: str
    approved_by: UUID | None
    second_approved_by: UUID | None


class ConfigIn(BaseModel):
    key: str
    int_value: int | None = None
    text_value: str | None = None


class ConfigOut(BaseModel):
    id: UUID
    key: str
    int_value: int | None
    text_value: str | None


class ComplianceIn(BaseModel):
    payee_type: str
    payee_id: UUID
    kyc_present: bool
    tax_record_present: bool


class ComplianceOut(BaseModel):
    id: UUID
    payee_type: str
    payee_id: UUID
    kyc_present: bool
    tax_record_present: bool


class PayoutMethodCreate(BaseModel):
    payee_type: str
    payee_id: UUID
    token_ref: str


class PayoutMethodOut(BaseModel):
    id: UUID
    payee_type: str
    payee_id: UUID
    provider: str
    status: str


class ReconciliationOut(BaseModel):
    id: UUID
    status: str
    expected_amount_minor: int
    actual_amount_minor: int | None
    currency_code: str
    notes: str | None


def _journal_out(row: FinanceTransaction) -> JournalOut:
    return JournalOut(
        id=row.id,
        type=row.type,
        status=row.status,
        source_module=row.source_module,
        source_type=row.source_type,
        currency_code=row.currency_code,
        occurred_at=row.occurred_at,
        organization_id=row.organization_id,
    )


@router.get("/ledger", response_model=JournalPage)
async def list_ledger(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    ops: Annotated[FinanceOpsService, Depends(finance_ops_service)],
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
) -> JournalPage:
    rows, next_cursor = await ops.list_ledger(ctx, cursor=cursor, limit=limit)
    return JournalPage(items=[_journal_out(row) for row in rows], next_cursor=next_cursor)


@router.get("/ledger/accounts", response_model=list[AccountOut])
async def list_accounts(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    ops: Annotated[FinanceOpsService, Depends(finance_ops_service)],
) -> list[AccountOut]:
    return [
        AccountOut(
            id=row.id,
            code=row.code,
            name=row.name,
            type=row.type,
            provisional=row.provisional,
            status=row.status,
        )
        for row in await ops.list_accounts(ctx)
    ]


@router.get("/reports/pnl", response_model=PnLOut)
async def event_pnl(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    ops: Annotated[FinanceOpsService, Depends(finance_ops_service)],
    event_id: UUID = Query(...),
) -> PnLOut:
    data = await ops.event_pnl(ctx, event_id)
    return PnLOut(**data)


@router.post("/revenues/recognize", response_model=RevenueOut)
async def recognize_period(
    body: PeriodRecognizeIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    recognition: Annotated[RecognitionService, Depends(recognition_service)],
) -> RevenueOut:
    if ctx.organization_id is None:
        raise AppError("WORKSPACE_REQUIRED", "Active organization workspace is required", 409)
    row = await recognition.recognize_subscription_period(
        ctx, body.period_id, organization_id=ctx.organization_id
    )
    return RevenueOut(
        id=row.id,
        status=row.status,
        category=row.category,
        amount_minor=row.amount_minor,
        currency_code=row.currency_code,
    )


@router.post("/expenses", response_model=ExpenseOut, status_code=201)
async def create_expense(
    body: ExpenseCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    ops: Annotated[FinanceOpsService, Depends(finance_ops_service)],
) -> ExpenseOut:
    row = await ops.create_expense(
        ctx,
        category=body.category,
        amount_minor=body.amount_minor,
        currency_code=body.currency_code,
        source_type=body.source_type,
        source_id=body.source_id,
        event_id=body.event_id,
        campaign_id=body.campaign_id,
    )
    return ExpenseOut(
        id=row.id,
        status=row.status,
        category=row.category,
        amount_minor=row.amount_minor,
        currency_code=row.currency_code,
        campaign_id=row.campaign_id,
    )


@router.post("/expenses/{expense_id}/approve", response_model=ExpenseOut)
async def approve_expense(
    expense_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    ops: Annotated[FinanceOpsService, Depends(finance_ops_service)],
) -> ExpenseOut:
    row = await ops.approve_expense(ctx, expense_id)
    return ExpenseOut(
        id=row.id,
        status=row.status,
        category=row.category,
        amount_minor=row.amount_minor,
        currency_code=row.currency_code,
        campaign_id=row.campaign_id,
    )


@router.post("/expenses/{expense_id}/recognize", response_model=ExpenseOut)
async def recognize_expense(
    expense_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    ops: Annotated[FinanceOpsService, Depends(finance_ops_service)],
) -> ExpenseOut:
    row = await ops.recognize_expense(ctx, expense_id)
    return ExpenseOut(
        id=row.id,
        status=row.status,
        category=row.category,
        amount_minor=row.amount_minor,
        currency_code=row.currency_code,
        campaign_id=row.campaign_id,
    )


@router.post("/expense-categories", response_model=ExpenseCategoryOut, status_code=201)
async def create_expense_category(
    body: ExpenseCategoryCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    ops: Annotated[FinanceOpsService, Depends(finance_ops_service)],
) -> ExpenseCategoryOut:
    row = await ops.create_expense_category(ctx, body.code, body.name)
    return ExpenseCategoryOut(id=row.id, code=row.code, name=row.name, status=row.status)


@router.post("/adjustments", response_model=AdjustmentOut, status_code=201)
async def post_adjustment(
    body: AdjustmentCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    ops: Annotated[FinanceOpsService, Depends(finance_ops_service)],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> AdjustmentOut:
    if not idempotency_key:
        raise AppError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 422)
    row = await ops.post_adjustment(
        ctx,
        reason_code=body.reason_code,
        amount_minor=body.amount_minor,
        currency_code=body.currency_code,
        target_type=body.target_type,
        target_id=body.target_id,
        debit_account_code=body.debit_account_code,
        credit_account_code=body.credit_account_code,
        idempotency_key=idempotency_key,
    )
    return AdjustmentOut(
        id=row.id,
        status=row.status,
        reason_code=row.reason_code,
        amount_minor=row.amount_minor,
        currency_code=row.currency_code,
    )


@router.post("/invoices", response_model=InvoiceOut, status_code=201)
async def create_invoice(
    body: InvoiceCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    ops: Annotated[FinanceOpsService, Depends(finance_ops_service)],
) -> InvoiceOut:
    invoice = await ops.create_invoice(
        ctx,
        direction=body.direction,
        counterparty_type=body.counterparty_type,
        counterparty_id=body.counterparty_id,
        currency_code=body.currency_code,
        lines=[(line.description, line.amount_minor) for line in body.lines],
    )
    return InvoiceOut(
        id=invoice.id,
        direction=invoice.direction,
        status=invoice.status,
        total_amount_minor=invoice.total_amount_minor,
        currency_code=invoice.currency_code,
    )


@router.post("/invoices/{invoice_id}/issue", response_model=InvoiceOut)
async def issue_invoice(
    invoice_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    ops: Annotated[FinanceOpsService, Depends(finance_ops_service)],
) -> InvoiceOut:
    invoice = await ops.issue_invoice(ctx, invoice_id)
    return InvoiceOut(
        id=invoice.id,
        direction=invoice.direction,
        status=invoice.status,
        total_amount_minor=invoice.total_amount_minor,
        currency_code=invoice.currency_code,
    )


@router.post("/payouts", response_model=PayoutOut, status_code=201)
async def create_payout(
    body: PayoutCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    service: Annotated[PayoutService, Depends(payout_service)],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> PayoutOut:
    if not idempotency_key:
        raise AppError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 422)
    row = await service.initiate(
        ctx,
        settlement_id=body.settlement_id,
        payout_method_id=body.payout_method_id,
        idempotency_key=idempotency_key,
    )
    return _payout_out(row)


@router.get("/payouts", response_model=list[PayoutOut])
async def list_payouts(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    service: Annotated[PayoutService, Depends(payout_service)],
) -> list[PayoutOut]:
    return [_payout_out(row) for row in await service.list_payouts(ctx)]


@router.post("/payouts/{payout_id}/approve", response_model=PayoutOut)
async def approve_payout(
    payout_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    service: Annotated[PayoutService, Depends(payout_service)],
) -> PayoutOut:
    return _payout_out(await service.approve(ctx, payout_id))


@router.post("/payouts/{payout_id}/sandbox-complete", response_model=PayoutOut)
async def sandbox_complete_payout(
    payout_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    service: Annotated[PayoutService, Depends(payout_service)],
) -> PayoutOut:
    return _payout_out(await service.process_sandbox(ctx, payout_id))


@router.post("/payout-methods", response_model=PayoutMethodOut, status_code=201)
async def create_payout_method(
    body: PayoutMethodCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    ops: Annotated[FinanceOpsService, Depends(finance_ops_service)],
) -> PayoutMethodOut:
    row = await ops.create_payout_method(
        ctx, payee_type=body.payee_type, payee_id=body.payee_id, token_ref=body.token_ref
    )
    return PayoutMethodOut(
        id=row.id,
        payee_type=row.payee_type,
        payee_id=row.payee_id,
        provider=row.provider,
        status=row.status,
    )


@router.post("/finance-config", response_model=ConfigOut)
async def upsert_config(
    body: ConfigIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    ops: Annotated[FinanceOpsService, Depends(finance_ops_service)],
) -> ConfigOut:
    row = await ops.upsert_config(ctx, body.key, int_value=body.int_value, text_value=body.text_value)
    return ConfigOut(id=row.id, key=row.key, int_value=row.int_value, text_value=row.text_value)


@router.post("/payee-compliance", response_model=ComplianceOut)
async def upsert_compliance(
    body: ComplianceIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    ops: Annotated[FinanceOpsService, Depends(finance_ops_service)],
) -> ComplianceOut:
    row = await ops.upsert_compliance(
        ctx,
        payee_type=body.payee_type,
        payee_id=body.payee_id,
        kyc_present=body.kyc_present,
        tax_record_present=body.tax_record_present,
    )
    return ComplianceOut(
        id=row.id,
        payee_type=row.payee_type,
        payee_id=row.payee_id,
        kyc_present=row.kyc_present,
        tax_record_present=row.tax_record_present,
    )


@router.get("/reconciliations", response_model=list[ReconciliationOut])
async def list_reconciliations(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    ops: Annotated[FinanceOpsService, Depends(finance_ops_service)],
) -> list[ReconciliationOut]:
    return [
        ReconciliationOut(
            id=row.id,
            status=row.status,
            expected_amount_minor=row.expected_amount_minor,
            actual_amount_minor=row.actual_amount_minor,
            currency_code=row.currency_code,
            notes=row.notes,
        )
        for row in await ops.list_reconciliations(ctx)
    ]


def _payout_out(row: Payout) -> PayoutOut:
    return PayoutOut(
        id=row.id,
        settlement_id=row.settlement_id,
        status=row.status,
        amount_minor=row.amount_minor,
        currency_code=row.currency_code,
        provider=row.provider,
        approved_by=row.approved_by,
        second_approved_by=row.second_approved_by,
    )
