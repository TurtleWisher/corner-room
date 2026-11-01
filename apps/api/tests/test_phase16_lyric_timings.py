"""Lyric timings (owner, 2026-11-01, D-LYRICS-03): staff tap along to a released song once per sung
line; listeners get the start times with the lyrics, and the times are dropped when the number of
lines changes."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from cornerroom.infra.errors import AppError
from cornerroom.modules.music.application.lyrics import clean_timings, sung_lines, timings_for
from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase4_studio import _artist_for
from tests.test_audio_phase5_intake import _orgs, _staff_with
from tests.test_audio_phase6_review import _ready_single, _review


def test_one_time_per_sung_line_never_going_back() -> None:
    lyrics = "One\ntwo\n\nThree"
    assert sung_lines(lyrics) == ["One", "two", "Three"]
    assert clean_timings([0, 1500, 1500], lyrics) == [0, 1500, 1500]
    for bad in ([0, 1000], [0, 2000, 1000], [-1, 0, 1]):
        with pytest.raises(AppError):
            clean_timings(bad, lyrics)
    with pytest.raises(AppError):
        clean_timings([], None)
    assert timings_for(lyrics, [0, 1, 2]) == [0, 1, 2]
    assert timings_for("One\ntwo", [0, 1, 2]) is None
    assert timings_for(lyrics, None) is None


async def _review_lyrics(client: AsyncClient, token: str, reviewer: str, track_id: str, text: str) -> None:
    await client.put(f"/api/v1/studio/tracks/{track_id}/lyrics", headers=bearer(token), json={"lyrics": text})
    approved = await client.post(
        f"/api/v1/catalog-intake/tracks/{track_id}/lyrics/review", headers=bearer(reviewer), json={"action": "approve"}
    )
    assert approved.status_code == 200, approved.text


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_staff_time_a_released_songs_lyrics(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    owner = await register_and_login(client, "timings-owner@example.com")
    token = owner["access_token"]
    artist_id = await _artist_for(owner["user"]["id"], label, name="Timed Singer")
    reviewer = await _staff_with(client, admin, "timings-reviewer@example.com", "content_manager", label)

    release_id, track_id = await _ready_single(client, token, artist_id)
    url = f"/api/v1/catalog-intake/tracks/{track_id}/lyrics/timings"
    # Not out yet: nothing to time.
    assert (await client.put(url, headers=bearer(reviewer), json={"times_ms": [0]})).status_code == 409
    for action in ("start_review", "approve", "release"):
        assert (await _review(client, reviewer, release_id, action)).status_code == 200
    await _review_lyrics(client, token, reviewer, track_id, "First line\nSecond line\n\nThird line")

    # The artist and fans can't set them; a wrong count or order is refused.
    assert (await client.put(url, headers=bearer(token), json={"times_ms": [0, 1, 2]})).status_code == 404
    assert (await client.put(url, headers=bearer(reviewer), json={"times_ms": [0, 1000]})).status_code == 422
    assert (await client.put(url, headers=bearer(reviewer), json={"times_ms": [0, 3000, 2000]})).status_code == 422

    saved = await client.put(url, headers=bearer(reviewer), json={"times_ms": [12000, 15500, 21000]})
    assert saved.status_code == 200, saved.text
    assert saved.json()["lyrics_timings_ms"] == [12000, 15500, 21000]
    public = (await client.get(f"/api/v1/tracks/{track_id}")).json()
    assert public["lyrics_timings_ms"] == [12000, 15500, 21000]

    # A spelling fix keeps them; a new line count drops them.
    await _review_lyrics(client, token, reviewer, track_id, "First line\nSecond line, fixed\n\nThird line")
    assert (await client.get(f"/api/v1/tracks/{track_id}")).json()["lyrics_timings_ms"] == [12000, 15500, 21000]
    await _review_lyrics(client, token, reviewer, track_id, "First line\nSecond line\n\nThird line\nFourth line")
    assert (await client.get(f"/api/v1/tracks/{track_id}")).json()["lyrics_timings_ms"] is None

    # Removing them goes back to pacing.
    await client.put(url, headers=bearer(reviewer), json={"times_ms": [0, 1, 2, 3]})
    cleared = await client.put(url, headers=bearer(reviewer), json={"times_ms": None})
    assert cleared.status_code == 200 and cleared.json()["lyrics_timings_ms"] is None
