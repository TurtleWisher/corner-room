"""Lyric timings (owner, 2026-11-01, D-LYRICS-03): staff tap along to a released song once per sung
line; listeners get the start times with the lyrics, and the times are dropped when the number of
lines changes."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from cornerroom.infra.errors import AppError
from cornerroom.modules.music.application.lyrics import clean_ends, clean_timings, ends_for, sung_lines, timings_for
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



def test_every_line_ends_after_it_starts_and_before_the_next() -> None:
    """D-LYRICS-05: one end per line, after its start, never after the next line's start."""
    lyrics = "One\ntwo\n\nThree"
    assert clean_ends([900, 2000, 5000], [0, 1500, 3000]) == [900, 2000, 5000]
    # Back to back is fine: a line may end the moment the next starts.
    assert clean_ends([1500, 3000, 3100], [0, 1500, 3000]) == [1500, 3000, 3100]
    for bad in ([900, 2000], [0, 2000, 5000], [1600, 2000, 5000], [900, 1500, 5000]):
        with pytest.raises(AppError):
            clean_ends(bad, [0, 1500, 3000])
    assert ends_for(lyrics, [0, 1500, 3000], [900, 2000, 5000]) == [900, 2000, 5000]
    # Ends that no longer fit their starts (or starts that no longer fit the words) are not used.
    assert ends_for(lyrics, [0, 1500, 3000], [900, 2000]) is None
    assert ends_for(lyrics, [0, 1500, 3000], [1600, 2000, 5000]) is None
    assert ends_for("One\ntwo", [0, 1500, 3000], [900, 2000, 5000]) is None
    assert ends_for(lyrics, [0, 1500, 3000], None) is None

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
    # D-VERSION-01: the single-track read carries the song's version (none set here).
    assert "version_title" in public and public["version_title"] is None

    # A spelling fix keeps them; a new line count drops them.
    await _review_lyrics(client, token, reviewer, track_id, "First line\nSecond line, fixed\n\nThird line")
    assert (await client.get(f"/api/v1/tracks/{track_id}")).json()["lyrics_timings_ms"] == [12000, 15500, 21000]
    await _review_lyrics(client, token, reviewer, track_id, "First line\nSecond line\n\nThird line\nFourth line")
    assert (await client.get(f"/api/v1/tracks/{track_id}")).json()["lyrics_timings_ms"] is None

    # D-LYRICS-05: each line's end goes with the starts; ends that don't fit are refused.
    four = [1000, 2000, 3000, 4000]
    bad_ends = await client.put(url, headers=bearer(reviewer), json={"times_ms": four, "ends_ms": [1500, 2500, 3500]})
    assert bad_ends.status_code == 422
    ended = await client.put(url, headers=bearer(reviewer), json={"times_ms": four, "ends_ms": [1800, 2600, 4000, 6000]})
    assert ended.status_code == 200, ended.text
    assert ended.json()["lyrics_line_ends_ms"] == [1800, 2600, 4000, 6000]
    public = (await client.get(f"/api/v1/tracks/{track_id}")).json()
    assert public["lyrics_timings_ms"] == four and public["lyrics_line_ends_ms"] == [1800, 2600, 4000, 6000]
    # New starts without ends drop the old ends; a new line count drops both.
    starts_only = (await client.put(url, headers=bearer(reviewer), json={"times_ms": [1100, 2000, 3000, 4000]})).json()
    assert starts_only["lyrics_line_ends_ms"] is None
    await client.put(url, headers=bearer(reviewer), json={"times_ms": four, "ends_ms": [1800, 2600, 4000, 6000]})
    await _review_lyrics(client, token, reviewer, track_id, "First line\nSecond line\n\nThird line")
    dropped = (await client.get(f"/api/v1/tracks/{track_id}")).json()
    assert dropped["lyrics_timings_ms"] is None and dropped["lyrics_line_ends_ms"] is None
    await _review_lyrics(client, token, reviewer, track_id, "First line\nSecond line\n\nThird line\nFourth line")

    # Removing them goes back to pacing.
    await client.put(url, headers=bearer(reviewer), json={"times_ms": [0, 1, 2, 3]})
    cleared = await client.put(url, headers=bearer(reviewer), json={"times_ms": None})
    assert cleared.status_code == 200 and cleared.json()["lyrics_timings_ms"] is None


def _second_review_off(monkeypatch: pytest.MonkeyPatch) -> None:
    from cornerroom.infra.settings import get_settings

    monkeypatch.setenv("STAFF_SECOND_REVIEW", "false")
    get_settings.cache_clear()


