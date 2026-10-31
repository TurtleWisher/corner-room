"""Artists put a song's credits in order by dragging; the new order goes live with no staff review
(owner, 2026-10-31, D-CREDITS-04). Any other credit change still waits in the change request.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase4_studio import _artist_for
from tests.test_audio_phase5_intake import _orgs, _staff_with
from tests.test_audio_phase6_review import _ready_single, _review

WRITER = {"role_key": "songwriter", "display_name": "Mitul"}
ART = {"role_key": "custom", "display_name": "Aryan", "instrument": "Artwork"}
GUITAR = {"role_key": "musician", "display_name": "Rafi", "instrument": "Guitars"}


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_new_credit_order_goes_live_without_review(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    owner = await register_and_login(client, "order-owner@example.com")
    token = owner["access_token"]
    artist_id = await _artist_for(owner["user"]["id"], label, name="Order Act")
    staff = await _staff_with(client, admin, "order-staff@example.com", "content_manager", label)
    stranger = await register_and_login(client, "order-stranger@example.com")
    release_id, track_id = await _ready_single(client, token, artist_id)
    for action in ("start_review", "approve", "release"):
        assert (await _review(client, staff, release_id, action)).status_code == 200, action
    # The first credits arrive through a reviewed change, as on any song that is out.
    saved = await client.put(f"/api/v1/studio/tracks/{track_id}/changes/credits", headers=bearer(token), json={"credits": [WRITER, ART, GUITAR]})
    assert saved.status_code == 200, saved.text
    assert (await client.post(f"/api/v1/studio/releases/{release_id}/changes/submit", headers=bearer(token))).status_code == 200
    approved = await client.post(f"/api/v1/catalog-intake/releases/{release_id}/changes/review", headers=bearer(staff), json={"action": "approve"})
    assert approved.status_code == 200, approved.text
    order_url = f"/api/v1/studio/tracks/{track_id}/credits/order"

    async def public_names() -> list[str]:
        body = (await client.get(f"/api/v1/tracks/{track_id}/credits")).json()
        return [c.get("display_name") for c in (body["items"] if isinstance(body, dict) else body)]

    assert await public_names() == ["Mitul", "Aryan", "Rafi"]

    # The artist drags the guitarist to the top: live straight away, nothing waits for staff.
    moved = await client.put(order_url, headers=bearer(token), json={"credits": [GUITAR, WRITER, ART]})
    assert moved.status_code == 200, moved.text
    assert [c["display_name"] for c in moved.json()["credits"]] == ["Rafi", "Mitul", "Aryan"]
    assert await public_names() == ["Rafi", "Mitul", "Aryan"]
    detail = (await client.get(f"/api/v1/studio/releases/{release_id}", headers=bearer(token))).json()
    assert detail.get("change_request") is None

    # Anything more than the order is refused here and goes through review instead.
    renamed = await client.put(order_url, headers=bearer(token), json={"credits": [GUITAR, WRITER, {**ART, "display_name": "Someone"}]})
    assert renamed.status_code == 409 and renamed.json()["code"] == "NOT_ONLY_ORDER"
    dropped = await client.put(order_url, headers=bearer(token), json={"credits": [GUITAR, WRITER]})
    assert dropped.status_code == 409
    assert await public_names() == ["Rafi", "Mitul", "Aryan"]

    # Someone with no part in the music can't touch it.
    assert (await client.put(order_url, headers=bearer(stranger["access_token"]), json={"credits": [WRITER, ART, GUITAR]})).status_code == 404


def test_only_a_new_order_of_the_same_credits_counts() -> None:
    from cornerroom.modules.music.application.changes import same_credits_new_order

    a, b = {"role_key": "producer", "display_name": "A"}, {"role_key": "lyricist", "display_name": "B"}
    assert same_credits_new_order([b, a], [a, b])
    assert not same_credits_new_order([a, b], [a, b])
    assert not same_credits_new_order([a], [a, b])
    assert not same_credits_new_order([a, a], [a, b])
    assert same_credits_new_order([b, a, a], [a, b, a])
