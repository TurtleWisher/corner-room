"""Bangla QR with staff verification (owner, 2026-10-18: Q-PAY-01 "both, staff first", Q-PAY-05).

The buyer pays by QR in their app and sends the transaction ID, the number paid from and the app.
Finance staff in the order's label confirm (captured through the normal pipeline, tickets issued)
or reject with a reason (the buyer may fix and resend; the seats stay held for the normal hold time
from the rejection). While staff check, the hold timer does not run. A live transaction ID can't be
sent for two payments. Money paid back by hand is completed with a transfer reference.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker

from cornerroom.infra.db import get_engine
from cornerroom.infra.settings import Settings
from cornerroom.modules.finance.application.service import _provider_for
from cornerroom.modules.finance.domain.models import Payment
from cornerroom.modules.notifications.domain.models import Notification
from cornerroom.modules.ticketing.domain.models import RefundPolicy, TicketHold
from cornerroom.worker import drain_outbox, expire_ticket_holds
from tests.auth_helpers import admin_token, bearer, register_and_login
from tests.test_phase05_ticketing import _on_sale_type, _open_ticketing, _platform_admin, _published_event, _workspace


def test_phase16_bangla_qr_provider_is_staff_verified_only() -> None:
    provider = _provider_for(Settings(payment_provider="bangla_qr"))
    assert provider.name == "bangla_qr"
    from uuid import uuid4

    intent = provider.create_intent(payment_id=uuid4(), amount_minor=100, currency_code="BDT")
    assert intent.next_status == "REQUIRES_ACTION"
    with pytest.raises(Exception) as caught:
        provider.parse_callback({}, signature="x", secret="y")
    assert getattr(caught.value, "code", "") == "PAYMENT_CALLBACK_UNSUPPORTED"
    assert _provider_for(Settings()).name == "sandbox"
    with pytest.raises(ValueError):
        Settings(payment_provider="paypal")


async def _ticket_order(client: AsyncClient, buyer: str, ticket_type_id: str, key: str, quantity: int = 1) -> dict:
    hold = await client.post("/api/v1/ticket-holds", headers=bearer(buyer), json={"ticket_type_id": ticket_type_id, "quantity": quantity})
    assert hold.status_code == 201, hold.text
    order = await client.post(
        "/api/v1/orders",
        headers={**bearer(buyer), "Idempotency-Key": key},
        json={"hold_id": hold.json()["id"], "delivery_address_confirmed": True},
    )
    assert order.status_code == 201, order.text
    return order.json() | {"hold_id": hold.json()["id"]}


async def _submit(client: AsyncClient, buyer: str, payment_id: str, ref: str, paid_from: str = "01712 345678", paid_with: str = "BKASH"):
    return await client.post(
        f"/api/v1/payments/{payment_id}/submissions",
        headers=bearer(buyer),
        json={"transaction_ref": ref, "paid_from": paid_from, "paid_with": paid_with},
    )


async def _expire(factory, hold_id: str) -> None:
    async with factory() as session:
        await session.execute(update(TicketHold).where(TicketHold.id == hold_id).values(expires_at=TicketHold.expires_at - timedelta(days=1)))
        await session.commit()


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase16_submit_check_reject_resend_confirm(client: AsyncClient) -> None:
    staff, _org = await _platform_admin(client)
    event = await _published_event(client, staff, title="QR Night")
    ticket_type = await _on_sale_type(client, staff, event["id"], quantity=5, price=100)
    await _open_ticketing(client, staff, event["id"])
    buyer = (await register_and_login(client, "qr-buyer@example.com"))["access_token"]
    factory = async_sessionmaker(get_engine(), expire_on_commit=False)
    order = await _ticket_order(client, buyer, ticket_type["id"], "qr-1", quantity=2)
    payment_id = order["payment"]["id"]

    bad = await _submit(client, buyer, payment_id, "x")
    assert bad.status_code == 422 and bad.json()["field"] == "transaction_ref"
    bad = await _submit(client, buyer, payment_id, "8N7A6B5C4D", paid_with="PAYPAL")
    assert bad.status_code == 422 and bad.json()["field"] == "paid_with"

    sent = await _submit(client, buyer, payment_id, "8n7a 6b5c4d")
    assert sent.status_code == 201, sent.text
    assert sent.json()["payment_submission"]["status"] == "SUBMITTED"
    assert sent.json()["payment_submission"]["transaction_ref"] == "8N7A6B5C4D"
    again = await _submit(client, buyer, payment_id, "8N7A6B5C4E")
    assert again.status_code == 409 and again.json()["code"] == "PAYMENT_SUBMISSION_PENDING"
    assert (await client.post(f"/api/v1/ticket-holds/{order['hold_id']}/release", headers=bearer(buyer))).json()["code"] == "HOLD_VERIFICATION_PENDING"

    # Q-PAY-05: the hold timer does not run while staff check.
    await _expire(factory, order["hold_id"])
    await expire_ticket_holds({})
    held = (await client.get(f"/api/v1/orders/{order['id']}", headers=bearer(buyer))).json()
    assert held["status"] == "PENDING_PAYMENT" and held["hold_status"] == "ACTIVE"

    # Finance sees it with the full number; the buyer's email is masked.
    queue = (await client.get("/api/v1/staff/payment-submissions", headers=bearer(staff))).json()
    row = next(r for r in queue if r["order_id"] == order["id"])
    assert row["paid_from"] == "+8801712345678" and row["paid_with"] == "BKASH" and row["amount_minor"] == 200
    assert row["buyer_email"] != "qr-buyer@example.com"

    no_reason = await client.post(f"/api/v1/staff/payment-submissions/{row['id']}/reject", headers=bearer(staff), json={"reason": "  "})
    assert no_reason.status_code == 422
    rejected = await client.post(
        f"/api/v1/staff/payment-submissions/{row['id']}/reject", headers=bearer(staff), json={"reason": "Transaction ID not found on the statement"}
    )
    assert rejected.status_code == 200, rejected.text
    seen = (await client.get(f"/api/v1/orders/{order['id']}", headers=bearer(buyer))).json()
    assert seen["payment_submission"]["status"] == "REJECTED"
    assert seen["payment_submission"]["decision_note"] == "Transaction ID not found on the statement"
    async with factory() as session:
        hold = await session.get(TicketHold, order["hold_id"])
    assert hold.verification_pending is False and hold.status == "ACTIVE"
    while await drain_outbox({}):
        pass
    async with factory() as session:
        notice = (await session.execute(select(Notification).where(Notification.type == "payment.rejected"))).scalars().one()
    assert "Transaction ID not found on the statement" in notice.body

    # Another buyer can't send a transaction ID that is already live on someone's payment.
    other = (await register_and_login(client, "qr-other@example.com"))["access_token"]
    other_order = await _ticket_order(client, other, ticket_type["id"], "qr-2")
    assert (await _submit(client, buyer, payment_id, "8N7A6B5C4E")).status_code == 201  # the fixed resend
    reused = await _submit(client, other, other_order["payment"]["id"], "8n7a6b5c4e")
    assert reused.status_code == 409 and reused.json()["code"] == "TRANSACTION_ALREADY_USED"

    # Another label's finance staff neither see nor confirm it.
    admin = await admin_token(client)
    label = next(r for r in (await client.get("/api/v1/organizations", headers=bearer(admin))).json()["items"] if r["type"] == "LABEL")
    finance = next(r for r in (await client.get("/api/v1/roles", headers=bearer(admin))).json() if r["key"] == "finance_manager")
    outsider = await register_and_login(client, "qr-outsider@example.com")
    joined = await client.post(
        f"/api/v1/organizations/{label['id']}/memberships",
        headers=bearer(admin),
        json={"user_id": outsider["user"]["id"], "status": "ACTIVE", "role_id": finance["id"]},
    )
    assert joined.status_code == 201, joined.text
    outsider_token = await _workspace(client, outsider["access_token"], label["id"])
    resent = next(r for r in (await client.get("/api/v1/staff/payment-submissions", headers=bearer(staff))).json() if r["order_id"] == order["id"])
    assert all(r["order_id"] != order["id"] for r in (await client.get("/api/v1/staff/payment-submissions", headers=bearer(outsider_token))).json())
    assert (await client.post(f"/api/v1/staff/payment-submissions/{resent['id']}/confirm", headers=bearer(outsider_token))).status_code == 404

    confirmed = await client.post(f"/api/v1/staff/payment-submissions/{resent['id']}/confirm", headers=bearer(staff))
    assert confirmed.status_code == 200 and confirmed.json()["status"] == "CONFIRMED"
    done = (await client.get(f"/api/v1/orders/{order['id']}", headers=bearer(buyer))).json()
    assert done["status"] == "FULFILLED" and done["payment"]["status"] == "CAPTURED"
    tickets = (await client.get("/api/v1/me/tickets", headers=bearer(buyer))).json()["items"]
    assert len([t for t in tickets if t["status"] == "ISSUED"]) == 2
    twice = await client.post(f"/api/v1/staff/payment-submissions/{resent['id']}/confirm", headers=bearer(staff))
    assert twice.status_code == 409


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase16_rejected_and_not_resent_is_cancelled(client: AsyncClient) -> None:
    staff, _org = await _platform_admin(client)
    event = await _published_event(client, staff, title="QR Quiet")
    ticket_type = await _on_sale_type(client, staff, event["id"], quantity=2, price=100)
    await _open_ticketing(client, staff, event["id"])
    buyer = (await register_and_login(client, "qr-quiet@example.com"))["access_token"]
    factory = async_sessionmaker(get_engine(), expire_on_commit=False)
    order = await _ticket_order(client, buyer, ticket_type["id"], "qr-quiet")
    assert (await _submit(client, buyer, order["payment"]["id"], "QUIET12345", paid_with="NAGAD")).status_code == 201
    sub = next(r for r in (await client.get("/api/v1/staff/payment-submissions", headers=bearer(staff))).json() if r["order_id"] == order["id"])
    assert (await client.post(f"/api/v1/staff/payment-submissions/{sub['id']}/reject", headers=bearer(staff), json={"reason": "Amount differs"})).status_code == 200
    # The buyer does not resend within the hold time.
    await _expire(factory, order["hold_id"])
    await expire_ticket_holds({})
    assert (await client.get(f"/api/v1/orders/{order['id']}", headers=bearer(buyer))).json()["status"] == "CANCELLED"
    late = await _submit(client, buyer, order["payment"]["id"], "QUIET12346")
    assert late.status_code == 409 and late.json()["code"] == "ORDER_CANCELLED"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase16_manual_refund_completion(client: AsyncClient) -> None:
    staff, _org = await _platform_admin(client)
    event = await _published_event(client, staff, title="QR Refund")
    ticket_type = await _on_sale_type(client, staff, event["id"], quantity=2, price=100)
    await _open_ticketing(client, staff, event["id"])
    buyer = (await register_and_login(client, "qr-refund@example.com"))["access_token"]
    factory = async_sessionmaker(get_engine(), expire_on_commit=False)
    order = await _ticket_order(client, buyer, ticket_type["id"], "qr-refund")
    assert (await _submit(client, buyer, order["payment"]["id"], "REFUND9876")).status_code == 201
    sub = next(r for r in (await client.get("/api/v1/staff/payment-submissions", headers=bearer(staff))).json() if r["order_id"] == order["id"])
    assert (await client.post(f"/api/v1/staff/payment-submissions/{sub['id']}/confirm", headers=bearer(staff))).status_code == 200
    async with factory() as session:
        session.add(RefundPolicy(scope_type="PLATFORM", reason_code="QR_TEST", requires_finance_approve=True))
        await session.commit()
    ticket_id = (await client.get("/api/v1/me/tickets", headers=bearer(buyer))).json()["items"][0]["id"]
    refund = (
        await client.post(
            "/api/v1/refunds",
            headers={**bearer(staff), "Idempotency-Key": "qr-r"},
            json={"order_id": order["id"], "ticket_ids": [ticket_id], "reason_code": "QR_TEST"},
        )
    ).json()
    assert (await client.post(f"/api/v1/refunds/{refund['id']}/approve", headers=bearer(staff))).status_code == 200
    # A test (sandbox) payment is completed with the test button, not by hand.
    sandbox = await client.post(f"/api/v1/refunds/{refund['id']}/complete-manual", headers=bearer(staff), json={"payout_reference": "BK-REF-1"})
    assert sandbox.status_code == 409
    async with factory() as session:
        await session.execute(update(Payment).where(Payment.id == order["payment"]["id"]).values(provider="bangla_qr"))
        await session.commit()
    short = await client.post(f"/api/v1/refunds/{refund['id']}/complete-manual", headers=bearer(staff), json={"payout_reference": "x"})
    assert short.status_code == 422
    done = await client.post(f"/api/v1/refunds/{refund['id']}/complete-manual", headers=bearer(staff), json={"payout_reference": "BK-REF-1"})
    assert done.status_code == 200 and done.json()["status"] == "COMPLETED"
    mine = (await client.get("/api/v1/me/tickets", headers=bearer(buyer))).json()["items"]
    assert mine[0]["status"] == "REFUNDED"
    async with factory() as session:
        count = await session.scalar(select(func.count()).select_from(Payment).where(Payment.provider == "bangla_qr"))
    assert count == 1
