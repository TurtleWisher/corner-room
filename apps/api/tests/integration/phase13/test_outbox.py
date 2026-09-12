"""Outbox: existing bus only, independent consumer failure, idempotent replay."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

import pytest

from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.infra import outbox_dispatch
from cornerroom.kernel.events import ARTIST_ACTIVATED, TRACK_PLAYED, USER_REGISTERED
from cornerroom.modules.analytics.application.consumers import consume_analytics_event
from cornerroom.modules.analytics.domain.metrics import CONSUMER_ANALYTICS
from cornerroom.modules.analytics.domain.models import AnalyticsEvent, DailyTrackMetrics
from cornerroom.modules.notifications.application.consumers import consume_notification_event
from cornerroom.modules.notifications.domain.models import Notification
from cornerroom.modules.notifications.domain.policy import CONSUMER_NOTIFICATIONS
from cornerroom.modules.search.application.consumers import consume_search_event
from cornerroom.modules.search.domain.models import SearchDocument
from tests.integration.phase13.graph import Phase13Graph, domain_event, p13_time


async def _failing_consumer(_event, _session) -> None:
    raise RuntimeError("qa_p13_controlled_consumer_failure")


def test_phase13_uses_existing_outbox_only() -> None:
    from pathlib import Path

    root = Path(__file__).resolve().parents[3] / "src" / "cornerroom"
    notify = (root / "modules" / "notifications" / "application" / "consumers.py").read_text(
        encoding="utf-8"
    )
    search = (root / "modules" / "search" / "application" / "consumers.py").read_text(
        encoding="utf-8"
    )
    analytics = (root / "modules" / "analytics" / "application" / "consumers.py").read_text(
        encoding="utf-8"
    )
    dispatch = (root / "infra" / "outbox_dispatch.py").read_text(encoding="utf-8")
    assert "SIDE_CONSUMERS" in dispatch
    assert "consume_notification_event" in dispatch
    assert "consume_search_event" in dispatch
    assert "consume_analytics_event" in dispatch
    for blob in (notify, search, analytics, dispatch):
        assert "kafka" not in blob.lower()
        assert "elasticsearch" not in blob.lower()
        assert "second_outbox" not in blob.lower()
    names = {fn.__name__ for fn in outbox_dispatch.SIDE_CONSUMERS}
    assert names == {
        "consume_notification_event",
        "consume_search_event",
        "consume_analytics_event",
    }


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_notification_failure_does_not_skip_search_or_analytics(
    pg_session: AsyncSession,
    p13_graph: Phase13Graph,
) -> None:
    g = p13_graph
    original = list(outbox_dispatch.SIDE_CONSUMERS)
    outbox_dispatch.SIDE_CONSUMERS[:] = [
        _failing_consumer,
        consume_search_event,
        consume_analytics_event,
    ]
    try:
        event = domain_event(
            event_type=ARTIST_ACTIVATED,
            producer="artists",
            aggregate_type="Artist",
            aggregate_id=g.artist_a.id,
            payload={"artist_id": str(g.artist_a.id)},
            organization_id=g.org_a.id,
        )
        row = await enqueue_outbox(pg_session, event)
        with pytest.raises(RuntimeError, match="qa_p13_controlled_consumer_failure"):
            await outbox_dispatch.dispatch_outbox(pg_session, row)
        docs = (
            await pg_session.execute(
                select(func.count())
                .select_from(SearchDocument)
                .where(SearchDocument.entity_id == g.artist_a.id)
            )
        ).scalar_one()
        assert docs == 1
        analytics_count = (
            await pg_session.execute(select(func.count()).select_from(AnalyticsEvent))
        ).scalar_one()
        assert analytics_count == 0
    finally:
        outbox_dispatch.SIDE_CONSUMERS[:] = original

    played = domain_event(
        event_type=TRACK_PLAYED,
        producer="streaming",
        aggregate_type="Track",
        aggregate_id=g.track_a.id,
        payload={"track_id": str(g.track_a.id), "completed": False, "duration_ms": 10000},
        organization_id=g.org_a.id,
        occurred_at=p13_time(),
    )
    outbox_dispatch.SIDE_CONSUMERS[:] = [
        consume_notification_event,
        _failing_consumer,
        consume_analytics_event,
    ]
    try:
        row = await enqueue_outbox(pg_session, played)
        with pytest.raises(RuntimeError, match="qa_p13_controlled_consumer_failure"):
            await outbox_dispatch.dispatch_outbox(pg_session, row)
        facts = (
            await pg_session.execute(
                select(func.count())
                .select_from(AnalyticsEvent)
                .where(AnalyticsEvent.source_event_id == row.id)
            )
        ).scalar_one()
        assert facts == 1
    finally:
        outbox_dispatch.SIDE_CONSUMERS[:] = original


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_outbox_replay_is_idempotent(
    pg_session: AsyncSession,
    p13_graph: Phase13Graph,
) -> None:
    g = p13_graph
    registered = domain_event(
        event_type=USER_REGISTERED,
        producer="identity",
        aggregate_type="User",
        aggregate_id=g.user_a.id,
        payload={"email": g.user_a.email, "user_id": str(g.user_a.id)},
        actor_id=g.user_a.id,
    )
    row = await enqueue_outbox(pg_session, registered)
    await outbox_dispatch.dispatch_outbox(pg_session, row)
    await outbox_dispatch.dispatch_outbox(pg_session, row)
    notes = (
        (
            await pg_session.execute(
                select(Notification).where(
                    Notification.user_id == g.user_a.id,
                    Notification.consumer == CONSUMER_NOTIFICATIONS,
                    Notification.source_event_id == row.id,
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(notes) == 1

    played = domain_event(
        event_type=TRACK_PLAYED,
        producer="streaming",
        aggregate_type="Track",
        aggregate_id=g.track_a.id,
        payload={"track_id": str(g.track_a.id), "completed": True, "duration_ms": 30000},
        organization_id=g.org_a.id,
        occurred_at=p13_time(minutes=1),
    )
    play_row = await enqueue_outbox(pg_session, played)
    await outbox_dispatch.dispatch_outbox(pg_session, play_row)
    await outbox_dispatch.dispatch_outbox(pg_session, play_row)
    facts = (
        (
            await pg_session.execute(
                select(AnalyticsEvent).where(
                    AnalyticsEvent.source_event_id == play_row.id,
                    AnalyticsEvent.consumer == CONSUMER_ANALYTICS,
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(facts) == 1
    daily = (
        await pg_session.execute(
            select(DailyTrackMetrics).where(DailyTrackMetrics.track_id == g.track_a.id)
        )
    ).scalar_one()
    assert daily.play_count == 1
    assert daily.completed_play_count == 1
    assert daily.listen_duration_ms == 30000

    activated = domain_event(
        event_type=ARTIST_ACTIVATED,
        producer="artists",
        aggregate_type="Artist",
        aggregate_id=g.artist_a.id,
        payload={"artist_id": str(g.artist_a.id)},
        organization_id=g.org_a.id,
    )
    search_row = await enqueue_outbox(pg_session, activated)
    await outbox_dispatch.dispatch_outbox(pg_session, search_row)
    await outbox_dispatch.dispatch_outbox(pg_session, search_row)
    docs = (
        (
            await pg_session.execute(
                select(SearchDocument).where(
                    SearchDocument.entity_type == "ARTIST",
                    SearchDocument.entity_id == g.artist_a.id,
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(docs) == 1
