"""Owner, 2026-10-28: plays before listen counting started (D-LISTEN-02), and new covers for
released music waiting for staff every time (D-COVER-01)."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase3_media import _drain_jobs
from tests.test_audio_phase4_studio import _artist_for, _png, _upload
from tests.test_audio_phase5_intake import _orgs, _staff_with
from tests.test_audio_phase6_review import _ready_single, _review


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_listens_before_counting_and_cover_changes_after_release(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    owner = await register_and_login(client, "cover-owner@example.com")
    token = owner["access_token"]
    artist_id = await _artist_for(owner["user"]["id"], label, name="Cover Band")
    reviewer = await _staff_with(client, admin, "cover-reviewer@example.com", "content_manager", label)
    release_id, track_id = await _ready_single(client, token, artist_id)
    for action in ("start_review", "approve", "release"):
        assert (await _review(client, reviewer, release_id, action)).status_code == 200
    first_cover = (await client.get(f"/api/v1/releases/{release_id}")).json().get("cover_asset_id")

    # Plays before counting: staff only, shown on top of counted listens, audited.
    assert (await client.get(f"/api/v1/tracks/{track_id}")).json()["listens"] == 0
    own = await client.put(f"/api/v1/tracks/{track_id}/listens-before-counting", headers=bearer(token), json={"count": 641})
    assert own.status_code == 404
    set_ = await client.put(
        f"/api/v1/tracks/{track_id}/listens-before-counting", headers=bearer(reviewer), json={"count": 641, "note": "Plays before launch"}
    )
    assert set_.status_code == 200, set_.text
    assert set_.json()["listens_before_counting"] == 641
    assert (await client.get(f"/api/v1/tracks/{track_id}")).json()["listens"] == 641
    catalog = {t["id"]: t for t in (await client.get("/api/v1/playback/catalog")).json()["items"]}
    assert catalog[track_id]["listens"] == 641
    bad = await client.put(f"/api/v1/tracks/{track_id}/listens-before-counting", headers=bearer(reviewer), json={"count": -1})
    assert bad.status_code == 422

    # A new cover after release waits; listeners keep the old one.
    await _upload(client, token, "COVER_ART", "release_cover", release_id, _png(1500), "new-cover.png")
    await _drain_jobs()
    detail = (await client.get(f"/api/v1/studio/releases/{release_id}", headers=bearer(token))).json()
    assert detail["cover_waiting"] is True and detail["pending_cover_url"]
    assert (await client.get(f"/api/v1/releases/{release_id}")).json().get("cover_asset_id") == first_cover
    queue = (await client.get("/api/v1/catalog-intake/covers", headers=bearer(reviewer))).json()
    assert [q["release_id"] for q in queue] == [release_id] and queue[0]["profile_name"] == "Cover Band"

    # The owner can't approve their own cover; staff send it back with a note, then approve a new one.
    own_review = await client.post(f"/api/v1/catalog-intake/releases/{release_id}/cover/review", headers=bearer(token), json={"action": "approve"})
    assert own_review.status_code == 404
    no_note = await client.post(f"/api/v1/catalog-intake/releases/{release_id}/cover/review", headers=bearer(reviewer), json={"action": "reject"})
    assert no_note.status_code == 422
    sent_back = await client.post(
        f"/api/v1/catalog-intake/releases/{release_id}/cover/review",
        headers=bearer(reviewer),
        json={"action": "reject", "note": "Please remove the small text in the corner."},
    )
    assert sent_back.status_code == 200, sent_back.text
    detail = (await client.get(f"/api/v1/studio/releases/{release_id}", headers=bearer(token))).json()
    assert detail["cover_waiting"] is False and "small text" in detail["cover_review_note"]

    await _upload(client, token, "COVER_ART", "release_cover", release_id, _png(1600), "fixed-cover.png")
    await _drain_jobs()
    approved = await client.post(f"/api/v1/catalog-intake/releases/{release_id}/cover/review", headers=bearer(reviewer), json={"action": "approve"})
    assert approved.status_code == 200, approved.text
    assert (await client.get(f"/api/v1/releases/{release_id}")).json().get("cover_asset_id") != first_cover
    assert (await client.get("/api/v1/catalog-intake/covers", headers=bearer(reviewer))).json() == []

    # A waiting cover can be withdrawn.
    await _upload(client, token, "COVER_ART", "release_cover", release_id, _png(1700), "third.png")
    await _drain_jobs()
    assert (await client.delete(f"/api/v1/studio/releases/{release_id}/cover/pending", headers=bearer(token))).status_code == 204
    assert (await client.get(f"/api/v1/studio/releases/{release_id}", headers=bearer(token))).json()["cover_waiting"] is False
