"""Platform admins play every song, and their buys are tests (owner, 2026-11-21, D-STREAM-03,
D-TEST-BUY-01).

Catalog staff or admins for the whole platform (a role with no organization) or in the workspace
that runs Corner Room (type PLATFORM) may play every song. A label's own staff keep only their
label's music. A platform admin's buy goes through checkout with no payment and is finished with
Complete as a test: the music is theirs, and nothing reaches sales, royalties, the artist or the
customer list."""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient

from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase5_intake import _orgs, _staff_with
from tests.test_audio_phase7_release_commerce import _released


async def _owns(user_id: str, release_id: str) -> bool:
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.entitlements.application.service import EntitlementService

    async with get_session_factory()() as session:
        return await EntitlementService(session).find_active_release(UUID(user_id), UUID(release_id)) is not None


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_platform_admins_play_everything_and_buy_as_a_test(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    release_id, track_id, owner, artist_id = await _released(client, admin, label, "tb-owner@example.com", "Test Buy Act")
    ops = await _staff_with(client, admin, "tb-ops@example.com", "finance_manager", label)
    proposal = next(p for p in (await client.get("/api/v1/offer-proposals", headers=bearer(ops))).json() if p["release_id"] == release_id)
    await client.post(f"/api/v1/offer-proposals/{proposal['id']}/decision", headers=bearer(ops), json={"decision": "accept"})
    offer = next(o for o in (await client.get("/api/v1/offers")).json()["items"] if o.get("subject_id") == release_id)

    # The platform admin plays every song; a fan and a label's own staff are not platform admins.
    access = (await client.get("/api/v1/me/stream-access", headers=bearer(admin))).json()
    assert access["platform_staff"] is True and track_id in access["track_ids"]
    fan = await register_and_login(client, "tb-fan@example.com")
    assert (await client.get("/api/v1/me/stream-access", headers=bearer(fan["access_token"]))).json()["platform_staff"] is False
    label_staff = await _staff_with(client, admin, "tb-label@example.com", "content_manager", label)
    label_access = (await client.get("/api/v1/me/stream-access", headers=bearer(label_staff))).json()
    assert label_access["platform_staff"] is False and track_id in label_access["track_ids"]
    if "PLATFORM" in orgs:
        platform_staff = await _staff_with(client, admin, "tb-platform@example.com", "content_manager", orgs["PLATFORM"])
        assert (await client.get("/api/v1/me/stream-access", headers=bearer(platform_staff))).json()["platform_staff"] is True

    # The admin's buy is a test: no payment, then Complete as a test.
    me = (await client.get("/api/v1/me", headers=bearer(admin))).json()
    placed = await client.post(
        "/api/v1/orders", headers={**bearer(admin), "Idempotency-Key": f"t-{uuid4()}"},
        json={"offer_id": offer["id"], "delivery_address_confirmed": True},
    )
    assert placed.status_code == 201, placed.text
    order = placed.json()
    assert order["is_test"] is True and order["payment"] is None and order["status"] == "PENDING_PAYMENT"
    # Nobody else can complete it, and a fan's normal order can't be completed as a test.
    assert (await client.post(f"/api/v1/orders/{order['id']}/complete-test", headers=bearer(fan["access_token"]))).status_code == 404
    done = await client.post(f"/api/v1/orders/{order['id']}/complete-test", headers=bearer(admin))
    assert done.status_code == 200, done.text
    assert done.json()["status"] == "FULFILLED" and done.json()["is_test"] is True
    assert await _owns(me["id"] if "id" in me else me["user"]["id"], release_id)

    fan_order = await client.post(
        "/api/v1/orders", headers={**bearer(fan["access_token"]), "Idempotency-Key": f"f-{uuid4()}"},
        json={"offer_id": offer["id"], "delivery_address_confirmed": True},
    )
    assert fan_order.json()["is_test"] is False and fan_order.json()["payment"] is not None
    assert (await client.post(f"/api/v1/orders/{fan_order.json()['id']}/complete-test", headers=bearer(fan["access_token"]))).status_code == 404

    # Never a sale, a buyer, or an artist's number.
    lines = (await client.get(f"/api/v1/studio/profiles/artist/{artist_id}/sales/lines", headers=bearer(owner["access_token"]))).json()["items"]
    assert lines == []
    buyers = (await client.get(f"/api/v1/studio/profiles/artist/{artist_id}/sales/buyers", headers=bearer(owner["access_token"]))).json()["items"]
    assert all(not group["names"] for group in buyers)
