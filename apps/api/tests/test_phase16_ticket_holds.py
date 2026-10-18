"""Hold expiry job (08_EVENT_ARCHITECTURE: a TTL job expires ACTIVE holds and returns inventory).

An abandoned checkout on the last ticket must not leave the ticket type SOLD_OUT and hidden from
the public list once the hold has run out.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import update

from cornerroom.infra.db import get_session_factory
from cornerroom.modules.ticketing.domain.models import TicketHold
from cornerroom.worker import expire_ticket_holds
from tests.auth_helpers import bearer, register_and_login
from tests.test_phase05_ticketing import (
    _on_sale_type,
    _open_ticketing,
    _platform_admin,
    _published_event,
)


async def _public_types(client: AsyncClient, event_id: str) -> dict[str, dict]:
    page = await client.get(f"/api/v1/events/{event_id}/ticket-types")
    assert page.status_code == 200, page.text
    return {row["id"]: row for row in page.json()["items"]}


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase16_expired_hold_returns_last_ticket_to_sale(client: AsyncClient) -> None:
    token, _org = await _platform_admin(client)
    event = await _published_event(client, token, title="Last Seat")
    ticket_type = await _on_sale_type(client, token, event["id"], quantity=1)
    other_type = await _on_sale_type(client, token, event["id"], quantity=3, name="Balcony")
    await _open_ticketing(client, token, event["id"])

    before = await _public_types(client, event["id"])
    assert before[ticket_type["id"]]["remaining"] == 1
    assert before[other_type["id"]]["remaining"] == 3

    buyer = await register_and_login(client, "abandoned-cart@example.com")
    hold = await client.post(
        "/api/v1/ticket-holds",
        headers=bearer(buyer["access_token"]),
        json={"ticket_type_id": ticket_type["id"], "quantity": 1},
    )
    assert hold.status_code == 201, hold.text
    hidden = await _public_types(client, event["id"])
    assert ticket_type["id"] not in hidden  # SOLD_OUT while held
    assert hidden[other_type["id"]]["remaining"] == 3

    # The buyer walks away; the hold runs past its TTL.
    factory = get_session_factory()
    async with factory() as session:
        await session.execute(
            update(TicketHold)
            .where(TicketHold.ticket_type_id == ticket_type["id"])
            .values(expires_at=TicketHold.expires_at - timedelta(days=1))
        )
        await session.commit()

    assert await expire_ticket_holds({}) == 1
    assert await expire_ticket_holds({}) == 0  # idempotent

    after = await _public_types(client, event["id"])
    assert after[ticket_type["id"]]["status"] == "ON_SALE"
    assert after[ticket_type["id"]]["remaining"] == 1
    assert after[other_type["id"]]["remaining"] == 3
