"""Audio Phase 6: review, publication and takedown (AUDIO_PHASE_1_DESIGN 5.4, A16, A17)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient

from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase3_media import _drain_jobs, wav_bytes
from tests.test_audio_phase4_studio import _artist_for, _png, _upload
from tests.test_audio_phase5_intake import _orgs, _staff_with


async def _ready_single(client: AsyncClient, owner_token: str, artist_id: str, *, editor: str | None = None) -> tuple[str, str]:
    """A complete single: details, one track with verified audio, cover, price. `editor` prepares it."""
    who = editor or owner_token
    detail = (
        await client.post("/api/v1/studio/releases", headers=bearer(who), json={"profile": {"kind": "artist", "id": artist_id}, "release_type": "SINGLE", "title": "Review Me"})
    ).json()
    release_id = detail["release"]["id"]
    await client.patch(
        f"/api/v1/studio/releases/{release_id}",
        headers=bearer(who),
        json={"language_code": "bn", "genre_primary": "adhunik", "p_line": "℗ 2026 A", "c_line": "© 2026 A"},
    )
    track_id = (await client.post(f"/api/v1/studio/releases/{release_id}/tracks", headers=bearer(who), json={"title": "Song"})).json()["tracks"][0]["id"]
    version_id = (await client.post(f"/api/v1/studio/tracks/{track_id}/versions", headers=bearer(who))).json()["version_id"]
    await _upload(client, who, "AUDIO_MASTER", "track_version", version_id, wav_bytes(seconds=1.0), "song.wav")
    await _upload(client, who, "COVER_ART", "release_cover", release_id, _png(), "cover.png")
    await client.post(f"/api/v1/studio/releases/{release_id}/price-proposals", headers=bearer(who), json={"subject_type": "RELEASE", "subject_id": release_id, "amount_minor": 3000})
    await _drain_jobs()
    submitted = await client.post(f"/api/v1/studio/releases/{release_id}/submit", headers=bearer(owner_token), json={"rights_declaration": True})
    assert submitted.status_code == 200, submitted.text
    return release_id, track_id


async def _review(client: AsyncClient, token: str, release_id: str, action: str, **extra) -> object:
    return await client.post(f"/api/v1/catalog-intake/releases/{release_id}/review", headers=bearer(token), json={"action": action, **extra})


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_review_two_person_rule_release_and_takedown(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    owner = await register_and_login(client, "review-owner@example.com")
    artist_id = await _artist_for(owner["user"]["id"], label, name="Reviewed")
    preparer = await _staff_with(client, admin, "review-preparer@example.com", "content_manager", label)
    reviewer = await _staff_with(client, admin, "review-reviewer@example.com", "content_manager", label)
    fan = await register_and_login(client, "review-fan@example.com")

    release_id, track_id = await _ready_single(client, owner["access_token"], artist_id, editor=preparer)

    # F4 / A16: the owner can't move their own track into review.
    own_review = await client.post(f"/api/v1/tracks/{track_id}/transition", headers=bearer(owner["access_token"]), json={"action": "start_review"})
    assert own_review.status_code in (403, 404)
    assert (await _review(client, owner["access_token"], release_id, "start_review")).status_code == 404

    # Nothing plays before release.
    early = await client.get(f"/api/v1/tracks/{track_id}/audio", headers=bearer(fan["access_token"]))
    assert early.status_code in (404, 409)

    started = await _review(client, reviewer, release_id, "start_review")
    assert started.status_code == 200, started.text
    # A17: the person who prepared it can't approve or publish it, on either route.
    blocked = await _review(client, preparer, release_id, "approve")
    assert blocked.status_code == 403 and blocked.json()["code"] == "SAME_PERSON_REVIEW"
    generic = await client.post(f"/api/v1/tracks/{track_id}/transition", headers=bearer(preparer), json={"action": "approve"})
    assert generic.status_code == 403 and generic.json()["code"] == "SAME_PERSON_REVIEW"

    no_note = await _review(client, reviewer, release_id, "request_changes")
    assert no_note.status_code == 422
    sent_back = await _review(client, reviewer, release_id, "request_changes", note="Please raise the cover to 3000 px.")
    assert sent_back.status_code == 200 and sent_back.json()["status"] == "IN_PRODUCTION"
    seen = (await client.get(f"/api/v1/studio/releases/{release_id}", headers=bearer(owner["access_token"]))).json()
    assert seen["tracks"][0]["status"] == "DRAFT"
    assert seen["history"][0]["action"] == "request_changes" and "3000 px" in seen["history"][0]["note"]
    assert "reviewer_id" not in seen["history"][0]

    resubmit = await client.post(f"/api/v1/studio/releases/{release_id}/submit", headers=bearer(owner["access_token"]), json={"rights_declaration": True})
    assert resubmit.status_code == 200
    assert (await _review(client, reviewer, release_id, "start_review")).status_code == 200
    approved = await _review(client, reviewer, release_id, "approve")
    assert approved.status_code == 200 and approved.json()["status"] == "APPROVED"
    past = await _review(client, reviewer, release_id, "schedule", release_at=(datetime.now(timezone.utc) - timedelta(days=1)).isoformat())
    assert past.status_code == 422
    released = await _review(client, reviewer, release_id, "release")
    assert released.status_code == 200 and released.json()["status"] == "RELEASED"

    public_release = await client.get(f"/api/v1/releases/{release_id}")
    assert public_release.status_code == 200
    public_track = await client.get(f"/api/v1/tracks/{track_id}")
    assert public_track.status_code == 200 and public_track.json()["status"] == "RELEASED"
    playable = await client.get(f"/api/v1/tracks/{track_id}/audio", headers=bearer(fan["access_token"]))
    assert playable.status_code != 409 or playable.json()["code"] != "TRACK_NOT_RELEASED"

    # Takedown needs music.takedown and stops public access and new delivery.
    down = await _review(client, reviewer, release_id, "takedown", note="Rights dispute")
    assert down.status_code == 200 and down.json()["status"] == "TAKEN_DOWN"
    assert (await client.get(f"/api/v1/tracks/{track_id}")).status_code == 404
    gone = await client.get(f"/api/v1/tracks/{track_id}/audio", headers=bearer(fan["access_token"]))
    assert gone.status_code in (404, 409)
    history = (await client.get(f"/api/v1/studio/releases/{release_id}", headers=bearer(owner["access_token"]))).json()["history"]
    assert [h["action"] for h in history][:3] == ["takedown", "release", "approve"]


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_reviewers_outside_the_org_see_nothing(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    label, platform = orgs["LABEL"], orgs["PLATFORM"]
    owner = await register_and_login(client, "review-iso-owner@example.com")
    artist_id = await _artist_for(owner["user"]["id"], label, name="Iso Reviewed")
    outsider = await _staff_with(client, admin, "review-outsider@example.com", "content_manager", platform)
    detail = (
        await client.post("/api/v1/studio/releases", headers=bearer(owner["access_token"]), json={"profile": {"kind": "artist", "id": artist_id}, "release_type": "SINGLE", "title": "x"})
    ).json()
    assert (await _review(client, outsider, detail["release"]["id"], "start_review")).status_code == 404
