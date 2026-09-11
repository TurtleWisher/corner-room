"""Journal balance — no database."""

from __future__ import annotations

import pytest

from cornerroom.infra.errors import AppError
from cornerroom.modules.finance.domain.journal import JournalLineDraft, assert_balanced


def test_balanced_journal() -> None:
    assert_balanced(
        [
            JournalLineDraft("DEBIT", 1000, "BDT", "1000"),
            JournalLineDraft("CREDIT", 1000, "BDT", "4000"),
        ]
    )


def test_unbalanced_journal_rejected() -> None:
    with pytest.raises(AppError) as exc:
        assert_balanced(
            [
                JournalLineDraft("DEBIT", 1000, "BDT", "1000"),
                JournalLineDraft("CREDIT", 900, "BDT", "4000"),
            ]
        )
    assert exc.value.code == "JOURNAL_UNBALANCED"


def test_line_cannot_be_zero() -> None:
    with pytest.raises(AppError) as exc:
        assert_balanced(
            [
                JournalLineDraft("DEBIT", 0, "BDT", "1000"),
                JournalLineDraft("CREDIT", 0, "BDT", "4000"),
            ]
        )
    assert exc.value.code == "JOURNAL_LINE_INVALID"


def test_direction_xor() -> None:
    with pytest.raises(AppError) as exc:
        assert_balanced(
            [
                JournalLineDraft("BOTH", 100, "BDT", "1000"),
                JournalLineDraft("CREDIT", 100, "BDT", "4000"),
            ]
        )
    assert exc.value.code == "JOURNAL_LINE_INVALID"
