"""arq worker — drains the Postgres outbox. Outbox is the source of truth."""

from __future__ import annotations

import structlog
from arq.connections import RedisSettings
from arq.cron import cron

from cornerroom.infra.db import dispose_engine, get_session_factory, init_engine
from cornerroom.infra.logging import configure_logging
from cornerroom.infra.outbox import (
    OUTBOX_PUBLISHED,
    claim_pending_outbox,
    mark_published,
    mark_retry_or_fail,
)
from cornerroom.infra.outbox_dispatch import dispatch_outbox
from cornerroom.infra.settings import get_settings

log = structlog.get_logger("worker")


async def drain_outbox(ctx: dict) -> int:
    settings = get_settings()
    factory = get_session_factory()
    published = 0
    async with factory() as session:
        rows = await claim_pending_outbox(session)
        for row in rows:
            if row.status == OUTBOX_PUBLISHED:
                continue
            try:
                await dispatch_outbox(session, row)
                await mark_published(session, row)
                published += 1
            except Exception as exc:
                log.exception("outbox_dispatch_failed", event_id=str(row.id), event_type=row.event_type)
                await session.refresh(row)
                await mark_retry_or_fail(
                    session,
                    row,
                    str(exc),
                    max_attempts=settings.outbox_max_attempts,
                    backoff_seconds=settings.outbox_backoff_seconds,
                )
        await session.commit()
    log.info("outbox_drained", published=published, operation="outbox.drain")
    return published


async def calculate_royalty_run(ctx: dict, run_id: str) -> str:
    """Retry-safe royalty calculation. Duplicates do not create extra lines."""
    from uuid import UUID

    from cornerroom.modules.royalties.application.service import RoyaltyService

    factory = get_session_factory()
    async with factory() as session:
        service = RoyaltyService(session)
        run = await service.complete_run(None, UUID(str(run_id)))
        await session.commit()
        return str(run.id)


async def process_notification_delivery(ctx: dict) -> int:
    """Retry email deliveries independently of OLTP. Stub sender only (Q-P13-10)."""
    from cornerroom.modules.notifications.application.service import NotificationService

    factory = get_session_factory()
    async with factory() as session:
        sent = await NotificationService(session).process_pending_email_deliveries()
        await session.commit()
        return sent


async def rebuild_search_index(ctx: dict) -> int:
    """Rebuild search documents for gaps (no ArtistUpdated / VenueActivated)."""
    from cornerroom.modules.search.application.service import SearchService

    factory = get_session_factory()
    async with factory() as session:
        count = await SearchService(session).rebuild()
        await session.commit()
        return count


async def aggregate_daily_metrics(ctx: dict, metric_date: str | None = None) -> int:
    """Idempotent daily_* rebuild from analytics_events. ASSUMED Asia/Dhaka."""
    from datetime import date

    from cornerroom.modules.analytics.application.service import AnalyticsService

    parsed = date.fromisoformat(metric_date) if metric_date else None
    factory = get_session_factory()
    async with factory() as session:
        count = await AnalyticsService(session).aggregate_daily_metrics(parsed)
        await session.commit()
        return count


async def startup(ctx: dict) -> None:
    from cornerroom.infra import models as _models  # noqa: F401
    from cornerroom.modules.finance.application.handlers import register_finance_handlers
    from cornerroom.modules.streaming.application.service import register_streaming_handlers

    settings = get_settings()
    configure_logging(settings.log_level, service="worker", environment=settings.app_env)
    register_streaming_handlers()
    register_finance_handlers()
    init_engine(settings)
    log.info("worker_started")


async def shutdown(ctx: dict) -> None:
    await dispose_engine()


def _redis_settings() -> RedisSettings:
    settings = get_settings()
    return RedisSettings.from_dsn(settings.redis_url)


class WorkerSettings:
    functions = [
        drain_outbox,
        calculate_royalty_run,
        process_notification_delivery,
        rebuild_search_index,
        aggregate_daily_metrics,
    ]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = _redis_settings()
    cron_jobs = [
        cron(drain_outbox, second={0, 15, 30, 45}),
        cron(process_notification_delivery, second={5, 20, 35, 50}),
    ]
    max_jobs = 10
    job_timeout = 120
    retry_jobs = True
