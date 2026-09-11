"""Track, release, and version lifecycle unit tests — no database."""

from __future__ import annotations

import pytest

from cornerroom.infra.errors import AppError
from cornerroom.modules.music.domain.lifecycle import (
    permission_for_release_action,
    permission_for_track_action,
    release_target_for_action,
    release_transition_action,
    track_target_for_action,
    track_transition_action,
    version_transition_action,
)


def test_track_draft_submit_review_approve() -> None:
    assert track_transition_action("DRAFT", "SUBMITTED") == "submit"
    assert track_transition_action("SUBMITTED", "IN_REVIEW") == "start_review"
    assert track_transition_action("IN_REVIEW", "APPROVED") == "approve"


def test_track_may_skip_scheduled() -> None:
    assert track_transition_action("APPROVED", "RELEASED") == "release"
    assert track_transition_action("SCHEDULED", "RELEASED") == "release"


def test_track_cannot_skip_review() -> None:
    with pytest.raises(AppError) as exc:
        track_transition_action("DRAFT", "RELEASED")
    assert exc.value.code == "INVALID_TRANSITION"
    assert exc.value.status == 409


def test_track_restore_from_takedown_denied() -> None:
    with pytest.raises(AppError) as exc:
        track_transition_action("TAKEN_DOWN", "RELEASED")
    assert exc.value.code == "INVALID_TRANSITION"


def test_unknown_track_action() -> None:
    with pytest.raises(AppError) as exc:
        track_target_for_action("stream")
    assert exc.value.status == 422


def test_track_permissions_split() -> None:
    assert permission_for_track_action("submit") == "music.write"
    assert permission_for_track_action("approve") == "music.approve"
    assert permission_for_track_action("release") == "music.approve"
    assert permission_for_track_action("takedown") == "music.takedown"


def test_release_skippable_approve_from_idea() -> None:
    assert release_transition_action("IDEA", "APPROVED") == "approve"
    assert release_transition_action("IDEA", "DEMO") == "start_demo"


def test_release_cannot_release_from_idea() -> None:
    with pytest.raises(AppError) as exc:
        release_transition_action("IDEA", "RELEASED")
    assert exc.value.code == "INVALID_TRANSITION"


def test_release_takedown_and_archive() -> None:
    assert release_transition_action("RELEASED", "TAKEN_DOWN") == "takedown"
    assert release_transition_action("TAKEN_DOWN", "ARCHIVED") == "archive"


def test_release_permissions_split() -> None:
    assert permission_for_release_action("start_production") == "music.write"
    assert permission_for_release_action("approve") == "music.approve"
    assert permission_for_release_action("takedown") == "music.takedown"


def test_unknown_release_action() -> None:
    with pytest.raises(AppError) as exc:
        release_target_for_action("distribute_dsp")
    assert exc.value.status == 422


def test_version_may_skip_processing() -> None:
    assert version_transition_action("UPLOADING", "READY") == "mark_ready"
    assert version_transition_action("UPLOADING", "PROCESSING") == "start_processing"


def test_version_cannot_ready_from_rejected() -> None:
    with pytest.raises(AppError) as exc:
        version_transition_action("REJECTED", "READY")
    assert exc.value.code == "INVALID_TRANSITION"


def test_version_supersede_from_ready() -> None:
    assert version_transition_action("READY", "SUPERSEDED") == "supersede"
