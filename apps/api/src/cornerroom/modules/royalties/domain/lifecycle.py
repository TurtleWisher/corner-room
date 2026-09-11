"""Royalty lifecycles. Architecture of record — not the owner-prompt example states."""

from __future__ import annotations

from cornerroom.infra.errors import AppError

BPS_TOTAL = 10_000

RIGHT_STATUSES = frozenset({"DRAFT", "ACTIVE", "DISPUTED", "RETIRED"})
RULE_STATUSES = frozenset({"DRAFT", "ACTIVE", "SUPERSEDED"})
POOL_STATUSES = frozenset({"OPEN", "FROZEN", "ALLOCATED", "CLOSED"})
ROYALTY_STATUSES = frozenset({"CALCULATING", "CALCULATED", "APPROVED", "POSTED"})
STATEMENT_STATUSES = frozenset({"DRAFT", "ISSUED", "ACKNOWLEDGED", "DISPUTED"})
SETTLEMENT_STATUSES = frozenset({"CALCULATED", "APPROVED", "PROCESSING", "PAID", "COMPLETED"})
PAYEE_TYPES = frozenset({"ARTIST", "USER", "ORGANIZATION"})
RUN_KINDS = frozenset({"PRIMARY", "CORRECTION"})
POOL_SOURCE_TYPES = frozenset({"STREAMING_SUB", "MUSIC_PURCHASE", "OTHER"})
RULE_POOL_TYPES = frozenset(
    {
        "PRO_RATA_BY_ELIGIBLE_PLAY",
        "PRO_RATA_BY_TIME",
        "PER_UNIT_PURCHASE",
        "MANUAL_ALLOCATION",
    }
)
SUPPORTED_POOL_TYPES = frozenset({"PRO_RATA_BY_ELIGIBLE_PLAY", "PRO_RATA_BY_TIME", "PER_UNIT_PURCHASE"})

RIGHT_TRANSITIONS: dict[tuple[str, str], str] = {
    ("DRAFT", "ACTIVE"): "activate",
    ("ACTIVE", "DISPUTED"): "dispute",
    ("ACTIVE", "RETIRED"): "retire",
    ("DISPUTED", "ACTIVE"): "resolve",
    ("DISPUTED", "RETIRED"): "retire",
}

RULE_TRANSITIONS: dict[tuple[str, str], str] = {
    ("DRAFT", "ACTIVE"): "activate",
    ("ACTIVE", "SUPERSEDED"): "supersede",
}

POOL_TRANSITIONS: dict[tuple[str, str], str] = {
    ("OPEN", "FROZEN"): "freeze",
    ("FROZEN", "ALLOCATED"): "allocate",
    ("ALLOCATED", "CLOSED"): "close",
}

ROYALTY_TRANSITIONS: dict[tuple[str, str], str] = {
    ("CALCULATING", "CALCULATED"): "complete",
    ("CALCULATED", "APPROVED"): "approve",
    ("APPROVED", "POSTED"): "post",
}

STATEMENT_TRANSITIONS: dict[tuple[str, str], str] = {
    ("DRAFT", "ISSUED"): "issue",
    ("ISSUED", "ACKNOWLEDGED"): "acknowledge",
    ("ISSUED", "DISPUTED"): "dispute",
}

SETTLEMENT_TRANSITIONS: dict[tuple[str, str], str] = {
    ("CALCULATED", "APPROVED"): "approve",
}

PHASE11_SETTLEMENT = frozenset({"PROCESSING", "PAID", "COMPLETED"})


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


def right_transition_action(current: str, target: str) -> str:
    return _transition(RIGHT_TRANSITIONS, current, target, "Rights")


def rule_transition_action(current: str, target: str) -> str:
    return _transition(RULE_TRANSITIONS, current, target, "RoyaltyRule")


def pool_transition_action(current: str, target: str) -> str:
    return _transition(POOL_TRANSITIONS, current, target, "RevenuePool")


def royalty_transition_action(current: str, target: str) -> str:
    return _transition(ROYALTY_TRANSITIONS, current, target, "Royalty")


def statement_transition_action(current: str, target: str) -> str:
    return _transition(STATEMENT_TRANSITIONS, current, target, "RoyaltyStatement")


def settlement_transition_action(current: str, target: str) -> str:
    if target in PHASE11_SETTLEMENT:
        raise AppError(
            "FINANCE_REQUIRED",
            "Settlement payment is Phase 11",
            409,
            "Royalty Engine may approve an obligation; payout execution is Finance",
        )
    return _transition(SETTLEMENT_TRANSITIONS, current, target, "Settlement")
