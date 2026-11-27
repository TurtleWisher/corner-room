"""A person's page for staff (owner, 2026-11-27, D-CUSTOMERS-03): from Customers and users, staff
open anyone and see every order with how its payment went, and their whole story on one timeline.
The list says what each person did last and puts the most recent first."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from httpx import AsyncClient

from cornerroom.modules.commerce.application.customer_profile import account_action_shown, sign_in_groups
from cornerroom.modules.commerce.application.customers import order_moment
from tests.auth_helpers import admin_token, bearer, register_and_login
from tests.test_phase05_ticketing import _on_sale_type, _open_ticketing, _platform_admin, _published_event
from tests.test_phase16_bangla_qr import _submit, _ticket_order

T0 = datetime(2026, 11, 27, 10, 0, tzinfo=UTC)


def test_what_happened_last_to_an_order() -> None:
    later = T0 + timedelta(minutes=5)
    decided = T0 + timedelta(hours=1)
    opened = dict(created_at=T0, updated_at=T0, sub_status=None, sub_created_at=None, sub_decided_at=None)
    assert order_moment(order_status="PENDING_PAYMENT", **opened) == ("CHECKOUT_OPENED", T0)
    sent = dict(created_at=T0, updated_at=T0, sub_status="SUBMITTED", sub_created_at=later, sub_decided_at=None)
    assert order_moment(order_status="PENDING_PAYMENT", **sent) == ("PAYMENT_SENT", later)
    confirmed = dict(created_at=T0, updated_at=later, sub_status="CONFIRMED", sub_created_at=later, sub_decided_at=decided)
    assert order_moment(order_status="PAID", **confirmed) == ("PAID", decided)
    rejected = dict(created_at=T0, updated_at=later, sub_status="REJECTED", sub_created_at=later, sub_decided_at=decided)
    assert order_moment(order_status="PENDING_PAYMENT", **rejected) == ("PAYMENT_REJECTED", decided)
    assert order_moment(order_status="CANCELLED", **{**opened, "updated_at": later}) == ("CHECKOUT_EXPIRED", later)
    assert order_moment(order_status="REFUNDED", **{**confirmed, "updated_at": decided}) == ("REFUNDED", decided)


def test_account_actions_already_told_elsewhere_are_left_out() -> None:
    for covered in ("order.placed", "payment.submitted", "follow.created", "auth.refresh", "listening_session.opened"):
        assert not account_action_shown(covered), covered
    for shown in ("auth.login", "auth.login_failed", "auth.password_changed", "delivery_address.saved", "library.liked"):
        assert account_action_shown(shown), shown


def test_sign_ins_group_rotated_sessions() -> None:
    family = uuid4()
    rows = [
        SimpleNamespace(family_id=family, created_at=T0, last_used_at=T0, user_agent="old", status="REVOKED",
                        revoked_at=T0, expires_at=T0 + timedelta(days=30)),
        SimpleNamespace(family_id=family, created_at=T0 + timedelta(hours=2), last_used_at=T0 + timedelta(hours=3),
                        user_agent="Chrome", status="ACTIVE", revoked_at=None, expires_at=T0 + timedelta(days=30)),
        SimpleNamespace(family_id=uuid4(), created_at=T0 - timedelta(days=3), last_used_at=None, user_agent="Safari",
                        status="ACTIVE", revoked_at=None, expires_at=T0 - timedelta(days=1)),
    ]
    groups = sign_in_groups(rows, T0 + timedelta(hours=4))
    assert len(groups) == 2
    assert groups[0] == {"signed_in_at": T0, "last_used_at": T0 + timedelta(hours=3), "device": "Chrome", "active": True}
    assert groups[1]["active"] is False and groups[1]["device"] == "Safari"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_staff_open_a_person_and_see_their_whole_story(client: AsyncClient) -> None:
    staff, _org = await _platform_admin(client)
    event = await _published_event(client, staff, title="Profile Night")
    ticket_type = await _on_sale_type(client, staff, event["id"], quantity=10, price=100)
    await _open_ticketing(client, staff, event["id"])

    fan = await register_and_login(client, "profile-fan@example.com")
    token = fan["access_token"]
    first = await _ticket_order(client, token, ticket_type["id"], "prof-1")
    sent = await _submit(client, token, first["payment"]["id"], "PROF123456", paid_from="01712345678")
    assert sent.status_code == 201, sent.text
    queue = (await client.get("/api/v1/staff/payment-submissions", headers=bearer(staff))).json()
    row = next(r for r in queue if r["order_id"] == first["id"])
    await client.post(f"/api/v1/staff/payment-submissions/{row['id']}/reject", headers=bearer(staff), json={"reason": "Not found"})
    # Opened the payment page again and stopped there.
    await _ticket_order(client, token, ticket_type["id"], "prof-2")

    admin = await admin_token(client)
    listing = (await client.get("/api/v1/staff/customers", headers=bearer(admin))).json()
    # Newest activity first, and each person says what they did last.
    moments = [r["last_activity_at"] for r in listing["items"] if r["last_activity_at"]]
    assert moments == sorted(moments, reverse=True)
    mine = next(r for r in listing["items"] if r["email"] == "profile-fan@example.com")
    assert mine["last_activity"] == "CHECKOUT_OPENED" and mine["last_activity_items"]
    # No picture uploaded: the key is there and empty, so the page draws initials.
    assert "picture_url" in mine and mine["picture_url"] is None

    page = await client.get(f"/api/v1/staff/customers/{fan['user']['id']}", headers=bearer(admin))
    assert page.status_code == 200, page.text
    body = page.json()
    assert body["person"]["email"] == "profile-fan@example.com" and body["person"]["sign_in_methods"] == ["PASSWORD"]
    assert body["person"]["picture_url"] is None and body["person"]["acts"] == []
    assert body["summary"]["rejected"] == 1 and body["summary"]["unfinished"] == 1
    rejected = next(o for o in body["orders"] if o["order_id"] == first["id"])
    assert rejected["status"] == "REJECTED"
    assert rejected["submissions"][0]["transaction_ref"] == "PROF123456"
    assert rejected["submissions"][0]["decision_note"] == "Not found"
    kinds = [m["kind"] for m in body["timeline"]]
    assert kinds[0] == "CHECKOUT_OPENED"
    assert {"SIGNED_UP", "PAYMENT_SENT", "PAYMENT_REJECTED"} <= set(kinds)
    assert body["sign_ins"] and body["sign_ins"][0]["active"] is True

    # Who looked is recorded; people without access get 404; nonsense keys are 404 or 422.
    audit = (
        await client.get("/api/v1/audit", headers=bearer(admin), params={"entity_type": "User", "entity_id": fan["user"]["id"]})
    ).json()
    assert any(r["action"] == "customer.viewed" for r in audit["items"])
    assert (await client.get(f"/api/v1/staff/customers/{fan['user']['id']}", headers=bearer(token))).status_code == 404
    assert (await client.get(f"/api/v1/staff/customers/{uuid4()}", headers=bearer(admin))).status_code == 404
    assert (await client.get("/api/v1/staff/customers/not-a-key", headers=bearer(admin))).status_code == 422
