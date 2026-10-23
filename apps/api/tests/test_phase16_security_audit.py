"""Security audit 2026-10-23: fixes found by the role-by-endpoint sweep.

- A label sells and gives away only its own music: another label's finance staff could create
  products for (and grant free access to) any label's songs and releases.
- Simple uploads (`/uploads/sessions`) are for media staff in their workspace, not any account.
- Playback availability no longer hands out the stored file's id.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase5_intake import _orgs, _staff_with
from tests.test_audio_phase7_release_commerce import _released
from tests.test_phase05_ticketing import _workspace


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase16_another_label_cannot_sell_or_give_away_this_labels_music(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    release_id, track_id, _owner, _artist = await _released(client, admin, label, "sa-owner@example.com", "SA Act")

    platform = await _workspace(client, admin, orgs["PLATFORM"])
    other = await client.post("/api/v1/organizations", headers=bearer(platform), json={"name": "SA Other Label", "type": "LABEL"})
    assert other.status_code == 201, other.text
    live = await client.post(
        f"/api/v1/organizations/{other.json()['id']}/lifecycle",
        headers=bearer(platform),
        json={"action": "activate", "version": other.json().get("version")},
    )
    assert live.status_code == 200, live.text
    outsider = await _staff_with(client, admin, "sa-other-fin@example.com", "finance_manager", other.json()["id"])
    fan = (await register_and_login(client, "sa-fan@example.com"))["user"]["id"]

    for product_type, subject in (("TRACK", track_id), ("RELEASE", release_id)):
        made = await client.post(
            "/api/v1/products",
            headers=bearer(outsider),
            json={"product_type": product_type, "subject_id": subject, "name": "Resale"},
        )
        assert made.status_code == 404, made.text
    for scope, ref in (("TRACK", track_id), ("RELEASE", release_id)):
        grant = await client.post(
            "/api/v1/entitlements/grants",
            headers=bearer(outsider),
            json={"user_id": fan, "entitlement_type": "ADMIN_GRANT", "ref_id": ref, "scope": scope},
        )
        assert grant.status_code == 404, grant.text

    # The label's own finance staff still give their own music away.
    own = await _staff_with(client, admin, "sa-label-fin@example.com", "finance_manager", label)
    gift = await client.post(
        "/api/v1/entitlements/grants",
        headers=bearer(own),
        json={"user_id": fan, "entitlement_type": "PROMOTIONAL_GRANT", "ref_id": track_id, "scope": "TRACK"},
    )
    assert gift.status_code == 201, gift.text


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase16_simple_uploads_are_for_media_staff_only(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    fan = (await register_and_login(client, "sa-uploader@example.com"))["access_token"]
    body = {"storage_class": "public_media", "filename": "x.png", "mime": "image/png"}
    assert (await client.post("/api/v1/uploads/sessions", headers=bearer(fan), json=body)).status_code == 409  # no workspace
    finance = await _staff_with(client, admin, "sa-fin-upload@example.com", "finance_manager", orgs["LABEL"])
    assert (await client.post("/api/v1/uploads/sessions", headers=bearer(finance), json=body)).status_code == 403
    marketer = await _staff_with(client, admin, "sa-marketer@example.com", "marketing_manager", orgs["LABEL"])
    assert (await client.post("/api/v1/uploads/sessions", headers=bearer(marketer), json=body)).status_code == 201


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase16_availability_hides_the_stored_file_id(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    _release_id, track_id, _owner, _artist = await _released(client, admin, orgs["LABEL"], "sa-avail@example.com", "SA Avail")
    fan = (await register_and_login(client, "sa-listener@example.com"))["access_token"]
    seen = await client.get(f"/api/v1/playback/tracks/{track_id}/availability", headers=bearer(fan))
    assert seen.status_code == 200, seen.text
    assert seen.json()["media_asset_id"] is None
