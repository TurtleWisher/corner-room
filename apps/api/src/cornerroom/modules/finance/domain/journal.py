"""Pure journal balance rules. POSTED requires debits = credits per currency."""

from __future__ import annotations

from dataclasses import dataclass

from cornerroom.infra.errors import AppError
from cornerroom.kernel.money import Money

DIRECTIONS = frozenset({"DEBIT", "CREDIT"})


@dataclass(frozen=True, slots=True)
class JournalLineDraft:
    direction: str
    amount_minor: int
    currency_code: str
    account_code: str


def validate_line(line: JournalLineDraft) -> Money:
    if line.direction not in DIRECTIONS:
        raise AppError("JOURNAL_LINE_INVALID", "Ledger line direction must be DEBIT or CREDIT", 422)
    money = Money(line.amount_minor, line.currency_code)
    if money.amount_minor <= 0:
        raise AppError("JOURNAL_LINE_INVALID", "Ledger line amount_minor must be > 0", 422)
    if not line.account_code:
        raise AppError("JOURNAL_LINE_INVALID", "Ledger line requires an account", 422)
    return money


def assert_balanced(lines: list[JournalLineDraft]) -> None:
    if len(lines) < 2:
        raise AppError("JOURNAL_UNBALANCED", "A posted journal needs at least two lines", 409)
    totals: dict[str, list[int]] = {}
    for line in lines:
        money = validate_line(line)
        bucket = totals.setdefault(money.currency_code, [0, 0])
        if line.direction == "DEBIT":
            bucket[0] += money.amount_minor
        else:
            bucket[1] += money.amount_minor
    for currency, (debits, credits) in totals.items():
        if debits != credits:
            raise AppError(
                "JOURNAL_UNBALANCED",
                "Posted journal is not balanced",
                409,
                f"{currency} debits {debits} != credits {credits}",
            )
