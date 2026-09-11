"""Pure playability rules. Catalog facts are independent. No royalty eligibility."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

PLAYABLE_TRACK_STATUS = "RELEASED"
PLAYABLE_VERSION_STATUS = "READY"
DELIVERABLE_MEDIA_STATUS = "READY"
DELIVERABLE_MEDIA_CLASS = "catalog_audio"


@dataclass(frozen=True, slots=True)
class CatalogSnapshot:
    track_id: UUID | None
    track_status: str | None
    track_deleted: bool
    version_id: UUID | None
    version_status: str | None
    version_is_current: bool
    version_deleted: bool
    media_asset_id: UUID | None
    media_status: str | None
    media_class: str | None
    media_deleted: bool
    release_id: UUID | None = None
    release_status: str | None = None
    release_track_present: bool | None = None


@dataclass(frozen=True, slots=True)
class Playability:
    catalog_playable: bool
    audio_deliverable: bool
    reason: str | None
    track_id: UUID | None
    track_version_id: UUID | None
    media_asset_id: UUID | None
    duration_ms: int | None = None


def evaluate_playability(snapshot: CatalogSnapshot) -> Playability:
    """Track / version / release-track / media are independent. Release RELEASED is not enough."""
    if snapshot.track_id is None or snapshot.track_deleted or snapshot.track_status is None:
        return Playability(False, False, "TRACK_NOT_FOUND", None, None, None)
    if snapshot.track_status == "TAKEN_DOWN":
        return Playability(
            False,
            False,
            "TRACK_TAKEN_DOWN",
            snapshot.track_id,
            snapshot.version_id,
            snapshot.media_asset_id,
        )
    if snapshot.track_status != PLAYABLE_TRACK_STATUS:
        return Playability(
            False,
            False,
            "TRACK_NOT_RELEASED",
            snapshot.track_id,
            snapshot.version_id,
            snapshot.media_asset_id,
        )
    if snapshot.release_id is not None and snapshot.release_track_present is False:
        return Playability(
            False,
            False,
            "RELEASE_TRACK_MISSING",
            snapshot.track_id,
            snapshot.version_id,
            snapshot.media_asset_id,
        )
    if (
        snapshot.version_id is None
        or snapshot.version_deleted
        or not snapshot.version_is_current
        or snapshot.version_status != PLAYABLE_VERSION_STATUS
    ):
        return Playability(
            False,
            False,
            "VERSION_NOT_READY",
            snapshot.track_id,
            snapshot.version_id,
            snapshot.media_asset_id,
        )
    deliverable = (
        snapshot.media_asset_id is not None
        and not snapshot.media_deleted
        and snapshot.media_status == DELIVERABLE_MEDIA_STATUS
        and snapshot.media_class == DELIVERABLE_MEDIA_CLASS
    )
    if not deliverable:
        return Playability(
            True,
            False,
            "TRACK_AUDIO_UNAVAILABLE",
            snapshot.track_id,
            snapshot.version_id,
            snapshot.media_asset_id,
        )
    return Playability(
        True,
        True,
        None,
        snapshot.track_id,
        snapshot.version_id,
        snapshot.media_asset_id,
    )
