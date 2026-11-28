"""Staff portal rules (D-STAFF-ACCOUNTS-01) and artist royalty rate maths (D-ROYALTY-RATE-01).

Pure rules, no database: who may change whom, which roles are areas, how a rate span covers a
sale, what a sale earns and which earlier stretches no rate covers yet.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from cornerroom.infra.seed import ROLE_PERMISSIONS
from cornerroom.modules.administration.domain.activity_areas import area_for
from cornerroom.modules.administration.domain.staff_levels import (
    AREA_KEYS,
    allowed_levels,
    areas_of,
    clean_areas,
    level_for,
    refusal,
)
from cornerroom.modules.authorization.domain.models import FOUNDATION_PERMISSIONS
from cornerroom.modules.royalties.domain.artist_rates import (
    RateSpan,
    Span,
    earned_minor,
    line_refund,
    rate_at,
    uncovered_before,
    valid_bps,
)

ADMIN = frozenset({"user.admin", "org.admin"})
OWNER = ADMIN | {"role.admin"}
T0 = datetime(2026, 11, 1, tzinfo=UTC)


def at(days: float) -> datetime:
    return T0 + timedelta(days=days)


# ----- staff levels --------------------------------------------------------------------------


def test_every_area_is_a_seeded_role_with_permissions() -> None:
    for key in AREA_KEYS:
        assert key in ROLE_PERMISSIONS, key
        assert ROLE_PERMISSIONS[key][1], f"{key} opens nothing"
    assert "admin" not in AREA_KEYS and "super_admin" not in AREA_KEYS and "staff_admin" not in AREA_KEYS


def test_admin_role_runs_everything_but_editing_roles() -> None:
    name, perms = ROLE_PERMISSIONS["staff_admin"]
    assert name == "Admin"
    assert "role.admin" not in perms
    assert set(perms) == set(FOUNDATION_PERMISSIONS) - {"role.admin"}


def test_levels_from_roles() -> None:
    assert level_for({"super_admin", "staff_admin"}) == "OWNER"
    assert level_for({"staff_admin", "analyst"}) == "ADMIN"
    assert level_for({"analyst"}) == "STAFF"
    assert level_for({"customer"}) is None
    assert level_for(set()) is None
    assert areas_of({"analyst", "content_manager", "customer"}) == ["content_manager", "analyst"]
    assert clean_areas(["analyst", "nope", "analyst", "event_manager"]) == ["event_manager", "analyst"]


def test_only_the_owner_touches_admins() -> None:
    me, them = "me", "them"
    assert refusal(viewer_id=me, viewer_permissions=ADMIN, target_id=them, current_level=None, new_level="STAFF") is None
    assert refusal(viewer_id=me, viewer_permissions=ADMIN, target_id=them, current_level="STAFF", new_level="ADMIN") == "OWNER_ONLY"
    assert refusal(viewer_id=me, viewer_permissions=ADMIN, target_id=them, current_level="ADMIN", new_level="STAFF") == "OWNER_ONLY"
    assert refusal(viewer_id=me, viewer_permissions=ADMIN, target_id=them, current_level="ADMIN", new_level=None) == "OWNER_ONLY"
    assert refusal(viewer_id=me, viewer_permissions=OWNER, target_id=them, current_level="STAFF", new_level="ADMIN") is None
    assert refusal(viewer_id=me, viewer_permissions=OWNER, target_id=them, current_level="ADMIN", new_level=None) is None
    assert allowed_levels(ADMIN) == ["STAFF"]
    assert allowed_levels(OWNER) == ["ADMIN", "STAFF"]
    assert allowed_levels({"analytics.read"}) == []


def test_nobody_changes_themselves_or_the_owner() -> None:
    assert refusal(viewer_id="me", viewer_permissions=OWNER, target_id="me", current_level="OWNER", new_level=None) == "NOT_YOURSELF"
    assert refusal(viewer_id="me", viewer_permissions=ADMIN, target_id="me", current_level="ADMIN", new_level="STAFF") == "NOT_YOURSELF"
    assert refusal(viewer_id="me", viewer_permissions=OWNER, target_id="o", current_level="OWNER", new_level="STAFF") == "OWNER_FIXED"
    assert refusal(viewer_id="me", viewer_permissions={"audit.read"}, target_id="x", current_level=None, new_level="STAFF") == "NOT_ALLOWED"
    assert refusal(viewer_id="me", viewer_permissions=OWNER, target_id="x", current_level=None, new_level="OWNER") == "BAD_LEVEL"


def test_activity_areas() -> None:
    assert area_for("release.approved") == "Music"
    assert area_for("royalty_rate.set") == "Money"
    assert area_for("staff_account.set") == "Accounts"
    assert area_for("auth.login") == "Sign-ins"
    assert area_for("something.new") == "Other"
    assert area_for(None) == "Other"


# ----- royalty rates -------------------------------------------------------------------------


def test_earned_is_the_share_of_what_was_kept_paid_rounded_down() -> None:
    assert earned_minor(10000, 0, 7000) == 7000  # ৳100 at 70 % is ৳70
    assert earned_minor(9999, 0, 3333) == 3332  # 3332.6667 rounds down
    assert earned_minor(10000, 2500, 5000) == 3750  # a refund earns nothing
    assert earned_minor(10000, 20000, 5000) == 0
    assert earned_minor(10000, 0, None) is None  # no rate yet
    assert earned_minor(10000, 0, 0) == 0
    assert earned_minor(10000, 0, 10000) == 10000


def test_valid_bps() -> None:
    assert valid_bps(0) and valid_bps(7000) and valid_bps(10000)
    assert not valid_bps(-1) and not valid_bps(10001) and not valid_bps(True)


def test_refunds_shared_across_a_gift_orders_lines() -> None:
    assert line_refund(0, 5000, 5000) == 0
    assert line_refund(1000, 5000, 5000) == 1000
    assert line_refund(9000, 5000, 5000) == 5000  # never more than the line
    assert line_refund(3000, 1000, 3000) == 1000  # three ৳10 lines, all refunded
    assert line_refund(1000, 1000, 3000) == 333


def test_a_sale_takes_the_rate_of_its_moment() -> None:
    spans = [RateSpan(6000, at(0), at(10)), RateSpan(7000, at(10), None)]
    assert rate_at(spans, at(-1)) is None
    assert rate_at(spans, at(0)) == 6000
    assert rate_at(spans, at(9.9)) == 6000
    assert rate_at(spans, at(10)) == 7000
    assert rate_at(spans, at(400)) == 7000
    assert rate_at([RateSpan(5000, None, None)], at(-1000)) == 5000


def test_uncovered_stretches_before_now() -> None:
    now = at(30)
    assert uncovered_before([], now) == [Span(None, now)]
    assert uncovered_before([RateSpan(5000, None, None)], now) == []
    assert uncovered_before([RateSpan(5000, at(5), None)], now) == [Span(None, at(5))]
    # A rate that was stopped, then nothing: the stretch after it and before it are open.
    assert uncovered_before([RateSpan(5000, at(5), at(10))], now) == [Span(None, at(5)), Span(at(10), now)]
    # A gap between two rates.
    spans = [RateSpan(5000, None, at(10)), RateSpan(6000, at(15), None)]
    assert uncovered_before(spans, now) == [Span(at(10), at(15))]
    # Earlier stretches filled by covers_earlier rows leave nothing.
    spans = [RateSpan(5000, None, at(5)), RateSpan(5000, at(5), at(10)), RateSpan(6000, at(10), None)]
    assert uncovered_before(spans, now) == []
