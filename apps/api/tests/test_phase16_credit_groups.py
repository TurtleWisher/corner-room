"""Musicians fold under the act they played in, and profiles list songs they are credited on
(owner, 2026-10-31, D-CREDITS-05 and D-CREDITS-06).
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase4_studio import _artist_for
from tests.test_audio_phase5_intake import _orgs, _staff_with
from tests.test_audio_phase6_review import _ready_single, _review


async def _released_with_credits(client: AsyncClient, staff: str, token: str, artist_id: str, credits: list[dict]) -> str:
    release_id, track_id = await _ready_single(client, token, artist_id)
    for action in ("start_review", "approve", "release"):
        assert (await _review(client, staff, release_id, action)).status_code == 200, action
    saved = await client.put(f"/api/v1/studio/tracks/{track_id}/changes/credits", headers=bearer(token), json={"credits": credits})
    assert saved.status_code == 200, saved.text
    assert (await client.post(f"/api/v1/studio/releases/{release_id}/changes/submit", headers=bearer(token))).status_code == 200
    approved = await client.post(f"/api/v1/catalog-intake/releases/{release_id}/changes/review", headers=bearer(staff), json={"action": "approve"})
    assert approved.status_code == 200, approved.text
    return track_id


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_musicians_fold_under_their_act_and_profiles_list_credited_songs(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    owner = await register_and_login(client, "group-owner@example.com")
    token = owner["access_token"]
    band_id = await _artist_for(owner["user"]["id"], label, name="Group Act")
    other = await register_and_login(client, "group-mixer@example.com")
    mixer_id = await _artist_for(other["user"]["id"], label, name="Mix Hall")
    staff = await _staff_with(client, admin, "group-staff@example.com", "content_manager", label)

    act = {"role_key": "songwriter", "artist_id": band_id}
    credits = [
        act,
        {"role_key": "musician", "display_name": "Rafi", "instrument": "Guitars", "part_of_artist_id": band_id},
        {"role_key": "mixing_engineer", "artist_id": mixer_id},
        {"role_key": "custom", "display_name": "mix  hall", "instrument": "Artwork"},
        {"role_key": "musician", "display_name": "Guest", "instrument": "Flute"},
    ]
    track_id = await _released_with_credits(client, staff, token, band_id, credits)

    public = (await client.get(f"/api/v1/tracks/{track_id}/credits")).json()
    rows = public["items"] if isinstance(public, dict) else public
    rafi = next(c for c in rows if c.get("display_name") == "Rafi")
    assert rafi["part_of_artist_id"] == band_id and rafi["part_of_name"] is None
    assert next(c for c in rows if c.get("display_name") == "Guest")["part_of_artist_id"] is None

    # Only a musician can be part of an act, and the act must be credited on the song.
    url = f"/api/v1/studio/tracks/{track_id}/changes/credits"
    wrong = await client.put(url, headers=bearer(token), json={"credits": [act, {"role_key": "producer", "display_name": "X", "part_of_artist_id": band_id}]})
    assert wrong.status_code == 422
    missing = await client.put(url, headers=bearer(token), json={"credits": [act, {"role_key": "musician", "display_name": "Y", "instrument": "Bass", "part_of_name": "Nobody"}]})
    assert missing.status_code == 422
    typed = await client.put(
        url, headers=bearer(token),
        json={"credits": [{"role_key": "songwriter", "display_name": "The Typed Band"}, {"role_key": "musician", "display_name": "Z", "instrument": "Bass", "part_of_name": "the typed band"}]},
    )
    assert typed.status_code == 200, typed.text
    assert "Bass: Z (with The Typed Band)" in [d["after"] for d in typed.json()["diff"]][0]

    # Credited on: the mixer's profile lists the song once, with both things they did (linked
    # and by the same name typed); the band's own release is not "credited on" for the band.
    listed = (await client.get(f"/api/v1/artists/{mixer_id}/credited-on")).json()
    assert [s["track_id"] for s in listed] == [track_id]
    assert listed[0]["roles"] == ["Mixing engineer", "Artwork"]
    assert listed[0]["by_name"] == "Group Act" and listed[0]["by_id"] == band_id
    assert (await client.get(f"/api/v1/artists/{band_id}/credited-on")).json() == []
    assert (await client.get("/api/v1/artists/00000000-0000-0000-0000-000000000000/credited-on")).status_code == 404


def test_role_words_read_like_the_song_page() -> None:
    from cornerroom.modules.music.application.credited_on import role_words

    labels = {"producer": "Producer"}
    assert role_words("producer", None, labels) == "Producer"
    assert role_words("custom", "Mixing & Mastering", labels) == "Mixing & Mastering"
    assert role_words("musician", "Guitars", labels) == "Guitars"
    assert role_words("musician", None, labels) == "Musician"
