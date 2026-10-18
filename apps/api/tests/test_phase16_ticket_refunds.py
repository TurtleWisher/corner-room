"""Refunded tickets stop opening the door (06_FINANCIAL_ARCHITECTURE §5: "Tickets -> REFUNDED;
QR void"; 08_EVENT_ARCHITECTURE: "Reverse revenue; void QR").

Before this pass a fully refunded ticket order stayed ISSUED: the buyer kept a working QR code and
the door scanner let them in. A part refund leaves tickets alone (which seat it covers is open).
"""

from __future__ import annotations

from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from cornerroom.infra.db import get_engine
from cornerroom.infra.outbox import OutboxEvent
from cornerroom.modules.notifications.domain.models import Notification
from cornerroom.modules.ticketing.domain.models import RefundPolicy
from cornerroom.worker import drain_outbox
from tests.auth_helpers import bearer, register_and_login
from tests.test_phase05_ticketing import (
    _on_sale_type,
    _open_ticketing,
    _platform_admin,
    _published_event,
)


async def _paid_ticket_order(client: AsyncClient, buyer: str, ticket_type_id: str, quantity: int, key: str) -> dict:
    hold = await client.post(
        "/api/v1/ticket-holds",
        headers=bearer(buyer),
        json={"ticket_type_id": ticket_type_id, "quantity": quantity},
    )
    assert hold.status_code == 201, hold.text
    order = await client.post(
        "/api/v1/orders",
        headers={**bearer(buyer), "Idempotency-Key": key},
        json={"hold_id": hold.json()["id"], "delivery_address_confirmed": True},
    )
    assert order.status_code == 201, order.text
    paid = await client.post(f"/api/v1/payments/{order.json()['payment']['id']}/sandbox-confirm", headers=bearer(buyer))
    assert paid.status_code == 200, paid.text
    return paid.json()


async def _refund(client: AsyncClient, buyer: str, staff: str, payment_id: str, amount: int, key: str) -> dict:
    requested = await client.post(
        "/api/v1/refunds",
        headers={**bearer(buyer), "Idempotency-Key": key},
        json={"payment_id": payment_id, "amount_minor": amount, "reason_code": "CUSTOMER_REQUEST"},
    )
    assert requested.status_code == 201, requested.text
    refund_id = requested.json()["id"]
    approved = await client.post(f"/api/v1/refunds/{refund_id}/approve", headers=bearer(staff))
    assert approved.status_code == 200, approved.text
    completed = await client.post(f"/api/v1/refunds/{refund_id}/sandbox-complete", headers=bearer(staff))
    assert completed.status_code == 200, completed.text
    return completed.json()


async def _my_tickets(client: AsyncClient, buyer: str) -> list[dict]:
    return (await client.get("/api/v1/me/tickets", headers=bearer(buyer))).json()["items"]


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase16_full_refund_voids_tickets_part_refund_keeps_them(client: AsyncClient) -> None:
    staff, _org = await _platform_admin(client)
    event = await _published_event(client, staff, title="Refund Night")
    ticket_type = await _on_sale_type(client, staff, event["id"], quantity=5, price=100)
    await _open_ticketing(client, staff, event["id"])
    factory = async_sessionmaker(get_engine(), expire_on_commit=False)
    async with factory() as session:
        session.add(RefundPolicy(scope_type="PLATFORM", reason_code="CUSTOMER_REQUEST", requires_finance_approve=True))
        await session.commit()

    buyer = (await register_and_login(client, "refund-door@example.com"))["access_token"]
    paid = await _paid_ticket_order(client, buyer, ticket_type["id"], 2, "refund-door-1")
    tickets = await _my_tickets(client, buyer)
    assert [t["status"] for t in tickets] == ["ISSUED", "ISSUED"]
    old_tokens = [t["presentation_token"] for t in tickets]
    # One of the two was already scanned in before the refund.
    scanned = await client.post("/api/v1/check-in", headers=bearer(staff), json={"token": old_tokens[0]})
    assert scanned.status_code == 200, scanned.text

    payment = paid["payment"]
    await _refund(client, buyer, staff, payment["id"], payment["amount_minor"], "refund-door-r1")

    order = await client.get(f"/api/v1/orders/{paid['id']}", headers=bearer(buyer))
    assert order.json()["status"] == "REFUNDED"
    after = await _my_tickets(client, buyer)
    assert sorted(t["status"] for t in after) == ["REFUNDED", "REFUNDED"]
    assert all(t["presentation_token"] is None for t in after)
    for token in old_tokens:
        door = await client.post("/api/v1/check-in", headers=bearer(staff), json={"token": token})
        assert door.status_code == 422, door.text
        assert door.json()["code"] == "INVALID_TICKET_TOKEN"

    async with factory() as session:
        refunded_events = await session.scalar(
            select(func.count()).select_from(OutboxEvent).where(OutboxEvent.event_type == "TicketRefunded")
        )
    assert refunded_events == 2

    # FAILURE_MODEL: the buyer is told the refund is complete.
    while await drain_outbox({}):
        pass
    buyer_id = UUID((await client.get("/api/v1/me", headers=bearer(buyer))).json()["id"])
    async with factory() as session:
        notices = (
            await session.execute(
                select(Notification).where(Notification.user_id == buyer_id, Notification.type == "refund.completed")
            )
        ).scalars().all()
    assert len(notices) == 1 and notices[0].title == "Refund completed"

    # A part refund of another order leaves its ticket valid at the door.
    other = await _paid_ticket_order(client, buyer, ticket_type["id"], 1, "refund-door-2")
    await _refund(client, buyer, staff, other["payment"]["id"], 1, "refund-door-r2")
    kept = [t for t in await _my_tickets(client, buyer) if t["status"] == "ISSUED"]
    assert len(kept) == 1
    door = await client.post("/api/v1/check-in", headers=bearer(staff), json={"token": kept[0]["presentation_token"]})
    assert door.status_code == 200, door.text
