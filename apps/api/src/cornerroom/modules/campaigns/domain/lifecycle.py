"""Campaign and task lifecycles from architecture. No DRAFT or PAUSED."""

from __future__ import annotations

from cornerroom.infra.errors import AppError

CAMPAIGN_STATUSES = frozenset(
    {
        "PLANNING",
        "CONTENT_PREPARATION",
        "SCHEDULED",
        "ACTIVE",
        "OPTIMIZATION",
        "COMPLETED",
        "REPORTING",
        "CANCELLED",
    }
)

CAMPAIGN_TRANSITIONS: dict[tuple[str, str], str] = {
    ("PLANNING", "CONTENT_PREPARATION"): "prepare_content",
    ("CONTENT_PREPARATION", "SCHEDULED"): "schedule",
    ("SCHEDULED", "ACTIVE"): "activate",
    ("ACTIVE", "OPTIMIZATION"): "optimize",
    ("OPTIMIZATION", "COMPLETED"): "complete",
    ("COMPLETED", "REPORTING"): "report",
}

CAMPAIGN_ACTION_TARGETS = {
    "prepare_content": "CONTENT_PREPARATION",
    "schedule": "SCHEDULED",
    "activate": "ACTIVE",
    "optimize": "OPTIMIZATION",
    "complete": "COMPLETED",
    "report": "REPORTING",
    "cancel": "CANCELLED",
}

CANCEL_FROM = frozenset(
    {
        "PLANNING",
        "CONTENT_PREPARATION",
        "SCHEDULED",
        "ACTIVE",
        "OPTIMIZATION",
    }
)

TASK_STATUSES = frozenset({"TODO", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"})

TASK_TRANSITIONS: dict[tuple[str, str], str] = {
    ("TODO", "IN_PROGRESS"): "start",
    ("IN_PROGRESS", "BLOCKED"): "block",
    ("BLOCKED", "IN_PROGRESS"): "resume",
    ("IN_PROGRESS", "DONE"): "complete",
}

TASK_ACTION_TARGETS = {
    "start": "IN_PROGRESS",
    "block": "BLOCKED",
    "resume": "IN_PROGRESS",
    "complete": "DONE",
    "cancel": "CANCELLED",
}

TASK_CANCEL_FROM = frozenset({"TODO", "IN_PROGRESS", "BLOCKED"})

CHANNEL_CODES = frozenset({"IN_APP", "EMAIL", "SOCIAL", "PRESS", "OTHER"})

SUBJECT_TYPES = frozenset({"ARTIST", "RELEASE", "EVENT"})

ATTRIBUTION_UNDEFINED = "ATTRIBUTION_UNDEFINED"


def _invalid(current: str, target: str) -> AppError:
    return AppError(
        "INVALID_TRANSITION",
        "Invalid lifecycle transition",
        409,
        f"Cannot transition from {current} to {target}",
    )


def campaign_target_for_action(action: str) -> str:
    target = CAMPAIGN_ACTION_TARGETS.get(action)
    if target is None:
        raise AppError("VALIDATION_ERROR", "Unknown lifecycle action", 422)
    return target


def campaign_transition_action(current: str, target: str) -> str:
    if current not in CAMPAIGN_STATUSES or target not in CAMPAIGN_STATUSES:
        raise AppError("VALIDATION_ERROR", "Invalid campaign status", 422)
    if target == "CANCELLED":
        if current not in CANCEL_FROM:
            raise _invalid(current, target)
        return "cancel"
    action = CAMPAIGN_TRANSITIONS.get((current, target))
    if action is None:
        raise _invalid(current, target)
    return action


def task_target_for_action(action: str) -> str:
    target = TASK_ACTION_TARGETS.get(action)
    if target is None:
        raise AppError("VALIDATION_ERROR", "Unknown task lifecycle action", 422)
    return target


def task_transition_action(current: str, target: str) -> str:
    if current not in TASK_STATUSES or target not in TASK_STATUSES:
        raise AppError("VALIDATION_ERROR", "Invalid task status", 422)
    if target == "CANCELLED":
        if current not in TASK_CANCEL_FROM:
            raise _invalid(current, target)
        return "cancel"
    action = TASK_TRANSITIONS.get((current, target))
    if action is None:
        raise _invalid(current, target)
    return action
