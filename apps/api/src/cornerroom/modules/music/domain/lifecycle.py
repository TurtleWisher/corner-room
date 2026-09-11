"""Music catalog lifecycles. No invented states, royalties, or streaming side effects."""

from __future__ import annotations

from cornerroom.infra.errors import AppError

TRACK_STATUSES = frozenset(
    {
        "DRAFT",
        "SUBMITTED",
        "IN_REVIEW",
        "APPROVED",
        "SCHEDULED",
        "RELEASED",
        "REJECTED",
        "TAKEN_DOWN",
        "ARCHIVED",
    }
)

RELEASE_STATUSES = frozenset(
    {
        "IDEA",
        "DEMO",
        "IN_PRODUCTION",
        "QC",
        "METADATA_REVIEW",
        "APPROVED",
        "SCHEDULED",
        "RELEASED",
        "TAKEN_DOWN",
        "ARCHIVED",
    }
)

VERSION_STATUSES = frozenset({"UPLOADING", "PROCESSING", "READY", "REJECTED", "SUPERSEDED"})

RELEASE_TYPES = frozenset({"SINGLE", "EP", "ALBUM", "COMPILATION", "LIVE"})

VERSION_TYPES = frozenset({"MASTER", "WORKING"})

PUBLIC_TRACK_STATUSES = frozenset({"RELEASED"})
PUBLIC_RELEASE_STATUSES = frozenset({"RELEASED"})

TRACK_TRANSITIONS: dict[tuple[str, str], str] = {
    ("DRAFT", "SUBMITTED"): "submit",
    ("SUBMITTED", "IN_REVIEW"): "start_review",
    ("IN_REVIEW", "APPROVED"): "approve",
    ("IN_REVIEW", "REJECTED"): "reject",
    ("APPROVED", "SCHEDULED"): "schedule",
    ("APPROVED", "RELEASED"): "release",
    ("SCHEDULED", "RELEASED"): "release",
    ("APPROVED", "TAKEN_DOWN"): "takedown",
    ("SCHEDULED", "TAKEN_DOWN"): "takedown",
    ("RELEASED", "TAKEN_DOWN"): "takedown",
    ("RELEASED", "ARCHIVED"): "archive",
    ("TAKEN_DOWN", "ARCHIVED"): "archive",
}

TRACK_ACTION_TARGETS = {
    "submit": "SUBMITTED",
    "start_review": "IN_REVIEW",
    "approve": "APPROVED",
    "reject": "REJECTED",
    "schedule": "SCHEDULED",
    "release": "RELEASED",
    "takedown": "TAKEN_DOWN",
    "archive": "ARCHIVED",
}

TRACK_WRITE_ACTIONS = frozenset({"submit", "start_review"})
TRACK_APPROVE_ACTIONS = frozenset({"approve", "schedule", "release"})
TRACK_TAKEDOWN_ACTIONS = frozenset({"takedown", "archive"})

RELEASE_TRANSITIONS: dict[tuple[str, str], str] = {
    ("IDEA", "DEMO"): "start_demo",
    ("IDEA", "IN_PRODUCTION"): "start_production",
    ("DEMO", "IN_PRODUCTION"): "start_production",
    ("IN_PRODUCTION", "QC"): "start_qc",
    ("QC", "METADATA_REVIEW"): "start_metadata_review",
    ("IDEA", "APPROVED"): "approve",
    ("DEMO", "APPROVED"): "approve",
    ("IN_PRODUCTION", "APPROVED"): "approve",
    ("QC", "APPROVED"): "approve",
    ("METADATA_REVIEW", "APPROVED"): "approve",
    ("APPROVED", "SCHEDULED"): "schedule",
    ("APPROVED", "RELEASED"): "release",
    ("SCHEDULED", "RELEASED"): "release",
    ("RELEASED", "TAKEN_DOWN"): "takedown",
    ("RELEASED", "ARCHIVED"): "archive",
    ("TAKEN_DOWN", "ARCHIVED"): "archive",
}

