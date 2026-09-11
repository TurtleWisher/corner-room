"""Artist, band, application, and membership lifecycle unit tests — no database."""

from __future__ import annotations

import pytest

from cornerroom.infra.errors import AppError
from cornerroom.modules.artists.domain.lifecycle import (
    application_target_for_action,
    application_transition_action,
    artist_target_for_action,
    artist_transition_action,
    band_transition_action,
    member_transition_action,
)
from cornerroom.modules.events.domain.lifecycle import lineup_transition_action


def test_artist_applied_to_review() -> None:
    assert artist_transition_action("APPLIED", "UNDER_REVIEW") == "start_review"


def test_artist_may_skip_contract_states() -> None:
    assert artist_transition_action("APPROVED", "ACTIVE") == "activate"
    assert artist_transition_action("CONTRACT_PENDING", "ACTIVE") == "activate"
    assert artist_transition_action("SIGNED", "ACTIVE") == "activate"


def test_artist_cannot_skip_review() -> None:
    with pytest.raises(AppError) as exc:
        artist_transition_action("APPLIED", "ACTIVE")
    assert exc.value.code == "INVALID_TRANSITION"
    assert exc.value.status == 409


def test_artist_unsuspend_denied() -> None:
    with pytest.raises(AppError) as exc:
        artist_transition_action("SUSPENDED", "ACTIVE")
    assert exc.value.code == "INVALID_TRANSITION"


def test_artist_reject_from_review() -> None:
    assert artist_transition_action("UNDER_REVIEW", "REJECTED") == "reject"


def test_unknown_artist_action() -> None:
    with pytest.raises(AppError) as exc:
        artist_target_for_action("explode")
    assert exc.value.status == 422


def test_application_withdraw() -> None:
    assert application_transition_action("SUBMITTED", "WITHDRAWN") == "withdraw"
    assert application_target_for_action("approve") == "APPROVED"


def test_application_cannot_approve_from_submitted() -> None:
    with pytest.raises(AppError) as exc:
        application_transition_action("SUBMITTED", "APPROVED")
    assert exc.value.code == "INVALID_TRANSITION"


def test_band_forming_to_active() -> None:
    assert band_transition_action("FORMING", "ACTIVE") == "activate"


def test_band_disbanded_is_terminal() -> None:
    with pytest.raises(AppError) as exc:
        band_transition_action("DISBANDED", "ACTIVE")
    assert exc.value.code == "INVALID_TRANSITION"


def test_member_accept_and_leave() -> None:
    assert member_transition_action("INVITED", "ACTIVE") == "accept"
    assert member_transition_action("ACTIVE", "LEFT") == "leave"
    assert member_transition_action("ACTIVE", "REMOVED") == "remove"


def test_member_cannot_accept_when_removed() -> None:
    with pytest.raises(AppError) as exc:
        member_transition_action("REMOVED", "ACTIVE")
    assert exc.value.code == "INVALID_TRANSITION"


def test_lineup_confirm_and_withdraw() -> None:
    assert lineup_transition_action("INVITED", "CONFIRMED") == "confirm"
    assert lineup_transition_action("CONFIRMED", "WITHDRAWN") == "withdraw"


def test_lineup_cannot_perform_from_invited() -> None:
    with pytest.raises(AppError) as exc:
        lineup_transition_action("INVITED", "PERFORMED")
    assert exc.value.code == "INVALID_TRANSITION"
