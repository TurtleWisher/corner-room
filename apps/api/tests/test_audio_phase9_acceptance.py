"""Audio Phase 9: purchase acceptance for whole releases (owner spec Phase 7 exit, Phase 9 gate).

Success, payment failure, duplicate provider callback, late fulfilment, refund through the real
refund flow, revoked access, wrong-account access and repeat download, end to end over HTTP.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from httpx import AsyncClient

from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase5_intake import _orgs, _staff_with
from tests.test_audio_phase7_release_commerce import _released


async def _release_offer(client: AsyncClient, tag: str) -> tuple[str, str, str, str]:
    """A released single with an accepted price: (release_id, track_id, offer_id, admin_token)."""
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    release_id, track_id, _owner, _artist = await _released(client, admin, label, f"acc-{tag}@example.com", f"Act {tag}")
    ops = await _staff_with(client, admin, f"acc-ops-{tag}@example.com", "finance_manager", label)
    queue = (await client.get("/api/v1/offer-proposals", headers=bearer(ops))).json()
    proposal = next(p for p in queue if p["release_id"] == release_id)
    assert (await client.post(f"/api/v1/offer-proposals/{proposal['id']}/decision", headers=bearer(ops), json={"decision": "accept"})).status_code == 200
    offer = next(o for o in (await client.get("/api/v1/offers")).json()["items"] if o.get("subject_id") == release_id)
    return release_id, track_id, offer["id"], admin


async def _order(client: AsyncClient, token: str, offer_id: str) -> dict:
    res = await client.post("/api/v1/orders", headers={**bearer(token), "Idempotency-Key": f"k-{uuid4()}"}, json={"offer_id": offer_id, "delivery_address_confirmed": True})
    assert res.status_code == 201, res.text
    return res.json()


async def _callback(client: AsyncClient, settings, order: dict, status: str, event: str):  # type: ignore[no-untyped-def]
    from cornerroom.modules.finance.application.sandbox import sign_sandbox_payload

    payment = order["payment"]
    payload = {
        "payment_id": payment["id"],
        "amount_minor": payment["amount_minor"],
        "currency_code": payment["currency_code"],
        "provider_event_id": event,
        "status": status,
    }
    signature = sign_sandbox_payload(payload, settings.sandbox_payment_secret or settings.jwt_secret)
    return await client.post("/api/v1/payments/callbacks", headers={"X-CornerRoom-Payment-Signature": signature}, json=payload)


async def _owns(client: AsyncClient, token: str, track_id: str) -> bool:
    """Ownership as downloads see it: purchase only (a plan never counts)."""
    res = await client.get(f"/api/v1/me/downloads/tracks/{track_id}", headers=bearer(token))
    assert res.status_code in (200, 403), res.text
    return res.status_code == 200


async def _release_entitlements(client: AsyncClient, token: str, release_id: str) -> list[dict]:
    items = (await client.get("/api/v1/me/entitlements", headers=bearer(token))).json()["items"]
    return [e for e in items if e["scope"] == "RELEASE" and e["ref_id"] == release_id]


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_release_purchase_failure_late_fulfilment_and_duplicate_callback(client: AsyncClient, settings) -> None:
    release_id, track_id, offer_id, _ops = await _release_offer(client, "pay")
    fan = await register_and_login(client, "acc-pay-fan@example.com")
    token = fan["access_token"]

    # A failed payment fulfils nothing.
    failed_order = await _order(client, token, offer_id)
    failed = await _callback(client, settings, failed_order, "FAILED", f"evt-fail-{uuid4()}")
    assert failed.status_code == 409 and failed.json()["code"] == "PAYMENT_NOT_CAPTURED"
    failed_view = (await client.get(f"/api/v1/orders/{failed_order['id']}", headers=bearer(token))).json()
    # The failure is recorded (it used to be rolled back with the 409), and nothing is fulfilled.
    assert failed_view["status"] != "FULFILLED" and failed_view["payment"]["status"] == "FAILED"
    assert await _release_entitlements(client, token, release_id) == []
    assert await _owns(client, token, track_id) is False

    # Late fulfilment: the order waits, unowned, until the provider's confirmation arrives.
    order = await _order(client, token, offer_id)
    pending = (await client.get(f"/api/v1/orders/{order['id']}", headers=bearer(token))).json()
    assert pending["status"] != "FULFILLED" and await _owns(client, token, track_id) is False
    event = f"evt-ok-{uuid4()}"
    first = await _callback(client, settings, order, "CAPTURED", event)
    assert first.status_code == 200, first.text and first.json()["status"] == "FULFILLED"
    # The same provider event again changes nothing: one entitlement, one library entry.
    again = await _callback(client, settings, order, "CAPTURED", event)
    assert again.status_code == 200
    assert len(await _release_entitlements(client, token, release_id)) == 1
    library = (await client.get("/api/v1/me/library", headers=bearer(token))).json()["items"]
    assert sum(1 for i in library if i["item_type"] == "release" and i["item_id"] == release_id and i["kind"] == "PURCHASE_REF") == 1
    assert await _owns(client, token, track_id) is True
    receipt = (await client.get(f"/api/v1/orders/{order['id']}", headers=bearer(token))).json()
    assert receipt["status"] == "FULFILLED" and receipt["items"][0]["release_title"] == "Review Me"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_release_refund_revokes_and_other_accounts_never_see_it(client: AsyncClient) -> None:
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.ticketing.domain.models import RefundPolicy

    # Refund approval needs an unscoped finance.post grant today (finance module; see the Finance
    # module pass), so the platform admin approves here.
    release_id, track_id, offer_id, finance = await _release_offer(client, "refund")
    fan = await register_and_login(client, "acc-refund-fan@example.com")
    other = await register_and_login(client, "acc-refund-other@example.com")
    token = fan["access_token"]
    order = await _order(client, token, offer_id)
    paid = await client.post(f"/api/v1/payments/{order['payment']['id']}/sandbox-confirm", headers=bearer(token))
    assert paid.status_code == 200 and paid.json()["status"] == "FULFILLED"
    assert await _owns(client, token, track_id) is True

    # Wrong account: someone else sees neither the order nor the download.
    assert (await client.get(f"/api/v1/orders/{order['id']}", headers=bearer(other["access_token"]))).status_code == 404
    assert await _owns(client, other["access_token"], track_id) is False

    # Repeat downloads are unlimited (D-AUDIO-06): asking twice is fine.
    for _ in range(2):
        assert (await client.get(f"/api/v1/me/downloads/tracks/{track_id}", headers=bearer(token))).status_code == 200

    # Refund through the real flow. No reason-to-revoke policy row exists: the music rule alone
    # (D-AUDIO-06) must take the release away once it is fully refunded.
    async with get_session_factory()() as session:
        session.add(RefundPolicy(scope_type="PLATFORM", reason_code="ACC_MUSIC_REFUND", requires_finance_approve=True))
        await session.commit()
    amount = paid.json()["payment"]["amount_minor"]
    refund = await client.post(
        "/api/v1/refunds",
        headers={**bearer(token), "Idempotency-Key": f"r-{uuid4()}"},
        json={"payment_id": paid.json()["payment"]["id"], "amount_minor": amount, "reason_code": "ACC_MUSIC_REFUND"},
    )
    assert refund.status_code == 201, refund.text
    assert await _owns(client, token, track_id) is True  # requested, not yet done
    assert (await client.post(f"/api/v1/refunds/{refund.json()['id']}/approve", headers=bearer(finance))).status_code == 200
    done = await client.post(f"/api/v1/refunds/{refund.json()['id']}/sandbox-complete", headers=bearer(finance))
    assert done.status_code == 200 and done.json()["status"] == "COMPLETED", done.text

    assert (await client.get(f"/api/v1/orders/{order['id']}", headers=bearer(token))).json()["status"] == "REFUNDED"
    assert all(e["status"] != "ACTIVE" for e in await _release_entitlements(client, token, release_id))
    assert await _owns(client, token, track_id) is False
    # The release can be bought again after a refund.
    assert (await client.post("/api/v1/orders", headers={**bearer(token), "Idempotency-Key": f"k-{uuid4()}"}, json={"offer_id": offer_id, "delivery_address_confirmed": True})).status_code == 201
