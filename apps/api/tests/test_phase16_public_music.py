"""Music details are public (owner, 2026-10-24): visitors see songs and releases with their track
lists; playing still needs an account and access."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase4_studio import _artist_for
from tests.test_audio_phase5_intake import _orgs
from tests.test_phase16_covers import _release_everything


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_visitors_see_track_lists_but_cannot_play(client: AsyncClient) -> None:
    _admin, orgs = await _orgs(client)
    owner = await register_and_login(client, "public-music-owner@example.com")
    artist_id = await _artist_for(owner["user"]["id"], orgs["LABEL"], name="Public Music")
    token = owner["access_token"]
    created = await client.post(
        "/api/v1/studio/releases",
        headers=bearer(token),
        json={"profile": {"kind": "artist", "id": artist_id}, "release_type": "SINGLE", "title": "Open Door"},
    )
    release_id = created.json()["release"]["id"]
    track_id = (
        await client.post(f"/api/v1/studio/releases/{release_id}/tracks", headers=bearer(token), json={"title": "Open Door"})
    ).json()["tracks"][0]["id"]

    # Not released yet: a visitor can't see its track list.
    assert (await client.get(f"/api/v1/playback/releases/{release_id}/tracks")).status_code == 404

    await _release_everything(release_id, track_id)
    rows = await client.get(f"/api/v1/playback/releases/{release_id}/tracks")
    assert rows.status_code == 200, rows.text
    assert [r["track_id"] for r in rows.json()] == [track_id]
    assert rows.json()[0]["track_version_id"] is None  # internal ids stay with signed-in people

    catalog = await client.get("/api/v1/playback/catalog")
    assert catalog.status_code == 200
    assert all(item["track_version_id"] is None for item in catalog.json()["items"])

    # Playing is still for signed-in people with access.
    assert (await client.get(f"/api/v1/playback/tracks/{track_id}/audio")).status_code == 401
    assert (await client.post("/api/v1/playback/sessions", json={"track_id": track_id})).status_code == 401
