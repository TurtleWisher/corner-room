"""Changes to released music, reviewed by staff (owner, 2026-10-28, D-CHANGES-01): details,
credits and a replacement audio file are held in one change request and only go public once
someone other than the artist approves them."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase3_media import _drain_jobs, wav_bytes
from tests.test_audio_phase4_studio import _artist_for, _upload
from tests.test_audio_phase5_intake import _orgs, _staff_with
from tests.test_audio_phase6_review import _ready_single, _review


def _current(detail: dict, track_id: str) -> str:
    track = next(t for t in detail["tracks"] if t["id"] == track_id)
    return next(a["version_id"] for a in track["audio"] if a["is_current"])


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_changes_after_release_wait_for_staff(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    owner = await register_and_login(client, "changes-owner@example.com")
    token = owner["access_token"]
    artist_id = await _artist_for(owner["user"]["id"], label, name="Change Band")
    reviewer = await _staff_with(client, admin, "changes-reviewer@example.com", "content_manager", label)

    # A draft is edited directly, not through a change request.
    draft = (
        await client.post(
            "/api/v1/studio/releases", headers=bearer(token),
            json={"profile": {"kind": "artist", "id": artist_id}, "release_type": "SINGLE", "title": "Draft"},
        )
    ).json()["release"]["id"]
    assert (await client.post(f"/api/v1/studio/releases/{draft}/changes", headers=bearer(token))).status_code == 409

    release_id, track_id = await _ready_single(client, token, artist_id)
    for action in ("start_review", "approve", "release"):
        assert (await _review(client, reviewer, release_id, action)).status_code == 200
    detail = (await client.get(f"/api/v1/studio/releases/{release_id}", headers=bearer(token))).json()
    first_audio = _current(detail, track_id)
    assert detail["change_request"] is None

    # Editing released music: checked like a draft, held back from listeners.
    bad = await client.patch(f"/api/v1/studio/tracks/{track_id}/changes", headers=bearer(token), json={"isrc": "nope"})
    assert bad.status_code == 422
    rel = await client.patch(f"/api/v1/studio/releases/{release_id}/changes", headers=bearer(token), json={"title": "Review Me (Remastered)"})
    assert rel.status_code == 200, rel.text
    trk = await client.patch(f"/api/v1/studio/tracks/{track_id}/changes", headers=bearer(token), json={"title": "Song (2026 mix)"})
    assert trk.status_code == 200, trk.text
    credits = await client.put(
        f"/api/v1/studio/tracks/{track_id}/changes/credits", headers=bearer(token),
        json={"credits": [{"role_key": "songwriter", "display_name": "Rafi Ahmed"}]},
    )
    assert credits.status_code == 200, credits.text
    fields = {(d["scope"].split(":")[0], d["field"]) for d in credits.json()["diff"]}
    assert ("Release", "Title") in fields and ("Song 1", "Title") in fields and ("Song 1", "Credits") in fields
    assert (await client.get(f"/api/v1/tracks/{track_id}")).json()["title"] == "Song"
    assert (await client.get(f"/api/v1/releases/{release_id}")).json()["title"] == "Review Me"

    # A replacement audio file is processed but stays off the air.
    version_id = (await client.post(f"/api/v1/studio/tracks/{track_id}/versions", headers=bearer(token))).json()["version_id"]
    await _upload(client, token, "AUDIO_MASTER", "track_version", version_id, wav_bytes(seconds=1.5), "new-mix.wav")
    await _drain_jobs()
    detail = (await client.get(f"/api/v1/studio/releases/{release_id}", headers=bearer(token))).json()
    assert _current(detail, track_id) == first_audio
    request = detail["change_request"]
    assert request["status"] == "OPEN" and request["audio"][0]["version_id"] == version_id
    assert request["audio"][0]["status"] == "READY"

    sent = await client.post(f"/api/v1/studio/releases/{release_id}/changes/submit", headers=bearer(token))
    assert sent.status_code == 200 and sent.json()["status"] == "SUBMITTED"
    queue = (await client.get("/api/v1/catalog-intake/changes", headers=bearer(reviewer))).json()
    assert [q["release_id"] for q in queue] == [release_id] and queue[0]["profile_name"] == "Change Band"

    # The artist can't approve their own changes; staff send them back with a note.
    own = await client.post(f"/api/v1/catalog-intake/releases/{release_id}/changes/review", headers=bearer(token), json={"action": "approve"})
    assert own.status_code == 404
    no_note = await client.post(f"/api/v1/catalog-intake/releases/{release_id}/changes/review", headers=bearer(reviewer), json={"action": "reject"})
    assert no_note.status_code == 422
    rejected = await client.post(
        f"/api/v1/catalog-intake/releases/{release_id}/changes/review", headers=bearer(reviewer),
        json={"action": "reject", "note": "Keep the original song title."},
    )
    assert rejected.status_code == 200 and rejected.json()["status"] == "REJECTED"
    detail = (await client.get(f"/api/v1/studio/releases/{release_id}", headers=bearer(token))).json()
    assert detail["change_request"] is None and detail["last_change_decision"]["review_note"] == "Keep the original song title."
    assert _current(detail, track_id) == first_audio
    assert all(a["version_id"] != version_id for t in detail["tracks"] for a in t["audio"])  # dropped

    # Again: new title for the release, new credits and new audio; approved, all public at once.
    await client.patch(f"/api/v1/studio/releases/{release_id}/changes", headers=bearer(token), json={"title": "Review Me (Remastered)"})
    await client.put(
        f"/api/v1/studio/tracks/{track_id}/changes/credits", headers=bearer(token),
        json={"credits": [{"role_key": "songwriter", "display_name": "Rafi Ahmed"}]},
    )
    version_id = (await client.post(f"/api/v1/studio/tracks/{track_id}/versions", headers=bearer(token))).json()["version_id"]
    await _upload(client, token, "AUDIO_MASTER", "track_version", version_id, wav_bytes(seconds=1.5), "new-mix-2.wav")
    await _drain_jobs()
    assert (await client.post(f"/api/v1/studio/releases/{release_id}/changes/submit", headers=bearer(token))).status_code == 200
    approved = await client.post(
        f"/api/v1/catalog-intake/releases/{release_id}/changes/review", headers=bearer(reviewer), json={"action": "approve"}
    )
    assert approved.status_code == 200, approved.text
    assert (await client.get(f"/api/v1/releases/{release_id}")).json()["title"] == "Review Me (Remastered)"
    public_credits = (await client.get(f"/api/v1/tracks/{track_id}/credits")).json()["items"]
    assert [(c["role_key"], c["display_name"]) for c in public_credits] == [("songwriter", "Rafi Ahmed")]
    detail = (await client.get(f"/api/v1/studio/releases/{release_id}", headers=bearer(token))).json()
    assert _current(detail, track_id) == version_id and detail["last_change_decision"]["status"] == "APPROVED"

    # A request can be withdrawn; nothing changes.
    await client.patch(f"/api/v1/studio/tracks/{track_id}/changes", headers=bearer(token), json={"explicit": True})
    assert (await client.delete(f"/api/v1/studio/releases/{release_id}/changes", headers=bearer(token))).status_code == 204
    detail = (await client.get(f"/api/v1/studio/releases/{release_id}", headers=bearer(token))).json()
    assert detail["change_request"] is None and detail["tracks"][0]["explicit"] is False
