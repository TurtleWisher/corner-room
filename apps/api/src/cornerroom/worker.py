"""arq worker — drains the Postgres outbox. Outbox is the source of truth."""

from __future__ import annotations

import time

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


HOLD_EXPIRY_BATCH = 200


async def expire_ticket_holds(ctx: dict) -> int:
    """TTL job: expire ACTIVE holds past their TTL and return inventory (08_EVENT_ARCHITECTURE).

    Without it, an abandoned checkout keeps its tickets held (and a type SOLD_OUT, hidden from
    the public list) until someone else happens to try the same ticket type.
    """
    from cornerroom.modules.commerce.application.service import CheckoutService
    from cornerroom.modules.ticketing.application.service import TicketingService

    factory = get_session_factory()
    async with factory() as session:
        expired = await TicketingService(session).expire_due_holds(batch=HOLD_EXPIRY_BATCH)
        await session.commit()
    # Q-COM-03: unpaid orders whose hold expired (here, on checkout, or was released) are cancelled.
    async with factory() as session:
        cancelled = await CheckoutService(session).cancel_unpaid_ticket_orders(batch=HOLD_EXPIRY_BATCH)
        await session.commit()
    if expired:
        log.info("ticket_holds_expired", expired=expired, operation="ticketing.hold_expiry")
    if cancelled:
        log.info("unpaid_orders_cancelled", cancelled=cancelled, operation="commerce.order_cancel")
    return expired


async def expire_upload_intents(ctx: dict) -> int:
    """Close upload intents past their lifetime and delete their stored parts."""
    from cornerroom.modules.documents.application.uploads import UploadService

    factory = get_session_factory()
    async with factory() as session:
        expired = await UploadService(session, get_settings()).expire_due()
        await session.commit()
    if expired:
        log.info("upload_intents_expired", expired=expired, operation="documents.upload_expiry")
    return expired


MEDIA_JOBS_PER_RUN = 2
# How long one run keeps claiming due jobs (scheduling choice, not a business rule).
MEDIA_RUN_BUDGET_S = 40


async def run_media_jobs(ctx: dict) -> int:
    """Claim due media jobs (inspect, transcode) and run them; failures back off and retry.

    A run keeps claiming while work is due, within MEDIA_RUN_BUDGET_S: the copies an inspection
    queues are made in the same run instead of waiting for the next tick (the AUDIO Phase 9 pilot
    measured 38 s for a 40 s song, almost all of it waiting between ticks)."""
    from cornerroom.modules.documents.application.media_jobs import MediaJobService
    from cornerroom.modules.documents.application.media_tools import MediaToolError

    settings = get_settings()
    factory = get_session_factory()
    async with factory() as session:
        svc = MediaJobService(session, settings)
        await svc.reclaim_stalled()
        await svc.enqueue_missing_inspections()
        await svc.enqueue_missing_renditions()
        await session.commit()
    started = time.monotonic()
    done = 0
    while time.monotonic() - started < MEDIA_RUN_BUDGET_S:
        async with factory() as session:
            job_ids = await MediaJobService(session, settings).claim_due(batch=MEDIA_JOBS_PER_RUN)
            await session.commit()
        if not job_ids:
            break
        for job_id in job_ids:
            async with factory() as session:
                try:
                    await MediaJobService(session, settings).execute(job_id)
                    await session.commit()
                    done += 1
                    continue
                except MediaToolError as exc:
                    code = exc.code
                except Exception as exc:  # noqa: BLE001 - recorded on the job, retried with backoff
                    log.exception("media_job_failed", job_id=str(job_id))
                    code = type(exc).__name__.upper()
                await session.rollback()
                await MediaJobService(session, settings).record_failure(job_id, code)
                await session.commit()
                log.warning("media_job_retry_scheduled", job_id=str(job_id), error_code=code)
    return done


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
        expire_ticket_holds,
        expire_upload_intents,
        run_media_jobs,
    ]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = _redis_settings()
    cron_jobs = [
        cron(drain_outbox, second={0, 15, 30, 45}),
        cron(process_notification_delivery, second={5, 20, 35, 50}),
        cron(expire_ticket_holds, second={10, 40}),
        cron(expire_upload_intents, minute=set(range(0, 60, 10)), second=25),
        # Media jobs can run for minutes (long masters); their own timeout, not the 120 s default.
        cron(run_media_jobs, second={0, 15, 30, 45}, timeout=get_settings().media_job_timeout_seconds * 3, unique=True),
    ]
    max_jobs = 10
    job_timeout = 120
    retry_jobs = True
