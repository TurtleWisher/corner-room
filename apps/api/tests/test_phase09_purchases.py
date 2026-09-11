"""Phase 09 purchases and subscriptions. PostgreSQL tests skip honestly when unavailable."""

from __future__ import annotations

from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker

from cornerroom.infra.db import get_engine
from cornerroom.modules.commerce.domain.models import RefundEntitlementPolicy
from cornerroom.modules.finance.application.sandbox import sign_sandbox_payload
from cornerroom.modules.ticketing.domain.models import RefundPolicy
from tests.auth_helpers import admin_token, bearer, register_and_login
from tests.test_phase07_catalog import _ready_version, _release_track, _workspace


async def _platform_admin(client: AsyncClient) -> tuple[str, str]:
    admin = await admin_token(client)
    orgs = (await client.get("/api/v1/organizations", headers=bearer(admin))).json()["items"]
    platform = next(row for row in orgs if row["type"] == "PLATFORM")
    token = await _workspace(client, admin, platform["id"])
    return token, platform["id"]


async def _released_track(client: AsyncClient, token: str, title: str) -> dict:
    created = await client.post("/api/v1/tracks", headers=bearer(token), json={"title": title})
    assert created.status_code == 201, created.text
    await _ready_version(client, token, created.json()["id"])
    return await _release_track(client, token, created.json()["id"], created.json()["version"])


async def _user_id(client: AsyncClient, token: str) -> str:
    me = await client.get("/api/v1/me", headers=bearer(token))
    assert me.status_code == 200, me.text
    return me.json()["id"]


async def _active_offer(client: AsyncClient, token: str, track_id: str, amount: int = 500) -> dict:
    product = await client.post(
        "/api/v1/products",
        headers=bearer(token),
        json={"product_type": "TRACK", "subject_id": track_id, "name": "Track SKU"},
    )
    assert product.status_code == 201, product.text
    activated = await client.post(
        f"/api/v1/products/{product.json()['id']}/lifecycle",
        headers=bearer(token),
        json={"action": "activate", "version": product.json()["version"]},
    )
    assert activated.status_code == 200, activated.text
    offer = await client.post(
        "/api/v1/offers",
        headers=bearer(token),
        json={
            "product_id": product.json()["id"],
            "amount_minor": amount,
            "currency_code": "USD",
        },
    )
    assert offer.status_code == 201, offer.text
    live = await client.post(
        f"/api/v1/offers/{offer.json()['id']}/lifecycle",
        headers=bearer(token),
        json={"action": "activate", "version": offer.json()["version"]},
    )
    assert live.status_code == 200, live.text
    return live.json()


