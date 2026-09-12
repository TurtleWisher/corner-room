"""Phase 13 Gate 2 — schema metadata and Alembic head (no live PostgreSQL required)."""

from __future__ import annotations

from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

from cornerroom.modules.analytics.domain.models import (
    AnalyticsEvent,
    DailyCampaignMetrics,
    DailyEventMetrics,
    DailyTrackMetrics,
)
from cornerroom.modules.notifications.domain.models import (
    Notification,
    NotificationDelivery,
    NotificationPreference,
)
from cornerroom.modules.search.domain.models import SearchDocument


def test_alembic_sole_head_is_0014() -> None:
    cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    script = ScriptDirectory.from_config(cfg)
    assert script.get_heads() == ["0014_notifications_search_analytics"]
    rev = script.get_revision("0014_notifications_search_analytics")
    assert rev is not None
    assert rev.down_revision == "0013_marketing_campaigns"


def test_notification_additive_columns_exist() -> None:
    cols = set(Notification.__table__.c.keys())
    assert {"correlation_id", "organization_id", "category", "consumer", "source_event_id"} <= cols
    delivery = set(NotificationDelivery.__table__.c.keys())
    assert {"next_attempt_at", "last_error", "provider_code"} <= delivery
    prefs = set(NotificationPreference.__table__.c.keys())
    assert {"quiet_hours_start", "quiet_hours_end", "quiet_hours_timezone"} <= prefs


def test_search_document_identity_and_visibility() -> None:
    table = SearchDocument.__table__
    assert table.schema == "search"
    names = {uq.name for uq in table.constraints if uq.name}
    assert "uq_search_documents_entity" in names
    assert table.c.visibility.default.arg == "UNAVAILABLE"


def test_analytics_has_no_forbidden_product_columns() -> None:
    forbidden = {
        "unique_listeners",
        "unique_listener_count",
        "activation",
        "activation_count",
        "cac",
        "roas",
        "stream_rate",
        "attribution_actual",
    }
    for model in (AnalyticsEvent, DailyTrackMetrics, DailyEventMetrics, DailyCampaignMetrics):
        cols = set(model.__table__.c.keys())
        assert forbidden.isdisjoint(cols)
    assert AnalyticsEvent.__table__.schema == "analytics"
    names = {uq.name for uq in AnalyticsEvent.__table__.constraints if uq.name}
    assert "uq_analytics_events_source_consumer" in names
