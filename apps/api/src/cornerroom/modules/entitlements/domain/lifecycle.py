"""Entitlement lifecycle. Fail closed. Do not invent durations."""

from __future__ import annotations

from datetime import datetime

from cornerroom.infra.errors import AppError

ENTITLEMENT_TYPES = frozenset(
    {"PURCHASE", "SUBSCRIPTION", "ADMIN_GRANT", "PROMOTIONAL_GRANT"}
)
ENTITLEMENT_STATUSES = frozenset({"ACTIVE", "REVOKED", "EXPIRED"})
ENTITLEMENT_SCOPES = frozenset({"TRACK", "CATALOG"})

TRANSITIONS: dict[tuple[str, str], str] = {
    ("ACTIVE", "REVOKED"): "revoke",
    ("ACTIVE", "EXPIRED"): "expire",
}


def entitlement_transition_action(current: str, target: str) -> str:
    action = TRANSITIONS.get((current, target))
    if action is None:
        raise AppError(
            "INVALID_TRANSITION",
            "This entitlement transition is not allowed",
            409,
            f"{current} cannot move to {target}",
        )
    return action


def is_covering(
    *,
    status: str,
    scope: str,
    ref_id,
    track_id,
    expires_at: datetime | None,
    now: datetime,
) -> bool:
    if status != "ACTIVE":
        return False
    if expires_at is not None and expires_at <= now:
        return False
    if scope == "CATALOG":
        return True
    return ref_id == track_id
