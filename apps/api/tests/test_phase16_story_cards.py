"""Story cards (owner, 2026-11-08, D-STORY-01).

People who own a song share a moment of it, up to 30 seconds they pick, as a story card with the
song's sound. Only owners (buyers and the act's own people) may; the song must be out; the act can
turn it off per release. Checking never counts as a listen.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from cornerroom.modules.music.domain.story_cards import story_reason
from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase4_studio import _artist_for
from tests.test_audio_phase5_intake import _orgs, _staff_with
from tests.test_audio_phase8_downloads import _grant
from tests.test_phase16_teasers import _draft_single, _play_events, _release


def test_story_rules() -> None:
    ok = dict(owns=True, track_released=True, release_switches=[True], clip_max_ms=30_000)
    assert story_reason(**ok) == "OK"
    assert story_reason(**{**ok, "owns": False}) == "NOT_OWNED"
    assert story_reason(**{**ok, "track_released": False}) == "NOT_RELEASED"
    assert story_reason(**{**ok, "release_switches": []}) == "NOT_RELEASED"
    # Out on two releases and one has sharing off: the act's wish wins.
    assert story_reason(**{**ok, "release_switches": [True, False]}) == "SHARING_OFF"
    # 0 blocks story cards (fail closed), before anything else is said.
    assert story_reason(**{**ok, "owns": False, "clip_max_ms": 0}) == "STORIES_OFF"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_owners_share_and_the_act_can_turn_it_off(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    owner = await register_and_login(client, "story-owner@example.com")
    token = owner["access_token"]
    artist_id = await _artist_for(owner["user"]["id"], label, name="Story Artist")
    reviewer = await _staff_with(client, admin, "story-reviewer@example.com", "content_manager", label)
    buyer = await register_and_login(client, "story-buyer@example.com")
    fan = (await register_and_login(client, "story-fan@example.com"))["access_token"]
    release_id, track_id = await _draft_single(client, token, artist_id, title="Storied")
    url = f"/api/v1/playback/tracks/{track_id}/story"

    # Signed in only.
    assert (await client.get(url)).status_code == 401
    # Not out yet: nobody can share it, not even the act.
    assert (await client.get(url, headers=bearer(token))).json()["reason"] == "NOT_RELEASED"

    await _release(client, token, reviewer, release_id)
    await _grant(buyer["user"]["id"], track_id)

    for who in (token, buyer["access_token"]):
        seen = (await client.get(url, headers=bearer(who))).json()
        assert seen == {"track_id": track_id, "can_share": True, "reason": "OK", "clip_max_ms": 30_000}
    assert (await client.get(url, headers=bearer(fan))).json()["reason"] == "NOT_OWNED"

    # On by default in Studio; the act turns it off and owners can't share any more.
    switch = f"/api/v1/studio/releases/{release_id}/story-sharing"
    detail = (await client.get(f"/api/v1/studio/releases/{release_id}", headers=bearer(token))).json()
    assert detail["release"]["story_sharing"] is True
    assert (await client.put(switch, headers=bearer(fan), json={"on": False})).status_code == 404
    off = await client.put(switch, headers=bearer(token), json={"on": False})
    assert off.status_code == 200, off.text
    assert off.json()["release"]["story_sharing"] is False
    seen = (await client.get(url, headers=bearer(buyer["access_token"]))).json()
    assert seen["can_share"] is False and seen["reason"] == "SHARING_OFF"
    # Back on.
    assert (await client.put(switch, headers=bearer(token), json={"on": True})).json()["release"]["story_sharing"] is True
    assert (await client.get(url, headers=bearer(buyer["access_token"]))).json()["can_share"] is True

    # Checking is never a listen.
    assert await _play_events(track_id) == 0
    # Unknown songs are 404.
    assert (await client.get("/api/v1/playback/tracks/0190f000-0000-7000-8000-000000000009/story", headers=bearer(token))).status_code == 404
