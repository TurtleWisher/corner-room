"""Per-ticket refunds and refunded seats back on sale (owner, 2026-10-18).

Q-COM-01: staff choose the exact tickets; the amount is their price; only those stop working.
Q-COM-02: a refunded seat returns to sale only while its type is selling, the event is
TICKETING_OPEN and has not started; a checked-in ticket never returns.
D-REF-01: the six platform refund reasons are seeded; the staff screen finds an order by its
reference, and another label's staff get 404.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import async_sessionmaker

from cornerroom.infra.db import get_engine
from cornerroom.modules.events.domain.models import Event
from tests.auth_helpers import admin_token, bearer, register_and_login
from tests.test_phase05_ticketing import _on_sale_type, _open_ticketing, _platform_admin, _published_event, _workspace


def _reference(order_id: str) -> str:
    return "CR-" + order_id.replace("-", "")[-8:].upper()


async def _remaining(client: AsyncClient, event_id: str, type_id: str) -> tuple[str, int] | None:
    rows = (await client.get(f"/api/v1/events/{event_id}/ticket-types")).json()["items"]
    row = next((r for r in rows if r["id"] == type_id), None)
    return (row["status"], row["remaining"]) if row else None


async def _refund(client: AsyncClient, staff: str, order_id: str, ticket_ids: list[str], key: str) -> dict:
    requested = await client.post(
        "/api/v1/refunds",
        headers={**bearer(staff), "Idempotency-Key": key},
        json={"order_id": order_id, "ticket_ids": ticket_ids, "reason_code": "CUSTOMER_REQUEST"},
    )
    assert requested.status_code == 201, requested.text
    refund = requested.json()
    assert (await client.post(f"/api/v1/refunds/{refund['id']}/approve", headers=bearer(staff))).status_code == 200
    done = await client.post(f"/api/v1/refunds/{refund['id']}/sandbox-complete", headers=bearer(staff))
    assert done.status_code == 200, done.text
    return refund


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase16_refund_chosen_tickets_and_resell_seats(client: AsyncClient) -> None:
    staff, _org = await _platform_admin(client)
    event = await _published_event(client, staff, title="Per Ticket Night")
    ticket_type = await _on_sale_type(client, staff, event["id"], quantity=3, price=100)
    await _open_ticketing(client, staff, event["id"])

    reasons = (await client.get("/api/v1/refund-reasons", headers=bearer(staff))).json()
    assert [r["reason_code"] for r in reasons] == [
        "CUSTOMER_REQUEST", "EVENT_CANCELLED", "EVENT_POSTPONED", "LATE_PAYMENT", "DUPLICATE_PAYMENT", "GOODWILL",
    ]
    assert all(r["requires_finance_approve"] for r in reasons)

    buyer = (await register_and_login(client, "per-ticket@example.com"))["access_token"]
    hold = await client.post("/api/v1/ticket-holds", headers=bearer(buyer), json={"ticket_type_id": ticket_type["id"], "quantity": 3})
    order = (await client.post("/api/v1/orders", headers={**bearer(buyer), "Idempotency-Key": "pt-1"}, json={"hold_id": hold.json()["id"], "delivery_address_confirmed": True})).json()
    paid = await client.post(f"/api/v1/payments/{order['payment']['id']}/sandbox-confirm", headers=bearer(buyer))
    assert paid.status_code == 200, paid.text
    assert await _remaining(client, event["id"], ticket_type["id"]) is None  # SOLD_OUT, hidden from the public list

    view = await client.get("/api/v1/staff/orders/lookup", params={"reference": _reference(order["id"])}, headers=bearer(staff))
    assert view.status_code == 200, view.text
    body = view.json()
    assert body["id"] == order["id"] and body["buyer_email"] != "per-ticket@example.com"
    tickets = body["tickets"]
    assert len(tickets) == 3 and all(t["refundable"] for t in tickets)
    t1, t2, t3 = (t["id"] for t in tickets)

    # The amount is never typed: sending one with ticket_ids is refused.
    typed = await client.post(
        "/api/v1/refunds",
        headers={**bearer(staff), "Idempotency-Key": "pt-typed"},
        json={"order_id": order["id"], "ticket_ids": [t1], "amount_minor": 1, "reason_code": "CUSTOMER_REQUEST"},
    )
    assert typed.status_code == 422

    first = await client.post(
        "/api/v1/refunds",
        headers={**bearer(staff), "Idempotency-Key": "pt-r1"},
        json={"order_id": order["id"], "ticket_ids": [t1], "reason_code": "CUSTOMER_REQUEST"},
    )
    assert first.status_code == 201, first.text
    assert first.json()["amount_minor"] == 100 and first.json()["ticket_ids"] == [t1]
    again = await client.post(
        "/api/v1/refunds",
        headers={**bearer(staff), "Idempotency-Key": "pt-r1-dup"},
        json={"order_id": order["id"], "ticket_ids": [t1], "reason_code": "CUSTOMER_REQUEST"},
    )
    assert again.status_code == 409 and again.json()["code"] == "TICKET_REFUND_PENDING"
    queue = (await client.get("/api/v1/staff/refunds", headers=bearer(staff))).json()
    assert [r["id"] for r in queue] == [first.json()["id"]]

    assert (await client.post(f"/api/v1/refunds/{first.json()['id']}/approve", headers=bearer(staff))).status_code == 200
    assert (await client.post(f"/api/v1/refunds/{first.json()['id']}/sandbox-complete", headers=bearer(staff))).status_code == 200
    mine = {t["id"]: t for t in (await client.get("/api/v1/me/tickets", headers=bearer(buyer))).json()["items"]}
    assert mine[t1]["status"] == "REFUNDED" and mine[t1]["presentation_token"] is None
    assert mine[t2]["status"] == "ISSUED" and mine[t3]["status"] == "ISSUED"
    assert (await client.get(f"/api/v1/orders/{order['id']}", headers=bearer(buyer))).json()["status"] == "PARTIALLY_REFUNDED"
    # Q-COM-02: the seat is back on sale.
    assert await _remaining(client, event["id"], ticket_type["id"]) == ("ON_SALE", 1)
    assert (await client.get("/api/v1/staff/refunds", headers=bearer(staff))).json() == []

    # A checked-in ticket is refunded but its seat never returns.
    scanned = await client.post("/api/v1/check-in", headers=bearer(staff), json={"token": mine[t2]["presentation_token"]})
    assert scanned.status_code == 200, scanned.text
    await _refund(client, staff, order["id"], [t2], "pt-r2")
    assert await _remaining(client, event["id"], ticket_type["id"]) == ("ON_SALE", 1)

    # Once the event has started, a refunded seat stays off sale.
    factory = async_sessionmaker(get_engine(), expire_on_commit=False)
    async with factory() as session:
        await session.execute(
            update(Event).where(Event.id == event["id"]).values(starts_at=datetime.now(timezone.utc) - timedelta(minutes=5))
        )
        await session.commit()
    await _refund(client, staff, order["id"], [t3], "pt-r3")
    assert await _remaining(client, event["id"], ticket_type["id"]) == ("ON_SALE", 1)
    final = (await client.get(f"/api/v1/orders/{order['id']}", headers=bearer(buyer))).json()
    assert final["status"] == "REFUNDED" and final["refunded_amount_minor"] == 300


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase16_refund_screen_is_hidden_from_another_label(client: AsyncClient) -> None:
    staff, _org = await _platform_admin(client)
    event = await _published_event(client, staff, title="Platform Show")
    ticket_type = await _on_sale_type(client, staff, event["id"], quantity=2, price=100)
    await _open_ticketing(client, staff, event["id"])
    buyer = (await register_and_login(client, "hidden-order@example.com"))["access_token"]
    hold = await client.post("/api/v1/ticket-holds", headers=bearer(buyer), json={"ticket_type_id": ticket_type["id"], "quantity": 1})
    order = (await client.post("/api/v1/orders", headers={**bearer(buyer), "Idempotency-Key": "hid-1"}, json={"hold_id": hold.json()["id"], "delivery_address_confirmed": True})).json()
    await client.post(f"/api/v1/payments/{order['payment']['id']}/sandbox-confirm", headers=bearer(buyer))

    admin = await admin_token(client)
    label = next(r for r in (await client.get("/api/v1/organizations", headers=bearer(admin))).json()["items"] if r["type"] == "LABEL")
    finance = next(r for r in (await client.get("/api/v1/roles", headers=bearer(admin))).json() if r["key"] == "finance_manager")
    other = await register_and_login(client, "other-label-finance@example.com")
    joined = await client.post(
        f"/api/v1/organizations/{label['id']}/memberships",
        headers=bearer(admin),
        json={"user_id": other["user"]["id"], "status": "ACTIVE", "role_id": finance["id"]},
    )
    assert joined.status_code == 201, joined.text
    other_token = await _workspace(client, other["access_token"], label["id"])

    lookup = await client.get("/api/v1/staff/orders/lookup", params={"reference": _reference(order["id"])}, headers=bearer(other_token))
    assert lookup.status_code == 404
    ticket_id = (await client.get("/api/v1/me/tickets", headers=bearer(buyer))).json()["items"][0]["id"]
    refused = await client.post(
        "/api/v1/refunds",
        headers={**bearer(other_token), "Idempotency-Key": "hid-r"},
        json={"order_id": order["id"], "ticket_ids": [ticket_id], "reason_code": "CUSTOMER_REQUEST"},
    )
    assert refused.status_code == 404
    bad = await client.get("/api/v1/staff/orders/lookup", params={"reference": "CR-NOTHEX!"}, headers=bearer(staff))
    assert bad.status_code == 422
