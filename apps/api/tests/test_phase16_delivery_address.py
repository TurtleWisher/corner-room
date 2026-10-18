"""D-ADDR-01 (owner, 2026-10-18): a Bangladesh delivery address before every payment.

Required: recipient name, Bangladesh mobile, division, district, upazila/thana, area, house/road;
optional postcode and landmark. Saved to the account, confirmed for each order and copied onto
it, so a later change does not rewrite past orders. Personal data: owner-only, never audited in full.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from cornerroom.infra.db import get_engine
from cornerroom.modules.audit.domain.models import AuditLog
from tests.auth_helpers import TEST_ADDRESS, bearer, register_and_login
from tests.test_phase05_ticketing import _on_sale_type, _open_ticketing, _platform_admin, _published_event


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase16_delivery_address_rules(client: AsyncClient) -> None:
    options = (await client.get("/api/v1/address-options")).json()
    assert len(options["divisions"]) == 8
    assert sum(len(d["districts"]) for d in options["divisions"]) == 64

    token = (await register_and_login(client, "address-owner@example.com", delivery_address=False))["access_token"]
    assert (await client.get("/api/v1/me/delivery-address", headers=bearer(token))).status_code == 404

    async def put(**over):
        return await client.put("/api/v1/me/delivery-address", headers=bearer(token), json=TEST_ADDRESS | over)

    for over, field in (
        ({"phone": "12345"}, "phone"),
        ({"phone": "01212345678"}, "phone"),  # 012 is not a Bangladesh mobile prefix
        ({"district": "Sylhet"}, "district"),  # Sylhet district is not in Dhaka division
        ({"division": "Atlantis"}, "division"),
        ({"postcode": "120"}, "postcode"),
        ({"upazila": "  "}, "upazila"),
    ):
        bad = await put(**over)
        assert bad.status_code == 422, (over, bad.text)
        assert bad.json()["field"] == field
        assert bad.json()["detail"] != field  # a sentence for people, not the field name

    saved = await put(phone="+880 1812-345678", postcode="1209", landmark="Opposite the lake")
    assert saved.status_code == 200, saved.text
    assert saved.json()["phone"] == "+8801812345678"
    assert (await client.get("/api/v1/me/delivery-address", headers=bearer(token))).json()["postcode"] == "1209"

    # The audit row says it was saved, never what the address is.
    factory = async_sessionmaker(get_engine(), expire_on_commit=False)
    async with factory() as session:
        rows = (await session.execute(select(AuditLog).where(AuditLog.action == "delivery_address.saved"))).scalars().all()
    assert rows and all("phone" not in str(r.new_state) and "Dhanmondi" not in str(r.new_state) for r in rows)


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase16_no_payment_without_a_confirmed_address(client: AsyncClient) -> None:
    staff, _org = await _platform_admin(client)
    event = await _published_event(client, staff, title="Address Night")
    ticket_type = await _on_sale_type(client, staff, event["id"], quantity=5, price=100)
    await _open_ticketing(client, staff, event["id"])
    buyer = (await register_and_login(client, "address-buyer@example.com", delivery_address=False))["access_token"]

    async def order(key: str, confirmed: bool):
        hold = await client.post("/api/v1/ticket-holds", headers=bearer(buyer), json={"ticket_type_id": ticket_type["id"], "quantity": 1})
        assert hold.status_code == 201, hold.text
        return await client.post(
            "/api/v1/orders",
            headers={**bearer(buyer), "Idempotency-Key": key},
            json={"hold_id": hold.json()["id"], "delivery_address_confirmed": confirmed},
        )

    missing = await order("addr-1", True)
    assert missing.status_code == 409 and missing.json()["code"] == "DELIVERY_ADDRESS_REQUIRED"

    first = TEST_ADDRESS | {"area": "Kalabagan"}
    assert (await client.put("/api/v1/me/delivery-address", headers=bearer(buyer), json=first)).status_code == 200
    unconfirmed = await order("addr-2", False)
    assert unconfirmed.status_code == 422 and unconfirmed.json()["code"] == "DELIVERY_ADDRESS_CONFIRMATION_REQUIRED"

    placed = await order("addr-3", True)
    assert placed.status_code == 201, placed.text
    assert placed.json()["delivery_address"]["area"] == "Kalabagan"
    assert placed.json()["delivery_address"]["phone"] == "+8801712345678"

    # Changing the saved address later does not rewrite the order's copy.
    moved = TEST_ADDRESS | {"division": "Chattogram", "district": "Cox's Bazar", "upazila": "Ukhia", "area": "Inani"}
    assert (await client.put("/api/v1/me/delivery-address", headers=bearer(buyer), json=moved)).status_code == 200
    again = (await client.get(f"/api/v1/orders/{placed.json()['id']}", headers=bearer(buyer))).json()
    assert again["delivery_address"]["area"] == "Kalabagan" and again["delivery_address"]["district"] == "Dhaka"

    # Subscriptions follow the same rule.
    other = (await register_and_login(client, "address-sub@example.com", delivery_address=False))["access_token"]
    plans = (await client.get("/api/v1/subscription-plans")).json()
    if plans.get("items"):
        refused = await client.post(
            "/api/v1/subscriptions",
            headers={**bearer(other), "Idempotency-Key": "addr-sub"},
            json={"plan_id": plans["items"][0]["id"], "delivery_address_confirmed": True},
        )
        assert refused.status_code == 409 and refused.json()["code"] == "DELIVERY_ADDRESS_REQUIRED"