async def _active_plan(client: AsyncClient, token: str, key: str, amount: int = 900) -> dict:
    created = await client.post(
        "/api/v1/subscription-plans",
        headers=bearer(token),
        json={
            "key": key,
            "price_amount_minor": amount,
            "currency_code": "USD",
            "interval": "MONTH",
            "interval_count": 1,
        },
    )
    assert created.status_code == 201, created.text
    live = await client.post(
        f"/api/v1/subscription-plans/{created.json()['id']}/lifecycle",
        headers=bearer(token),
        json={"action": "activate"},
    )
    assert live.status_code == 200, live.text
    return live.json()


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase09_order_payment_fulfillment_entitlement_idor(client: AsyncClient) -> None:
    staff, _org = await _platform_admin(client)
    track = await _released_track(client, staff, "For Sale")
    offer = await _active_offer(client, staff, track["id"], 700)
    buyer = await register_and_login(client, "buyer-p9@example.com")
    other = await register_and_login(client, "other-p9@example.com")
    buyer_token = buyer["access_token"]

    denied = await client.post(
        "/api/v1/playback/sessions",
        headers=bearer(buyer_token),
        json={"track_id": track["id"]},
    )
    assert denied.status_code == 403
    assert denied.json()["code"] == "ENTITLEMENT_REQUIRED"

    mixed = await client.post(
        "/api/v1/orders",
        headers={**bearer(buyer_token), "Idempotency-Key": "mix-1"},
        json={"hold_id": str(uuid4()), "offer_id": offer["id"]},
    )
    assert mixed.status_code == 422
    assert mixed.json()["code"] == "MIXED_ORDER"

    first = await client.post(
        "/api/v1/orders",
        headers={**bearer(buyer_token), "Idempotency-Key": "buy-track-1"},
        json={"offer_id": offer["id"]},
    )
    assert first.status_code == 201, first.text
    replay = await client.post(
        "/api/v1/orders",
        headers={**bearer(buyer_token), "Idempotency-Key": "buy-track-1"},
        json={"offer_id": offer["id"]},
    )
    assert replay.status_code == 201
    assert replay.json()["id"] == first.json()["id"]
    assert first.json()["status"] == "PENDING_PAYMENT"
    assert first.json()["payment"]["status"] != "CAPTURED"

    captured = await client.post(
        f"/api/v1/payments/{first.json()['payment']['id']}/sandbox-confirm",
        headers=bearer(buyer_token),
    )
    assert captured.status_code == 200, captured.text
    assert captured.json()["status"] == "FULFILLED"
    original_amount = first.json()["payment"]["amount_minor"]
    assert captured.json()["payment"]["status"] == "CAPTURED"
    assert captured.json()["payment"]["amount_minor"] == original_amount

    ents = await client.get("/api/v1/me/entitlements", headers=bearer(buyer_token))
    assert ents.status_code == 200
    assert any(row["entitlement_type"] == "PURCHASE" and row["status"] == "ACTIVE" for row in ents.json()["items"])

    stolen = await client.get(
        f"/api/v1/orders/{first.json()['id']}",
        headers=bearer(other["access_token"]),
    )
    assert stolen.status_code == 404
    stolen_ent = await client.get(
        f"/api/v1/entitlements/{ents.json()['items'][0]['id']}",
        headers=bearer(other["access_token"]),
    )
    assert stolen_ent.status_code == 404

    opened = await client.post(
        "/api/v1/playback/sessions",
        headers=bearer(buyer_token),
        json={"track_id": track["id"]},
    )
    assert opened.status_code == 201, opened.text

    down = await client.post(
        f"/api/v1/tracks/{track['id']}/transition",
        headers=bearer(staff),
        json={"action": "takedown", "version": track["version"]},
    )
    assert down.status_code == 200
    blocked = await client.post(
        "/api/v1/playback/sessions",
        headers=bearer(buyer_token),
        json={"track_id": track["id"]},
    )
    assert blocked.status_code == 409
    assert blocked.json()["code"] == "TRACK_TAKEN_DOWN"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase09_subscription_lifecycle_renewal_fail_and_authz(client: AsyncClient, settings) -> None:
    staff, _org = await _platform_admin(client)
    plan = await _active_plan(client, staff, "p9-monthly")
    fan = await register_and_login(client, "sub-fan@example.com")
    other = await register_and_login(client, "sub-other@example.com")
    token = fan["access_token"]

    created = await client.post(
        "/api/v1/subscriptions",
        headers={**bearer(token), "Idempotency-Key": "sub-1"},
        json={"plan_id": plan["id"]},
    )
    assert created.status_code == 201, created.text
    replay = await client.post(
        "/api/v1/subscriptions",
        headers={**bearer(token), "Idempotency-Key": "sub-1"},
        json={"plan_id": plan["id"]},
    )
    assert replay.json()["id"] == created.json()["id"]

    paid = await client.post(
        f"/api/v1/payments/{created.json()['payment']['id']}/sandbox-confirm",
        headers=bearer(token),
    )
    assert paid.status_code == 200
    assert paid.json()["status"] == "FULFILLED"

    mine = await client.get("/api/v1/me/subscription", headers=bearer(token))
    assert mine.status_code == 200, mine.text
    assert mine.json()["status"] == "ACTIVE"
    sub_id = mine.json()["id"]

    stolen = await client.get(
        f"/api/v1/subscriptions/{sub_id}",
        headers=bearer(other["access_token"]),
    )
    assert stolen.status_code == 404

    second = await client.post(
        "/api/v1/subscriptions",
        headers={**bearer(token), "Idempotency-Key": "sub-2"},
        json={"plan_id": plan["id"]},
    )
    assert second.status_code == 409
    assert second.json()["code"] == "SUBSCRIPTION_EXISTS"

    cancelled = await client.post(
        f"/api/v1/subscriptions/{sub_id}/cancel",
        headers=bearer(token),
    )
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "CANCELLED"
    assert cancelled.json()["cancel_at_period_end"] is True
    ents = await client.get("/api/v1/me/entitlements", headers=bearer(token))
    assert any(row["entitlement_type"] == "SUBSCRIPTION" and row["status"] == "ACTIVE" for row in ents.json()["items"])

    fan2 = await register_and_login(client, "sub-fan2@example.com")
    start2 = await client.post(
        "/api/v1/subscriptions",
        headers={**bearer(fan2["access_token"]), "Idempotency-Key": "sub-b"},
        json={"plan_id": plan["id"]},
    )
    assert start2.status_code == 201
    paid2 = await client.post(
        f"/api/v1/payments/{start2.json()['payment']['id']}/sandbox-confirm",
        headers=bearer(fan2["access_token"]),
    )
    assert paid2.status_code == 200
    live = await client.get("/api/v1/me/subscription", headers=bearer(fan2["access_token"]))
    renew = await client.post(
        f"/api/v1/subscriptions/{live.json()['id']}/sandbox-renew",
        headers={**bearer(fan2["access_token"]), "Idempotency-Key": "renew-1"},
        json={},
    )
    assert renew.status_code == 200, renew.text
    renew_replay = await client.post(
        f"/api/v1/subscriptions/{live.json()['id']}/sandbox-renew",
        headers={**bearer(fan2["access_token"]), "Idempotency-Key": "renew-1"},
        json={},
    )
    assert renew_replay.json()["id"] == renew.json()["id"]

    fail_payload = {
        "payment_id": renew.json()["payment"]["id"],
        "amount_minor": renew.json()["payment"]["amount_minor"],
        "currency_code": "USD",
        "provider_event_id": "evt-fail-renew",
        "status": "FAILED",
    }
    secret = settings.sandbox_payment_secret or settings.jwt_secret
    signature = sign_sandbox_payload(fail_payload, secret)
    failed = await client.post(
        "/api/v1/payments/callbacks",
        headers={"X-CornerRoom-Payment-Signature": signature},
        json=fail_payload,
    )
    assert failed.status_code == 409
    past = await client.get("/api/v1/me/subscription", headers=bearer(fan2["access_token"]))
    assert past.json()["status"] == "PAST_DUE"

    stranger = await register_and_login(client, "no-write@example.com")
    blocked = await client.post(
        "/api/v1/products",
        headers=bearer(stranger["access_token"]),
        json={"product_type": "TRACK", "subject_id": str(uuid4()), "name": "Nope"},
    )
    assert blocked.status_code in {403, 404, 409}


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase09_refund_additive_duplicate_webhook_org_grant(client: AsyncClient, settings) -> None:
    staff, _org = await _platform_admin(client)
    track = await _released_track(client, staff, "Refundable")
    offer = await _active_offer(client, staff, track["id"], 400)
    buyer = await register_and_login(client, "refund-fan@example.com")
    token = buyer["access_token"]
    order = await client.post(
        "/api/v1/orders",
        headers={**bearer(token), "Idempotency-Key": "ref-order"},
        json={"offer_id": offer["id"]},
    )
    paid = await client.post(
        f"/api/v1/payments/{order.json()['payment']['id']}/sandbox-confirm",
        headers=bearer(token),
    )
    assert paid.status_code == 200
    payment_id = paid.json()["payment"]["id"]
    payment_amount = paid.json()["payment"]["amount_minor"]

    factory = async_sessionmaker(get_engine(), expire_on_commit=False)
    async with factory() as session:
        session.add(
            RefundPolicy(
                scope_type="PLATFORM",
                reason_code="CUSTOMER_REQUEST",
                requires_finance_approve=True,
            )
        )
        session.add(
            RefundEntitlementPolicy(
                scope_type="PLATFORM",
                reason_code="CUSTOMER_REQUEST",
                action="REVOKE",
            )
        )
        await session.commit()

    missing_policy = await client.post(
        "/api/v1/refunds",
        headers={**bearer(token), "Idempotency-Key": "ref-none"},
        json={"payment_id": payment_id, "amount_minor": 1, "reason_code": "UNKNOWN_REASON"},
    )
    assert missing_policy.status_code == 409
    assert missing_policy.json()["code"] == "REFUND_POLICY_REQUIRED"

    requested = await client.post(
        "/api/v1/refunds",
        headers={**bearer(token), "Idempotency-Key": "ref-1"},
        json={"payment_id": payment_id, "amount_minor": payment_amount, "reason_code": "CUSTOMER_REQUEST"},
    )
    assert requested.status_code == 201, requested.text
    replay = await client.post(
        "/api/v1/refunds",
        headers={**bearer(token), "Idempotency-Key": "ref-1"},
        json={"payment_id": payment_id, "amount_minor": payment_amount, "reason_code": "CUSTOMER_REQUEST"},
    )
    assert replay.json()["id"] == requested.json()["id"]
    approved = await client.post(
        f"/api/v1/refunds/{requested.json()['id']}/approve",
        headers=bearer(staff),
    )
    assert approved.status_code == 200
    completed = await client.post(
        f"/api/v1/refunds/{requested.json()['id']}/sandbox-complete",
        headers=bearer(staff),
    )
    assert completed.status_code == 200
    assert completed.json()["status"] == "COMPLETED"
    still = await client.get(f"/api/v1/orders/{order.json()['id']}", headers=bearer(token))
    assert still.json()["payment"]["status"] == "CAPTURED"
    assert still.json()["payment"]["amount_minor"] == payment_amount
    assert still.json()["status"] == "REFUNDED"
    ents = await client.get("/api/v1/me/entitlements", headers=bearer(token))
    assert all(row["status"] != "ACTIVE" or row["entitlement_type"] != "PURCHASE" for row in ents.json()["items"])

    payload = {
        "payment_id": payment_id,
        "amount_minor": payment_amount,
        "currency_code": "USD",
        "provider_event_id": "evt-already-captured",
        "status": "CAPTURED",
    }
    secret = settings.sandbox_payment_secret or settings.jwt_secret
    signature = sign_sandbox_payload(payload, secret)
    first = await client.post(
        "/api/v1/payments/callbacks",
        headers={"X-CornerRoom-Payment-Signature": signature},
        json=payload,
    )
    second = await client.post(
        "/api/v1/payments/callbacks",
        headers={"X-CornerRoom-Payment-Signature": signature},
        json=payload,
    )
    assert first.status_code == 200
    assert second.status_code == 200

    other_orgs = (await client.get("/api/v1/organizations", headers=bearer(staff))).json()["items"]
    label = next(row for row in other_orgs if row["type"] == "LABEL")
    label_token = await _workspace(client, staff, label["id"])
    hidden = await client.get("/api/v1/products", headers=bearer(label_token))
    assert hidden.status_code == 200
    assert all(row["organization_id"] == label["id"] for row in hidden.json()["items"])

    fan = await register_and_login(client, "grant-fan@example.com")
    fan_id = await _user_id(client, fan["access_token"])
    grant = await client.post(
        "/api/v1/entitlements/grants",
        headers=bearer(staff),
        json={
            "user_id": fan_id,
            "entitlement_type": "ADMIN_GRANT",
            "ref_id": track["id"],
            "scope": "CATALOG",
        },
    )
    assert grant.status_code == 201, grant.text
