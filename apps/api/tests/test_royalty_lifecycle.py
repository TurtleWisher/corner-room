"""Phase 10 royalty lifecycles — no database."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest

from cornerroom.infra.errors import AppError
from cornerroom.modules.royalties.domain.lifecycle import (
    pool_transition_action,
    right_transition_action,
    royalty_transition_action,
    rule_transition_action,
    settlement_transition_action,
    statement_transition_action,
)


def test_rights_draft_to_active() -> None:
    assert right_transition_action("DRAFT", "ACTIVE") == "activate"


def test_rights_cannot_skip_to_retired() -> None:
    with pytest.raises(AppError) as exc:
        right_transition_action("DRAFT", "RETIRED")
    assert exc.value.code == "INVALID_TRANSITION"


def test_rule_activate_then_supersede() -> None:
    assert rule_transition_action("DRAFT", "ACTIVE") == "activate"
    assert rule_transition_action("ACTIVE", "SUPERSEDED") == "supersede"


def test_pool_open_freeze_allocate_close() -> None:
    assert pool_transition_action("OPEN", "FROZEN") == "freeze"
    assert pool_transition_action("FROZEN", "ALLOCATED") == "allocate"
    assert pool_transition_action("ALLOCATED", "CLOSED") == "close"


def test_pool_cannot_close_from_open() -> None:
    with pytest.raises(AppError) as exc:
        pool_transition_action("OPEN", "CLOSED")
    assert exc.value.code == "INVALID_TRANSITION"


def test_royalty_run_lifecycle() -> None:
    assert royalty_transition_action("CALCULATING", "CALCULATED") == "complete"
    assert royalty_transition_action("CALCULATED", "APPROVED") == "approve"
    assert royalty_transition_action("APPROVED", "POSTED") == "post"


def test_owner_prompt_states_are_not_invented() -> None:
    with pytest.raises(AppError) as exc:
        royalty_transition_action("DRAFT", "READY")
    assert exc.value.code == "INVALID_TRANSITION"


def test_statement_issue_ack_dispute() -> None:
    assert statement_transition_action("DRAFT", "ISSUED") == "issue"
    assert statement_transition_action("ISSUED", "ACKNOWLEDGED") == "acknowledge"
    assert statement_transition_action("ISSUED", "DISPUTED") == "dispute"


def test_issued_statement_not_editable_via_draft() -> None:
    with pytest.raises(AppError) as exc:
        statement_transition_action("ISSUED", "DRAFT")
    assert exc.value.code == "INVALID_TRANSITION"


def test_settlement_approve_only() -> None:
    assert settlement_transition_action("CALCULATED", "APPROVED") == "approve"


def test_settlement_payment_is_phase_11() -> None:
    with pytest.raises(AppError) as exc:
        settlement_transition_action("APPROVED", "PROCESSING")
    assert exc.value.code == "FINANCE_REQUIRED"
    now = datetime(2026, 9, 11, tzinfo=timezone.utc)
    assert now.tzinfo is not None
    _ = uuid4()
