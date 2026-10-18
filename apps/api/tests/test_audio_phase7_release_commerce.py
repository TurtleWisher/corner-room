"""Audio Phase 7: selling whole releases (AUDIO_PHASE_1_DESIGN 9; D-AUDIO-10 to -15; A23 to A25)."""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient

from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase4_studio import _artist_for
from tests.test_audio_phase5_intake import _orgs, _staff_with
from tests.test_audio_phase6_review import _ready_single, _review


async def _released(client: AsyncClient, admin: str, label: str, email: str, name: str) -> tuple[str, str, dict, str]:
    owner = await register_and_login(client, email)
    artist_id = await _artist_for(owner["user"]["id"], label, name=name)
    reviewer = await _staff_with(client, admin, f"rev-{email}", "content_manager", label)
    release_id, track_id = await _ready_single(client, owner["access_token"], artist_id)
    for action in ("start_review", "approve", "release"):
        res = await _review(client, reviewer, release_id, action)
        assert res.status_code == 200, res.text
    return release_id, track_id, owner, artist_id


async def _buy(client: AsyncClient, token: str, offer_id: str) -> dict:
    order = await client.post(
        "/api/v1/orders", headers={**bearer(token), "Idempotency-Key": f"k-{uuid4()}"}, json={"offer_id": offer_id, "delivery_address_confirmed": True}
    )
    assert order.status_code == 201, order.text
    paid = await client.post(f"/api/v1/payments/{order.json()['payment']['id']}/sandbox-confirm", headers=bearer(token))
    assert paid.status_code == 200, paid.text
    return paid.json()


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_release_purchase_from_proposal_to_listening(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    release_id, track_id, owner, _artist = await _released(client, admin, label, "rc-owner@example.com", "Commerce Act")
    ops = await _staff_with(client, admin, "rc-ops@example.com", "finance_manager", label)
    fan = await register_and_login(client, "rc-fan@example.com")

    queue = await client.get("/api/v1/offer-proposals", headers=bearer(ops))
    assert queue.status_code == 200, queue.text
    mine = [p for p in queue.json() if p["release_id"] == release_id]
    assert len(mine) == 1, queue.json()
    proposal = mine[0]
    assert proposal["subject_type"] == "RELEASE" and proposal["amount_minor"] == 3000
    no_note = await client.post(f"/api/v1/offer-proposals/{proposal['id']}/decision", headers=bearer(ops), json={"decision": "counter"})
    assert no_note.status_code == 422
    accepted = await client.post(f"/api/v1/offer-proposals/{proposal['id']}/decision", headers=bearer(ops), json={"decision": "accept"})
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["status"] == "ACCEPTED"
    seen = (await client.get(f"/api/v1/studio/releases/{release_id}", headers=bearer(owner["access_token"]))).json()
    assert seen["proposals"][0]["status"] == "ACCEPTED"

    offers = (await client.get("/api/v1/offers")).json()["items"]
    offer = next(o for o in offers if o.get("subject_id") == release_id)
    assert offer["product_type"] == "RELEASE" and offer["amount_minor"] == 3000 and offer["audience"] == "EVERYONE"

    # The test master has no playback copies, so delivery would stop at TRACK_AUDIO_UNAVAILABLE before
    # the entitlement check; ask the entitlement service directly (delivery itself is Phase 3's tests).
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.entitlements.application.service import EntitlementService

    async def can_play(track: str | UUID) -> bool:
        async with get_session_factory()() as session:
            return await EntitlementService(session).has_catalog_access(UUID(fan["user"]["id"]), UUID(str(track)))

    assert await can_play(track_id) is False
    receipt = await _buy(client, fan["access_token"], offer["id"])
    assert receipt["status"] == "FULFILLED" and receipt["purpose"] == "RELEASE"
    assert receipt["items"][0]["item_type"] == "RELEASE" and receipt["items"][0]["release_title"] == "Review Me"
    assert await can_play(track_id) is True
    library = (await client.get("/api/v1/me/library", headers=bearer(fan["access_token"]))).json()["items"]
    assert any(i["item_type"] == "release" and i["item_id"] == release_id and i["kind"] == "PURCHASE_REF" for i in library)
    again = await client.post("/api/v1/orders", headers={**bearer(fan["access_token"]), "Idempotency-Key": f"k-{uuid4()}"}, json={"offer_id": offer["id"], "delivery_address_confirmed": True})
    assert again.status_code == 409 and again.json()["code"] == "ALREADY_OWNED"

    # D-AUDIO-12 / A24: a bonus track added to the same release later is covered;
    # A23: a track on another release is not.
    from cornerroom.modules.music.domain.models import ReleaseTrack, Track

    async with get_session_factory()() as session:
        rel_track = await session.get(Track, UUID(track_id))
        bonus = Track(title="Bonus", status="RELEASED", primary_artist_id=rel_track.primary_artist_id, primary_org_id=rel_track.primary_org_id)
        stranger = Track(title="Elsewhere", status="RELEASED", primary_org_id=rel_track.primary_org_id)
        session.add_all([bonus, stranger])
        await session.flush()
        session.add(ReleaseTrack(release_id=UUID(release_id), track_id=bonus.id, position=2))
        await session.commit()
        ent = EntitlementService(session)
        assert await ent.has_catalog_access(UUID(fan["user"]["id"]), bonus.id) is True
        assert await ent.has_catalog_access(UUID(fan["user"]["id"]), stranger.id) is False


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_track_sales_and_audience_rules(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    owner = await register_and_login(client, "rc2-owner@example.com")
    artist_id = await _artist_for(owner["user"]["id"], label, name="Album Rules")
    ops = await _staff_with(client, admin, "rc2-ops@example.com", "finance_manager", label)
    album = (
        await client.post("/api/v1/studio/releases", headers=bearer(owner["access_token"]), json={"profile": {"kind": "artist", "id": artist_id}, "release_type": "ALBUM", "title": "Whole Only"})
    ).json()
    album_id = album["release"]["id"]
    track_id = (await client.post(f"/api/v1/studio/releases/{album_id}/tracks", headers=bearer(owner["access_token"]), json={"title": "Part"})).json()["tracks"][0]["id"]

    # A25: a song from an album sold whole only can't become its own product.
    product = await client.post("/api/v1/products", headers=bearer(ops), json={"product_type": "TRACK", "subject_id": track_id, "name": "Part"})
    assert product.status_code == 409 and product.json()["code"] == "TRACK_NOT_SOLD_SEPARATELY"
    await client.patch(f"/api/v1/studio/releases/{album_id}", headers=bearer(owner["access_token"]), json={"track_sales": "TRACKS_ALLOWED"})
    allowed = await client.post("/api/v1/products", headers=bearer(ops), json={"product_type": "TRACK", "subject_id": track_id, "name": "Part"})
    assert allowed.status_code == 201, allowed.text

    # If the artist later switches back to whole-release-only, the song's price leaves the public
    # list (2026-10-18: it stayed listed and every attempt to buy it was refused).
    product_id = allowed.json()["id"]
    assert (await client.post(f"/api/v1/products/{product_id}/lifecycle", headers=bearer(ops), json={"action": "activate"})).status_code == 200
    offer = await client.post("/api/v1/offers", headers=bearer(ops), json={"product_id": product_id, "amount_minor": 500, "currency_code": "BDT"})
    assert offer.status_code == 201, offer.text
    assert (await client.post(f"/api/v1/offers/{offer.json()['id']}/lifecycle", headers=bearer(ops), json={"action": "activate"})).status_code == 200
    listed = {o["id"] for o in (await client.get("/api/v1/offers")).json()["items"]}
    assert offer.json()["id"] in listed
    switched = await client.patch(f"/api/v1/studio/releases/{album_id}", headers=bearer(owner["access_token"]), json={"track_sales": "RELEASE_ONLY"})
    assert switched.status_code == 200, switched.text
    listed = {o["id"] for o in (await client.get("/api/v1/offers")).json()["items"]}
    assert offer.json()["id"] not in listed

    # A partial-owner price can only be bought by fans who already own part of the release.
    release_id, _track, owner2, _a = await _released(client, admin, label, "rc2-b@example.com", "Partial")
    ops_token = ops
    prop = await client.post(
        f"/api/v1/studio/releases/{release_id}/price-proposals",
        headers=bearer(owner2["access_token"]),
        json={"subject_type": "RELEASE", "subject_id": release_id, "amount_minor": 1000, "audience": "OWNS_PART_OF_RELEASE"},
    )
    assert prop.status_code == 422  # a single has no partial owners worth a separate price
    queue = (await client.get("/api/v1/offer-proposals", headers=bearer(ops_token))).json()
    pid = next(p["id"] for p in queue if p["release_id"] == release_id)
    assert (await client.post(f"/api/v1/offer-proposals/{pid}/decision", headers=bearer(ops_token), json={"decision": "accept"})).status_code == 200
    fan = await register_and_login(client, "rc2-fan@example.com")
    assert (await client.get("/api/v1/offer-proposals", headers=bearer(fan["access_token"]))).status_code in (403, 409)
