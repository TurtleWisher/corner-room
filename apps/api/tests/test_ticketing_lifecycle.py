"""TicketType / hold / ticket lifecycle unit tests — no database."""

from __future__ import annotations

import pytest

from cornerroom.infra.errors import AppError
from cornerroom.modules.ticketing.application.tokens import ticket_token, verify_ticket_token
from cornerroom.modules.ticketing.domain.lifecycle import (
    PURCHASABLE_EVENT_STATUSES,
    ticket_type_target_for_action,
    ticket_type_transition_action,
)


def test_draft_to_on_sale() -> None:
    assert ticket_type_transition_action("DRAFT", "ON_SALE") == "on_sale"


def test_on_sale_to_closed() -> None:
    assert ticket_type_transition_action("ON_SALE", "CLOSED") == "close"


def test_cannot_skip_draft_to_closed() -> None:
    with pytest.raises(AppError) as exc:
        ticket_type_transition_action("DRAFT", "CLOSED")
    assert exc.value.status == 409
    assert exc.value.code == "INVALID_TRANSITION"


def test_unknown_ticket_type_action() -> None:
    with pytest.raises(AppError) as exc:
        ticket_type_target_for_action("comp")
    assert exc.value.status == 422


def test_purchases_only_while_ticketing_open() -> None:
    assert PURCHASABLE_EVENT_STATUSES == frozenset({"TICKETING_OPEN"})
    assert "LIVE" not in PURCHASABLE_EVENT_STATUSES
    assert "SALES_CLOSED" not in PURCHASABLE_EVENT_STATUSES
    assert "CANCELLED" not in PURCHASABLE_EVENT_STATUSES


def test_ticket_token_roundtrip() -> None:
    from uuid import uuid4

    ticket_id = uuid4()
    token = ticket_token(ticket_id, "test-secret")
    assert verify_ticket_token(token, "test-secret") == ticket_id
    assert verify_ticket_token(token, "other") is None
    assert verify_ticket_token("not-a-token", "test-secret") is None
