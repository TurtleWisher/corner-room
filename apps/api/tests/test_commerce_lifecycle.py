"""Phase 09 commerce / entitlement / subscription lifecycles — no database."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest

from cornerroom.infra.errors import AppError
from cornerroom.kernel.calendar import add_billing_interval
from cornerroom.kernel.recurring import RecurringPeriodRequest, SandboxRecurringBilling
from cornerroom.modules.commerce.domain.lifecycle import (
    offer_transition_action,
    order_transition_action,
    product_transition_action,
)
from cornerroom.modules.entitlements.domain.lifecycle import is_covering
from cornerroom.modules.subscriptions.domain.lifecycle import (
    initial_subscription_status,
    period_end,
    subscription_transition_action,
)


def test_product_draft_to_active() -> None:
    assert product_transition_action("DRAFT", "ACTIVE") == "activate"


def test_offer_cannot_skip_to_retired() -> None:
    with pytest.raises(AppError) as exc:
        offer_transition_action("DRAFT", "RETIRED")
    assert exc.value.code == "INVALID_TRANSITION"


def test_order_paid_then_fulfilled() -> None:
    assert order_transition_action("PENDING_PAYMENT", "PAID") == "pay"
    assert order_transition_action("PAID", "FULFILLED") == "fulfill"


def test_skip_trial_when_trial_days_null_or_zero() -> None:
    assert initial_subscription_status(None) == "ACTIVE"
    assert initial_subscription_status(0) == "ACTIVE"
    assert initial_subscription_status(7) == "TRIALING"


def test_cancel_from_active() -> None:
    assert subscription_transition_action("ACTIVE", "CANCELLED") == "cancel"


def test_paused_not_implemented() -> None:
    with pytest.raises(AppError) as exc:
        subscription_transition_action("ACTIVE", "PAUSED")
    assert exc.value.code == "INVALID_TRANSITION"


def test_interval_count_fail_closed() -> None:
    now = datetime(2026, 1, 31, tzinfo=timezone.utc)
    with pytest.raises(AppError) as exc:
        add_billing_interval(now, "MONTH", 0)
    assert exc.value.status == 422


def test_unknown_interval_fail_closed() -> None:
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    with pytest.raises(AppError) as exc:
        add_billing_interval(now, "QUARTER", 1)
    assert exc.value.status == 422


def test_month_end_calendar_clamp() -> None:
    start = datetime(2026, 1, 31, tzinfo=timezone.utc)
    ended = add_billing_interval(start, "MONTH", 1)
    assert ended.month == 2
    assert ended.day == 28


def test_trial_period_uses_trial_days_not_invented_length() -> None:
    start = datetime(2026, 9, 1, tzinfo=timezone.utc)
    ended = period_end(
        starts_at=start,
        interval="YEAR",
        interval_count=1,
        trial_days=3,
        status="TRIALING",
    )
    assert ended.day == 4


def test_catalog_scope_covers_any_track() -> None:
    now = datetime(2026, 9, 11, tzinfo=timezone.utc)
    track = uuid4()
    assert is_covering(
        status="ACTIVE",
        scope="CATALOG",
        ref_id=uuid4(),
        track_id=track,
        expires_at=None,
        now=now,
    )


def test_track_scope_does_not_cover_other_track() -> None:
    now = datetime(2026, 9, 11, tzinfo=timezone.utc)
    assert not is_covering(
        status="ACTIVE",
        scope="TRACK",
        ref_id=uuid4(),
        track_id=uuid4(),
        expires_at=None,
        now=now,
    )


def test_expired_entitlement_not_covering() -> None:
    now = datetime(2026, 9, 11, tzinfo=timezone.utc)
    track = uuid4()
    assert not is_covering(
        status="ACTIVE",
        scope="TRACK",
        ref_id=track,
        track_id=track,
        expires_at=datetime(2026, 9, 1, tzinfo=timezone.utc),
        now=now,
    )


def test_sandbox_recurring_is_not_a_vendor() -> None:
    port = SandboxRecurringBilling()
    result = port.request_period(
        RecurringPeriodRequest(
            subscription_id=uuid4(),
            plan_version_id=uuid4(),
            amount_minor=999,
            currency_code="USD",
            period_starts_at=datetime(2026, 9, 11, tzinfo=timezone.utc),
            period_ends_at=datetime(2026, 10, 11, tzinfo=timezone.utc),
            idempotency_key="renew-1",
        )
    )
    assert result.provider == "sandbox"
    assert result.next_action == "CREATE_ORDER_PAYMENT"
