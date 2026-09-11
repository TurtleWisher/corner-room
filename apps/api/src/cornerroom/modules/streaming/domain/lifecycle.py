"""Streaming lifecycles. No invented entitlement or royalty states."""

from __future__ import annotations

from cornerroom.infra.errors import AppError

SESSION_STATUSES = frozenset({"OPEN", "CLOSED"})
PLAYLIST_KINDS = frozenset({"USER", "EDITORIAL"})
USER_PLAYLIST_STATUSES = frozenset({"ACTIVE", "ARCHIVED"})
EDITORIAL_PLAYLIST_STATUSES = frozenset({"DRAFT", "PUBLISHED", "ARCHIVED"})
LIBRARY_KINDS_WRITABLE = frozenset({"LIKE", "SAVE"})
LIBRARY_ITEM_TYPES = frozenset({"track", "release", "artist", "playlist"})

SESSION_TRANSITIONS: dict[tuple[str, str], str] = {
    ("OPEN", "CLOSED"): "close",
}

USER_PLAYLIST_TRANSITIONS: dict[tuple[str, str], str] = {
    ("ACTIVE", "ARCHIVED"): "archive",
}

EDITORIAL_PLAYLIST_TRANSITIONS: dict[tuple[str, str], str] = {
    ("DRAFT", "PUBLISHED"): "publish",
    ("DRAFT", "ARCHIVED"): "archive",
    ("PUBLISHED", "ARCHIVED"): "archive",
}


def session_transition_action(current: str, target: str) -> str:
    action = SESSION_TRANSITIONS.get((current, target))
    if action is None:
        raise AppError(
            "INVALID_TRANSITION",
            "This listening session transition is not allowed",
            409,
            f"{current} cannot move to {target}",
        )
    return action


def playlist_target_for_action(kind: str, action: str) -> str:
    if kind == "USER":
        mapping = {"archive": "ARCHIVED"}
    elif kind == "EDITORIAL":
        mapping = {"publish": "PUBLISHED", "archive": "ARCHIVED"}
    else:
        mapping = {}
    target = mapping.get(action)
    if target is None:
        raise AppError("VALIDATION_ERROR", "Unknown playlist action", 422)
    return target


def playlist_transition_action(kind: str, current: str, target: str) -> str:
    table = USER_PLAYLIST_TRANSITIONS if kind == "USER" else EDITORIAL_PLAYLIST_TRANSITIONS
    action = table.get((current, target))
    if action is None:
        raise AppError(
            "INVALID_TRANSITION",
            "This playlist transition is not allowed",
            409,
            f"{kind} {current} cannot move to {target}",
        )
    return action


def permission_for_editorial_action(action: str) -> str:
    if action == "publish":
        return "music.approve"
    return "music.write"
