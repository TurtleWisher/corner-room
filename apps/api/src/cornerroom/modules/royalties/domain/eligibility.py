"""Eligibility evaluation. Policy values come from RoyaltyRule.definition data only."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID


@dataclass(frozen=True, slots=True)
class EligibilityPolicy:
    """Staff-configured eligibility. Missing policy → fail closed (no payable units)."""

    min_duration_ms: int | None = None
    require_completed: bool | None = None
    unique_listener: bool = False
    exclude_owner_plays: bool = False
    exclude_ignored: bool = True


@dataclass(frozen=True, slots=True)
class PlaybackFact:
    playback_event_id: UUID
    track_id: UUID
    user_id: UUID
    started_at: datetime
    duration_ms: int
    completed: bool
    ignored: bool


def parse_eligibility(definition: dict[str, Any] | None) -> EligibilityPolicy | None:
    if not isinstance(definition, dict):
        return None
    raw = definition.get("eligibility")
    if not isinstance(raw, dict) or not raw:
        return None
    min_ms = raw.get("min_duration_ms")
    if min_ms is not None:
        if not isinstance(min_ms, int) or min_ms < 0:
            return None
    require_completed = raw.get("require_completed")
    if require_completed is not None and not isinstance(require_completed, bool):
        return None
    unique_listener = raw.get("unique_listener")
    if unique_listener is not None and not isinstance(unique_listener, bool):
        return None
    exclude_owner = raw.get("exclude_owner_plays")
    if exclude_owner is not None and not isinstance(exclude_owner, bool):
        return None
    exclude_ignored = raw.get("exclude_ignored")
    if exclude_ignored is None:
        exclude_ignored = True
    elif not isinstance(exclude_ignored, bool):
        return None
    return EligibilityPolicy(
        min_duration_ms=min_ms,
        require_completed=require_completed,
        unique_listener=bool(unique_listener),
        exclude_owner_plays=bool(exclude_owner),
        exclude_ignored=bool(exclude_ignored),
    )


def fact_is_eligible(
    fact: PlaybackFact,
    policy: EligibilityPolicy,
    *,
    owner_user_ids: frozenset[UUID] | None = None,
) -> bool:
    if policy.exclude_ignored and fact.ignored:
        return False
    if policy.min_duration_ms is not None and fact.duration_ms < policy.min_duration_ms:
        return False
    if policy.require_completed is True and not fact.completed:
        return False
    if policy.exclude_owner_plays and owner_user_ids and fact.user_id in owner_user_ids:
        return False
    return True


def eligible_units_by_track(
    facts: list[PlaybackFact],
    policy: EligibilityPolicy,
    *,
    owner_user_ids_by_track: dict[UUID, frozenset[UUID]] | None = None,
) -> dict[UUID, int]:
    owners = owner_user_ids_by_track or {}
    if policy.unique_listener:
        seen: dict[UUID, set[UUID]] = {}
        for fact in facts:
            if not fact_is_eligible(fact, policy, owner_user_ids=owners.get(fact.track_id)):
                continue
            seen.setdefault(fact.track_id, set()).add(fact.user_id)
        return {track_id: len(users) for track_id, users in seen.items()}
    counts: dict[UUID, int] = {}
    for fact in facts:
        if not fact_is_eligible(fact, policy, owner_user_ids=owners.get(fact.track_id)):
            continue
        counts[fact.track_id] = counts.get(fact.track_id, 0) + 1
    return counts


def eligible_time_by_track(
    facts: list[PlaybackFact],
    policy: EligibilityPolicy,
    *,
    owner_user_ids_by_track: dict[UUID, frozenset[UUID]] | None = None,
) -> dict[UUID, int]:
    owners = owner_user_ids_by_track or {}
    totals: dict[UUID, int] = {}
    for fact in facts:
        if not fact_is_eligible(fact, policy, owner_user_ids=owners.get(fact.track_id)):
            continue
        totals[fact.track_id] = totals.get(fact.track_id, 0) + fact.duration_ms
    return totals
