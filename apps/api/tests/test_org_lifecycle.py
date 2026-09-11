"""Organization lifecycle unit tests — no database."""

from __future__ import annotations

import pytest

from cornerroom.infra.errors import AppError
from cornerroom.modules.identity.application.org_lifecycle import (
    membership_transition_action,
    target_for_action,
    transition_action,
)


def test_pending_to_active() -> None:
    assert transition_action("PENDING", "ACTIVE") == "activate"


def test_invalid_org_transition_denied() -> None:
    with pytest.raises(AppError) as exc:
        transition_action("ARCHIVED", "ACTIVE")
    assert exc.value.status == 409
    assert exc.value.code == "INVALID_TRANSITION"


def test_archive_from_suspended() -> None:
    assert transition_action("SUSPENDED", "ARCHIVED") == "archive"


def test_unknown_action() -> None:
    with pytest.raises(AppError) as exc:
        target_for_action("delete")
    assert exc.value.status == 422


def test_membership_invited_to_active() -> None:
    assert membership_transition_action("INVITED", "ACTIVE") == "activate"


def test_membership_revoked_cannot_reactivate() -> None:
    with pytest.raises(AppError) as exc:
        membership_transition_action("REVOKED", "ACTIVE")
    assert exc.value.code == "INVALID_TRANSITION"