RELEASE_ACTION_TARGETS = {
    "start_demo": "DEMO",
    "start_production": "IN_PRODUCTION",
    "start_qc": "QC",
    "start_metadata_review": "METADATA_REVIEW",
    "approve": "APPROVED",
    "schedule": "SCHEDULED",
    "release": "RELEASED",
    "takedown": "TAKEN_DOWN",
    "archive": "ARCHIVED",
}

RELEASE_WRITE_ACTIONS = frozenset(
    {"start_demo", "start_production", "start_qc", "start_metadata_review"}
)
RELEASE_APPROVE_ACTIONS = frozenset({"approve", "schedule", "release"})
RELEASE_TAKEDOWN_ACTIONS = frozenset({"takedown", "archive"})

VERSION_TRANSITIONS: dict[tuple[str, str], str] = {
    ("UPLOADING", "PROCESSING"): "start_processing",
    ("UPLOADING", "READY"): "mark_ready",
    ("PROCESSING", "READY"): "mark_ready",
    ("UPLOADING", "REJECTED"): "reject",
    ("PROCESSING", "REJECTED"): "reject",
    ("READY", "SUPERSEDED"): "supersede",
}

VERSION_ACTION_TARGETS = {
    "start_processing": "PROCESSING",
    "mark_ready": "READY",
    "reject": "REJECTED",
    "supersede": "SUPERSEDED",
}


def _invalid(current: str, target: str) -> AppError:
    return AppError(
        "INVALID_TRANSITION",
        "Invalid lifecycle transition",
        409,
        f"Cannot transition from {current} to {target}",
    )


def track_target_for_action(action: str) -> str:
    target = TRACK_ACTION_TARGETS.get(action)
    if target is None:
        raise AppError("VALIDATION_ERROR", "Unknown track lifecycle action", 422)
    return target


def track_transition_action(current: str, target: str) -> str:
    if current not in TRACK_STATUSES or target not in TRACK_STATUSES:
        raise AppError("VALIDATION_ERROR", "Invalid track status", 422)
    action = TRACK_TRANSITIONS.get((current, target))
    if action is None:
        raise _invalid(current, target)
    return action


def release_target_for_action(action: str) -> str:
    target = RELEASE_ACTION_TARGETS.get(action)
    if target is None:
        raise AppError("VALIDATION_ERROR", "Unknown release lifecycle action", 422)
    return target


def release_transition_action(current: str, target: str) -> str:
    if current not in RELEASE_STATUSES or target not in RELEASE_STATUSES:
        raise AppError("VALIDATION_ERROR", "Invalid release status", 422)
    action = RELEASE_TRANSITIONS.get((current, target))
    if action is None:
        raise _invalid(current, target)
    return action


def version_target_for_action(action: str) -> str:
    target = VERSION_ACTION_TARGETS.get(action)
    if target is None:
        raise AppError("VALIDATION_ERROR", "Unknown track version action", 422)
    return target


def version_transition_action(current: str, target: str) -> str:
    if current not in VERSION_STATUSES or target not in VERSION_STATUSES:
        raise AppError("VALIDATION_ERROR", "Invalid track version status", 422)
    action = VERSION_TRANSITIONS.get((current, target))
    if action is None:
        raise _invalid(current, target)
    return action


def permission_for_track_action(action: str) -> str:
    if action in TRACK_WRITE_ACTIONS:
        return "music.write"
    if action in TRACK_APPROVE_ACTIONS:
        return "music.approve"
    if action in TRACK_TAKEDOWN_ACTIONS:
        return "music.takedown"
    raise AppError("VALIDATION_ERROR", "Unknown track lifecycle action", 422)


def permission_for_release_action(action: str) -> str:
    if action in RELEASE_WRITE_ACTIONS:
        return "music.write"
    if action in RELEASE_APPROVE_ACTIONS:
        return "music.approve"
    if action in RELEASE_TAKEDOWN_ACTIONS:
        return "music.takedown"
    raise AppError("VALIDATION_ERROR", "Unknown release lifecycle action", 422)
