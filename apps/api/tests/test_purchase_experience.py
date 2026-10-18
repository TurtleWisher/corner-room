"""Premium purchase experience, backend truth (2026-10-13):
- the order tells checkout what it needs (line items priced by the server, reservation expiry,
  payment mode), so the page never computes money or invents a countdown;
- a customer can complete a sandbox payment themselves only on local, dev and test servers;
- a payment that arrives after the reservation expired is kept (PAID, flagged for staff), never
  rolled back, and a repeated callback is safe.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select

from cornerroom.infra.settings import get_settings
from cornerroom.modules.finance.application.sandbox import sign_sandbox_payload
from tests.auth_helpers import bearer, register_and_login
from tests.test_phase05_ticketing import _on_sale_type, _open_ticketing, _platform_admin, _published_event
from tests.test_phase09_purchases import _active_offer, _released_track


async def _ticket_order(client: AsyncClient, *, email: str, quantity: int = 2, key: str = "k1") -> tuple[dict, dict, str]:
    token, _org = await _platform_admin(client)
    event = await _published_event(client, token, title=f"Show {email.split('@')[0]}")
    ticket_type = await _on_sale_type(client, token, event["id"], quantity=5, price=1500, currency="BDT", name="Early entry")
    await _open_ticketing(client, token, event["id"])
    buyer = await register_and_login(client, email)
    hold = await client.post(
        "/api/v1/ticket-holds",
        headers=bearer(buyer["access_token"]),
        json={"ticket_type_id": ticket_type["id"], "quantity": quantity},
    )
    assert hold.status_code == 201, hold.text
    order = await client.post(
        "/api/v1/orders",
        headers={**bearer(buyer["access_token"]), "Idempotency-Key": key},
        json={"hold_id": hold.json()["id"], "delivery_address_confirmed": True},
    )
    assert order.status_code == 201, order.text
    return order.json(), {"event": event, "ticket_type": ticket_type, "hold": hold.json()}, buyer["access_token"]


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_ticket_order_carries_server_priced_items_and_reservation(client: AsyncClient) -> None:
    order, ctx, buyer = await _ticket_order(client, email="items@example.com", quantity=2)
    assert order["total_amount_minor"] == 3000 and order["currency_code"] == "BDT"
    [item] = order["items"]
    assert item["item_type"] == "TICKET"
    assert item["quantity"] == 2
    assert item["unit_amount_minor"] == 1500 and item["amount_minor"] == 3000
    assert item["ticket_type_name"] == "Early entry"
    assert item["event_id"] == ctx["event"]["id"]
    assert order["hold_expires_at"] == ctx["hold"]["expires_at"]
    assert order["hold_status"] == "ACTIVE"
    payment = order["payment"]
    assert payment["mode"] == "test"
    assert payment["self_confirm_available"] is True  # tests run as APP_ENV=test
    assert payment["qr_image_url"] is None  # no Bangla QR configured yet

    fetched = await client.get(f"/api/v1/orders/{order['id']}", headers=bearer(buyer))
    assert fetched.json()["items"] == order["items"]

    confirmed = await client.post(f"/api/v1/payments/{payment['id']}/sandbox-confirm", headers=bearer(buyer))
    assert confirmed.status_code == 200
    body = confirmed.json()
    assert body["status"] == "FULFILLED"
    assert body["payment"]["status"] == "CAPTURED"
    assert body["payment"]["self_confirm_available"] is False
    assert body["hold_status"] == "CONVERTED"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_other_customers_cannot_read_an_order(client: AsyncClient) -> None:
    order, _ctx, _buyer = await _ticket_order(client, email="owner@example.com")
    stranger = await register_and_login(client, "stranger@example.com")
    peek = await client.get(f"/api/v1/orders/{order['id']}", headers=bearer(stranger["access_token"]))
    assert peek.status_code == 404
    pay = await client.post(
        f"/api/v1/payments/{order['payment']['id']}/sandbox-confirm", headers=bearer(stranger["access_token"])
    )
    assert pay.status_code == 404


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_self_confirm_is_refused_outside_test_environments(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    order, _ctx, buyer = await _ticket_order(client, email="live@example.com")
    monkeypatch.setenv("APP_ENV", "staging")
    get_settings.cache_clear()
    fetched = await client.get(f"/api/v1/orders/{order['id']}", headers=bearer(buyer))
    assert fetched.json()["payment"]["self_confirm_available"] is False
    refused = await client.post(f"/api/v1/payments/{order['payment']['id']}/sandbox-confirm", headers=bearer(buyer))
    assert refused.status_code == 409
    assert refused.json()["code"] == "PAYMENT_CONFIRMATION_UNAVAILABLE"
    still = await client.get(f"/api/v1/orders/{order['id']}", headers=bearer(buyer))
    assert still.json()["status"] == "PENDING_PAYMENT"
    assert still.json()["payment"]["status"] == "REQUIRES_ACTION"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_late_payment_after_expired_hold_is_kept_and_flagged(client: AsyncClient) -> None:
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.audit.domain.models import AuditLog
    from cornerroom.modules.finance.domain.models import Payment
    from cornerroom.modules.ticketing.domain.models import Ticket, TicketHold

    order, ctx, buyer = await _ticket_order(client, email="late@example.com", quantity=1)
    # The 15-minute reservation runs out and the sweep releases it.
    async with get_session_factory()() as session:
        hold = await session.get(TicketHold, UUID(ctx["hold"]["id"]))
        hold.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        await session.commit()
    # The next shopper's hold runs the expiry sweep (and takes the released seat).
    other = await register_and_login(client, "nextinline@example.com")
    released = await client.post(
        "/api/v1/ticket-holds",
        headers=bearer(other["access_token"]),
        json={"ticket_type_id": ctx["ticket_type"]["id"], "quantity": 1},
    )
    assert released.status_code == 201, released.text
    async with get_session_factory()() as session:
        assert (await session.get(TicketHold, UUID(ctx["hold"]["id"]))).status == "EXPIRED"

    payload = {
        "payment_id": order["payment"]["id"],
        "amount_minor": 1500,
        "currency_code": "BDT",
        "provider_event_id": "evt-late-1",
        "status": "CAPTURED",
    }
    signature = sign_sandbox_payload(payload, get_settings().sandbox_payment_secret)
    for _ in range(2):  # the provider retries: still safe
        callback = await client.post(
            "/api/v1/payments/callbacks", headers={"X-CornerRoom-Payment-Signature": signature}, json=payload
        )
        assert callback.status_code == 200, callback.text
        assert callback.json()["status"] == "PAID"

    seen = (await client.get(f"/api/v1/orders/{order['id']}", headers=bearer(buyer))).json()
    assert seen["status"] == "PAID"  # paid, not fulfilled: waiting for staff
    assert seen["payment"]["status"] == "CAPTURED"
    assert seen["hold_status"] == "EXPIRED"
    async with get_session_factory()() as session:
        assert (await session.get(Payment, UUID(order["payment"]["id"]))).status == "CAPTURED"
        tickets = await session.scalar(
            select(func.count()).select_from(Ticket).where(Ticket.ticket_type_id == UUID(ctx["ticket_type"]["id"]), Ticket.status == "ISSUED")
        )
        assert tickets == 0
        flagged = await session.scalar(
            select(func.count()).select_from(AuditLog).where(
                AuditLog.action == "order.fulfillment_failed", AuditLog.entity_id == order["id"]
            )
        )
        assert flagged == 2  # one per attempt, each with a reason code only


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_track_order_items_and_entitlement(client: AsyncClient) -> None:
    token, _org = await _platform_admin(client)
    track = await _released_track(client, token, "Sodium Light")
    offer = await _active_offer(client, token, track["id"], amount=500)
    buyer = await register_and_login(client, "trackfan@example.com")
    order = await client.post(
        "/api/v1/orders",
        headers={**bearer(buyer["access_token"]), "Idempotency-Key": "t1"},
        json={"offer_id": offer["id"], "delivery_address_confirmed": True},
    )
    assert order.status_code == 201, order.text
    body = order.json()
    [item] = body["items"]
    assert item["item_type"] == "TRACK" and item["ref_id"] == track["id"]
    assert item["quantity"] == 1 and item["amount_minor"] == 500
    assert body["hold_expires_at"] is None
    confirmed = await client.post(
        f"/api/v1/payments/{body['payment']['id']}/sandbox-confirm", headers=bearer(buyer["access_token"])
    )
    assert confirmed.json()["status"] == "FULFILLED"
    owned = await client.get("/api/v1/me/entitlements", headers=bearer(buyer["access_token"]))
    assert any(e["ref_id"] == track["id"] and e["status"] == "ACTIVE" for e in owned.json()["items"]), owned.text
    # The buyer's order history shows it once.
    mine = await client.get("/api/v1/me/orders", headers=bearer(buyer["access_token"]))
    assert [o["id"] for o in mine.json()["items"]].count(body["id"]) == 1
