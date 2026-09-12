"""Ops visibility. Read-only. No ledger mutation, no force payout, no secret dump."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError
from cornerroom.infra.logging import SENSITIVE_KEY_FRAGMENTS
from cornerroom.infra.outbox import OutboxEvent
from cornerroom.kernel.health_status import (
    EMAIL_STUB_HONESTY,
    NOT_AVAILABLE,
    NOT_CONFIGURED,
    overall_status,
    public_dependency_checks,
)
from cornerroom.kernel.pagination import clamp_limit, decode_cursor, encode_cursor
from cornerroom.modules.analytics.domain.metrics import (
    UNIQUE_LISTENERS_NOT_AVAILABLE,
    attribution_status,
)
from cornerroom.modules.analytics.domain.models import (
    AnalyticsEvent,
    DailyCampaignMetrics,
    DailyEventMetrics,
    DailyTrackMetrics,
)
from cornerroom.modules.audit.application.service import FORBIDDEN_KEYS
from cornerroom.modules.audit.domain.models import AuditLog
from cornerroom.modules.finance.domain.models import FinanceTransaction, Payout, ReconciliationItem
from cornerroom.modules.notifications.domain.models import Notification, NotificationDelivery
from cornerroom.modules.notifications.domain.policy import CHANNEL_AVAILABILITY
from cornerroom.modules.search.domain.models import SearchDocument
from cornerroom.modules.search.domain.visibility import VISIBILITY_UNAVAILABLE

REGISTERED_JOBS = (
    "drain_outbox",
    "calculate_royalty_run",
    "process_notification_delivery",
    "rebuild_search_index",
    "aggregate_daily_metrics",
)


def _is_forbidden_key(key: str) -> bool:
    lowered = str(key).lower()
    if lowered in FORBIDDEN_KEYS:
        return True
    return any(fragment in lowered for fragment in SENSITIVE_KEY_FRAGMENTS)


def _scrub(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: ("***" if _is_forbidden_key(key) else _scrub(item))
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_scrub(item) for item in value]
    return value


class OpsService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def overview(
        self,
        *,
        organization_id: UUID | None,
        database_ok: bool,
        redis_ok: bool,
        treat_email_stub_as_degraded: bool = False,
    ) -> dict[str, Any]:
        scoped = organization_id is not None
        outbox = await self._counts(OutboxEvent.status)
        deliveries = await self._counts(NotificationDelivery.status)
        notify_channels = await self._counts(NotificationDelivery.channel)
        search_visibility = await self._counts(SearchDocument.visibility)
        finance_tx = (
            await self._counts(
                FinanceTransaction.status,
                organization_id=organization_id,
                org_column=FinanceTransaction.organization_id,
            )
            if scoped
            else {}
        )
        payouts = (
            await self._counts(
                Payout.status,
                organization_id=organization_id,
                org_column=Payout.organization_id,
            )
            if scoped
            else {}
        )
        reconciliation = (
            await self._counts(
                ReconciliationItem.status,
                organization_id=organization_id,
                org_column=ReconciliationItem.organization_id,
            )
            if scoped
            else {}
        )
        notify_stmt = select(func.count()).select_from(Notification)
        analytics_stmt = select(func.count()).select_from(AnalyticsEvent)
        search_stmt = select(func.count()).select_from(SearchDocument)
        audit_stmt = select(func.count()).select_from(AuditLog)
        if scoped:
            notify_stmt = notify_stmt.where(Notification.organization_id == organization_id)
            analytics_stmt = analytics_stmt.where(AnalyticsEvent.organization_id == organization_id)
            search_stmt = search_stmt.where(SearchDocument.organization_id == organization_id)
            audit_stmt = audit_stmt.where(AuditLog.organization_id == organization_id)
            notification_count = int((await self.session.execute(notify_stmt)).scalar_one())
            analytics_count = int((await self.session.execute(analytics_stmt)).scalar_one())
            search_count = int((await self.session.execute(search_stmt)).scalar_one())
            audit_count = int((await self.session.execute(audit_stmt)).scalar_one())
            latest_metric_date = await self._latest_metric_date(organization_id)
        else:
            notification_count = 0
            analytics_count = 0
            search_count = 0
            audit_count = 0
            latest_metric_date = None
        workspace_note = "organization" if scoped else "workspace_required"
        return {
            "health": {
                "status": overall_status(
                    database_ok=database_ok,
                    redis_ok=redis_ok,
                    treat_email_stub_as_degraded=treat_email_stub_as_degraded,
                ),
                "checks": public_dependency_checks(database_ok=database_ok, redis_ok=redis_ok),
            },
            "outbox": {
                "counts_by_status": outbox,
                "failed_count": int(outbox.get("FAILED", 0)),
            },
            "jobs": {
                "registered": list(REGISTERED_JOBS),
                "worker_process": {"status": NOT_CONFIGURED},
                "source_of_truth": "postgres_outbox",
            },
            "notifications": {
                "count": notification_count,
                "deliveries_by_status": deliveries if scoped else {},
                "deliveries_by_channel": notify_channels if scoped else {},
                "channels": dict(CHANNEL_AVAILABILITY),
                "email": {"status": NOT_CONFIGURED, "honesty": EMAIL_STUB_HONESTY},
                "sms": {"status": NOT_AVAILABLE},
                "push": {"status": NOT_AVAILABLE},
                "scope": workspace_note,
            },
            "search": {
                "document_count": search_count,
                "counts_by_visibility": search_visibility if scoped else {},
                "default_visibility": VISIBILITY_UNAVAILABLE,
                "rebuild": {"status": NOT_CONFIGURED},
                "scope": workspace_note,
            },
            "analytics": {
                "ingested_event_count": analytics_count,
                "latest_metric_date": latest_metric_date,
                "unique_listeners": UNIQUE_LISTENERS_NOT_AVAILABLE,
                "money": {"status": NOT_AVAILABLE},
                "attribution": attribution_status(),
                "scope": workspace_note,
            },
            "finance": {
                "visibility": "counts_only" if scoped else "workspace_required",
                "scope": workspace_note,
                "transactions_by_status": finance_tx,
                "payouts_by_status": payouts,
                "reconciliation_by_status": reconciliation,
                "mutation": "forbidden",
                "force_payout": "forbidden",
                "repair": "forbidden",
            },
            "security": {
                "source": "audit",
                "record_count": audit_count,
                "scope": workspace_note,
                "impersonation": "not_implemented",
            },
        }

    async def list_outbox(
        self,
        *,
        status: str | None = None,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> tuple[list[OutboxEvent], str | None]:
        page = clamp_limit(limit)
        stmt = select(OutboxEvent).order_by(OutboxEvent.created_at.desc(), OutboxEvent.id.desc())
        if status:
            stmt = stmt.where(OutboxEvent.status == status)
        if cursor:
            try:
                data = decode_cursor(cursor)
            except Exception as exc:
                raise AppError("VALIDATION_ERROR", "Invalid cursor", 422) from exc
            stmt = stmt.where(OutboxEvent.created_at < data["t"])
        stmt = stmt.limit(page + 1)
        rows = list((await self.session.execute(stmt)).scalars().all())
        next_cursor = None
        if len(rows) > page:
            last = rows[page - 1]
            next_cursor = encode_cursor(last.created_at.isoformat(), last.id)
            rows = rows[:page]
        return rows, next_cursor

    def serialize_outbox(self, row: OutboxEvent) -> dict[str, Any]:
        return {
            "id": row.id,
            "event_type": row.event_type,
            "status": row.status,
            "aggregate_type": row.aggregate_type,
            "aggregate_id": row.aggregate_id,
            "correlation_id": row.correlation_id,
            "attempts": row.attempts,
            "last_error": row.last_error,
            "created_at": row.created_at,
            "published_at": row.published_at,
            "next_attempt_at": row.next_attempt_at,
            "payload": _scrub(row.payload),
        }

    async def _latest_metric_date(self, organization_id: UUID) -> str | None:
        dates = []
        for model in (DailyTrackMetrics, DailyEventMetrics, DailyCampaignMetrics):
            stmt = select(func.max(model.metric_date)).where(model.organization_id == organization_id)
            value = (await self.session.execute(stmt)).scalar_one_or_none()
            if value is not None:
                dates.append(value)
        if not dates:
            return None
        return max(dates).isoformat()

    async def _counts(
        self,
        column: Any,
        *,
        organization_id: UUID | None = None,
        org_column: Any | None = None,
    ) -> dict[str, int]:
        stmt = select(column, func.count()).group_by(column)
        if organization_id is not None and org_column is not None:
            stmt = stmt.where(org_column == organization_id)
        rows = (await self.session.execute(stmt)).all()
        return {str(status): int(count) for status, count in rows}