async def _released_with_lyrics(client: AsyncClient, token: str, reviewer: str, artist_id: str, text: str) -> str:
    release_id, track_id = await _ready_single(client, token, artist_id)
    for action in ("start_review", "approve", "release"):
        assert (await _review(client, reviewer, release_id, action)).status_code == 200
    await _review_lyrics(client, token, reviewer, track_id, text)
    return track_id


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_staff_find_a_song_and_fix_its_words_while_timing(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """D-LYRICS-04: staff search released songs by title or act, and fix the words on the sync
    page; the song's own lyrics change, so the song page and Studio show the fix."""
    _second_review_off(monkeypatch)
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    owner = await register_and_login(client, "sync-owner@example.com")
    token = owner["access_token"]
    artist_id = await _artist_for(owner["user"]["id"], label, name="Searchable Singer")
    reviewer = await _staff_with(client, admin, "sync-reviewer@example.com", "content_manager", label)
    track_id = await _released_with_lyrics(client, token, reviewer, artist_id, "Line one\nLine two\n\nLine three")

    # Found by the act's name and by part of the title; the artist can't search.
    songs = "/api/v1/catalog-intake/lyrics/songs"
    by_act = (await client.get(songs, headers=bearer(reviewer), params={"q": "searchable"})).json()
    assert [s["track_id"] for s in by_act] == [track_id]
    assert by_act[0]["profile_name"] == "Searchable Singer" and by_act[0]["lines"] == 3 and not by_act[0]["timed"]
    # Words may mix the act and the title, in any order.
    mixed = (await client.get(songs, headers=bearer(reviewer), params={"q": "singer searchable"})).json()
    assert [s["track_id"] for s in mixed] == [track_id]
    assert (await client.get(songs, headers=bearer(reviewer), params={"q": "no such 100%"})).json() == []
    assert (await client.get(songs, headers=bearer(token))).status_code == 404

    url = f"/api/v1/catalog-intake/tracks/{track_id}/lyrics"
    read = (await client.get(url, headers=bearer(reviewer))).json()
    assert read["lyrics"] == "Line one\nLine two\n\nLine three" and read["approves_at_once"] is True
    assert (await client.get(url, headers=bearer(token))).status_code == 404
    assert (await client.put(url, headers=bearer(token), json={"lyrics": "x"})).status_code == 404

    # New words and their times in one save: live at once for staff outside the act.
    saved = await client.put(
        url, headers=bearer(reviewer),
        json={"lyrics": "Line one\r\nLine two, fixed   \n\n\n\nLine three\nLine four", "times_ms": [1000, 2000, 3000, 4000]},
    )
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["lyrics"] == "Line one\nLine two, fixed\n\nLine three\nLine four"
    assert body["lyrics_timings_ms"] == [1000, 2000, 3000, 4000] and not body["lyrics_waiting"]
    assert body["lyrics_line_ends_ms"] is None

    # D-LYRICS-05: the sync page saves each line's end with its start; a spacing fix keeps both.
    ends = [1800, 2900, 3900, 6500]
    with_ends = await client.put(
        url, headers=bearer(reviewer),
        json={"lyrics": body["lyrics"], "times_ms": [1000, 2000, 3000, 4000], "ends_ms": ends},
    )
    assert with_ends.status_code == 200, with_ends.text
    assert with_ends.json()["lyrics_line_ends_ms"] == ends
    listed = (await client.get(songs, headers=bearer(reviewer), params={"q": "searchable"})).json()
    assert listed[0]["timed"] and listed[0]["line_ends"]
    wrong = {"lyrics": body["lyrics"], "times_ms": [1000, 2000, 3000, 4000], "ends_ms": [900, 2900, 3900, 6500]}
    assert (await client.put(url, headers=bearer(reviewer), json=wrong)).status_code == 422
    public = (await client.get(f"/api/v1/tracks/{track_id}")).json()
    assert public["lyrics"] == body["lyrics"] and public["lyrics_timings_ms"] == [1000, 2000, 3000, 4000]

    # A spacing-only fix keeps the times; times that don't fit the new words are refused.
    spaced = (await client.put(url, headers=bearer(reviewer), json={"lyrics": "Line one\nLine two, fixed\nLine three\n\nLine four"})).json()
    assert spaced["lyrics_timings_ms"] == [1000, 2000, 3000, 4000] and spaced["lyrics_line_ends_ms"] == ends
    assert (await client.put(url, headers=bearer(reviewer), json={"lyrics": "Only one", "times_ms": [0, 1]})).status_code == 422

    # An artist's change waiting is reviewed first, never silently replaced.
    await client.put(f"/api/v1/studio/tracks/{track_id}/lyrics", headers=bearer(token), json={"lyrics": "Artist words"})
    blocked = await client.put(url, headers=bearer(reviewer), json={"lyrics": "Staff words"})
    assert blocked.status_code == 409 and blocked.json()["code"] == "LYRICS_WAITING"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_staff_on_the_acts_team_wait_for_their_words(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """D-REVIEW-ARTIST-01: a staff member who runs the act waits like any artist, then approves the
    change from the staff side; the times are kept only once the words are live."""
    _second_review_off(monkeypatch)
    from tests.test_phase16_solo_review import _staff_artist

    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    token, artist_id = await _staff_artist(client, admin, "sync-staff-artist@example.com", label, "Staff Band Singer")
    reviewer = await _staff_with(client, admin, "sync-other-reviewer@example.com", "content_manager", label)
    track_id = await _released_with_lyrics(client, token, reviewer, artist_id, "A\nB")

    url = f"/api/v1/catalog-intake/tracks/{track_id}/lyrics"
    assert (await client.get(url, headers=bearer(token))).json()["approves_at_once"] is False
    waiting = (await client.put(url, headers=bearer(token), json={"lyrics": "A\nB, fixed", "times_ms": [0, 900]})).json()
    assert waiting["lyrics"] == "A\nB" and waiting["lyrics_waiting"] and waiting["waiting_from_me"]
    assert waiting["lyrics_pending"] == "A\nB, fixed" and waiting["lyrics_timings_ms"] is None
    # Their own waiting change can be replaced by them.
    again = (await client.put(url, headers=bearer(token), json={"lyrics": "A\nB, fixed again"})).json()
    assert again["lyrics_pending"] == "A\nB, fixed again"

    approved = await client.post(
        f"/api/v1/catalog-intake/tracks/{track_id}/lyrics/review", headers=bearer(token), json={"action": "approve"}
    )
    assert approved.status_code == 200, approved.text
    assert (await client.get(f"/api/v1/tracks/{track_id}")).json()["lyrics"] == "A\nB, fixed again"
