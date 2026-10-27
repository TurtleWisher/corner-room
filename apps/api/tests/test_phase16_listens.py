"""Listen counts (owner, 2026-10-27, D-LISTEN-01): a play counts once it has been heard for 30
seconds, once per play however often it is reported, and at most 30 a day per person per song.
Shown on the song and in the public catalog; counted automatically."""

from __future__ import annotations

from uuid import uuid4

import pytest
from httpx import AsyncClient

from tests.auth_helpers import admin_token, bearer, register_and_login
from tests.test_phase07_catalog import _workspace
from tests.test_phase08_streaming import _released_track


async def _listener(client: AsyncClient, staff: str, email: str, track_id: str) -> str:
    fan = (await register_and_login(client, email))["access_token"]
    me = (await client.get("/api/v1/me", headers=bearer(fan))).json()
    granted = await client.post(
        "/api/v1/entitlements/grants",
        headers=bearer(staff),
        json={"user_id": me["id"], "entitlement_type": "ADMIN_GRANT", "ref_id": track_id, "scope": "TRACK"},
    )
    assert granted.status_code == 201, granted.text
    return fan


async def _play(client: AsyncClient, fan: str, track_id: str, *heard_ms: int) -> None:
    """One play (its own listening session), reported once for each value (pause, resume, end)."""
    session = await client.post("/api/v1/playback/sessions", headers=bearer(fan), json={"track_id": track_id})
    assert session.status_code == 201, session.text
    for ms in heard_ms:
        sent = await client.post(
            "/api/v1/playback/events",
            headers=bearer(fan),
            json={"client_event_id": str(uuid4()), "track_id": track_id, "session_id": session.json()["id"], "duration_ms": ms},
        )
        assert sent.status_code == 201, sent.text


async def _count(client: AsyncClient, track_id: str) -> int:
    return (await client.get(f"/api/v1/tracks/{track_id}")).json()["listens"]


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_listens_count_real_plays_once_each_with_a_daily_cap(client: AsyncClient, monkeypatch) -> None:
    from cornerroom.infra.settings import get_settings

    admin = await admin_token(client)
    platform = next(r for r in (await client.get("/api/v1/organizations", headers=bearer(admin))).json()["items"] if r["type"] == "PLATFORM")
    staff = await _workspace(client, admin, platform["id"])
    track = (await _released_track(client, staff, "Counted Song"))["id"]
    fan = await _listener(client, staff, "listen-fan@example.com", track)
    assert await _count(client, track) == 0

    # A skip (under 30 seconds) is not a listen.
    await _play(client, fan, track, 12_000)
    assert await _count(client, track) == 0
    # Paused at 40 s, then finished: one play, reported twice, counted once.
    await _play(client, fan, track, 40_000, 180_000)
    assert await _count(client, track) == 1
    # Played five more times: five more listens (the owner's example).
    for _ in range(5):
        await _play(client, fan, track, 61_000)
    assert await _count(client, track) == 6
    # The public catalog shows the same number.
    catalog = {t["id"]: t for t in (await client.get("/api/v1/playback/catalog")).json()["items"]}
    assert catalog[track]["listens"] == 6

    # The daily cap per person per song (30 by default; 7 here to keep the test short).
    monkeypatch.setenv("LISTEN_DAILY_CAP", "7")
    get_settings.cache_clear()
    try:
        for _ in range(3):
            await _play(client, fan, track, 45_000)
        assert await _count(client, track) == 7
        # Another listener has their own allowance.
        other = await _listener(client, staff, "listen-other@example.com", track)
        await _play(client, other, track, 45_000)
        assert await _count(client, track) == 8
    finally:
        monkeypatch.undo()
        get_settings.cache_clear()
