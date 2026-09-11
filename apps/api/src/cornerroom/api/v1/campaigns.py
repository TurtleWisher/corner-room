"""Campaign routes. Thin — rules live in CampaignService."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from cornerroom.api.deps import campaign_service, get_auth_context
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.campaigns.application.service import CampaignService
from cornerroom.modules.campaigns.domain.models import Campaign
from cornerroom.modules.finance.domain.models import Expense

router = APIRouter(prefix="/campaigns", tags=["campaigns"])


class MoneyOut(BaseModel):
    amount_minor: int
    currency_code: str


class CampaignOut(BaseModel):
    id: UUID
    organization_id: UUID
    title: str
    description: str | None
    status: str
    starts_at: datetime | None
    ends_at: datetime | None
    budget: MoneyOut | None
    committed_spend: MoneyOut | None = None
    attribution_status: str
    cancelled_at: datetime | None
    version: int


class CampaignPage(BaseModel):
    items: list[CampaignOut]
    next_cursor: str | None


class CampaignCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=8000)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    budget: MoneyOut | None = None
    organization_id: UUID | None = None


class CampaignPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=8000)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    budget: MoneyOut | None = None
    clear_budget: bool = False
    version: int | None = Field(default=None, ge=1)


class LifecycleIn(BaseModel):
    action: str = Field(
        pattern="^(prepare_content|schedule|activate|optimize|complete|report|cancel)$"
    )
    version: int | None = Field(default=None, ge=1)


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    due_at: datetime | None = None
    assignee_user_id: UUID | None = None


class TaskOut(BaseModel):
    id: UUID
    campaign_id: UUID
    title: str
    status: str
    assignee_user_id: UUID | None
    due_at: datetime | None
    version: int


class TaskAssignIn(BaseModel):
    assignee_user_id: UUID
    version: int | None = Field(default=None, ge=1)


class TaskLifecycleIn(BaseModel):
    action: str = Field(pattern="^(start|block|resume|complete|cancel)$")
    version: int | None = Field(default=None, ge=1)


class LinkCreate(BaseModel):
    subject_type: str = Field(min_length=1, max_length=32)
    subject_id: UUID


class LinkOut(BaseModel):
    id: UUID
    campaign_id: UUID
    subject_type: str
    subject_id: UUID


class AssetCreate(BaseModel):
    media_asset_id: UUID


class AssetOut(BaseModel):
    id: UUID
    campaign_id: UUID
    media_asset_id: UUID


class ChannelCreate(BaseModel):
    code: str = Field(min_length=1, max_length=32)


class ChannelOut(BaseModel):
    id: UUID
    campaign_id: UUID
    code: str


class KpiTargetCreate(BaseModel):
    metric_key: str = Field(min_length=1, max_length=64)
    target_value: int


class KpiTargetOut(BaseModel):
    id: UUID
    campaign_id: UUID
    metric_key: str
    target_value: int
    attribution_status: str


class ExpenseRequestIn(BaseModel):
    category: str = Field(min_length=1, max_length=64)
    amount: MoneyOut


class ExpenseRequestOut(BaseModel):
    id: UUID
    status: str
    category: str
    amount: MoneyOut
    campaign_id: UUID | None
    source_type: str
    source_id: UUID


class CampaignDetailOut(CampaignOut):
    tasks: list[TaskOut]
    links: list[LinkOut]
    assets: list[AssetOut]
    channels: list[ChannelOut]
    kpi_targets: list[KpiTargetOut]
    expense_requests: list[ExpenseRequestOut]


def _money(amount_minor: int | None, currency_code: str | None) -> MoneyOut | None:
    if amount_minor is None or currency_code is None:
        return None
    return MoneyOut(amount_minor=amount_minor, currency_code=currency_code)


def _expense_out(row: Expense) -> ExpenseRequestOut:
    return ExpenseRequestOut(
        id=row.id,
        status=row.status,
        category=row.category,
        amount=MoneyOut(amount_minor=row.amount_minor, currency_code=row.currency_code),
        campaign_id=row.campaign_id,
        source_type=row.source_type,
        source_id=row.source_id,
    )


async def _campaign_out(svc: CampaignService, row: Campaign, *, with_spend: bool) -> CampaignOut:
    committed = None
    if with_spend:
        amount, currency = await svc.committed_spend(row)
        committed = _money(amount if currency else None, currency)
        if committed is None and amount == 0 and row.currency_code:
            committed = MoneyOut(amount_minor=0, currency_code=row.currency_code)
    return CampaignOut(
        id=row.id,
        organization_id=row.organization_id,
        title=row.title,
        description=row.description,
        status=row.status,
        starts_at=row.starts_at,
        ends_at=row.ends_at,
        budget=_money(row.budget_amount_minor, row.currency_code),
        committed_spend=committed,
        attribution_status=svc.attribution_status(),
        cancelled_at=row.cancelled_at,
        version=row.version,
    )


@router.get("", response_model=CampaignPage)
async def list_campaigns(
    svc: Annotated[CampaignService, Depends(campaign_service)],
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
) -> CampaignPage:
    rows, next_cursor = await svc.list_campaigns(ctx, cursor=cursor, limit=limit)
    items = [await _campaign_out(svc, row, with_spend=False) for row in rows]
    return CampaignPage(items=items, next_cursor=next_cursor)


@router.post("", response_model=CampaignOut, status_code=201)
async def create_campaign(
    body: CampaignCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[CampaignService, Depends(campaign_service)],
) -> CampaignOut:
    row = await svc.create_campaign(
        ctx,
        title=body.title,
        description=body.description,
        starts_at=body.starts_at,
        ends_at=body.ends_at,
        budget_amount_minor=body.budget.amount_minor if body.budget else None,
        currency_code=body.budget.currency_code if body.budget else None,
        organization_id=body.organization_id,
    )
    return await _campaign_out(svc, row, with_spend=True)


@router.get("/{campaign_id}", response_model=CampaignDetailOut)
async def get_campaign(
    campaign_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[CampaignService, Depends(campaign_service)],
) -> CampaignDetailOut:
    row = await svc.get_campaign(ctx, campaign_id)
    base = await _campaign_out(svc, row, with_spend=True)
    tasks = await svc.list_tasks(ctx, campaign_id)
    links = await svc.list_links(ctx, campaign_id)
    assets = await svc.list_assets(ctx, campaign_id)
    channels = await svc.list_channels(ctx, campaign_id)
    kpis = await svc.list_kpi_targets(ctx, campaign_id)
    expenses = await svc.list_expenses(ctx, campaign_id)
    return CampaignDetailOut(
        **base.model_dump(),
        tasks=[
            TaskOut(
                id=t.id,
                campaign_id=t.campaign_id,
                title=t.title,
                status=t.status,
                assignee_user_id=t.assignee_user_id,
                due_at=t.due_at,
                version=t.version,
            )
            for t in tasks
        ],
        links=[
            LinkOut(
                id=link.id,
                campaign_id=link.campaign_id,
                subject_type=link.subject_type,
                subject_id=link.subject_id,
            )
            for link in links
        ],
        assets=[
            AssetOut(id=a.id, campaign_id=a.campaign_id, media_asset_id=a.media_asset_id)
            for a in assets
        ],
        channels=[ChannelOut(id=c.id, campaign_id=c.campaign_id, code=c.code) for c in channels],
        kpi_targets=[
            KpiTargetOut(
                id=k.id,
                campaign_id=k.campaign_id,
                metric_key=k.metric_key,
                target_value=k.target_value,
                attribution_status=svc.attribution_status(),
            )
            for k in kpis
        ],
        expense_requests=[_expense_out(e) for e in expenses],
    )


@router.patch("/{campaign_id}", response_model=CampaignOut)
async def patch_campaign(
    campaign_id: UUID,
    body: CampaignPatch,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[CampaignService, Depends(campaign_service)],
) -> CampaignOut:
    row = await svc.patch_campaign(
        ctx,
        campaign_id,
        title=body.title,
        description=body.description,
        starts_at=body.starts_at,
        ends_at=body.ends_at,
        budget_amount_minor=body.budget.amount_minor if body.budget else None,
        currency_code=body.budget.currency_code if body.budget else None,
        version=body.version,
        clear_budget=body.clear_budget,
    )
    return await _campaign_out(svc, row, with_spend=True)


@router.post("/{campaign_id}/transition", response_model=CampaignOut)
async def transition_campaign(
    campaign_id: UUID,
    body: LifecycleIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[CampaignService, Depends(campaign_service)],
) -> CampaignOut:
    row = await svc.transition(ctx, campaign_id, action=body.action, version=body.version)
    return await _campaign_out(svc, row, with_spend=True)


@router.get("/{campaign_id}/tasks", response_model=list[TaskOut])
async def list_tasks(
    campaign_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[CampaignService, Depends(campaign_service)],
) -> list[TaskOut]:
    rows = await svc.list_tasks(ctx, campaign_id)
    return [
        TaskOut(
            id=t.id,
            campaign_id=t.campaign_id,
            title=t.title,
            status=t.status,
            assignee_user_id=t.assignee_user_id,
            due_at=t.due_at,
            version=t.version,
        )
        for t in rows
    ]


@router.post("/{campaign_id}/tasks", response_model=TaskOut, status_code=201)
async def create_task(
    campaign_id: UUID,
    body: TaskCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[CampaignService, Depends(campaign_service)],
) -> TaskOut:
    row = await svc.create_task(
        ctx,
        campaign_id,
        title=body.title,
        due_at=body.due_at,
        assignee_user_id=body.assignee_user_id,
    )
    return TaskOut(
        id=row.id,
        campaign_id=row.campaign_id,
        title=row.title,
        status=row.status,
        assignee_user_id=row.assignee_user_id,
        due_at=row.due_at,
        version=row.version,
    )


@router.post("/{campaign_id}/tasks/{task_id}/assign", response_model=TaskOut)
async def assign_task(
    campaign_id: UUID,
    task_id: UUID,
    body: TaskAssignIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[CampaignService, Depends(campaign_service)],
) -> TaskOut:
    row = await svc.assign_task(
        ctx,
        campaign_id,
        task_id,
        assignee_user_id=body.assignee_user_id,
        version=body.version,
    )
    return TaskOut(
        id=row.id,
        campaign_id=row.campaign_id,
        title=row.title,
        status=row.status,
        assignee_user_id=row.assignee_user_id,
        due_at=row.due_at,
        version=row.version,
    )


@router.post("/{campaign_id}/tasks/{task_id}/complete", response_model=TaskOut)
async def complete_task(
    campaign_id: UUID,
    task_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[CampaignService, Depends(campaign_service)],
    version: int | None = Query(default=None, ge=1),
) -> TaskOut:
    row = await svc.transition_task(ctx, campaign_id, task_id, action="complete", version=version)
    return TaskOut(
        id=row.id,
        campaign_id=row.campaign_id,
        title=row.title,
        status=row.status,
        assignee_user_id=row.assignee_user_id,
        due_at=row.due_at,
        version=row.version,
    )


@router.post("/{campaign_id}/tasks/{task_id}/transition", response_model=TaskOut)
async def transition_task(
    campaign_id: UUID,
    task_id: UUID,
    body: TaskLifecycleIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[CampaignService, Depends(campaign_service)],
) -> TaskOut:
    row = await svc.transition_task(
        ctx, campaign_id, task_id, action=body.action, version=body.version
    )
    return TaskOut(
        id=row.id,
        campaign_id=row.campaign_id,
        title=row.title,
        status=row.status,
        assignee_user_id=row.assignee_user_id,
        due_at=row.due_at,
        version=row.version,
    )


@router.post("/{campaign_id}/links", response_model=LinkOut, status_code=201)
async def add_link(
    campaign_id: UUID,
    body: LinkCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[CampaignService, Depends(campaign_service)],
) -> LinkOut:
    row = await svc.add_link(
        ctx, campaign_id, subject_type=body.subject_type, subject_id=body.subject_id
    )
    return LinkOut(
        id=row.id,
        campaign_id=row.campaign_id,
        subject_type=row.subject_type,
        subject_id=row.subject_id,
    )


@router.post("/{campaign_id}/assets", response_model=AssetOut, status_code=201)
async def add_asset(
    campaign_id: UUID,
    body: AssetCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[CampaignService, Depends(campaign_service)],
) -> AssetOut:
    row = await svc.add_asset(ctx, campaign_id, media_asset_id=body.media_asset_id)
    return AssetOut(id=row.id, campaign_id=row.campaign_id, media_asset_id=row.media_asset_id)


@router.post("/{campaign_id}/channels", response_model=ChannelOut, status_code=201)
async def add_channel(
    campaign_id: UUID,
    body: ChannelCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[CampaignService, Depends(campaign_service)],
) -> ChannelOut:
    row = await svc.add_channel(ctx, campaign_id, code=body.code)
    return ChannelOut(id=row.id, campaign_id=row.campaign_id, code=row.code)


@router.post("/{campaign_id}/kpi-targets", response_model=KpiTargetOut, status_code=201)
async def add_kpi_target(
    campaign_id: UUID,
    body: KpiTargetCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[CampaignService, Depends(campaign_service)],
) -> KpiTargetOut:
    row = await svc.add_kpi_target(
        ctx, campaign_id, metric_key=body.metric_key, target_value=body.target_value
    )
    return KpiTargetOut(
        id=row.id,
        campaign_id=row.campaign_id,
        metric_key=row.metric_key,
        target_value=row.target_value,
        attribution_status=svc.attribution_status(),
    )


@router.post("/{campaign_id}/expense-requests", response_model=ExpenseRequestOut, status_code=201)
async def request_expense(
    campaign_id: UUID,
    body: ExpenseRequestIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    svc: Annotated[CampaignService, Depends(campaign_service)],
) -> ExpenseRequestOut:
    row = await svc.request_expense(
        ctx,
        campaign_id,
        category=body.category,
        amount_minor=body.amount.amount_minor,
        currency_code=body.amount.currency_code,
    )
    return _expense_out(row)
