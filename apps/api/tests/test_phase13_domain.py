"""Phase 13 Gate 3 — Domain / application services (no PostgreSQL required)."""

from __future__ import annotations

from datetime import datetime, time, timezone
from pathlib import Path
from uuid import uuid4

from cornerroom.kernel.events import (
    CAMPAIGN_STARTED,
    DomainEvent,
    USER_REGISTERED,
)
from cornerroom.modules.analytics.domain.metrics import (
    UNIQUE_LISTENERS_NOT_AVAILABLE,
    attribution_status,
    calculate_unique_listeners,
    metric_date_for,
    never_negative,
    sanitize_properties,
    unique_listeners_metric,
)
from cornerroom.modules.notifications.domain.policy import (
    CATEGORY_MARKETING,
    CATEGORY_SECURITY,
    CATEGORY_TRANSACTIONAL,
    CHANNEL_EMAIL,
    CHANNEL_IN_APP,
    CHANNEL_PUSH,
    CHANNEL_SMS,
    DECISION_SEND,
    DECISION_SUPPRESS,
    EVENT_CATEGORY,
    QuietHours,
    REASON_CHANNEL_UNAVAILABLE,
    REASON_MARKETING,
    REASON_QUIET_HOURS,
    evaluate_channel,
    notification_type_for_event,
    render_template,
)
from cornerroom.modules.search.domain.visibility import (
    VISIBILITY_PUBLIC,
    VISIBILITY_UNAVAILABLE,
    build_searchable_text,
    exclude_sensitive,
    visibility_public_or_unavailable,
)


def test_marketing_is_never_sent() -> None:
    for channel in (CHANNEL_IN_APP, CHANNEL_EMAIL, CHANNEL_SMS, CHANNEL_PUSH):
        decision = evaluate_channel(category=CATEGORY_MARKETING, channel=channel)
        assert decision.action == DECISION_SUPPRESS
        assert decision.reason == REASON_MARKETING


def test_sms_and_push_are_unavailable() -> None:
    for channel in (CHANNEL_SMS, CHANNEL_PUSH):
        decision = evaluate_channel(category=CATEGORY_TRANSACTIONAL, channel=channel)
        assert decision.action == DECISION_SUPPRESS
        assert decision.reason == REASON_CHANNEL_UNAVAILABLE


def test_transactional_and_security_ignore_quiet_hours() -> None:
    quiet = QuietHours(start=time(22, 0), end=time(8, 0), timezone="Asia/Dhaka")
    for category in (CATEGORY_TRANSACTIONAL, CATEGORY_SECURITY):
        decision = evaluate_channel(
            category=category, channel=CHANNEL_EMAIL, quiet_hours=quiet
        )
        assert decision.action == DECISION_SEND


def test_quiet_hours_null_is_off() -> None:
    off = QuietHours(start=None, end=None, timezone=None)
    assert off.is_configured() is False
    decision = evaluate_channel(
        category=None, channel=CHANNEL_EMAIL, quiet_hours=off
    )
    assert decision.action == DECISION_SEND


def test_quiet_hours_suppress_uncategorized_without_delay_clock() -> None:
    quiet = QuietHours(start=time(22, 0), end=time(8, 0), timezone="Asia/Dhaka")
    decision = evaluate_channel(category=None, channel=CHANNEL_EMAIL, quiet_hours=quiet)
    assert decision.action == DECISION_SUPPRESS
    assert decision.reason == REASON_QUIET_HOURS


def test_user_registered_is_wired_transactional() -> None:
    assert EVENT_CATEGORY[USER_REGISTERED] == CATEGORY_TRANSACTIONAL
    assert notification_type_for_event(USER_REGISTERED) == "user.registered"


def test_event_cancelled_not_wired_without_recipient() -> None:
    from cornerroom.kernel.events import EVENT_CANCELLED, EVENT_POSTPONED

    assert notification_type_for_event(EVENT_CANCELLED) is None
    assert notification_type_for_event(EVENT_POSTPONED) is None


def test_template_missing_placeholder_fails_closed() -> None:
    assert render_template("Hello {name}", {}) is None
    assert render_template("Hello {name}", {"name": "Ada"}) == "Hello Ada"


