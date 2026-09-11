"""Phase 05 ticketing. PostgreSQL tests skip honestly when the database is unavailable."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from cornerroom.infra.db import get_engine
from cornerroom.infra.outbox import OutboxEvent
from cornerroom.kernel.events import TICKETING_OPENED
from cornerroom.modules.finance.application.sandbox import sign_sandbox_payload
from tests.auth_helpers import admin_token, bearer, register_and_login

FUTURE_START = datetime(2026, 12, 1, 18, 0, tzinfo=timezone.utc)
FUTURE_END = datetime(2026, 12, 1, 21, 0, tzinfo=timezone.utc)


async def _workspace(client: AsyncClient, token: str, org_id: str) -> str:
    switched = await client.post(f"/api/v1/organizations/{org_id}/switch", headers=bearer(token))
    assert switched.status_code == 200, switched.text
    return switched.json()["access_token"]


async def _platform_admin(client: AsyncClient) -> tuple[str, str]:
    admin = await admin_token(client)
    orgs = (await client.get("/api/v1/organizations", headers=bearer(admin))).json()["items"]
    platform = next(row for row in orgs if row["type"] == "PLATFORM")
    token = await _workspace(client, admin, platform["id"])
    return token, platform["id"]


async def _published_event(client: AsyncClient, token: str, title: str = "Gate Show") -> dict:
    created = await client.post(
        "/api/v1/events",
        headers=bearer(token),
        json={
            "title": title,
            "timezone": "UTC",
            "description": "Public copy",
            "starts_at": FUTURE_START.isoformat(),
            "ends_at": FUTURE_END.isoformat(),
        },
    )
    assert created.status_code == 201, created.text
    event_id = created.json()["id"]
    planned = await client.post(
        f"/api/v1/events/{event_id}/lifecycle",
        headers=bearer(token),
        json={"action": "plan"},
    )
    assert planned.status_code == 200, planned.text
    published = await client.post(
        f"/api/v1/events/{event_id}/lifecycle",
        headers=bearer(token),
        json={"action": "publish"},
    )
    assert published.status_code == 200, published.text
    return published.json()


async def _on_sale_type(
    client: AsyncClient,
    token: str,
    event_id: str,
    *,
    quantity: int = 10,
    price: int = 1500,
    currency: str = "USD",
    name: str = "General",
) -> dict:
    created = await client.post(
        "/api/v1/ticket-types",
        headers=bearer(token),
        json={
            "event_id": event_id,
            "name": name,
            "price_amount_minor": price,
            "currency_code": currency,
            "quantity_total": quantity,
        },
    )
    assert created.status_code == 201, created.text
    row = created.json()
    opened = await client.post(
        f"/api/v1/ticket-types/{row['id']}/lifecycle",
        headers=bearer(token),
        json={"action": "on_sale", "version": row["version"]},
    )
    assert opened.status_code == 200, opened.text
    return opened.json()


async def _open_ticketing(client: AsyncClient, token: str, event_id: str) -> dict:
    opened = await client.post(
        f"/api/v1/events/{event_id}/lifecycle",
        headers=bearer(token),
        json={"action": "open_ticketing"},
    )
    assert opened.status_code == 200, opened.text
    assert opened.json()["status"] == "TICKETING_OPEN"
    return opened.json()


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_ticket_type_lifecycle_and_open_ticketing(client: AsyncClient) -> None:
    token, _org = await _platform_admin(client)
    event = await _published_event(client, token)
    still_blocked = await client.post(
        f"/api/v1/events/{event['id']}/lifecycle",
        headers=bearer(token),
        json={"action": "open_ticketing"},
    )
    assert still_blocked.status_code == 409
    assert still_blocked.json()["code"] == "TICKETING_REQUIRED"

    ticket_type = await _on_sale_type(client, token, event["id"], quantity=5, price=2000)
    assert ticket_type["remaining"] == 5
    assert ticket_type["currency_code"] == "USD"
    opened = await _open_ticketing(client, token, event["id"])
    assert opened["status"] == "TICKETING_OPEN"

    guest_types = await client.get(f"/api/v1/events/{event['id']}/ticket-types")
    assert guest_types.status_code == 200
    assert any(row["id"] == ticket_type["id"] for row in guest_types.json()["items"])

    closed = await client.post(
        f"/api/v1/events/{event['id']}/lifecycle",
        headers=bearer(token),
        json={"action": "close_sales"},
    )
    assert closed.status_code == 200
    assert closed.json()["status"] == "SALES_CLOSED"

    buyer = await register_and_login(client, "buyer-closed@example.com")
    hold = await client.post(
        "/api/v1/ticket-holds",
        headers=bearer(buyer["access_token"]),
        json={"ticket_type_id": ticket_type["id"], "quantity": 1},
    )
    assert hold.status_code == 409
    assert hold.json()["code"] == "SALES_CLOSED"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_checkout_issues_tickets_without_fake_success_flag(
    client: AsyncClient,
) -> None:
    token, _org = await _platform_admin(client)
    event = await _published_event(client, token, title="Paid Night")
    ticket_type = await _on_sale_type(client, token, event["id"], quantity=3, price=2500)
    await _open_ticketing(client, token, event["id"])

    buyer = await register_and_login(client, "buyer-ok@example.com")
    hold = await client.post(
        "/api/v1/ticket-holds",
        headers=bearer(buyer["access_token"]),
        json={"ticket_type_id": ticket_type["id"], "quantity": 2},
    )
    assert hold.status_code == 201, hold.text
    assert hold.json()["status"] == "ACTIVE"

    remaining = await client.get(
        f"/api/v1/ticket-types/{ticket_type['id']}",
        headers=bearer(token),
    )
    assert remaining.json()["remaining"] == 1

    order = await client.post(
        "/api/v1/orders",
        headers={**bearer(buyer["access_token"]), "Idempotency-Key": "checkout-1"},
        json={"hold_id": hold.json()["id"]},
    )
    assert order.status_code == 201, order.text
    body = order.json()
    assert body["status"] == "PENDING_PAYMENT"
    assert body["payment"]["status"] == "REQUIRES_ACTION"
    assert body["payment"]["amount_minor"] == 5000
    assert "payment_success" not in body

    tickets_before = await client.get("/api/v1/me/tickets", headers=bearer(buyer["access_token"]))
    assert all(row["status"] != "ISSUED" for row in tickets_before.json()["items"])

    confirmed = await client.post(
        f"/api/v1/payments/{body['payment']['id']}/sandbox-confirm",
        headers=bearer(buyer["access_token"]),
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "FULFILLED"
    assert confirmed.json()["payment"]["status"] == "CAPTURED"

    mine = await client.get("/api/v1/me/tickets", headers=bearer(buyer["access_token"]))
    assert mine.status_code == 200
    issued = [row for row in mine.json()["items"] if row["status"] == "ISSUED"]
    assert len(issued) == 2
    assert all(row["presentation_token"] for row in issued)

    other = await register_and_login(client, "other-idor@example.com")
    stolen = await client.get(
        f"/api/v1/tickets/{issued[0]['id']}",
        headers=bearer(other["access_token"]),
    )
    assert stolen.status_code == 404


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_check_in_and_idor(client: AsyncClient) -> None:
    token, _org = await _platform_admin(client)
    event = await _published_event(client, token, title="Door Night")
    ticket_type = await _on_sale_type(client, token, event["id"], quantity=1, price=100)
    await _open_ticketing(client, token, event["id"])
    buyer = await register_and_login(client, "door-buyer@example.com")
    hold = await client.post(
        "/api/v1/ticket-holds",
        headers=bearer(buyer["access_token"]),
        json={"ticket_type_id": ticket_type["id"], "quantity": 1},
    )
    order = await client.post(
        "/api/v1/orders",
        headers={**bearer(buyer["access_token"]), "Idempotency-Key": "door-1"},
        json={"hold_id": hold.json()["id"]},
    )
    await client.post(
        f"/api/v1/payments/{order.json()['payment']['id']}/sandbox-confirm",
        headers=bearer(buyer["access_token"]),
    )
    ticket = (await client.get("/api/v1/me/tickets", headers=bearer(buyer["access_token"]))).json()[
        "items"
    ][0]
    token_value = ticket["presentation_token"]

    customer_scan = await client.post(
        "/api/v1/check-in",
        headers=bearer(buyer["access_token"]),
        json={"token": token_value},
    )
    assert customer_scan.status_code in {403, 404}

    scanned = await client.post(
        "/api/v1/check-in",
        headers=bearer(token),
        json={"token": token_value},
    )
    assert scanned.status_code == 200, scanned.text
    assert scanned.json()["status"] == "RECORDED"

    attendance = await client.get(
        f"/api/v1/events/{event['id']}/attendance",
        headers=bearer(token),
    )
    assert attendance.status_code == 200
    assert len(attendance.json()["items"]) == 1


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_cancelled_event_blocks_holds_postpone_keeps_tickets(client: AsyncClient) -> None:
    token, _org = await _platform_admin(client)
    event = await _published_event(client, token, title="Weather Night")
    ticket_type = await _on_sale_type(client, token, event["id"], quantity=2, price=100)
    await _open_ticketing(client, token, event["id"])
    buyer = await register_and_login(client, "keep-ticket@example.com")
    hold = await client.post(
        "/api/v1/ticket-holds",
        headers=bearer(buyer["access_token"]),
        json={"ticket_type_id": ticket_type["id"], "quantity": 1},
    )
    order = await client.post(
        "/api/v1/orders",
        headers={**bearer(buyer["access_token"]), "Idempotency-Key": "keep-1"},
        json={"hold_id": hold.json()["id"]},
    )
    await client.post(
        f"/api/v1/payments/{order.json()['payment']['id']}/sandbox-confirm",
        headers=bearer(buyer["access_token"]),
    )
    postponed = await client.post(
        f"/api/v1/events/{event['id']}/lifecycle",
        headers=bearer(token),
        json={
            "action": "postpone",
            "starts_at": "2026-12-08T18:00:00+00:00",
            "ends_at": "2026-12-08T21:00:00+00:00",
            "reason": "Rain",
        },
    )
    assert postponed.status_code == 200
    tickets = (await client.get("/api/v1/me/tickets", headers=bearer(buyer["access_token"]))).json()[
        "items"
    ]
    assert tickets[0]["status"] == "ISSUED"

    resumed = await client.post(
        f"/api/v1/events/{event['id']}/lifecycle",
        headers=bearer(token),
        json={"action": "resume", "resume_status": "TICKETING_OPEN"},
    )
    assert resumed.status_code == 200
    cancelled = await client.post(
        f"/api/v1/events/{event['id']}/lifecycle",
        headers=bearer(token),
        json={"action": "cancel"},
    )
    assert cancelled.status_code == 200
    blocked = await client.post(
        "/api/v1/ticket-holds",
        headers=bearer(buyer["access_token"]),
        json={"ticket_type_id": ticket_type["id"], "quantity": 1},
    )
    assert blocked.status_code == 409
    still_issued = (
        await client.get("/api/v1/me/tickets", headers=bearer(buyer["access_token"]))
    ).json()["items"]
    assert still_issued[0]["status"] == "ISSUED"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_cross_org_ticket_type_is_hidden(client: AsyncClient) -> None:
    token, _platform = await _platform_admin(client)
    event = await _published_event(client, token, title="Org A Show")
    ticket_type = await _on_sale_type(client, token, event["id"])
    admin = await admin_token(client)
    orgs = (await client.get("/api/v1/organizations", headers=bearer(admin))).json()["items"]
    label = next(row for row in orgs if row["type"] == "LABEL")
    label_token = await _workspace(client, admin, label["id"])
    hidden = await client.get(
        f"/api/v1/ticket-types/{ticket_type['id']}",
        headers=bearer(label_token),
    )
    assert hidden.status_code == 404


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_concurrency_a_oversell(client: AsyncClient) -> None:
    token, _org = await _platform_admin(client)
    event = await _published_event(client, token, title="One Seat")
    ticket_type = await _on_sale_type(client, token, event["id"], quantity=1)
    await _open_ticketing(client, token, event["id"])
    buyer_a = await register_and_login(client, "race-a@example.com")
    buyer_b = await register_and_login(client, "race-b@example.com")
    first, second = await asyncio.gather(
        client.post(
            "/api/v1/ticket-holds",
            headers=bearer(buyer_a["access_token"]),
            json={"ticket_type_id": ticket_type["id"], "quantity": 1},
        ),
        client.post(
            "/api/v1/ticket-holds",
            headers=bearer(buyer_b["access_token"]),
            json={"ticket_type_id": ticket_type["id"], "quantity": 1},
        ),
    )
    codes = sorted([first.status_code, second.status_code])
    assert codes == [201, 409]
    leftover = await client.get(
        f"/api/v1/ticket-types/{ticket_type['id']}",
        headers=bearer(token),
    )
    assert leftover.json()["remaining"] >= 0
    assert leftover.json()["remaining"] == 0


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_concurrency_b_duplicate_checkout_key(client: AsyncClient) -> None:
    token, _org = await _platform_admin(client)
    event = await _published_event(client, token, title="Dup Checkout")
    ticket_type = await _on_sale_type(client, token, event["id"], quantity=2)
    await _open_ticketing(client, token, event["id"])
    buyer = await register_and_login(client, "dup-order@example.com")
    hold = await client.post(
        "/api/v1/ticket-holds",
        headers=bearer(buyer["access_token"]),
        json={"ticket_type_id": ticket_type["id"], "quantity": 1},
    )
    payload = {"hold_id": hold.json()["id"]}
    headers = {**bearer(buyer["access_token"]), "Idempotency-Key": "same-checkout-key"}
    first = await client.post("/api/v1/orders", headers=headers, json=payload)
    second = await client.post("/api/v1/orders", headers=headers, json=payload)
    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    assert first.json()["id"] == second.json()["id"]
    listed = await client.get("/api/v1/me/orders", headers=bearer(buyer["access_token"]))
    assert len(listed.json()["items"]) == 1


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_concurrency_c_duplicate_payment_callback(client: AsyncClient, settings) -> None:
    token, _org = await _platform_admin(client)
    event = await _published_event(client, token, title="Dup Pay")
    ticket_type = await _on_sale_type(client, token, event["id"], quantity=1)
    await _open_ticketing(client, token, event["id"])
    buyer = await register_and_login(client, "dup-pay@example.com")
    hold = await client.post(
        "/api/v1/ticket-holds",
        headers=bearer(buyer["access_token"]),
        json={"ticket_type_id": ticket_type["id"], "quantity": 1},
    )
    order = await client.post(
        "/api/v1/orders",
        headers={**bearer(buyer["access_token"]), "Idempotency-Key": "pay-dup"},
        json={"hold_id": hold.json()["id"]},
    )
    payment_id = order.json()["payment"]["id"]
    payload = {
        "payment_id": payment_id,
        "amount_minor": 1500,
        "currency_code": "USD",
        "provider_event_id": "evt-dup-1",
        "status": "CAPTURED",
    }
    secret = settings.sandbox_payment_secret or settings.jwt_secret
    signature = sign_sandbox_payload(payload, secret)
    first, second = await asyncio.gather(
        client.post(
            "/api/v1/payments/callbacks",
            headers={"X-CornerRoom-Payment-Signature": signature},
            json=payload,
        ),
        client.post(
            "/api/v1/payments/callbacks",
            headers={"X-CornerRoom-Payment-Signature": signature},
            json=payload,
        ),
    )
    assert first.status_code == 200
    assert second.status_code == 200
    mine = await client.get("/api/v1/me/tickets", headers=bearer(buyer["access_token"]))
    issued = [row for row in mine.json()["items"] if row["status"] in {"ISSUED", "CHECKED_IN"}]
    assert len(issued) == 1


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_concurrency_d_duplicate_issuance(client: AsyncClient) -> None:
    token, _org = await _platform_admin(client)
    event = await _published_event(client, token, title="Dup Issue")
    ticket_type = await _on_sale_type(client, token, event["id"], quantity=1)
    await _open_ticketing(client, token, event["id"])
    buyer = await register_and_login(client, "dup-issue@example.com")
    hold = await client.post(
        "/api/v1/ticket-holds",
        headers=bearer(buyer["access_token"]),
        json={"ticket_type_id": ticket_type["id"], "quantity": 1},
    )
    order = await client.post(
        "/api/v1/orders",
        headers={**bearer(buyer["access_token"]), "Idempotency-Key": "issue-dup"},
        json={"hold_id": hold.json()["id"]},
    )
    payment_id = order.json()["payment"]["id"]
    first = await client.post(
        f"/api/v1/payments/{payment_id}/sandbox-confirm",
        headers=bearer(buyer["access_token"]),
    )
    second = await client.post(
        f"/api/v1/payments/{payment_id}/sandbox-confirm",
        headers=bearer(buyer["access_token"]),
    )
    assert first.status_code == 200
    assert second.status_code == 200
    mine = await client.get("/api/v1/me/tickets", headers=bearer(buyer["access_token"]))
    assert len(mine.json()["items"]) == 1


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_concurrency_e_concurrent_check_in(client: AsyncClient) -> None:
    token, _org = await _platform_admin(client)
    event = await _published_event(client, token, title="Dup Scan")
    ticket_type = await _on_sale_type(client, token, event["id"], quantity=1)
    await _open_ticketing(client, token, event["id"])
    buyer = await register_and_login(client, "dup-scan@example.com")
    hold = await client.post(
        "/api/v1/ticket-holds",
        headers=bearer(buyer["access_token"]),
        json={"ticket_type_id": ticket_type["id"], "quantity": 1},
    )
    order = await client.post(
        "/api/v1/orders",
        headers={**bearer(buyer["access_token"]), "Idempotency-Key": "scan-dup"},
        json={"hold_id": hold.json()["id"]},
    )
    await client.post(
        f"/api/v1/payments/{order.json()['payment']['id']}/sandbox-confirm",
        headers=bearer(buyer["access_token"]),
    )
    ticket = (await client.get("/api/v1/me/tickets", headers=bearer(buyer["access_token"]))).json()[
        "items"
    ][0]
    first, second = await asyncio.gather(
        client.post("/api/v1/check-in", headers=bearer(token), json={"token": ticket["presentation_token"]}),
        client.post("/api/v1/check-in", headers=bearer(token), json={"token": ticket["presentation_token"]}),
    )
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["id"] == second.json()["id"]
    attendance = await client.get(
        f"/api/v1/events/{event['id']}/attendance",
        headers=bearer(token),
    )
    assert len(attendance.json()["items"]) == 1


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_open_ticketing_emits_outbox(client: AsyncClient) -> None:
    token, _org = await _platform_admin(client)
    event = await _published_event(client, token, title="Outbox Night")
    await _on_sale_type(client, token, event["id"])
    await _open_ticketing(client, token, event["id"])
    factory = async_sessionmaker(get_engine(), expire_on_commit=False)
    async with factory() as session:
        rows = (
            await session.execute(select(OutboxEvent).where(OutboxEvent.event_type == TICKETING_OPENED))
        ).scalars().all()
        assert any(
            row.payload.get("payload", {}).get("event_id") == event["id"] for row in rows
        )
