"""Song lyrics (owner, 2026-10-27, D-LYRICS-01): the artist adds them with the song's details, staff
review them, and listeners see them only once the song is released. A change after release waits
for someone other than the artist."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from cornerroom.modules.music.application.lyrics import clean_lyrics
from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase4_studio import _artist_for
from tests.test_audio_phase5_intake import _orgs, _staff_with
from tests.test_audio_phase6_review import _ready_single, _review


def test_lyrics_are_tidied_into_plain_lines() -> None:
    assert clean_lyrics(None) is None
    assert clean_lyrics(" \r\n \n") is None
    assert clean_lyrics("Chaya pore  \r\nmone pore\r\n\r\n\r\n\r\nVerse two\x07") == "Chaya pore\nmone pore\n\nVerse two"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_lyrics_reviewed_with_the_release_and_changes_after_release(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    owner = await register_and_login(client, "lyrics-owner@example.com")
    token = owner["access_token"]
    artist_id = await _artist_for(owner["user"]["id"], label, name="Lyric Writer")
    reviewer = await _staff_with(client, admin, "lyrics-reviewer@example.com", "content_manager", label)

    # Drafting: saved straight onto the song; nobody outside sees them yet.
    detail = (
        await client.post(
            "/api/v1/studio/releases", headers=bearer(token),
            json={"profile": {"kind": "artist", "id": artist_id}, "release_type": "SINGLE", "title": "Draft"},
        )
    ).json()
    draft_track = (
        await client.post(f"/api/v1/studio/releases/{detail['release']['id']}/tracks", headers=bearer(token), json={"title": "Draft song"})
    ).json()["tracks"][0]["id"]
    saved = await client.put(f"/api/v1/studio/tracks/{draft_track}/lyrics", headers=bearer(token), json={"lyrics": "Line one\nLine two"})
    assert saved.status_code == 200, saved.text
    assert saved.json()["lyrics"] == "Line one\nLine two" and saved.json()["lyrics_waiting"] is False
    assert (await client.get(f"/api/v1/tracks/{draft_track}")).status_code == 404

    # A released single: lyrics typed before submitting go through the release review.
    release_id, track_id = await _ready_single(client, token, artist_id)
    too_late = await client.put(f"/api/v1/studio/tracks/{track_id}/lyrics", headers=bearer(token), json={"lyrics": "In review"})
    assert too_late.status_code == 409
    assert (await _review(client, reviewer, release_id, "start_review")).status_code == 200
    assert (await _review(client, reviewer, release_id, "approve")).status_code == 200
    assert (await _review(client, reviewer, release_id, "release")).status_code == 200
    public = (await client.get(f"/api/v1/tracks/{track_id}")).json()
    assert public["lyrics"] is None

    # After release: the change waits, listeners still see the old lyrics (none here).
    waiting = await client.put(f"/api/v1/studio/tracks/{track_id}/lyrics", headers=bearer(token), json={"lyrics": "Out now\nSing along"})
    assert waiting.status_code == 200, waiting.text
    assert waiting.json()["lyrics_waiting"] is True and waiting.json()["lyrics_pending"] == "Out now\nSing along"
    assert (await client.get(f"/api/v1/tracks/{track_id}")).json()["lyrics"] is None

    # Staff see it in their queue; the artist can't approve their own lyrics.
    queue = (await client.get("/api/v1/catalog-intake/lyrics", headers=bearer(reviewer))).json()
    assert [q["track_id"] for q in queue] == [track_id]
    assert queue[0]["profile_name"] == "Lyric Writer"
    own = await client.post(f"/api/v1/catalog-intake/tracks/{track_id}/lyrics/review", headers=bearer(token), json={"action": "approve"})
    assert own.status_code == 404
    fan = (await register_and_login(client, "lyrics-fan@example.com"))["access_token"]
    assert (await client.get("/api/v1/catalog-intake/lyrics", headers=bearer(fan))).status_code in (403, 409)

    # Rejected with a note the artist sees; then resubmitted and approved.
    no_note = await client.post(f"/api/v1/catalog-intake/tracks/{track_id}/lyrics/review", headers=bearer(reviewer), json={"action": "reject"})
    assert no_note.status_code == 422
    rejected = await client.post(
        f"/api/v1/catalog-intake/tracks/{track_id}/lyrics/review", headers=bearer(reviewer),
        json={"action": "reject", "note": "Please fix the spelling in line 2."},
    )
    assert rejected.status_code == 200, rejected.text
    seen = (await client.get(f"/api/v1/studio/releases/{release_id}", headers=bearer(token))).json()["tracks"][0]
    assert seen["lyrics_waiting"] is False and "spelling" in seen["lyrics_review_note"]
    await client.put(f"/api/v1/studio/tracks/{track_id}/lyrics", headers=bearer(token), json={"lyrics": "Out now\nSing along, fixed"})
    approved = await client.post(f"/api/v1/catalog-intake/tracks/{track_id}/lyrics/review", headers=bearer(reviewer), json={"action": "approve"})
    assert approved.status_code == 200, approved.text
    assert (await client.get(f"/api/v1/tracks/{track_id}")).json()["lyrics"] == "Out now\nSing along, fixed"
    assert (await client.get("/api/v1/catalog-intake/lyrics", headers=bearer(reviewer))).json() == []

    # Withdrawing a waiting change leaves the public lyrics alone.
    await client.put(f"/api/v1/studio/tracks/{track_id}/lyrics", headers=bearer(token), json={"lyrics": None})
    withdrawn = await client.delete(f"/api/v1/studio/tracks/{track_id}/lyrics/pending", headers=bearer(token))
    assert withdrawn.status_code == 200 and withdrawn.json()["lyrics_waiting"] is False
    assert (await client.get(f"/api/v1/tracks/{track_id}")).json()["lyrics"] == "Out now\nSing along, fixed"
