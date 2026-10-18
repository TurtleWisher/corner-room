"""Play events are royalty input, so they follow the same chain as playback (module pass 9).

modules/streaming.md: Playability -> Entitlement -> session -> PlaybackEvent. A listening session is
not tied to one track, so before this pass a session opened for a song the listener may play could
record plays for any other released song.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from httpx import AsyncClient

from tests.auth_helpers import admin_token, bearer, register_and_login
from tests.test_phase07_catalog import _workspace
from tests.test_phase08_streaming import _released_track


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase16_play_events_need_entitlement_for_that_track(client: AsyncClient) -> None:
    admin = await admin_token(client)
    platform = next(r for r in (await client.get("/api/v1/organizations", headers=bearer(admin))).json()["items"] if r["type"] == "PLATFORM")
    staff = await _workspace(client, admin, platform["id"])
    allowed = await _released_track(client, staff, "Allowed Song")
    other = await _released_track(client, staff, "Other Song")

    fan = (await register_and_login(client, "play-integrity@example.com"))["access_token"]
    me = (await client.get("/api/v1/me", headers=bearer(fan))).json()
    granted = await client.post(
        "/api/v1/entitlements/grants",
        headers=bearer(staff),
        json={"user_id": me["id"], "entitlement_type": "ADMIN_GRANT", "ref_id": allowed["id"], "scope": "TRACK"},
    )
    assert granted.status_code == 201, granted.text
    session = await client.post("/api/v1/playback/sessions", headers=bearer(fan), json={"track_id": allowed["id"]})
    assert session.status_code == 201, session.text
    refused_session = await client.post("/api/v1/playback/sessions", headers=bearer(fan), json={"track_id": other["id"]})
    assert refused_session.status_code == 403

    def event(track_id: str) -> dict:
        return {"client_event_id": str(uuid4()), "track_id": track_id, "session_id": session.json()["id"], "duration_ms": 5000}

    ok = await client.post("/api/v1/playback/events", headers=bearer(fan), json=event(allowed["id"]))
    assert ok.status_code == 201, ok.text
    smuggled = await client.post("/api/v1/playback/events", headers=bearer(fan), json=event(other["id"]))
    assert smuggled.status_code == 403
    assert smuggled.json()["code"] == "ENTITLEMENT_REQUIRED"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase16_library_and_playlists_take_only_real_released_things(client: AsyncClient) -> None:
    admin = await admin_token(client)
    platform = next(r for r in (await client.get("/api/v1/organizations", headers=bearer(admin))).json()["items"] if r["type"] == "PLATFORM")
    staff = await _workspace(client, admin, platform["id"])
    released = await _released_track(client, staff, "Out Now")
    draft = await client.post("/api/v1/tracks", headers=bearer(staff), json={"title": "Not Yet"})
    assert draft.status_code == 201, draft.text
    fan = (await register_and_login(client, "library-checks@example.com"))["access_token"]

    async def like(item_type: str, item_id: str):
        return await client.post("/api/v1/me/library", headers=bearer(fan), json={"item_type": item_type, "item_id": item_id, "kind": "LIKE"})

    assert (await like("track", released["id"])).status_code == 201
    assert (await like("track", str(uuid4()))).status_code == 404
    assert (await like("track", draft.json()["id"])).status_code == 404  # not public yet
    assert (await like("release", str(uuid4()))).status_code == 404
    assert (await like("artist", str(uuid4()))).status_code == 404

    playlist = await client.post("/api/v1/playlists", headers=bearer(fan), json={"title": "Mine"})
    assert playlist.status_code == 201, playlist.text
    items = f"/api/v1/playlists/{playlist.json()['id']}/items"
    assert (await client.post(items, headers=bearer(fan), json={"track_id": released["id"], "position": 1})).status_code == 201
    unreleased = await client.post(items, headers=bearer(fan), json={"track_id": draft.json()["id"], "position": 2})
    assert unreleased.status_code == 409 and unreleased.json()["code"] == "TRACK_NOT_RELEASED"