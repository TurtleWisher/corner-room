"""Owner, 2026-10-30.

- The Tracks list said "Not on sale yet" for every song sold as part of a release: song lists did
  not say which releases a song is on (only single-song reads did). Lists carry `release_ids` now.
- Credits (D-CREDITS-02): a Musician credit says who played what on one song (a typed name, no
  artist page needed) and an "Other" credit is a role the artist names themselves.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.test_audio_phase5_intake import _orgs
from tests.test_audio_phase7_release_commerce import _released


def test_change_lists_word_credits_like_the_song_page() -> None:
    """Owner, 2026-10-31: a change waiting for review said "Custom: MIZULS (Songwriter & Composer)"."""
    from cornerroom.modules.music.application.changes import credit_line

    names = {"a1": "MIZULS"}
    assert credit_line({"role_key": "custom", "artist_id": "a1", "instrument": "Songwriter & Composer"}, names) == (
        "Songwriter & Composer: MIZULS"
    )
    assert credit_line({"role_key": "custom", "display_name": "Aryan", "instrument": "Artwork"}, names) == "Artwork: Aryan"
    assert credit_line({"role_key": "musician", "display_name": "Rafi", "instrument": "Guitars"}, names) == "Guitars: Rafi"
    assert credit_line({"role_key": "mixing_engineer", "display_name": "M.K."}, names) == "Mixing engineer: M.K."
    assert credit_line({"role_key": "performer", "artist_id": "a1", "instrument": "Vocals"}, names) == "Performer: MIZULS (Vocals)"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_song_lists_say_which_releases_a_song_is_on(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    release_id, track_id, _owner, _artist = await _released(client, admin, orgs["LABEL"], "list-owner@example.com", "List Act")

    listed = {t["id"]: t for t in (await client.get("/api/v1/tracks?limit=100")).json()["items"]}
    assert listed[track_id]["release_ids"] == [release_id]
    # The same as a single-song read.
    assert (await client.get(f"/api/v1/tracks/{track_id}")).json()["release_ids"] == [release_id]


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_musician_and_custom_credits(client: AsyncClient) -> None:
    from cornerroom.infra.db import get_session_factory
    from cornerroom.infra.errors import AppError
    from cornerroom.modules.music.application.studio import StudioService

    await client.get("/health")  # the app has started, so the credit roles are seeded
    async with get_session_factory()() as session:
        svc = StudioService(session)
        cleaned = await svc.clean_credits(
            [
                {"role_key": "musician", "display_name": "Rafi Ahmed", "instrument": "Guitars"},
                {"role_key": "custom", "display_name": "Nadia", "instrument": "Cover art"},
            ]
        )
        assert cleaned == [
            {"role_key": "musician", "artist_id": None, "display_name": "Rafi Ahmed", "instrument": "Guitars", "part_of_artist_id": None, "part_of_name": None},
            {"role_key": "custom", "artist_id": None, "display_name": "Nadia", "instrument": "Cover art", "part_of_artist_id": None, "part_of_name": None},
        ]
        # An "Other" credit needs its role named.
        with pytest.raises(AppError) as err:
            await svc.clean_credits([{"role_key": "custom", "display_name": "Nadia", "instrument": "  "}])
        assert err.value.code == "VALIDATION_ERROR"
