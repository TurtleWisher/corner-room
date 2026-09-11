"""Royalty HTTP API. Thin — rules live in RoyaltyService."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel, Field

from cornerroom.api.deps import get_auth_context, royalty_service
from cornerroom.infra.errors import AppError, NotFoundError
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.royalties.application.service import RoyaltyService
from cornerroom.modules.royalties.domain.models import (
    RevenuePool,
    RightShare,
    Rights,
    Royalty,
    RoyaltyAdjustment,
    RoyaltyLine,
    RoyaltyRule,
    RoyaltyStatement,
    Settlement,
)

router = APIRouter(tags=["royalties"])


class ShareIn(BaseModel):
    right_type: str
    payee_type: str
    payee_id: UUID
    share_bps: int = Field(ge=0, le=10000)
    effective_from: datetime
    effective_to: datetime | None = None


class RightsPut(BaseModel):
    territory: str = "WW"
    residual_payee_type: str | None = None
    residual_payee_id: UUID | None = None
    contract_id: UUID | None = None
    shares: list[ShareIn] = Field(default_factory=list)


class ShareOut(BaseModel):
    id: UUID
    right_type: str
    payee_type: str
    payee_id: UUID
    share_bps: int
    effective_from: datetime
    effective_to: datetime | None


class RightsOut(BaseModel):
    id: UUID
    track_id: UUID | None
    status: str
    territory: str
    residual_payee_type: str | None
    residual_payee_id: UUID | None
    version: int
    shares: list[ShareOut]


class LifecycleIn(BaseModel):
    action: str
    version: int | None = Field(default=None, ge=1)


class RuleCreate(BaseModel):
    key: str = Field(min_length=1, max_length=80)
    version: int = Field(default=1, ge=1)
    definition: dict[str, Any]


class RuleOut(BaseModel):
    id: UUID
    key: str
    version: int
    status: str
    definition: dict[str, Any]


class PoolCreate(BaseModel):
    period_start: datetime
    period_end: datetime
    source_type: str
    currency_code: str = Field(min_length=3, max_length=3)
    rule_id: UUID


class PoolOut(BaseModel):
    id: UUID
    period_start: datetime
    period_end: datetime
    source_type: str
    currency_code: str
    amount_minor: int
    status: str
    rule_id: UUID
    version: int


class RecognizedIn(BaseModel):
    source_type: str
    period_start: datetime
    period_end: datetime
    amount_minor: int = Field(ge=0)
    currency_code: str = Field(min_length=3, max_length=3)
    source_id: UUID | None = None


class RecognizedOut(BaseModel):
    id: UUID
    source_type: str
    amount_minor: int
    currency_code: str
    period_start: datetime
    period_end: datetime


class RunCreate(BaseModel):
    revenue_pool_id: UUID
    run_kind: str = "PRIMARY"


class LineOut(BaseModel):
    id: UUID
    payee_type: str
    payee_id: UUID
    track_id: UUID | None
    eligible_units: int
    share_bps_snapshot: int
    amount_minor: int
    currency_code: str
    is_residual: bool


class RunOut(BaseModel):
    id: UUID
    revenue_pool_id: UUID
    status: str
    run_kind: str
    pool_amount_minor_snapshot: int
    unallocated_minor: int
    rule_key_snapshot: str | None
    rule_version_snapshot: int | None
    lines: list[LineOut] = Field(default_factory=list)


class StatementOut(BaseModel):
    id: UUID
    payee_type: str
    payee_id: UUID
    period_start: datetime
    period_end: datetime
    status: str
    total_amount_minor: int
    currency_code: str
    version_number: int
    lines: list[LineOut] = Field(default_factory=list)
    adjustments: list[dict[str, Any]] = Field(default_factory=list)


class StatementPage(BaseModel):
    items: list[StatementOut]
    next_cursor: str | None


class AdjustmentIn(BaseModel):
    amount_minor: int
    reason: str = Field(min_length=1, max_length=200)


class SettlementCreate(BaseModel):
    statement_id: UUID


class SettlementOut(BaseModel):
    id: UUID
    kind: str
    payee_type: str
    payee_id: UUID
    status: str
    amount_minor: int
    currency_code: str


def _shares_out(rows: list[RightShare]) -> list[ShareOut]:
    return [
        ShareOut(
            id=row.id,
            right_type=row.right_type,
            payee_type=row.payee_type,
            payee_id=row.payee_id,
            share_bps=row.share_bps,
            effective_from=row.effective_from,
            effective_to=row.effective_to,
        )
        for row in rows
    ]


def _rights_out(rights: Rights, shares: list[RightShare]) -> RightsOut:
    return RightsOut(
        id=rights.id,
        track_id=rights.track_id,
        status=rights.status,
        territory=rights.territory,
        residual_payee_type=rights.residual_payee_type,
        residual_payee_id=rights.residual_payee_id,
        version=rights.version,
        shares=_shares_out(shares),
    )


def _rule_out(row: RoyaltyRule) -> RuleOut:
    return RuleOut(
        id=row.id,
        key=row.key,
        version=row.version_number,
        status=row.status,
        definition=row.definition,
    )


def _pool_out(row: RevenuePool) -> PoolOut:
    return PoolOut(
        id=row.id,
        period_start=row.period_start,
        period_end=row.period_end,
        source_type=row.source_type,
        currency_code=row.currency_code,
        amount_minor=row.amount_minor,
        status=row.status,
        rule_id=row.rule_id,
        version=row.version,
    )


def _line_out(row: RoyaltyLine) -> LineOut:
    return LineOut(
        id=row.id,
        payee_type=row.payee_type,
        payee_id=row.payee_id,
        track_id=row.track_id,
        eligible_units=row.eligible_units,
        share_bps_snapshot=row.share_bps_snapshot,
        amount_minor=row.amount_minor,
        currency_code=row.currency_code,
        is_residual=row.is_residual,
    )


def _run_out(run: Royalty, lines: list[RoyaltyLine] | None = None) -> RunOut:
    return RunOut(
        id=run.id,
        revenue_pool_id=run.revenue_pool_id,
        status=run.status,
        run_kind=run.run_kind,
        pool_amount_minor_snapshot=run.pool_amount_minor_snapshot,
        unallocated_minor=run.unallocated_minor,
        rule_key_snapshot=run.rule_key_snapshot,
        rule_version_snapshot=run.rule_version_snapshot,
        lines=[_line_out(row) for row in (lines or [])],
    )


def _statement_out(
    row: RoyaltyStatement,
    lines: list[RoyaltyLine] | None = None,
    adjustments: list[RoyaltyAdjustment] | None = None,
) -> StatementOut:
    return StatementOut(
        id=row.id,
        payee_type=row.payee_type,
        payee_id=row.payee_id,
        period_start=row.period_start,
        period_end=row.period_end,
        status=row.status,
        total_amount_minor=row.total_amount_minor,
        currency_code=row.currency_code,
        version_number=row.version_number,
        lines=[_line_out(line) for line in (lines or [])],
        adjustments=[
            {
                "id": str(adj.id),
                "amount_minor": adj.amount_minor,
                "currency_code": adj.currency_code,
                "reason": adj.reason,
            }
            for adj in (adjustments or [])
        ],
    )


def _settlement_out(row: Settlement) -> SettlementOut:
    return SettlementOut(
        id=row.id,
        kind=row.kind,
        payee_type=row.payee_type,
        payee_id=row.payee_id,
        status=row.status,
        amount_minor=row.amount_minor,
        currency_code=row.currency_code,
    )


@router.get("/tracks/{track_id}/rights", response_model=RightsOut)
async def get_track_rights(
    track_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    service: Annotated[RoyaltyService, Depends(royalty_service)],
) -> RightsOut:
    rights, shares = await service.get_track_rights(ctx, track_id)
    if rights is None:
        raise NotFoundError("Rights not found")
    return _rights_out(rights, shares)


@router.put("/tracks/{track_id}/rights", response_model=RightsOut)
async def put_track_rights(
    track_id: UUID,
    body: RightsPut,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    service: Annotated[RoyaltyService, Depends(royalty_service)],
) -> RightsOut:
    rights, shares = await service.put_track_rights(
        ctx,
        track_id,
        territory=body.territory,
        residual_payee_type=body.residual_payee_type,
        residual_payee_id=body.residual_payee_id,
        contract_id=body.contract_id,
        shares=[item.model_dump() for item in body.shares],
    )
    return _rights_out(rights, shares)


@router.post("/rights/{rights_id}/lifecycle", response_model=RightsOut)
async def rights_lifecycle(
    rights_id: UUID,
    body: LifecycleIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    service: Annotated[RoyaltyService, Depends(royalty_service)],
) -> RightsOut:
    rights = await service.transition_rights(ctx, rights_id, body.action)
    shares: list[RightShare] = []
    if rights.track_id is not None:
        _, shares = await service.get_track_rights(ctx, rights.track_id)
    return _rights_out(rights, shares)


@router.get("/royalty-rules", response_model=list[RuleOut])
async def list_rules(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    service: Annotated[RoyaltyService, Depends(royalty_service)],
) -> list[RuleOut]:
    return [_rule_out(row) for row in await service.list_rules(ctx)]


@router.post("/royalty-rules", response_model=RuleOut, status_code=201)
async def create_rule(
    body: RuleCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    service: Annotated[RoyaltyService, Depends(royalty_service)],
) -> RuleOut:
    row = await service.create_rule(ctx, key=body.key, definition=body.definition, version_number=body.version)
    return _rule_out(row)


@router.post("/royalty-rules/{rule_id}/lifecycle", response_model=RuleOut)
async def rule_lifecycle(
    rule_id: UUID,
    body: LifecycleIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    service: Annotated[RoyaltyService, Depends(royalty_service)],
) -> RuleOut:
    return _rule_out(await service.transition_rule(ctx, rule_id, body.action))


@router.post("/recognized-revenue", response_model=RecognizedOut, status_code=201)
async def record_recognized(
    body: RecognizedIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    service: Annotated[RoyaltyService, Depends(royalty_service)],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> RecognizedOut:
    if not idempotency_key:
        raise AppError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", 422)
    fact = await service.record_recognized_revenue(
        ctx,
        source_type=body.source_type,
        period_start=body.period_start,
        period_end=body.period_end,
        amount_minor=body.amount_minor,
        currency_code=body.currency_code,
        idempotency_key=idempotency_key,
        source_id=body.source_id,
    )
    return RecognizedOut(
        id=fact.intake_id,
        source_type=fact.source_type,
        amount_minor=fact.money.amount_minor,
        currency_code=fact.money.currency_code,
        period_start=fact.period_start,
        period_end=fact.period_end,
    )


@router.get("/revenue-pools", response_model=list[PoolOut])
async def list_pools(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    service: Annotated[RoyaltyService, Depends(royalty_service)],
) -> list[PoolOut]:
    return [_pool_out(row) for row in await service.list_pools(ctx)]


@router.post("/revenue-pools", response_model=PoolOut, status_code=201)
async def create_pool(
    body: PoolCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    service: Annotated[RoyaltyService, Depends(royalty_service)],
) -> PoolOut:
    return _pool_out(
        await service.create_pool(
            ctx,
            period_start=body.period_start,
            period_end=body.period_end,
            source_type=body.source_type,
            currency_code=body.currency_code,
            rule_id=body.rule_id,
        )
    )


@router.post("/revenue-pools/{pool_id}/freeze", response_model=PoolOut)
async def freeze_pool(
    pool_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    service: Annotated[RoyaltyService, Depends(royalty_service)],
) -> PoolOut:
    return _pool_out(await service.freeze_pool(ctx, pool_id))


@router.post("/royalty-runs", response_model=RunOut, status_code=201)
async def create_run(
    body: RunCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    service: Annotated[RoyaltyService, Depends(royalty_service)],
) -> RunOut:
    run = await service.start_run(ctx, body.revenue_pool_id, run_kind=body.run_kind)
    run, lines = await service.get_run(ctx, run.id)
    return _run_out(run, lines)


@router.get("/royalty-runs/{run_id}", response_model=RunOut)
async def get_run(
    run_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    service: Annotated[RoyaltyService, Depends(royalty_service)],
) -> RunOut:
    run, lines = await service.get_run(ctx, run_id)
    return _run_out(run, lines)


@router.post("/royalty-runs/{run_id}/lifecycle", response_model=RunOut)
async def run_lifecycle(
    run_id: UUID,
    body: LifecycleIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    service: Annotated[RoyaltyService, Depends(royalty_service)],
) -> RunOut:
    await service.transition_run(ctx, run_id, body.action)
    run, lines = await service.get_run(ctx, run_id)
    return _run_out(run, lines)


@router.get("/me/royalties/statements", response_model=StatementPage)
async def my_statements(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    service: Annotated[RoyaltyService, Depends(royalty_service)],
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
) -> StatementPage:
    rows, next_cursor = await service.list_my_statements(ctx, cursor=cursor, limit=limit)
    return StatementPage(items=[_statement_out(row) for row in rows], next_cursor=next_cursor)


@router.get("/statements/{statement_id}", response_model=StatementOut)
async def get_statement(
    statement_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    service: Annotated[RoyaltyService, Depends(royalty_service)],
) -> StatementOut:
    statement, lines, adjustments = await service.get_statement(ctx, statement_id)
    return _statement_out(statement, lines, adjustments)


@router.post("/statements/{statement_id}/lifecycle", response_model=StatementOut)
async def statement_lifecycle(
    statement_id: UUID,
    body: LifecycleIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    service: Annotated[RoyaltyService, Depends(royalty_service)],
) -> StatementOut:
    await service.transition_statement(ctx, statement_id, body.action)
    statement, lines, adjustments = await service.get_statement(ctx, statement_id)
    return _statement_out(statement, lines, adjustments)


@router.post("/statements/{statement_id}/adjustments", response_model=StatementOut, status_code=201)
async def add_adjustment(
    statement_id: UUID,
    body: AdjustmentIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    service: Annotated[RoyaltyService, Depends(royalty_service)],
) -> StatementOut:
    await service.add_adjustment(ctx, statement_id, amount_minor=body.amount_minor, reason=body.reason)
    statement, lines, adjustments = await service.get_statement(ctx, statement_id)
    return _statement_out(statement, lines, adjustments)


@router.post("/settlements", response_model=SettlementOut, status_code=201)
async def create_settlement(
    body: SettlementCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    service: Annotated[RoyaltyService, Depends(royalty_service)],
) -> SettlementOut:
    return _settlement_out(await service.create_settlement(ctx, body.statement_id))


@router.post("/settlements/{settlement_id}/approve", response_model=SettlementOut)
async def approve_settlement(
    settlement_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    service: Annotated[RoyaltyService, Depends(royalty_service)],
) -> SettlementOut:
    return _settlement_out(await service.approve_settlement(ctx, settlement_id))
