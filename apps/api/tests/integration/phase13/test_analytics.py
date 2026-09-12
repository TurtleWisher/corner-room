"""Analytics integration: ingest via outbox, replay, honesty, aggregation."""

from __future__ import annotations

from datetime import date

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

import pytest

from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.infra.outbox_dispatch import dispatch_outbox
from cornerroom.kernel.events import CAMPAIGN_STARTED, EVENT_PUBLISHED, TRACK_LIKED, TRACK_PLAYED
from cornerroom.modules.analytics.application.service import AnalyticsService
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
from tests.integration.phase13.graph import Phase13Graph, domain_event, p13_time


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_analytics_ingest_track_played_via_outbox(
    pg_session: AsyncSession,
    p13_graph: Phase13Graph,
) -> None:
    g = p13_graph
    durations = (10000, 20000, 30000)
    completed_flags = (False, False, True)
    for index, (duration, completed) in enumerate(zip(durations, completed_flags, strict=True)):
        event = domain_event(
            event_type=TRACK_PLAYED,
            producer="streaming",
            aggregate_type="Track",
            aggregate_id=g.track_a.id,
            payload={
                "track_id": str(g.track_a.id),
                "completed": completed,
                "duration_ms": duration,
            },
            organization_id=g.org_a.id,
            occurred_at=p13_time(minutes=index),
        )
        row = await enqueue_outbox(pg_session, event)
        await dispatch_outbox(pg_session, row)

    liked = domain_event(
        event_type=TRACK_LIKED,
        producer="streaming",
        aggregate_type="Track",
        aggregate_id=g.track_a.id,
        payload={"track_id": str(g.track_a.id)},
        organization_id=g.org_a.id,
        occurred_at=p13_time(minutes=4),
    )
    await dispatch_outbox(pg_session, await enqueue_outbox(pg_session, liked))
    published = domain_event(
        event_type=EVENT_PUBLISHED,
        producer="events",
        aggregate_type="Event",
        aggregate_id=g.event_a.id,
        payload={"event_id": str(g.event_a.id)},
        organization_id=g.org_a.id,
        occurred_at=p13_time(minutes=5),
    )
    await dispatch_outbox(pg_session, await enqueue_outbox(pg_session, published))
    started = domain_event(
        event_type=CAMPAIGN_STARTED,
        producer="campaigns",
        aggregate_type="Campaign",
        aggregate_id=g.campaign_a.id,
        payload={"campaign_id": str(g.campaign_a.id)},
        organization_id=g.org_a.id,
        occurred_at=p13_time(minutes=6),
    )
    await dispatch_outbox(pg_session, await enqueue_outbox(pg_session, started))

    plays = (
        (
            await pg_session.execute(
                select(AnalyticsEvent).where(AnalyticsEvent.event_type == TRACK_PLAYED)
            )
        )
        .scalars()
        .all()
    )
    assert len(plays) == 3
    daily = (
        await pg_session.execute(
            select(DailyTrackMetrics).where(DailyTrackMetrics.track_id == g.track_a.id)
        )
    ).scalar_one()
    assert daily.metric_date == date(2026, 9, 10)
    assert daily.organization_id == g.org_a.id
    assert daily.play_count == 3
    assert daily.completed_play_count == 1
    assert daily.listen_duration_ms == 60000
    assert daily.play_count >= 0
    assert "unique_listeners" not in DailyTrackMetrics.__table__.c.keys()

    svc = AnalyticsService(pg_session)
    assert svc.unique_listeners() == UNIQUE_LISTENERS_NOT_AVAILABLE
    assert svc.attribution() == "ATTRIBUTION_UNDEFINED"
    assert svc._money_tile()["status"] == "NOT_AVAILABLE"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_analytics_replay_does_not_double_count(
    pg_session: AsyncSession,
    p13_graph: Phase13Graph,
) -> None:
    g = p13_graph
    event = domain_event(
        event_type=TRACK_PLAYED,
        producer="streaming",
        aggregate_type="Track",
        aggregate_id=g.track_a.id,
        payload={"track_id": str(g.track_a.id), "completed": True, "duration_ms": 15000},
        organization_id=g.org_a.id,
        occurred_at=p13_time(),
    )
    row = await enqueue_outbox(pg_session, event)
    await dispatch_outbox(pg_session, row)
    before = (
        await pg_session.execute(select(func.count()).select_from(AnalyticsEvent))
    ).scalar_one()
    daily_before = (
        await pg_session.execute(
            select(DailyTrackMetrics).where(DailyTrackMetrics.track_id == g.track_a.id)
        )
    ).scalar_one()
    await dispatch_outbox(pg_session, row)
    after = (
        await pg_session.execute(select(func.count()).select_from(AnalyticsEvent))
    ).scalar_one()
    daily_after = (
        await pg_session.execute(
            select(DailyTrackMetrics).where(DailyTrackMetrics.track_id == g.track_a.id)
        )
    ).scalar_one()
    assert after == before
    assert daily_after.play_count == daily_before.play_count
    assert daily_after.listen_duration_ms == daily_before.listen_duration_ms

    rebuilt = await AnalyticsService(pg_session).aggregate_daily_metrics(date(2026, 9, 10))
    assert rebuilt >= 1
    daily_rebuilt = (
        await pg_session.execute(
            select(DailyTrackMetrics).where(DailyTrackMetrics.track_id == g.track_a.id)
        )
    ).scalar_one()
    assert daily_rebuilt.play_count == daily_before.play_count
    rebuilt_again = await AnalyticsService(pg_session).aggregate_daily_metrics(date(2026, 9, 10))
    assert rebuilt_again >= 1
    daily_twice = (
        await pg_session.execute(
            select(DailyTrackMetrics).where(DailyTrackMetrics.track_id == g.track_a.id)
        )
    ).scalar_one()
    assert daily_twice.play_count == daily_before.play_count


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_analytics_constraints_and_no_playback_copy(
    pg_session: AsyncSession,
    p13_graph: Phase13Graph,
) -> None:
    del p13_graph
    names = (
        (
            await pg_session.execute(
                text(
                    """
                SELECT conname FROM pg_constraint
                WHERE conname IN (
                    'uq_analytics_events_source_consumer',
                    'uq_daily_track_metrics_date_track_version',
                    'uq_daily_event_metrics_date_event_version',
                    'uq_daily_campaign_metrics_date_campaign_version'
                )
                """
                )
            )
        )
        .scalars()
        .all()
    )
    assert "uq_analytics_events_source_consumer" in names
    assert "uq_daily_track_metrics_date_track_version" in names
    tables = (
        (
            await pg_session.execute(
                text(
                    """
                SELECT tablename FROM pg_tables
                WHERE schemaname = 'analytics'
                """
                )
            )
        )
        .scalars()
        .all()
    )
    assert "analytics_events" in tables
    assert "daily_track_metrics" in tables
    assert "daily_event_metrics" in tables
    assert "daily_campaign_metrics" in tables
    assert "playback_events" not in tables
    assert "analytics_ledger" not in tables
    assert attribution_status() == "ATTRIBUTION_UNDEFINED"
    assert DailyEventMetrics.__table__.schema == "analytics"
    assert DailyCampaignMetrics.__table__.schema == "analytics"
    cols = set(DailyTrackMetrics.__table__.c.keys())
    assert "unique_listeners" not in cols
    assert "cac" not in cols
    assert "roas" not in cols
    assert "activation" not in cols
