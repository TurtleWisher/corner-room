"""Payout eligibility and dual control — no database."""

from __future__ import annotations

from uuid import uuid4

import pytest

from cornerroom.infra.errors import AppError
from cornerroom.modules.finance.domain.payout_gates import (
    PayeeComplianceView,
    PayoutConfigView,
    approvals_complete,
    assert_distinct_second,
    assert_no_self_approve,
    require_compliance,
    require_minimum,
    require_payout_config,
    requires_second_approver,
)

UNSET = PayoutConfigView(None, None, None)
CONFIGURED = PayoutConfigView(10_000, 100, "MONTHLY")


def test_missing_config_fails_closed() -> None:
    with pytest.raises(AppError) as exc:
        require_payout_config(UNSET)
    assert exc.value.code == "PAYOUT_CONFIG_REQUIRED"


def test_below_minimum_rejected() -> None:
    with pytest.raises(AppError) as exc:
        require_minimum(50, CONFIGURED)
    assert exc.value.code == "PAYOUT_BELOW_MINIMUM"


def test_missing_kyc_blocks() -> None:
    with pytest.raises(AppError) as exc:
        require_compliance(None)
    assert exc.value.code == "PAYEE_COMPLIANCE_REQUIRED"
    with pytest.raises(AppError):
        require_compliance(PayeeComplianceView(kyc_present=True, tax_record_present=False))


def test_second_approver_from_config_not_code() -> None:
    assert requires_second_approver(10_000, CONFIGURED) is True
    assert requires_second_approver(9_999, CONFIGURED) is False


def test_no_self_approve() -> None:
    actor = uuid4()
    with pytest.raises(AppError) as exc:
        assert_no_self_approve(actor_id=actor, initiator_id=actor)
    assert exc.value.code == "PAYOUT_SELF_APPROVE_FORBIDDEN"


def test_second_approver_must_be_distinct() -> None:
    first = uuid4()
    initiator = uuid4()
    with pytest.raises(AppError) as exc:
        assert_distinct_second(actor_id=first, first_approver_id=first, initiator_id=initiator)
    assert exc.value.code == "PAYOUT_DUPLICATE_APPROVER"


def test_approvals_complete_respects_threshold() -> None:
    first = uuid4()
    second = uuid4()
    assert approvals_complete(
        amount_minor=500, config=CONFIGURED, approved_by=first, second_approved_by=None
    )
    assert not approvals_complete(
        amount_minor=10_000, config=CONFIGURED, approved_by=first, second_approved_by=None
    )
    assert approvals_complete(
        amount_minor=10_000, config=CONFIGURED, approved_by=first, second_approved_by=second
    )
