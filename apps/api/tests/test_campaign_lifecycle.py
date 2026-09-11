"""Campaign and task lifecycle unit tests — no database."""

from __future__ import annotations

import pytest

from cornerroom.infra.errors import AppError
from cornerroom.modules.campaigns.domain.lifecycle import (
    ATTRIBUTION_UNDEFINED,
    CHANNEL_CODES,
    SUBJECT_TYPES,
    campaign_target_for_action,
    campaign_transition_action,
    task_target_for_action,
    task_transition_action,
)


def test_planning_to_content_preparation() -> None:
    assert campaign_transition_action("PLANNING", "CONTENT_PREPARATION") == "prepare_content"


def test_happy_path_matrix() -> None:
    path = [
        ("PLANNING", "CONTENT_PREPARATION", "prepare_content"),
        ("CONTENT_PREPARATION", "SCHEDULED", "schedule"),
        ("SCHEDULED", "ACTIVE", "activate"),
        ("ACTIVE", "OPTIMIZATION", "optimize"),
        ("OPTIMIZATION", "COMPLETED", "complete"),
        ("COMPLETED", "REPORTING", "report"),
    ]
    for current, target, action in path:
        assert campaign_transition_action(current, target) == action
        assert campaign_target_for_action(action) == target


@pytest.mark.parametrize(
    "current",
    ["PLANNING", "CONTENT_PREPARATION", "SCHEDULED", "ACTIVE", "OPTIMIZATION"],
)
def test_cancel_from_open_states(current: str) -> None:
    assert campaign_transition_action(current, "CANCELLED") == "cancel"


@pytest.mark.parametrize("current", ["COMPLETED", "REPORTING", "CANCELLED"])
def test_cannot_cancel_terminal(current: str) -> None:
    with pytest.raises(AppError) as exc:
        campaign_transition_action(current, "CANCELLED")
    assert exc.value.status == 409
    assert exc.value.code == "INVALID_TRANSITION"


def test_cannot_skip_to_active() -> None:
    with pytest.raises(AppError) as exc:
        campaign_transition_action("PLANNING", "ACTIVE")
    assert exc.value.code == "INVALID_TRANSITION"


def test_no_draft_status() -> None:
    with pytest.raises(AppError) as exc:
        campaign_transition_action("DRAFT", "PLANNING")
    assert exc.value.status == 422


def test_no_paused_status() -> None:
    with pytest.raises(AppError) as exc:
        campaign_transition_action("ACTIVE", "PAUSED")
    assert exc.value.status == 422
    with pytest.raises(AppError) as exc:
        campaign_target_for_action("pause")
    assert exc.value.status == 422


def test_unknown_campaign_action() -> None:
    with pytest.raises(AppError) as exc:
        campaign_target_for_action("spend")
    assert exc.value.status == 422


def test_task_todo_to_in_progress() -> None:
    assert task_transition_action("TODO", "IN_PROGRESS") == "start"
    assert task_target_for_action("complete") == "DONE"


def test_task_cannot_complete_from_todo() -> None:
    with pytest.raises(AppError) as exc:
        task_transition_action("TODO", "DONE")
    assert exc.value.code == "INVALID_TRANSITION"


def test_task_cannot_complete_from_blocked() -> None:
    with pytest.raises(AppError) as exc:
        task_transition_action("BLOCKED", "DONE")
    assert exc.value.code == "INVALID_TRANSITION"


def test_task_block_and_resume() -> None:
    assert task_transition_action("IN_PROGRESS", "BLOCKED") == "block"
    assert task_transition_action("BLOCKED", "IN_PROGRESS") == "resume"


def test_task_cancel_from_todo() -> None:
    assert task_transition_action("TODO", "CANCELLED") == "cancel"


def test_task_cannot_cancel_done() -> None:
    with pytest.raises(AppError) as exc:
        task_transition_action("DONE", "CANCELLED")
    assert exc.value.code == "INVALID_TRANSITION"


def test_subject_types_are_architecture_only() -> None:
    assert SUBJECT_TYPES == frozenset({"ARTIST", "RELEASE", "EVENT"})
    assert "BAND" not in SUBJECT_TYPES
    assert "TRACK" not in SUBJECT_TYPES
    assert "ALBUM" not in SUBJECT_TYPES
    assert "DRAFT" not in CHANNEL_CODES


def test_attribution_is_undefined() -> None:
    assert ATTRIBUTION_UNDEFINED == "ATTRIBUTION_UNDEFINED"
