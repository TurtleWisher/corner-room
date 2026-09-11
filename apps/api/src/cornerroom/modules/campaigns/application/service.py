"""Campaign application service. Controllers stay thin. No ledger writes."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import Select, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.exc import StaleDataError

from cornerroom.infra.errors import AppError, ConflictError, ForbiddenError, NotFoundError
from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import (
    CAMPAIGN_COMPLETED,
    CAMPAIGN_STARTED,
    CAMPAIGN_TASK_ASSIGNED,
    CAMPAIGN_TASK_COMPLETED,
    DomainEvent,
)
from cornerroom.kernel.ids import new_uuid
from cornerroom.kernel.money import Money
from cornerroom.kernel.pagination import clamp_limit, decode_cursor, encode_cursor
from cornerroom.kernel.ports import NotificationPort, NullNotificationPort
from cornerroom.modules.artists.domain.models import Artist
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.authorization.application.service import AuthorizationService
from cornerroom.modules.campaigns.domain.lifecycle import (
    ATTRIBUTION_UNDEFINED,
    CHANNEL_CODES,
    SUBJECT_TYPES,
    campaign_target_for_action,
    campaign_transition_action,
    task_target_for_action,
    task_transition_action,
)
from cornerroom.modules.campaigns.domain.models import (
    Campaign,
    CampaignAsset,
    CampaignChannel,
    CampaignKpiTarget,
    CampaignLink,
    CampaignTask,
)
from cornerroom.modules.documents.domain.models import MediaAsset
from cornerroom.modules.events.domain.models import Event
from cornerroom.modules.finance.application.operations import FinanceOpsService
from cornerroom.modules.finance.domain.models import Expense
from cornerroom.modules.identity.domain.models import Organization, User
from cornerroom.modules.music.domain.models import Release

log = structlog.get_logger("campaigns")

CAMPAIGN_DOMAIN_EVENTS = {
    "ACTIVE": CAMPAIGN_STARTED,
    "COMPLETED": CAMPAIGN_COMPLETED,
}


class CampaignService:
    def __init__(
        self,
        session: AsyncSession,
        clock: Clock | None = None,
        notifications: NotificationPort | None = None,
    ) -> None:
        self.session = session
        self.clock = clock or SystemClock()
        self.audit = AuditService(session)
        self.authz = AuthorizationService(session, clock=self.clock)
        self.finance = FinanceOpsService(session, clock=self.clock)
        self.notifications = notifications or NullNotificationPort()

    def _workspace_org_id(self, ctx: AuthContext, claimed: UUID | None = None) -> UUID:
        if claimed is not None and ctx.organization_id is not None and claimed != ctx.organization_id:
            raise AppError(
                "ORG_SCOPE_MISMATCH",
                "Organization scope mismatch",
                403,
                "Client organization_id cannot override the authorized workspace",
            )
        org_id = ctx.organization_id
        if org_id is None:
            raise ForbiddenError("Switch to an organization workspace before mutating campaigns")
        if claimed is not None:
            return claimed
        return org_id

    async def _org(self, org_id: UUID) -> Organization:
        org = await self.session.get(Organization, org_id)
        if org is None or org.deleted_at is not None:
            raise NotFoundError("Organization not found")
        return org

    async def _require_active_org(self, org_id: UUID) -> Organization:
        org = await self._org(org_id)
        if org.status != "ACTIVE":
            raise AppError(
                "ORG_NOT_ACTIVE",
                "Organization is not active",
                409,
                "Suspended or archived organizations cannot mutate campaigns",
            )
        return org

    async def _is_allowed(
        self,
        user_id: UUID,
        permission: str,
        *,
        resource_id: UUID,
        organization_id: UUID,
    ) -> bool:
        try:
            await self.authz.authorize(
                user_id,
                permission,
                resource_type="campaign",
                resource_id=resource_id,
                scope_organization_id=organization_id,
            )
            return True
        except ForbiddenError:
            return False

    async def _assert_write(self, ctx: AuthContext, campaign: Campaign) -> None:
        allowed = await self._is_allowed(
            ctx.user_id,
            "campaign.write",
            resource_id=campaign.id,
            organization_id=campaign.organization_id,
        )
        if not allowed:
            raise NotFoundError("Campaign not found")

    async def _campaign(self, campaign_id: UUID) -> Campaign:
        row = await self.session.get(Campaign, campaign_id)
        if row is None or row.deleted_at is not None:
            raise NotFoundError("Campaign not found")
        return row

    async def _load_writable(self, ctx: AuthContext, campaign_id: UUID) -> Campaign:
        row = await self._campaign(campaign_id)
        await self._assert_write(ctx, row)
        return row

    def _assert_version(self, row: Campaign | CampaignTask, expected: int | None) -> None:
        if expected is not None and expected != row.version:
            raise ConflictError("The resource was updated concurrently")

    async def _flush_versioned(self) -> None:
        try:
            await self.session.flush()
        except StaleDataError as exc:
            raise ConflictError("The resource was updated concurrently") from exc
        except IntegrityError as exc:
            raise ConflictError("Conflicting campaign state") from exc

    async def _emit(
        self,
        ctx: AuthContext,
        *,
        event_type: str,
        aggregate_type: str,
        aggregate_id: UUID,
        organization_id: UUID,
        payload: dict[str, Any],
    ) -> None:
        domain = DomainEvent(
            event_type=event_type,
            producer="campaigns",
            aggregate_type=aggregate_type,
            aggregate_id=aggregate_id,
            payload=payload,
            occurred_at=self.clock.now(),
            actor_id=ctx.user_id,
            organization_id=organization_id,
            correlation_id=ctx.request_id,
        )
        await enqueue_outbox(self.session, domain)

    async def _notify(
        self,
        *,
        user_id: UUID | None,
        notification_type: str,
        title: str,
        body: str,
    ) -> None:
        if user_id is None:
            return
        try:
            await self.notifications.request(
                user_id=user_id,
                notification_type=notification_type,
                title=title,
                body=body,
            )
        except Exception:
            log.exception("campaign_notification_failed", notification_type=notification_type)

    def _aware(self, value: datetime | None, *, field: str) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            raise AppError(
                "VALIDATION_ERROR",
                "Timestamps must be timezone-aware",
                422,
                f"{field} must include a timezone offset; do not assume a local zone",
            )
        return value

    def _validate_interval(self, starts_at: datetime | None, ends_at: datetime | None) -> None:
        if starts_at is not None and ends_at is not None and ends_at <= starts_at:
            raise AppError("VALIDATION_ERROR", "Invalid schedule", 422, "ends_at must be after starts_at")

    def _budget_pair(
        self,
        amount_minor: int | None,
        currency_code: str | None,
    ) -> tuple[int | None, str | None]:
        if amount_minor is None and currency_code is None:
            return None, None
        if amount_minor is None or currency_code is None:
            raise AppError(
                "VALIDATION_ERROR",
                "Budget amount and currency must be set together",
                422,
            )
        money = Money(amount_minor, currency_code)
        return money.amount_minor, money.currency_code

    async def create_campaign(
        self,
        ctx: AuthContext,
        *,
        title: str,
        description: str | None = None,
        starts_at: datetime | None = None,
        ends_at: datetime | None = None,
        budget_amount_minor: int | None = None,
        currency_code: str | None = None,
        organization_id: UUID | None = None,
    ) -> Campaign:
        org_id = self._workspace_org_id(ctx, organization_id)
        await self._require_active_org(org_id)
        allowed = await self._is_allowed(
            ctx.user_id,
            "campaign.write",
            resource_id=org_id,
            organization_id=org_id,
        )
        if not allowed:
            raise NotFoundError("Campaign not found")
        starts = self._aware(starts_at, field="starts_at")
        ends = self._aware(ends_at, field="ends_at")
        self._validate_interval(starts, ends)
        budget, currency = self._budget_pair(budget_amount_minor, currency_code)
        row = Campaign(
            organization_id=org_id,
            title=title.strip(),
            description=description,
            status="PLANNING",
            starts_at=starts,
            ends_at=ends,
            budget_amount_minor=budget,
            currency_code=currency,
            created_by=ctx.user_id,
            updated_by=ctx.user_id,
        )
        self.session.add(row)
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx,
            action="campaign.created",
            entity_type="Campaign",
            entity_id=row.id,
            new_state={"status": row.status, "title": row.title},
            organization_id=org_id,
        )
        return row

    async def list_campaigns(
        self,
        ctx: AuthContext,
        *,
        cursor: str | None = None,
        limit: int = 50,
    ) -> tuple[list[Campaign], str | None]:
        org_id = self._workspace_org_id(ctx)
        probe = new_uuid()
        allowed = await self._is_allowed(
            ctx.user_id,
            "campaign.write",
            resource_id=probe,
            organization_id=org_id,
        )
        if not allowed:
            raise NotFoundError("Campaign not found")
        stmt: Select[tuple[Campaign]] = (
            select(Campaign)
            .where(
                Campaign.organization_id == org_id,
                Campaign.deleted_at.is_(None),
            )
            .order_by(Campaign.created_at.desc(), Campaign.id.desc())
        )
        if cursor:
            data = decode_cursor(cursor)
            stmt = stmt.where(Campaign.created_at < data["t"])
        size = clamp_limit(limit)
        rows = list((await self.session.execute(stmt.limit(size + 1))).scalars().all())
        next_cursor = None
        if len(rows) > size:
            last = rows[size - 1]
            next_cursor = encode_cursor(last.created_at.isoformat(), last.id)
            rows = rows[:size]
        return rows, next_cursor

    async def get_campaign(self, ctx: AuthContext, campaign_id: UUID) -> Campaign:
        return await self._load_writable(ctx, campaign_id)

    async def patch_campaign(
        self,
        ctx: AuthContext,
        campaign_id: UUID,
        *,
        title: str | None = None,
        description: str | None = None,
        starts_at: datetime | None = None,
        ends_at: datetime | None = None,
        budget_amount_minor: int | None = None,
        currency_code: str | None = None,
        version: int | None = None,
        clear_budget: bool = False,
    ) -> Campaign:
        row = await self._load_writable(ctx, campaign_id)
        self._assert_version(row, version)
        if row.status in {"COMPLETED", "REPORTING", "CANCELLED"}:
            raise AppError(
                "CAMPAIGN_IMMUTABLE",
                "This campaign can no longer be edited",
                409,
                f"Status {row.status} does not allow PATCH",
            )
        previous = {"title": row.title, "status": row.status}
        if title is not None:
            row.title = title.strip()
        if description is not None:
            row.description = description
        if starts_at is not None:
            row.starts_at = self._aware(starts_at, field="starts_at")
        if ends_at is not None:
            row.ends_at = self._aware(ends_at, field="ends_at")
        self._validate_interval(row.starts_at, row.ends_at)
        if clear_budget:
            row.budget_amount_minor = None
            row.currency_code = None
        elif budget_amount_minor is not None or currency_code is not None:
            amount = budget_amount_minor if budget_amount_minor is not None else row.budget_amount_minor
            code = currency_code if currency_code is not None else row.currency_code
            budget, currency = self._budget_pair(amount, code)
            row.budget_amount_minor = budget
            row.currency_code = currency
        row.updated_by = ctx.user_id
        await self._flush_versioned()
        await self.audit.record_from_auth(
            ctx,
            action="campaign.updated",
            entity_type="Campaign",
            entity_id=row.id,
            previous_state=previous,
            new_state={"title": row.title, "status": row.status},
            organization_id=row.organization_id,
        )
        return row

    async def transition(
        self,
        ctx: AuthContext,
        campaign_id: UUID,
        *,
        action: str,
        version: int | None = None,
    ) -> Campaign:
        row = await self._load_writable(ctx, campaign_id)
        self._assert_version(row, version)
        target = campaign_target_for_action(action)
        campaign_transition_action(row.status, target)
        previous = row.status
        row.status = target
        if target == "CANCELLED":
            row.cancelled_at = self.clock.now()
        row.updated_by = ctx.user_id
        await self._flush_versioned()
        event_type = CAMPAIGN_DOMAIN_EVENTS.get(target)
        if event_type:
            await self._emit(
                ctx,
                event_type=event_type,
                aggregate_type="Campaign",
                aggregate_id=row.id,
                organization_id=row.organization_id,
                payload={"status": row.status, "previous_status": previous},
            )
        await self.audit.record_from_auth(
            ctx,
            action=f"campaign.{action}",
            entity_type="Campaign",
            entity_id=row.id,
            previous_state={"status": previous},
            new_state={"status": row.status},
            organization_id=row.organization_id,
        )
        return row

    async def list_tasks(self, ctx: AuthContext, campaign_id: UUID) -> list[CampaignTask]:
        await self._load_writable(ctx, campaign_id)
        rows = (
            await self.session.execute(
                select(CampaignTask)
                .where(
                    CampaignTask.campaign_id == campaign_id,
                    CampaignTask.deleted_at.is_(None),
                )
                .order_by(CampaignTask.created_at.asc(), CampaignTask.id.asc())
            )
        ).scalars().all()
        return list(rows)

    async def create_task(
        self,
        ctx: AuthContext,
        campaign_id: UUID,
        *,
        title: str,
        due_at: datetime | None = None,
        assignee_user_id: UUID | None = None,
    ) -> CampaignTask:
        campaign = await self._load_writable(ctx, campaign_id)
        if campaign.status in {"COMPLETED", "REPORTING", "CANCELLED"}:
            raise AppError(
                "CAMPAIGN_IMMUTABLE",
                "Tasks cannot be added in this status",
                409,
                f"Status {campaign.status} does not allow new tasks",
            )
        due = self._aware(due_at, field="due_at")
        if assignee_user_id is not None:
            await self._assert_assignee(assignee_user_id)
        task = CampaignTask(
            campaign_id=campaign.id,
            title=title.strip(),
            status="TODO",
            due_at=due,
            assignee_user_id=assignee_user_id,
            created_by=ctx.user_id,
            updated_by=ctx.user_id,
        )
        self.session.add(task)
        await self.session.flush()
        if assignee_user_id is not None:
            await self._emit_task_assigned(ctx, campaign, task)
        await self.audit.record_from_auth(
            ctx,
            action="campaign_task.created",
            entity_type="CampaignTask",
            entity_id=task.id,
            new_state={"status": task.status, "title": task.title},
            organization_id=campaign.organization_id,
        )
        return task

    async def _assert_assignee(self, user_id: UUID) -> User:
        user = await self.session.get(User, user_id)
        if user is None or user.deleted_at is not None:
            raise AppError("ASSIGNEE_NOT_FOUND", "Assignee was not found", 409)
        if user.status != "ACTIVE":
            raise AppError("ASSIGNEE_NOT_ACTIVE", "Assignee is not active", 409)
        return user

    async def _emit_task_assigned(self, ctx: AuthContext, campaign: Campaign, task: CampaignTask) -> None:
        await self._emit(
            ctx,
            event_type=CAMPAIGN_TASK_ASSIGNED,
            aggregate_type="CampaignTask",
            aggregate_id=task.id,
            organization_id=campaign.organization_id,
            payload={
                "campaign_id": str(campaign.id),
                "assignee_user_id": str(task.assignee_user_id) if task.assignee_user_id else None,
            },
        )
        await self._notify(
            user_id=task.assignee_user_id,
            notification_type="campaign.task_assigned",
            title="Campaign task assigned",
            body=f"A campaign task was assigned: {task.title}",
        )

    async def assign_task(
        self,
        ctx: AuthContext,
        campaign_id: UUID,
        task_id: UUID,
        *,
        assignee_user_id: UUID,
        version: int | None = None,
    ) -> CampaignTask:
        campaign = await self._load_writable(ctx, campaign_id)
        task = await self.session.get(CampaignTask, task_id)
        if task is None or task.deleted_at is not None or task.campaign_id != campaign.id:
            raise NotFoundError("Task not found")
        self._assert_version(task, version)
        if task.status in {"DONE", "CANCELLED"}:
            raise AppError(
                "INVALID_TRANSITION",
                "A completed or cancelled task cannot be assigned",
                409,
            )
        await self._assert_assignee(assignee_user_id)
        previous = task.assignee_user_id
        task.assignee_user_id = assignee_user_id
        task.updated_by = ctx.user_id
        await self._flush_versioned()
        await self._emit_task_assigned(ctx, campaign, task)
        await self.audit.record_from_auth(
            ctx,
            action="campaign_task.assigned",
            entity_type="CampaignTask",
            entity_id=task.id,
            previous_state={"assignee_user_id": str(previous) if previous else None},
            new_state={"assignee_user_id": str(task.assignee_user_id)},
            organization_id=campaign.organization_id,
        )
        return task

    async def transition_task(
        self,
        ctx: AuthContext,
        campaign_id: UUID,
        task_id: UUID,
        *,
        action: str,
        version: int | None = None,
    ) -> CampaignTask:
        campaign = await self._load_writable(ctx, campaign_id)
        task = await self.session.get(CampaignTask, task_id)
        if task is None or task.deleted_at is not None or task.campaign_id != campaign.id:
            raise NotFoundError("Task not found")
        self._assert_version(task, version)
        target = task_target_for_action(action)
        task_transition_action(task.status, target)
        previous = task.status
        task.status = target
        task.updated_by = ctx.user_id
        await self._flush_versioned()
        if target == "DONE":
            await self._emit(
                ctx,
                event_type=CAMPAIGN_TASK_COMPLETED,
                aggregate_type="CampaignTask",
                aggregate_id=task.id,
                organization_id=campaign.organization_id,
                payload={
                    "campaign_id": str(campaign.id),
                    "previous_status": previous,
                },
            )
            await self._notify(
                user_id=task.assignee_user_id,
                notification_type="campaign.task_completed",
                title="Campaign task completed",
                body=f"A campaign task was completed: {task.title}",
            )
        await self.audit.record_from_auth(
            ctx,
            action=f"campaign_task.{action}",
            entity_type="CampaignTask",
            entity_id=task.id,
            previous_state={"status": previous},
            new_state={"status": task.status},
            organization_id=campaign.organization_id,
        )
        return task

    async def list_links(self, ctx: AuthContext, campaign_id: UUID) -> list[CampaignLink]:
        await self._load_writable(ctx, campaign_id)
        rows = (
            await self.session.execute(
                select(CampaignLink).where(
                    CampaignLink.campaign_id == campaign_id,
                    CampaignLink.deleted_at.is_(None),
                )
            )
        ).scalars().all()
        return list(rows)

    async def _assert_subject(self, *, subject_type: str, subject_id: UUID, organization_id: UUID) -> None:
        if subject_type not in SUBJECT_TYPES:
            raise AppError(
                "INVALID_SUBJECT_TYPE",
                "Campaign links are limited to ARTIST, RELEASE, or EVENT",
                409,
                "Album is a Release. Concert is an Event. Other types are rejected.",
            )
        if subject_type == "ARTIST":
            row = await self.session.get(Artist, subject_id)
            if row is None or row.deleted_at is not None:
                raise AppError("SUBJECT_NOT_FOUND", "Linked artist was not found", 409)
            if row.primary_org_id != organization_id:
                raise AppError("SUBJECT_ORG_MISMATCH", "Linked subject is not in this organization", 409)
            return
        if subject_type == "RELEASE":
            row = await self.session.get(Release, subject_id)
            if row is None or row.deleted_at is not None:
                raise AppError("SUBJECT_NOT_FOUND", "Linked release was not found", 409)
            if row.primary_org_id != organization_id:
                raise AppError("SUBJECT_ORG_MISMATCH", "Linked subject is not in this organization", 409)
            return
        event = await self.session.get(Event, subject_id)
        if event is None or event.deleted_at is not None:
            raise AppError("SUBJECT_NOT_FOUND", "Linked event was not found", 409)
        if event.organization_id != organization_id:
            raise AppError("SUBJECT_ORG_MISMATCH", "Linked subject is not in this organization", 409)

    async def add_link(
        self,
        ctx: AuthContext,
        campaign_id: UUID,
        *,
        subject_type: str,
        subject_id: UUID,
    ) -> CampaignLink:
        campaign = await self._load_writable(ctx, campaign_id)
        kind = subject_type.strip().upper()
        await self._assert_subject(
            subject_type=kind,
            subject_id=subject_id,
            organization_id=campaign.organization_id,
        )
        link = CampaignLink(
            campaign_id=campaign.id,
            subject_type=kind,
            subject_id=subject_id,
            created_by=ctx.user_id,
            updated_by=ctx.user_id,
        )
        self.session.add(link)
        try:
            await self.session.flush()
        except IntegrityError as exc:
            raise ConflictError("This subject is already linked to the campaign") from exc
        await self.audit.record_from_auth(
            ctx,
            action="campaign_link.created",
            entity_type="CampaignLink",
            entity_id=link.id,
            new_state={"subject_type": link.subject_type, "subject_id": str(link.subject_id)},
            organization_id=campaign.organization_id,
        )
        return link

    async def list_assets(self, ctx: AuthContext, campaign_id: UUID) -> list[CampaignAsset]:
        await self._load_writable(ctx, campaign_id)
        rows = (
            await self.session.execute(
                select(CampaignAsset).where(
                    CampaignAsset.campaign_id == campaign_id,
                    CampaignAsset.deleted_at.is_(None),
                )
            )
        ).scalars().all()
        return list(rows)

    async def add_asset(
        self,
        ctx: AuthContext,
        campaign_id: UUID,
        *,
        media_asset_id: UUID,
    ) -> CampaignAsset:
        campaign = await self._load_writable(ctx, campaign_id)
        asset = await self.session.get(MediaAsset, media_asset_id)
        if asset is None or asset.deleted_at is not None:
            raise AppError("MEDIA_NOT_FOUND", "Media asset was not found", 409)
        if asset.storage_class != "campaign_asset":
            raise AppError(
                "INVALID_STORAGE_CLASS",
                "Campaign assets must use storage_class campaign_asset",
                409,
            )
        if asset.status != "READY":
            raise AppError(
                "MEDIA_NOT_READY",
                "Only READY campaign_asset uploads can be attached",
                409,
            )
        row = CampaignAsset(
            campaign_id=campaign.id,
            media_asset_id=asset.id,
            created_by=ctx.user_id,
            updated_by=ctx.user_id,
        )
        self.session.add(row)
        try:
            await self.session.flush()
        except IntegrityError as exc:
            raise ConflictError("This media asset is already attached") from exc
        await self.audit.record_from_auth(
            ctx,
            action="campaign_asset.attached",
            entity_type="CampaignAsset",
            entity_id=row.id,
            new_state={"media_asset_id": str(row.media_asset_id)},
            organization_id=campaign.organization_id,
        )
        return row

    async def list_channels(self, ctx: AuthContext, campaign_id: UUID) -> list[CampaignChannel]:
        await self._load_writable(ctx, campaign_id)
        rows = (
            await self.session.execute(
                select(CampaignChannel).where(
                    CampaignChannel.campaign_id == campaign_id,
                    CampaignChannel.deleted_at.is_(None),
                )
            )
        ).scalars().all()
        return list(rows)

    async def add_channel(
        self,
        ctx: AuthContext,
        campaign_id: UUID,
        *,
        code: str,
    ) -> CampaignChannel:
        campaign = await self._load_writable(ctx, campaign_id)
        normalized = code.strip().upper()
        if normalized not in CHANNEL_CODES:
            raise AppError(
                "INVALID_CHANNEL_CODE",
                "Channel codes are provider-agnostic data values",
                409,
                "Allowed: IN_APP, EMAIL, SOCIAL, PRESS, OTHER. No vendor adapters.",
            )
        row = CampaignChannel(
            campaign_id=campaign.id,
            code=normalized,
            created_by=ctx.user_id,
            updated_by=ctx.user_id,
        )
        self.session.add(row)
        try:
            await self.session.flush()
        except IntegrityError as exc:
            raise ConflictError("This channel is already on the campaign") from exc
        await self.audit.record_from_auth(
            ctx,
            action="campaign_channel.added",
            entity_type="CampaignChannel",
            entity_id=row.id,
            new_state={"code": row.code},
            organization_id=campaign.organization_id,
        )
        return row

    async def list_kpi_targets(self, ctx: AuthContext, campaign_id: UUID) -> list[CampaignKpiTarget]:
        await self._load_writable(ctx, campaign_id)
        rows = (
            await self.session.execute(
                select(CampaignKpiTarget).where(
                    CampaignKpiTarget.campaign_id == campaign_id,
                    CampaignKpiTarget.deleted_at.is_(None),
                )
            )
        ).scalars().all()
        return list(rows)

    async def add_kpi_target(
        self,
        ctx: AuthContext,
        campaign_id: UUID,
        *,
        metric_key: str,
        target_value: int,
    ) -> CampaignKpiTarget:
        campaign = await self._load_writable(ctx, campaign_id)
        if target_value < 0:
            raise AppError("VALIDATION_ERROR", "KPI target must be non-negative", 422)
        row = CampaignKpiTarget(
            campaign_id=campaign.id,
            metric_key=metric_key.strip(),
            target_value=target_value,
            created_by=ctx.user_id,
            updated_by=ctx.user_id,
        )
        self.session.add(row)
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx,
            action="campaign_kpi_target.created",
            entity_type="CampaignKpiTarget",
            entity_id=row.id,
            new_state={"metric_key": row.metric_key, "target_value": row.target_value},
            organization_id=campaign.organization_id,
        )
        return row

    def attribution_status(self) -> str:
        return ATTRIBUTION_UNDEFINED

    async def request_expense(
        self,
        ctx: AuthContext,
        campaign_id: UUID,
        *,
        category: str,
        amount_minor: int,
        currency_code: str,
    ) -> Expense:
        campaign = await self._load_writable(ctx, campaign_id)
        if campaign.budget_amount_minor is None or campaign.currency_code is None:
            raise AppError(
                "BUDGET_REQUIRED",
                "A planning budget is required before requesting spend",
                409,
                "Null budget blocks expense requests (Q-P12-07). Budget is not a journal.",
            )
        money = Money(amount_minor, currency_code)
        if money.currency_code != campaign.currency_code:
            raise AppError(
                "CURRENCY_MISMATCH",
                "Expense currency must match the campaign budget currency",
                409,
            )
        committed, committed_currency = await self.finance.committed_campaign_spend(
            campaign.organization_id,
            campaign.id,
        )
        if committed_currency is not None and committed_currency != campaign.currency_code:
            raise AppError(
                "CURRENCY_MISMATCH",
                "Existing campaign expenses use a different currency than the budget",
                409,
            )
        if committed + money.amount_minor > campaign.budget_amount_minor:
            raise AppError(
                "BUDGET_CAP_EXCEEDED",
                "This request would exceed the campaign budget cap",
                409,
            )
        return await self.finance.create_campaign_expense_draft(
            ctx,
            campaign_id=campaign.id,
            category=category,
            amount_minor=money.amount_minor,
            currency_code=money.currency_code,
            source_id=new_uuid(),
        )

    async def list_expenses(self, ctx: AuthContext, campaign_id: UUID) -> list[Expense]:
        campaign = await self._load_writable(ctx, campaign_id)
        return await self.finance.list_campaign_expenses(campaign.organization_id, campaign.id)

    async def committed_spend(self, campaign: Campaign) -> tuple[int, str | None]:
        return await self.finance.committed_campaign_spend(campaign.organization_id, campaign.id)
