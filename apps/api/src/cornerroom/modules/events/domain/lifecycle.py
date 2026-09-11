"""Event and venue lifecycles from 08_EVENT_ARCHITECTURE.md. No invented states."""

from __future__ import annotations

from cornerroom.infra.errors import AppError

EVENT_STATUSES = frozenset(
    {
        "DRAFT",
        "PLANNED",
        "PUBLISHED",
        "TICKETING_OPEN",
        "SALES_CLOSED",
        "LIVE",
        "COMPLETED",
        "SETTLED",
        "ARCHIVED",
        "CANCELLED",
        "POSTPONED",
    }
)

VENUE_STATUSES = frozenset({"DRAFT", "ACTIVE", "INACTIVE"})

BOOKING_STATUSES = frozenset({"INQUIRED", "HOLD", "CONFIRMED", "CANCELLED", "COMPLETED"})

EVENT_TRANSITIONS: dict[tuple[str, str], str] = {
    ("DRAFT", "PLANNED"): "plan",
    ("PLANNED", "PUBLISHED"): "publish",
    ("PUBLISHED", "TICKETING_OPEN"): "open_ticketing",
    ("TICKETING_OPEN", "SALES_CLOSED"): "close_sales",
    ("SALES_CLOSED", "LIVE"): "go_live",
    ("LIVE", "COMPLETED"): "complete",
    ("COMPLETED", "SETTLED"): "settle",
    ("SETTLED", "ARCHIVED"): "archive",
    ("PLANNED", "POSTPONED"): "postpone",
    ("PUBLISHED", "POSTPONED"): "postpone",
    ("TICKETING_OPEN", "POSTPONED"): "postpone",
    ("POSTPONED", "PLANNED"): "resume",
    ("POSTPONED", "PUBLISHED"): "resume",
    ("POSTPONED", "TICKETING_OPEN"): "resume",
}

EVENT_ACTION_TARGETS = {
    "plan": "PLANNED",
    "publish": "PUBLISHED",
    "open_ticketing": "TICKETING_OPEN",
    "close_sales": "SALES_CLOSED",
    "go_live": "LIVE",
    "complete": "COMPLETED",
    "settle": "SETTLED",
    "archive": "ARCHIVED",
    "cancel": "CANCELLED",
    "postpone": "POSTPONED",
    "resume": None,  # target supplied by caller / previous status
}

CANCEL_FROM = frozenset(
    {
        "DRAFT",
        "PLANNED",
        "PUBLISHED",
        "TICKETING_OPEN",
        "SALES_CLOSED",
        "LIVE",
        "POSTPONED",
    }
)

# Settlement remains Phase 11. Ticketing open/close are owned by Phase 05.
FINANCE_DEPENDENT_ACTIONS = frozenset({"settle"})

VENUE_TRANSITIONS: dict[tuple[str, str], str] = {
    ("DRAFT", "ACTIVE"): "activate",
    ("ACTIVE", "INACTIVE"): "deactivate",
}

VENUE_ACTION_TARGETS = {
    "activate": "ACTIVE",
    "deactivate": "INACTIVE",
}

PUBLIC_EVENT_STATUSES = frozenset(
    {
        "PUBLISHED",
        "TICKETING_OPEN",
        "SALES_CLOSED",
        "LIVE",
        "COMPLETED",
        "POSTPONED",
        "CANCELLED",
    }
)

LINEUP_STATUSES = frozenset({"INVITED", "CONFIRMED", "PERFORMED", "WITHDRAWN", "NO_SHOW"})
PUBLIC_LINEUP_STATUSES = frozenset({"CONFIRMED", "PERFORMED"})

LINEUP_TRANSITIONS: dict[tuple[str, str], str] = {
    ("INVITED", "CONFIRMED"): "confirm",
    ("INVITED", "WITHDRAWN"): "withdraw",
    ("CONFIRMED", "WITHDRAWN"): "withdraw",
    ("CONFIRMED", "PERFORMED"): "mark_performed",
    ("CONFIRMED", "NO_SHOW"): "mark_no_show",
}

LINEUP_ACTION_TARGETS = {
    "confirm": "CONFIRMED",
    "withdraw": "WITHDRAWN",
    "mark_performed": "PERFORMED",
    "mark_no_show": "NO_SHOW",
}

MUTABLE_VENUE_ASSIGN_STATUSES = frozenset(
    {
        "DRAFT",
        "PLANNED",
        "PUBLISHED",
        "TICKETING_OPEN",
        "SALES_CLOSED",
        "POSTPONED",
    }
)

PERMISSION_FOR_ACTION = {
    "plan": "event.write",
    "publish": "event.publish",
    "open_ticketing": "event.publish",
    "close_sales": "event.write",
    "go_live": "event.write",
    "complete": "event.write",
    "settle": "event.write",
    "archive": "event.write",
    "cancel": "event.cancel",
    "postpone": "event.cancel",
    "resume": "event.write",
}


def _invalid(current: str, target: str) -> AppError:
    return AppError(
        "INVALID_TRANSITION",
        "Invalid lifecycle transition",
        409,
        f"Cannot transition from {current} to {target}",
    )


def event_target_for_action(action: str) -> str | None:
    if action not in EVENT_ACTION_TARGETS:
        raise AppError("VALIDATION_ERROR", "Unknown lifecycle action", 422)
    return EVENT_ACTION_TARGETS[action]


def event_transition_action(current: str, target: str) -> str:
    if current not in EVENT_STATUSES or target not in EVENT_STATUSES:
        raise AppError("VALIDATION_ERROR", "Invalid event status", 422)
    if target == "CANCELLED":
        if current not in CANCEL_FROM:
            raise _invalid(current, target)
        return "cancel"
    action = EVENT_TRANSITIONS.get((current, target))
    if action is None:
        raise _invalid(current, target)
    return action


def venue_target_for_action(action: str) -> str:
    target = VENUE_ACTION_TARGETS.get(action)
    if target is None:
        raise AppError("VALIDATION_ERROR", "Unknown venue lifecycle action", 422)
    return target


def venue_transition_action(current: str, target: str) -> str:
    if current not in VENUE_STATUSES or target not in VENUE_STATUSES:
        raise AppError("VALIDATION_ERROR", "Invalid venue status", 422)
    action = VENUE_TRANSITIONS.get((current, target))
    if action is None:
        raise _invalid(current, target)
    return action


def lineup_target_for_action(action: str) -> str:
    target = LINEUP_ACTION_TARGETS.get(action)
    if target is None:
        raise AppError("VALIDATION_ERROR", "Unknown lineup lifecycle action", 422)
    return target


def lineup_transition_action(current: str, target: str) -> str:
    if current not in LINEUP_STATUSES or target not in LINEUP_STATUSES:
        raise AppError("VALIDATION_ERROR", "Invalid lineup status", 422)
    action = LINEUP_TRANSITIONS.get((current, target))
    if action is None:
        raise _invalid(current, target)
    return action
