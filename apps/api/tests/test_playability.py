"""Playability is independent of Release status and does not invent royalty eligibility."""

from __future__ import annotations

from uuid import uuid4

from cornerroom.modules.streaming.domain.playability import CatalogSnapshot, evaluate_playability


def _base(**overrides: object) -> CatalogSnapshot:
    track_id = uuid4()
    version_id = uuid4()
    media_id = uuid4()
    data = dict(
        track_id=track_id,
        track_status="RELEASED",
        track_deleted=False,
        version_id=version_id,
        version_status="READY",
        version_is_current=True,
        version_deleted=False,
        media_asset_id=media_id,
        media_status="READY",
        media_class="catalog_audio",
        media_deleted=False,
    )
    data.update(overrides)
    return CatalogSnapshot(**data)  # type: ignore[arg-type]


def test_released_ready_with_audio_is_playable() -> None:
    result = evaluate_playability(_base())
    assert result.catalog_playable is True
    assert result.audio_deliverable is True
    assert result.reason is None


def test_takedown_is_not_playable() -> None:
    result = evaluate_playability(_base(track_status="TAKEN_DOWN"))
    assert result.catalog_playable is False
    assert result.audio_deliverable is False
    assert result.reason == "TRACK_TAKEN_DOWN"


def test_unreleased_is_not_playable() -> None:
    result = evaluate_playability(_base(track_status="APPROVED"))
    assert result.catalog_playable is False
    assert result.reason == "TRACK_NOT_RELEASED"


def test_missing_ready_version_is_not_playable() -> None:
    result = evaluate_playability(_base(version_id=None, version_status=None, version_is_current=False))
    assert result.catalog_playable is False
    assert result.reason == "VERSION_NOT_READY"


def test_non_current_version_is_not_playable() -> None:
    result = evaluate_playability(_base(version_is_current=False, version_status="SUPERSEDED"))
    assert result.reason == "VERSION_NOT_READY"


def test_missing_media_is_catalog_playable_but_not_deliverable() -> None:
    result = evaluate_playability(_base(media_asset_id=None, media_status=None, media_class=None, media_deleted=True))
    assert result.catalog_playable is True
    assert result.audio_deliverable is False
    assert result.reason == "TRACK_AUDIO_UNAVAILABLE"


def test_release_released_does_not_make_missing_release_track_playable() -> None:
    result = evaluate_playability(
        _base(release_id=uuid4(), release_status="RELEASED", release_track_present=False)
    )
    assert result.catalog_playable is False
    assert result.reason == "RELEASE_TRACK_MISSING"


def test_release_track_still_requires_track_released() -> None:
    result = evaluate_playability(
        _base(
            track_status="DRAFT",
            release_id=uuid4(),
            release_status="RELEASED",
            release_track_present=True,
        )
    )
    assert result.reason == "TRACK_NOT_RELEASED"
