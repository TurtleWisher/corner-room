"""Royalty allocation, rounding, eligibility, and residual rules — no database."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest

from cornerroom.infra.errors import AppError
from cornerroom.modules.royalties.domain.allocation import (
    ResidualPayee,
    ShareSlice,
    allocate_pool,
    allocate_track_shares,
    largest_remainder,
    validate_share_coverage,
)
from cornerroom.modules.royalties.domain.eligibility import (
    EligibilityPolicy,
    PlaybackFact,
    eligible_units_by_track,
    fact_is_eligible,
    parse_eligibility,
)
from cornerroom.modules.royalties.domain.lifecycle import BPS_TOTAL


def test_share_coverage_requires_10000_without_residual() -> None:
    with pytest.raises(AppError) as exc:
        validate_share_coverage([7000, 2000], None)
    assert exc.value.code == "SHARE_COVERAGE"


def test_share_coverage_with_stored_residual() -> None:
    residual = ResidualPayee(rights_id=uuid4(), payee_type="ORGANIZATION", payee_id=uuid4(), right_type="MASTER")
    assert validate_share_coverage([7000, 2000], residual) == 1000


def test_negative_share_rejected() -> None:
    with pytest.raises(AppError) as exc:
        validate_share_coverage([-1], None)
    assert exc.value.code == "INVALID_SHARE"


def test_largest_remainder_sums_to_pool() -> None:
    a, b, c = uuid4(), uuid4(), uuid4()
    amounts, leftover = largest_remainder(100, {a: 1, b: 1, c: 1})
    assert leftover == 0
    assert sum(amounts.values()) == 100


def test_empty_weights_leave_pool_unallocated() -> None:
    amounts, leftover = largest_remainder(500, {})
    assert amounts == {}
    assert leftover == 500


def test_track_shares_remainder_goes_to_stored_residual() -> None:
    rights_id = uuid4()
    track_id = uuid4()
    residual = ResidualPayee(rights_id=rights_id, payee_type="ORGANIZATION", payee_id=uuid4(), right_type="MASTER")
    shares = [
        ShareSlice(
            right_share_id=uuid4(),
            rights_id=rights_id,
            right_type="MASTER",
            payee_type="ARTIST",
            payee_id=uuid4(),
            share_bps=3333,
        ),
        ShareSlice(
            right_share_id=uuid4(),
            rights_id=rights_id,
            right_type="MASTER",
            payee_type="ARTIST",
            payee_id=uuid4(),
            share_bps=3333,
        ),
    ]
    lines, leftover = allocate_track_shares(
        track_id=track_id,
        track_amount_minor=100,
        eligible_units=10,
        shares=shares,
        residual=residual,
    )
    assert leftover == 0
    assert sum(line.amount_minor for line in lines) == 100
    assert any(line.is_residual for line in lines)


def test_no_residual_payee_does_not_invent_one() -> None:
    rights_id = uuid4()
    shares = [
        ShareSlice(
            right_share_id=uuid4(),
            rights_id=rights_id,
            right_type="MASTER",
            payee_type="ARTIST",
            payee_id=uuid4(),
            share_bps=BPS_TOTAL,
        )
    ]
    lines, leftover = allocate_track_shares(
        track_id=uuid4(),
        track_amount_minor=1,
        eligible_units=1,
        shares=shares,
        residual=None,
    )
    assert leftover == 0
    assert sum(line.amount_minor for line in lines) == 1


def test_missing_shares_fail_closed() -> None:
    with pytest.raises(AppError) as exc:
        allocate_track_shares(
            track_id=uuid4(),
            track_amount_minor=50,
            eligible_units=1,
            shares=[],
            residual=None,
        )
    assert exc.value.code == "NO_VALID_SHARE"


def test_non_payable_track_does_not_inflate_others() -> None:
    payable = uuid4()
    blocked = uuid4()
    rights_id = uuid4()
    artist = uuid4()
    shares = [
        ShareSlice(
            right_share_id=uuid4(),
            rights_id=rights_id,
            right_type="MASTER",
            payee_type="ARTIST",
            payee_id=artist,
            share_bps=BPS_TOTAL,
        )
    ]
    lines, unallocated, payable_units, non_payable = allocate_pool(
        pool_minor=100,
        units_by_track={payable: 1, blocked: 1},
        shares_by_track={payable: shares, blocked: []},
        residual_by_track={payable: None, blocked: None},
    )
    assert payable_units == {payable: 1}
    assert non_payable == {blocked: 1}
    assert sum(line.amount_minor for line in lines) + unallocated == 100
    assert unallocated == 50


def test_eligibility_missing_policy_is_none() -> None:
    assert parse_eligibility({}) is None
    assert parse_eligibility({"pool_type": "PRO_RATA_BY_ELIGIBLE_PLAY"}) is None


def test_eligibility_uses_rule_data_not_hardcoded_seconds() -> None:
    policy = parse_eligibility({"eligibility": {"min_duration_ms": 5000, "exclude_ignored": True}})
    assert policy is not None
    assert policy.min_duration_ms == 5000
    now = datetime(2026, 9, 11, tzinfo=timezone.utc)
    short = PlaybackFact(uuid4(), uuid4(), uuid4(), now, 4000, False, False)
    long = PlaybackFact(uuid4(), uuid4(), uuid4(), now, 5000, False, False)
    ignored = PlaybackFact(uuid4(), uuid4(), uuid4(), now, 9000, True, True)
    assert not fact_is_eligible(short, policy)
    assert fact_is_eligible(long, policy)
    assert not fact_is_eligible(ignored, policy)


def test_unique_listener_counts_users_not_plays() -> None:
    policy = EligibilityPolicy(unique_listener=True)
    track = uuid4()
    user = uuid4()
    now = datetime(2026, 9, 11, tzinfo=timezone.utc)
    facts = [
        PlaybackFact(uuid4(), track, user, now, 1000, False, False),
        PlaybackFact(uuid4(), track, user, now, 1000, False, False),
        PlaybackFact(uuid4(), track, uuid4(), now, 1000, False, False),
    ]
    units = eligible_units_by_track(facts, policy)
    assert units[track] == 2
