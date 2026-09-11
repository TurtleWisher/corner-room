"""Finance lifecycles — no database."""

from __future__ import annotations

import pytest

from cornerroom.infra.errors import AppError
from cornerroom.modules.finance.domain.lifecycle import (
    expense_transition_action,
    finance_settlement_transition_action,
    invoice_transition_action,
    journal_transition_action,
    payout_transition_action,
    revenue_transition_action,
)
from cornerroom.modules.royalties.domain.lifecycle import settlement_transition_action


def test_journal_draft_to_posted() -> None:
    assert journal_transition_action("DRAFT", "POSTED") == "post"


def test_posted_journal_reversed_not_edited() -> None:
    assert journal_transition_action("POSTED", "REVERSED") == "reverse"
    with pytest.raises(AppError) as exc:
        journal_transition_action("POSTED", "DRAFT")
    assert exc.value.code == "INVALID_TRANSITION"


def test_revenue_recognize_then_reverse() -> None:
    assert revenue_transition_action("DRAFT", "RECOGNIZED") == "recognize"
    assert revenue_transition_action("RECOGNIZED", "REVERSED") == "reverse"


def test_expense_authorized_workflow() -> None:
    assert expense_transition_action("DRAFT", "APPROVED") == "approve"
    assert expense_transition_action("APPROVED", "RECOGNIZED") == "recognize"
    with pytest.raises(AppError):
        expense_transition_action("DRAFT", "RECOGNIZED")


def test_invoice_issue() -> None:
    assert invoice_transition_action("DRAFT", "ISSUED") == "issue"


def test_payout_lifecycle() -> None:
    assert payout_transition_action("PENDING", "PROCESSING") == "process"
    assert payout_transition_action("PROCESSING", "PAID") == "complete"
    assert payout_transition_action("PROCESSING", "FAILED") == "fail"


def test_royalty_module_still_cannot_pay() -> None:
    with pytest.raises(AppError) as exc:
        settlement_transition_action("APPROVED", "PROCESSING")
    assert exc.value.code == "FINANCE_REQUIRED"


def test_finance_extends_approved_settlement() -> None:
    assert finance_settlement_transition_action("APPROVED", "PROCESSING") == "process"
    assert finance_settlement_transition_action("PROCESSING", "PAID") == "pay"
    assert finance_settlement_transition_action("PAID", "COMPLETED") == "complete"
