"""User lifecycle transitions. Architecture states only — no invented statuses."""

from __future__ import annotations

from cornerroom.infra.errors import AppError

USER_STATUSES = frozenset({"PENDING_VERIFICATION", "ACTIVE", "SUSPENDED", "CLOSED"})

# (from, to) → action name used in audit/events
ALLOWED_TRANSITIONS: dict[tuple[str, str], str] = {
    ("PENDING_VERIFICATION", "ACTIVE"): "activate",
    ("PENDING_VERIFICATION", "CLOSED"): "close",
    ("ACTIVE", "SUSPENDED"): "suspend",
    ("ACTIVE", "CLOSED"): "close",
    ("SUSPENDED", "ACTIVE"): "unsuspend",
    ("SUSPENDED", "CLOSED"): "close",
}

ACTION_TARGETS = {
    "activate": "ACTIVE",
    "suspend": "SUSPENDED",
    "unsuspend": "ACTIVE",
    "close": "CLOSED",
}


def assert_known_status(status: str) -> None:
    if status not in USER_STATUSES:
        raise AppError("VALIDATION_ERROR", "Invalid user status", 422)


def transition_action(current: str, target: str) -> str:
    assert_known_status(current)
    assert_known_status(target)
    action = ALLOWED_TRANSITIONS.get((current, target))
    if action is None:
        raise AppError(
            "INVALID_TRANSITION",
            "Invalid lifecycle transition",
            409,
            f"Cannot transition from {current} to {target}",
        )
    return action


def target_for_action(action: str) -> str:
    target = ACTION_TARGETS.get(action)
    if target is None:
        raise AppError("VALIDATION_ERROR", "Unknown lifecycle action", 422)
    return target
