"""Customers and users (owner, 2026-10-28, D-CUSTOMERS-02): everyone who tried to pay is findable,
not only confirmed sales, with the transaction ID and paid-from number they typed; accounts without a
personal name show the artist they manage; each account has its types."""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker

from cornerroom.infra.db import get_engine
from cornerroom.modules.commerce.application.customers import overall_status, payment_status
from cornerroom.worker import expire_ticket_holds
from tests.auth_helpers import admin_token, bearer, register_and_login
from tests.test_audio_phase4_studio import _artist_for
from tests.test_phase05_ticketing import _on_sale_type, _open_ticketing, _platform_admin, _published_event
from tests.test_phase16_bangla_qr import _expire, _submit, _ticket_order


def test_payment_status_per_order_and_overall() -> None:
    assert payment_status("PAID", "CONFIRMED") == "PAID"
    assert payment_status("FULFILLED", None) == "PAID"
    assert payment_status("PARTIALLY_REFUNDED", "CONFIRMED") == "REFUNDED"
    assert payment_status("PENDING_PAYMENT", "SUBMITTED") == "WAITING"
    assert payment_status("PENDING_PAYMENT", "REJECTED") == "REJECTED"
    assert payment_status("CANCELLED", "REJECTED") == "REJECTED"
    assert payment_status("CANCELLED", None) == "EXPIRED"
    assert payment_status("PENDING_PAYMENT", None) == "NOT_SENT"
    assert overall_status(["EXPIRED", "PAID", "WAITING"]) == "PAID"
    assert overall_status(["EXPIRED", "WAITING"]) == "WAITING"
    assert overall_status([]) is None


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_everyone_who_tried_to_pay_is_listed_and_findable(client: AsyncClient) -> None:
    staff, _org = await _platform_admin(client)
    event = await _published_event(client, staff, title="Payments Night")
    ticket_type = await _on_sale_type(client, staff, event["id"], quantity=10, price=100)
    await _open_ticketing(client, staff, event["id"])
    factory = async_sessionmaker(get_engine(), expire_on_commit=False)

    # Sent a gift word instead of a transaction ID; nobody has checked it yet.
    gift = (await register_and_login(client, "pay-gift@example.com"))["access_token"]
    gift_order = await _ticket_order(client, gift, ticket_type["id"], "pay-1")
    sent = await _submit(client, gift, gift_order["payment"]["id"], "AUTULGIFT2026", paid_from="01990428674", paid_with="OTHER")
    assert sent.status_code == 201, sent.text
    # Sent a payment that staff rejected.
    rejected = (await register_and_login(client, "pay-rejected@example.com"))["access_token"]
    rejected_order = await _ticket_order(client, rejected, ticket_type["id"], "pay-2")
    await _submit(client, rejected, rejected_order["payment"]["id"], "9Z9Y9X9W9V")
    queue = (await client.get("/api/v1/staff/payment-submissions", headers=bearer(staff))).json()
    row = next(r for r in queue if r["order_id"] == rejected_order["id"])
    await client.post(f"/api/v1/staff/payment-submissions/{row['id']}/reject", headers=bearer(staff), json={"reason": "Not on the statement"})
    # Started checkout, never sent a payment, and the order expired.
    expired = (await register_and_login(client, "pay-expired@example.com"))["access_token"]
    expired_order = await _ticket_order(client, expired, ticket_type["id"], "pay-3")
    await _expire(factory, expired_order["hold_id"])
    await expire_ticket_holds({})

    # Confirmed and rejected decisions stay visible in their own queues.
    assert any(r["order_id"] == rejected_order["id"] for r in (
        await client.get("/api/v1/staff/payment-submissions", headers=bearer(staff), params={"status": "REJECTED"})
    ).json())

    admin = await admin_token(client)
    scoped = (
        await client.get("/api/v1/staff/customers", headers=bearer(admin), params={"scope": "event", "scope_id": event["id"]})
    ).json()
    by_email = {r["email"]: r for r in scoped["items"]}
    assert by_email["pay-gift@example.com"]["payment_status"] == "WAITING"
    payment = by_email["pay-gift@example.com"]["payments"][0]
    assert payment["transaction_ref"] == "AUTULGIFT2026" and payment["paid_with"] == "OTHER"
    assert payment["paid_from"].endswith("1990428674") and payment["amount_minor"] == 100
    assert by_email["pay-rejected@example.com"]["payment_status"] == "REJECTED"
    assert by_email["pay-rejected@example.com"]["payments"][0]["decision_note"] == "Not on the statement"
    assert by_email["pay-expired@example.com"]["payment_status"] == "EXPIRED"
    assert by_email["pay-gift@example.com"]["account_types"] == ["fan"]

    # Findable by what they typed: the code and the number they paid from.
    for needle in ("autulgift", "01990428674"):
        found = (await client.get("/api/v1/staff/customers", headers=bearer(admin), params={"q": needle})).json()
        assert [r["email"] for r in found["items"]] == ["pay-gift@example.com"], needle

    # An account with no personal name shows the artist it manages, and is typed artist; staff are staff.
    orgs = (await client.get("/api/v1/organizations", headers=bearer(admin))).json()["items"]
    label = next(o["id"] for o in orgs if o["type"] == "LABEL")
    owner = await register_and_login(client, "pay-artist@example.com", delivery_address=False)
    await _artist_for(owner["user"]["id"], label, name="Sakib Sound")
    everyone = {r["email"]: r for r in (await client.get("/api/v1/staff/customers", headers=bearer(admin))).json()["items"]}
    artist_row = everyone["pay-artist@example.com"]
    # Its own profile name stays first; the artist it manages is listed (and named when it has none).
    assert artist_row["manages"] == ["Sakib Sound"] and artist_row["name"] in ("Fan", "Sakib Sound")
    assert artist_row["account_types"] == ["artist"] and artist_row["payment_status"] is None
    found = (await client.get("/api/v1/staff/customers", headers=bearer(admin), params={"q": "sakib sound"})).json()
    assert [r["email"] for r in found["items"]] == ["pay-artist@example.com"]
    assert any("staff" in r["account_types"] for r in everyone.values())
