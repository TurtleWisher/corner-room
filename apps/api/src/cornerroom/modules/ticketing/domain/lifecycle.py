"""TicketType / TicketHold / Ticket / CheckIn lifecycles from 08_EVENT_ARCHITECTURE.md."""

from __future__ import annotations

from cornerroom.infra.errors import AppError

TICKET_TYPE_STATUSES = frozenset({"DRAFT", "ON_SALE", "SOLD_OUT", "CLOSED", "ARCHIVED"})
HOLD_STATUSES = frozenset({"ACTIVE", "CONVERTED", "EXPIRED", "RELEASED"})
TICKET_STATUSES = frozenset(
    {
        "CREATED",
        "RESERVED",
        "PAYMENT_PENDING",
        "PAID",
        "ISSUED",
        "CHECKED_IN",
        "EXPIRED",
        "CANCELLED",
        "REFUNDED",
    }
)
CHECK_IN_STATUSES = frozenset({"RECORDED", "VOIDED"})

TICKET_TYPE_TRANSITIONS: dict[tuple[str, str], str] = {
    ("DRAFT", "ON_SALE"): "on_sale",
    ("ON_SALE", "SOLD_OUT"): "sold_out",
    ("ON_SALE", "CLOSED"): "close",
    ("SOLD_OUT", "CLOSED"): "close",
    ("SOLD_OUT", "ON_SALE"): "on_sale",  # inventory returned after hold expiry
    ("CLOSED", "ARCHIVED"): "archive",
    ("ON_SALE", "ARCHIVED"): "archive",
    ("SOLD_OUT", "ARCHIVED"): "archive",
    ("DRAFT", "ARCHIVED"): "archive",
}

TICKET_TYPE_ACTION_TARGETS = {
    "on_sale": "ON_SALE",
    "sold_out": "SOLD_OUT",
    "close": "CLOSED",
    "archive": "ARCHIVED",
}

# Purchases are allowed only while the Event is TICKETING_OPEN (Q-P1-03 fail closed).
PURCHASABLE_EVENT_STATUSES = frozenset({"TICKETING_OPEN"})


def _invalid(current: str, target: str) -> AppError:
    return AppError(
        "INVALID_TRANSITION",
        "Invalid lifecycle transition",
        409,
        f"Cannot transition from {current} to {target}",
    )


def ticket_type_target_for_action(action: str) -> str:
    target = TICKET_TYPE_ACTION_TARGETS.get(action)
    if target is None:
        raise AppError("VALIDATION_ERROR", "Unknown ticket type lifecycle action", 422)
    return target


def ticket_type_transition_action(current: str, target: str) -> str:
    if current not in TICKET_TYPE_STATUSES or target not in TICKET_TYPE_STATUSES:
        raise AppError("VALIDATION_ERROR", "Invalid ticket type status", 422)
    action = TICKET_TYPE_TRANSITIONS.get((current, target))
    if action is None:
        raise _invalid(current, target)
    return action
