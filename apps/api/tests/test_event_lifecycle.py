"""Event and venue lifecycle unit tests — no database."""

from __future__ import annotations

import pytest

from cornerroom.infra.errors import AppError
from cornerroom.modules.events.domain.lifecycle import (
    event_target_for_action,
    event_transition_action,
    venue_target_for_action,
    venue_transition_action,
)


def test_draft_to_planned() -> None:
    assert event_transition_action("DRAFT", "PLANNED") == "plan"


def test_planned_to_published() -> None:
    assert event_transition_action("PLANNED", "PUBLISHED") == "publish"


def test_invalid_event_transition_denied() -> None:
    with pytest.raises(AppError) as exc:
        event_transition_action("ARCHIVED", "DRAFT")
    assert exc.value.status == 409
    assert exc.value.code == "INVALID_TRANSITION"


def test_cannot_cancel_completed() -> None:
    with pytest.raises(AppError) as exc:
        event_transition_action("COMPLETED", "CANCELLED")
    assert exc.value.code == "INVALID_TRANSITION"


def test_postpone_from_published() -> None:
    assert event_transition_action("PUBLISHED", "POSTPONED") == "postpone"


def test_resume_from_postponed_to_published() -> None:
    assert event_transition_action("POSTPONED", "PUBLISHED") == "resume"


def test_settle_action_exists_as_state_only() -> None:
    assert event_target_for_action("settle") == "SETTLED"
    assert event_transition_action("COMPLETED", "SETTLED") == "settle"


def test_unknown_event_action() -> None:
    with pytest.raises(AppError) as exc:
        event_target_for_action("explode")
    assert exc.value.status == 422


def test_venue_activate() -> None:
    assert venue_transition_action("DRAFT", "ACTIVE") == "activate"
    assert venue_target_for_action("deactivate") == "INACTIVE"


def test_venue_inactive_is_terminal() -> None:
    with pytest.raises(AppError) as exc:
        venue_transition_action("INACTIVE", "ACTIVE")
    assert exc.value.code == "INVALID_TRANSITION"


def test_cannot_skip_to_live() -> None:
    with pytest.raises(AppError) as exc:
        event_transition_action("PUBLISHED", "LIVE")
    assert exc.value.code == "INVALID_TRANSITION"