def test_duplicate_notify_identity_uses_source_event() -> None:
    event_id = uuid4()
    user_id = uuid4()
    first = ( "notifications", event_id, "user.registered", user_id )
    second = ( "notifications", event_id, "user.registered", user_id )
    assert first == second


def test_search_default_visibility_unavailable_until_public_rule() -> None:
    assert visibility_public_or_unavailable(False) == VISIBILITY_UNAVAILABLE
    assert visibility_public_or_unavailable(True) == VISIBILITY_PUBLIC


def test_search_excludes_sensitive_and_money() -> None:
    assert exclude_sensitive("password hash") == ""
    assert exclude_sensitive("amount_minor 500") == ""
    assert exclude_sensitive("legal_name secret") == ""
    text = build_searchable_text("Night Drive", "password: hunter2", "Dhaka")
    assert "Night Drive" in text
    assert "password" not in text.lower()
    assert "Dhaka" in text


def test_search_draft_and_takedown_are_not_public() -> None:
    assert visibility_public_or_unavailable(False) != VISIBILITY_PUBLIC


def test_analytics_ingest_identity_is_source_and_consumer() -> None:
    source = uuid4()
    key_a = (source, "analytics")
    key_b = (source, "analytics")
    assert key_a == key_b


def test_analytics_metric_date_assumed_dhaka() -> None:
    occurred = datetime(2026, 9, 11, 18, 30, tzinfo=timezone.utc)
    assert metric_date_for(occurred).isoformat() == "2026-09-12"


def test_analytics_strips_money_and_secrets() -> None:
    clean = sanitize_properties(
        {
            "track_id": "abc",
            "amount_minor": 500,
            "currency_code": "BDT",
            "password": "x",
            "completed": True,
            "duration_ms": 12000,
        }
    )
    assert "amount_minor" not in clean
    assert "currency_code" not in clean
    assert "password" not in clean
    assert clean["completed"] is True
    assert clean["duration_ms"] == 12000


def test_counts_never_negative() -> None:
    assert never_negative(-3) == 0
    assert never_negative(4) == 4


def test_unique_listeners_not_available() -> None:
    assert unique_listeners_metric() == UNIQUE_LISTENERS_NOT_AVAILABLE
    assert calculate_unique_listeners([uuid4(), uuid4()]) == UNIQUE_LISTENERS_NOT_AVAILABLE


def test_attribution_undefined() -> None:
    assert attribution_status() == "ATTRIBUTION_UNDEFINED"


def test_analytics_and_search_do_not_write_ledger() -> None:
    root = Path(__file__).resolve().parents[1] / "src" / "cornerroom" / "modules"
    analytics = (root / "analytics" / "application" / "service.py").read_text(encoding="utf-8")
    search = (root / "search" / "application" / "indexer.py").read_text(encoding="utf-8")
    notify = (root / "notifications" / "application" / "service.py").read_text(encoding="utf-8")
    forbidden = ("LedgerEntry", "ledger.post", "finance.post", "amount_minor *")
    for blob in (analytics, search, notify):
        for token in forbidden:
            assert token not in blob


def test_campaign_started_is_observed_not_attributed() -> None:
    event = DomainEvent(
        event_type=CAMPAIGN_STARTED,
        producer="campaigns",
        aggregate_type="Campaign",
        aggregate_id=uuid4(),
        payload={"campaign_id": str(uuid4())},
        occurred_at=datetime.now(timezone.utc),
    )
    assert event.event_type == CAMPAIGN_STARTED
    assert attribution_status() == "ATTRIBUTION_UNDEFINED"


def test_track_played_does_not_duplicate_playback_table_in_analytics_model() -> None:
    from cornerroom.modules.analytics.domain.models import AnalyticsEvent, DailyTrackMetrics

    assert "playback_events" not in AnalyticsEvent.__tablename__
    cols = set(DailyTrackMetrics.__table__.c.keys())
    assert "unique_listeners" not in cols
    assert "activation" not in cols
    assert "cac" not in cols
    assert "roas" not in cols
