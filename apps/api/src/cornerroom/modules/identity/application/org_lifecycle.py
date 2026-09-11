"""Organization lifecycle. Architecture states only — no invented statuses."""

from __future__ import annotations

from cornerroom.infra.errors import AppError

ORG_STATUSES = frozenset({"PENDING", "ACTIVE", "SUSPENDED", "ARCHIVED"})

ALLOWED_TRANSITIONS: dict[tuple[str, str], str] = {
    ("PENDING", "ACTIVE"): "activate",
    ("ACTIVE", "SUSPENDED"): "suspend",
    ("SUSPENDED", "ACTIVE"): "unsuspend",
    ("ACTIVE", "ARCHIVED"): "archive",
    ("SUSPENDED", "ARCHIVED"): "archive",
}

ACTION_TARGETS = {
    "activate": "ACTIVE",
    "suspend": "SUSPENDED",
    "unsuspend": "ACTIVE",
    "archive": "ARCHIVED",
}

MEMBERSHIP_TRANSITIONS: dict[tuple[str, str], str] = {
    ("INVITED", "ACTIVE"): "activate",
    ("INVITED", "REVOKED"): "revoke",
    ("ACTIVE", "REVOKED"): "revoke",
}


def transition_action(current: str, target: str) -> str:
    if current not in ORG_STATUSES or target not in ORG_STATUSES:
        raise AppError("VALIDATION_ERROR", "Invalid organization status", 422)
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


def membership_transition_action(current: str, target: str) -> str:
    action = MEMBERSHIP_TRANSITIONS.get((current, target))
    if action is None:
        raise AppError(
            "INVALID_TRANSITION",
            "Invalid membership transition",
            409,
            f"Cannot transition membership from {current} to {target}",
        )
    return action
