"""Finance lifecycles. Architecture of record — do not invent parallel money states."""

from __future__ import annotations

from cornerroom.infra.errors import AppError

TRANSACTION_TYPES = frozenset(
    {
        "TICKET_SALE",
        "MUSIC_PURCHASE",
        "SUBSCRIPTION",
        "SPONSORSHIP",
        "OTHER_INCOME",
        "REFUND",
        "EXPENSE",
        "ADJUSTMENT",
        "ROYALTY_ACCRUAL",
        "SETTLEMENT_PAYOUT",
        "PAYOUT_FEE",
        "TAX",
    }
)
SOURCE_MODULES = frozenset(
    {
        "TICKETING",
        "SUBSCRIPTIONS",
        "MUSIC",
        "EVENTS",
        "CAMPAIGNS",
        "ROYALTIES",
        "FINANCE",
        "ADMIN",
        "COMMERCE",
    }
)
JOURNAL_STATUSES = frozenset({"DRAFT", "POSTED", "REVERSED"})
ACCOUNT_TYPES = frozenset({"ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"})
RECOGNITION_STATUSES = frozenset({"DRAFT", "RECOGNIZED", "REVERSED"})
INVOICE_STATUSES = frozenset({"DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "VOIDED", "OVERDUE"})
PAYOUT_STATUSES = frozenset({"PENDING", "PROCESSING", "PAID", "FAILED"})
RECONCILIATION_STATUSES = frozenset({"MATCHED", "MISMATCH", "UNRECONCILED"})
EXPENSE_WORKFLOW = frozenset({"DRAFT", "APPROVED", "RECOGNIZED", "REVERSED"})

JOURNAL_TRANSITIONS: dict[tuple[str, str], str] = {
    ("DRAFT", "POSTED"): "post",
    ("POSTED", "REVERSED"): "reverse",
}

REVENUE_TRANSITIONS: dict[tuple[str, str], str] = {
    ("DRAFT", "RECOGNIZED"): "recognize",
    ("RECOGNIZED", "REVERSED"): "reverse",
}

EXPENSE_TRANSITIONS: dict[tuple[str, str], str] = {
    ("DRAFT", "APPROVED"): "approve",
    ("APPROVED", "RECOGNIZED"): "recognize",
    ("RECOGNIZED", "REVERSED"): "reverse",
}

INVOICE_TRANSITIONS: dict[tuple[str, str], str] = {
    ("DRAFT", "ISSUED"): "issue",
    ("ISSUED", "PARTIALLY_PAID"): "partial",
    ("ISSUED", "PAID"): "pay",
    ("ISSUED", "VOIDED"): "void",
    ("ISSUED", "OVERDUE"): "overdue",
    ("PARTIALLY_PAID", "PAID"): "pay",
    ("PARTIALLY_PAID", "VOIDED"): "void",
}

PAYOUT_TRANSITIONS: dict[tuple[str, str], str] = {
    ("PENDING", "PROCESSING"): "process",
    ("PROCESSING", "PAID"): "complete",
    ("PROCESSING", "FAILED"): "fail",
    ("PENDING", "FAILED"): "fail",
}

FINANCE_SETTLEMENT_TRANSITIONS: dict[tuple[str, str], str] = {
    ("APPROVED", "PROCESSING"): "process",
    ("PROCESSING", "PAID"): "pay",
    ("PAID", "COMPLETED"): "complete",
    ("PROCESSING", "FAILED"): "fail",
    ("APPROVED", "VOIDED"): "void",
    ("FAILED", "APPROVED"): "retry",
}


def _transition(table: dict[tuple[str, str], str], current: str, target: str, entity: str) -> str:
    action = table.get((current, target))
    if action is None:
        raise AppError(
            "INVALID_TRANSITION",
            f"Invalid {entity} transition",
            409,
            f"{current} cannot become {target}",
        )
    return action


def journal_transition_action(current: str, target: str) -> str:
    return _transition(JOURNAL_TRANSITIONS, current, target, "Transaction")


def revenue_transition_action(current: str, target: str) -> str:
    return _transition(REVENUE_TRANSITIONS, current, target, "Revenue")


def expense_transition_action(current: str, target: str) -> str:
    return _transition(EXPENSE_TRANSITIONS, current, target, "Expense")


def invoice_transition_action(current: str, target: str) -> str:
    return _transition(INVOICE_TRANSITIONS, current, target, "Invoice")


def payout_transition_action(current: str, target: str) -> str:
    return _transition(PAYOUT_TRANSITIONS, current, target, "Payout")


def finance_settlement_transition_action(current: str, target: str) -> str:
    """Royalty module still cannot pay. Finance drives PROCESSING+ on the same entity."""
    return _transition(FINANCE_SETTLEMENT_TRANSITIONS, current, target, "Settlement")
