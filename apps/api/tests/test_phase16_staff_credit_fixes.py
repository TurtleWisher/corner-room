"""Staff approve credit corrections they made themselves (owner, 2026-10-31, D-CHANGES-02).

Only changes that touch nothing but songs' credits; a change to details or audio still needs
someone else (two-person rule, D-AUDIO-09).
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase4_studio import _artist_for
from tests.test_audio_phase5_intake import _orgs, _staff_with
from tests.test_audio_phase6_review import _ready_single, _review


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_staff_approve_their_own_credit_fix_but_not_other_changes(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    owner = await register_and_login(client, "fix-owner@example.com")
    artist_id = await _artist_for(owner["user"]["id"], label, name="Fix Act")
    staff = await _staff_with(client, admin, "fix-staff@example.com", "content_manager", label)
    release_id, track_id = await _ready_single(client, owner["access_token"], artist_id)
    for action in ("start_review", "approve", "release"):
        assert (await _review(client, staff, release_id, action)).status_code == 200
    review_url = f"/api/v1/catalog-intake/releases/{release_id}/changes/review"

    # Staff correct the credits, send them, and approve them themselves.
    saved = await client.put(
        f"/api/v1/studio/tracks/{track_id}/changes/credits", headers=bearer(staff),
        json={"credits": [{"role_key": "custom", "display_name": "Aryan", "instrument": "Artwork"}]},
    )
    assert saved.status_code == 200, saved.text
    assert any(d["after"] == "Artwork: Aryan" for d in saved.json()["diff"])
    assert (await client.post(f"/api/v1/studio/releases/{release_id}/changes/submit", headers=bearer(staff))).status_code == 200
    approved = await client.post(review_url, headers=bearer(staff), json={"action": "approve"})
    assert approved.status_code == 200, approved.text
    credits = (await client.get(f"/api/v1/tracks/{track_id}/credits")).json()
    names = [c.get("display_name") for c in (credits["items"] if isinstance(credits, dict) else credits)]
    assert "Aryan" in names

    # A change to the song's details still needs someone else.
    titled = await client.patch(f"/api/v1/studio/tracks/{track_id}/changes", headers=bearer(staff), json={"title": "Song (fixed)"})
    assert titled.status_code == 200, titled.text
    assert (await client.post(f"/api/v1/studio/releases/{release_id}/changes/submit", headers=bearer(staff))).status_code == 200
    refused = await client.post(review_url, headers=bearer(staff), json={"action": "approve"})
    assert refused.status_code == 403 and refused.json()["code"] == "SAME_PERSON_REVIEW"


def test_only_credit_changes_count_as_credit_fixes() -> None:
    from cornerroom.modules.music.application.changes import credits_only

    assert credits_only({"tracks": {"t1": {"credits": []}}})
    assert credits_only({"tracks": {"t1": {"credits": [{"role_key": "producer"}]}, "t2": {"credits": []}}})
    assert not credits_only({})
    assert not credits_only({"release": {"title": "New"}, "tracks": {"t1": {"credits": []}}})
    assert not credits_only({"tracks": {"t1": {"credits": [], "fields": {"title": "New"}}}})
    assert not credits_only({"tracks": {"t1": {"credits": [], "audio_version_id": "v1"}}})
    assert not credits_only({"tracks": {"t1": {"fields": {"title": "New"}}}})
