"""Artist, application, band, and membership lifecycles. No invented states."""

from __future__ import annotations

from cornerroom.infra.errors import AppError

ARTIST_STATUSES = frozenset(
    {
        "APPLIED",
        "UNDER_REVIEW",
        "APPROVED",
        "CONTRACT_PENDING",
        "SIGNED",
        "ACTIVE",
        "SUSPENDED",
        "TERMINATED",
        "REJECTED",
    }
)

APPLICATION_STATUSES = frozenset(
    {"SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED", "WITHDRAWN"}
)

BAND_STATUSES = frozenset({"FORMING", "ACTIVE", "HIATUS", "DISBANDED"})

MEMBER_STATUSES = frozenset({"INVITED", "ACTIVE", "LEFT", "REMOVED"})

FOLLOW_STATUSES = frozenset({"ACTIVE", "UNFOLLOWED"})

FOLLOW_TARGET_TYPES = frozenset({"ARTIST", "BAND"})

PUBLIC_ARTIST_STATUSES = frozenset({"ACTIVE"})
PUBLIC_BAND_STATUSES = frozenset({"ACTIVE"})

ARTIST_TRANSITIONS: dict[tuple[str, str], str] = {
    ("APPLIED", "UNDER_REVIEW"): "start_review",
    ("UNDER_REVIEW", "APPROVED"): "approve",
    ("UNDER_REVIEW", "REJECTED"): "reject",
    ("APPROVED", "CONTRACT_PENDING"): "begin_contract",
    ("CONTRACT_PENDING", "SIGNED"): "mark_signed",
    ("APPROVED", "ACTIVE"): "activate",
    ("CONTRACT_PENDING", "ACTIVE"): "activate",
    ("SIGNED", "ACTIVE"): "activate",
    ("ACTIVE", "SUSPENDED"): "suspend",
    ("ACTIVE", "TERMINATED"): "terminate",
    ("SUSPENDED", "TERMINATED"): "terminate",
}

ARTIST_ACTION_TARGETS = {
    "start_review": "UNDER_REVIEW",
    "approve": "APPROVED",
    "reject": "REJECTED",
    "begin_contract": "CONTRACT_PENDING",
    "mark_signed": "SIGNED",
    "activate": "ACTIVE",
    "suspend": "SUSPENDED",
    "terminate": "TERMINATED",
}

APPLICATION_TRANSITIONS: dict[tuple[str, str], str] = {
    ("SUBMITTED", "UNDER_REVIEW"): "start_review",
    ("UNDER_REVIEW", "APPROVED"): "approve",
    ("UNDER_REVIEW", "REJECTED"): "reject",
    ("SUBMITTED", "WITHDRAWN"): "withdraw",
    ("UNDER_REVIEW", "WITHDRAWN"): "withdraw",
}

APPLICATION_ACTION_TARGETS = {
    "start_review": "UNDER_REVIEW",
    "approve": "APPROVED",
    "reject": "REJECTED",
    "withdraw": "WITHDRAWN",
}

BAND_TRANSITIONS: dict[tuple[str, str], str] = {
    ("FORMING", "ACTIVE"): "activate",
    ("ACTIVE", "HIATUS"): "pause",
    ("HIATUS", "ACTIVE"): "resume",
    ("ACTIVE", "DISBANDED"): "disband",
    ("HIATUS", "DISBANDED"): "disband",
    ("FORMING", "DISBANDED"): "disband",
}

BAND_ACTION_TARGETS = {
    "activate": "ACTIVE",
    "pause": "HIATUS",
    "resume": "ACTIVE",
    "disband": "DISBANDED",
}

MEMBER_TRANSITIONS: dict[tuple[str, str], str] = {
    ("INVITED", "ACTIVE"): "accept",
    ("INVITED", "REMOVED"): "remove",
    ("ACTIVE", "LEFT"): "leave",
    ("ACTIVE", "REMOVED"): "remove",
}

MEMBER_ACTION_TARGETS = {
    "accept": "ACTIVE",
    "leave": "LEFT",
    "remove": "REMOVED",
}


def _invalid(current: str, target: str) -> AppError:
    return AppError(
        "INVALID_TRANSITION",
        "Invalid lifecycle transition",
        409,
        f"Cannot transition from {current} to {target}",
    )


def artist_target_for_action(action: str) -> str:
    target = ARTIST_ACTION_TARGETS.get(action)
    if target is None:
        raise AppError("VALIDATION_ERROR", "Unknown artist lifecycle action", 422)
    return target


def artist_transition_action(current: str, target: str) -> str:
    if current not in ARTIST_STATUSES or target not in ARTIST_STATUSES:
        raise AppError("VALIDATION_ERROR", "Invalid artist status", 422)
    action = ARTIST_TRANSITIONS.get((current, target))
    if action is None:
        raise _invalid(current, target)
    return action


def application_target_for_action(action: str) -> str:
    target = APPLICATION_ACTION_TARGETS.get(action)
    if target is None:
        raise AppError("VALIDATION_ERROR", "Unknown application lifecycle action", 422)
    return target


def application_transition_action(current: str, target: str) -> str:
    if current not in APPLICATION_STATUSES or target not in APPLICATION_STATUSES:
        raise AppError("VALIDATION_ERROR", "Invalid application status", 422)
    action = APPLICATION_TRANSITIONS.get((current, target))
    if action is None:
        raise _invalid(current, target)
    return action


def band_target_for_action(action: str) -> str:
    target = BAND_ACTION_TARGETS.get(action)
    if target is None:
        raise AppError("VALIDATION_ERROR", "Unknown band lifecycle action", 422)
    return target


def band_transition_action(current: str, target: str) -> str:
    if current not in BAND_STATUSES or target not in BAND_STATUSES:
        raise AppError("VALIDATION_ERROR", "Invalid band status", 422)
    action = BAND_TRANSITIONS.get((current, target))
    if action is None:
        raise _invalid(current, target)
    return action


def member_target_for_action(action: str) -> str:
    target = MEMBER_ACTION_TARGETS.get(action)
    if target is None:
        raise AppError("VALIDATION_ERROR", "Unknown membership lifecycle action", 422)
    return target


def member_transition_action(current: str, target: str) -> str:
    if current not in MEMBER_STATUSES or target not in MEMBER_STATUSES:
        raise AppError("VALIDATION_ERROR", "Invalid membership status", 422)
    action = MEMBER_TRANSITIONS.get((current, target))
    if action is None:
        raise _invalid(current, target)
    return action
