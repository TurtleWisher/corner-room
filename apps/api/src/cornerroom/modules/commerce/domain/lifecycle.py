"""Commerce catalog and order lifecycles. No invented prices."""

from __future__ import annotations

from cornerroom.infra.errors import AppError

PRODUCT_TYPES = frozenset({"TRACK", "CATALOG_ACCESS", "SUBSCRIPTION_PLAN"})
CATALOG_STATUSES = frozenset({"DRAFT", "ACTIVE", "RETIRED"})

PRODUCT_TRANSITIONS: dict[tuple[str, str], str] = {
    ("DRAFT", "ACTIVE"): "activate",
    ("ACTIVE", "RETIRED"): "retire",
}

OFFER_TRANSITIONS: dict[tuple[str, str], str] = {
    ("DRAFT", "ACTIVE"): "activate",
    ("ACTIVE", "RETIRED"): "retire",
}

ORDER_PAYMENT_TRANSITIONS: dict[tuple[str, str], str] = {
    ("DRAFT", "PENDING_PAYMENT"): "checkout",
    ("PENDING_PAYMENT", "PAID"): "pay",
    ("PAID", "FULFILLED"): "fulfill",
    ("PENDING_PAYMENT", "CANCELLED"): "cancel",
    ("PAID", "PARTIALLY_REFUNDED"): "partial_refund",
    ("FULFILLED", "PARTIALLY_REFUNDED"): "partial_refund",
    ("PAID", "REFUNDED"): "refund",
    ("FULFILLED", "REFUNDED"): "refund",
    ("PARTIALLY_REFUNDED", "REFUNDED"): "refund",
}


def catalog_transition(table: dict[tuple[str, str], str], current: str, target: str) -> str:
    action = table.get((current, target))
    if action is None:
        raise AppError(
            "INVALID_TRANSITION",
            "This transition is not allowed",
            409,
            f"{current} cannot move to {target}",
        )
    return action


def product_transition_action(current: str, target: str) -> str:
    return catalog_transition(PRODUCT_TRANSITIONS, current, target)


def offer_transition_action(current: str, target: str) -> str:
    return catalog_transition(OFFER_TRANSITIONS, current, target)


def order_transition_action(current: str, target: str) -> str:
    if current == target:
        return "noop"
    return catalog_transition(ORDER_PAYMENT_TRANSITIONS, current, target)
