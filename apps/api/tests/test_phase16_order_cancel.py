"""Q-COM-03 (owner, 2026-10-18): an unpaid ticket order is cancelled when its hold runs out.

FAILURE_MODEL: "Order PENDING_PAYMENT / cancelled per TTL; hold released". Amends Q-PAY-02: a
payment captured after cancellation is kept and flagged for staff, the order stays CANCELLED,
the customer cannot confirm a cancelled order, and staff can refund the late payment.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker

from cornerroom.infra.db import get_engine
from cornerroom.infra.outbox import OutboxEvent
from cornerroom.modules.audit.domain.models import AuditLog
from cornerroom.modules.finance.application.sandbox import sign_sandbox_payload
from cornerroom.modules.notifications.domain.models import Notification
from cornerroom.modules.ticketing.domain.models import RefundPolicy, TicketHold
from cornerroom.worker import drain_outbox, expire_ticket_holds
from tests.auth_helpers import bearer, register_and_login
from tests.test_phase05_ticketing import _on_sale_type, _open_ticketing, _platform_admin, _published_event


async def _order(client: AsyncClient, buyer: str, ticket_type_id: str, key: str) -> dict:
    hold = await client.post("/api/v1/ticket-holds", headers=bearer(buyer), json={"ticket_type_id": ticket_type_id, "quantity": 1})
    assert hold.status_code == 201, hold.text
    order = await client.post("/api/v1/orders", headers={**bearer(buyer), "Idempotency-Key": key}, json={"hold_id": hold.json()["id"], "delivery_address_confirmed": True})
    assert order.status_code == 201, order.text
    return order.json() | {"hold_id": hold.json()["id"]}


async def _count(factory, stmt) -> int:
    async with factory() as session:
        return int(await session.scalar(stmt) or 0)


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase16_unpaid_ticket_order_is_cancelled_and_late_payment_is_kept(client: AsyncClient, settings) -> None:
    staff, _org = await _platform_admin(client)
    event = await _published_event(client, staff, title="Cancel Night")
    ticket_type = await _on_sale_type(client, staff, event["id"], quantity=5, price=100)
    await _open_ticketing(client, staff, event["id"])
    buyer = (await register_and_login(client, "cancel-buyer@example.com"))["access_token"]
    factory = async_sessionmaker(get_engine(), expire_on_commit=False)

    order = await _order(client, buyer, ticket_type["id"], "cancel-1")
    # Still payable while the hold is live: the job leaves it alone.
    await expire_ticket_holds({})
    assert (await client.get(f"/api/v1/orders/{order['id']}", headers=bearer(buyer))).json()["status"] == "PENDING_PAYMENT"

    async with factory() as session:
        await session.execute(
            update(TicketHold).where(TicketHold.id == order["hold_id"]).values(expires_at=TicketHold.expires_at - timedelta(days=1))
        )
        await session.commit()
    await expire_ticket_holds({})
    await expire_ticket_holds({})  # idempotent
    after = (await client.get(f"/api/v1/orders/{order['id']}", headers=bearer(buyer))).json()
    assert after["status"] == "CANCELLED"
    assert after["hold_status"] == "EXPIRED"
    assert await _count(factory, select(func.count()).select_from(OutboxEvent).where(OutboxEvent.event_type == "OrderCancelled")) == 1
    assert await _count(
        factory, select(func.count()).select_from(AuditLog).where(AuditLog.action == "order.cancelled", AuditLog.entity_id == order["id"])
    ) == 1
    # FAILURE_MODEL: the buyer is told.
    while await drain_outbox({}):
        pass
    assert await _count(factory, select(func.count()).select_from(Notification).where(Notification.type == "order.cancelled")) == 1

    # The customer cannot pay for it any more.
    refused = await client.post(f"/api/v1/payments/{order['payment']['id']}/sandbox-confirm", headers=bearer(buyer))
    assert refused.status_code == 409, refused.text
    assert refused.json()["code"] == "ORDER_CANCELLED"

    # A payment the provider still captures is kept and flagged once; the order stays cancelled.
    payload = {
        "payment_id": order["payment"]["id"],
        "amount_minor": order["payment"]["amount_minor"],
        "currency_code": order["payment"]["currency_code"],
        "provider_event_id": "evt-late-1",
        "status": "CAPTURED",
    }
    signature = sign_sandbox_payload(payload, settings.sandbox_payment_secret or settings.jwt_secret)
    for _ in range(2):
        late = await client.post("/api/v1/payments/callbacks", headers={"X-CornerRoom-Payment-Signature": signature}, json=payload)
        assert late.status_code == 200, late.text
    seen = (await client.get(f"/api/v1/orders/{order['id']}", headers=bearer(buyer))).json()
    assert seen["status"] == "CANCELLED"
    assert seen["payment"]["status"] == "CAPTURED"
    assert seen["refunded_amount_minor"] == 0
    assert await _count(
        factory,
        select(func.count()).select_from(AuditLog).where(AuditLog.action == "order.fulfillment_failed", AuditLog.entity_id == order["id"]),
    ) == 1
    mine = (await client.get("/api/v1/me/tickets", headers=bearer(buyer))).json()["items"]
    assert not [t for t in mine if t["status"] in {"ISSUED", "CHECKED_IN"}]

    # Staff refund the late payment without tripping over the order status.
    async with factory() as session:
        session.add(RefundPolicy(scope_type="PLATFORM", reason_code="LATE_PAYMENT", requires_finance_approve=True))
        await session.commit()
    # Staff refund what is left; the server works out the amount.
    requested = await client.post(
        "/api/v1/refunds",
        headers={**bearer(staff), "Idempotency-Key": "late-refund"},
        json={"order_id": order["id"], "refund_remaining": True, "reason_code": "LATE_PAYMENT"},
    )
    assert requested.status_code == 201, requested.text
    assert requested.json()["amount_minor"] == order["payment"]["amount_minor"]
    assert (await client.post(f"/api/v1/refunds/{requested.json()['id']}/approve", headers=bearer(staff))).status_code == 200
    done = await client.post(f"/api/v1/refunds/{requested.json()['id']}/sandbox-complete", headers=bearer(staff))
    assert done.status_code == 200, done.text
    final = (await client.get(f"/api/v1/orders/{order['id']}", headers=bearer(buyer))).json()
    assert final["status"] == "CANCELLED"
    assert final["refunded_amount_minor"] == order["payment"]["amount_minor"]


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase16_released_hold_cancels_its_order(client: AsyncClient) -> None:
    staff, _org = await _platform_admin(client)
    event = await _published_event(client, staff, title="Release Night")
    ticket_type = await _on_sale_type(client, staff, event["id"], quantity=5, price=100)
    await _open_ticketing(client, staff, event["id"])
    buyer = (await register_and_login(client, "release-buyer@example.com"))["access_token"]
    order = await _order(client, buyer, ticket_type["id"], "release-1")
    released = await client.post(f"/api/v1/ticket-holds/{order['hold_id']}/release", headers=bearer(buyer))
    assert released.status_code == 200, released.text
    await expire_ticket_holds({})
    assert (await client.get(f"/api/v1/orders/{order['id']}", headers=bearer(buyer))).json()["status"] == "CANCELLED"
