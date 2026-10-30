"""D-STREAM-02 (owner, 2026-10-30): staff and the music's own artist or band listen without buying.

"Why would an artist have to buy his own music, and why would an admin have to buy anything?"
Catalog staff (music.approve in the music's organization) stream everything of that organization;
the artist or band admins stream their own songs. Fans still need a purchase, and downloads still
need one for everybody.
"""

from __future__ import annotations

from uuid import UUID

import pytest
from httpx import AsyncClient

from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase5_intake import _orgs, _staff_with
from tests.test_audio_phase7_release_commerce import _released


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_staff_and_the_artist_stream_without_buying(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    release_id, track_id, owner, _artist = await _released(client, admin, label, "stream-owner@example.com", "Stream Act")
    staff = await _staff_with(client, admin, "stream-staff@example.com", "content_manager", label)
    fan = await register_and_login(client, "stream-fan@example.com")
    stranger = await register_and_login(client, "stream-other-artist@example.com")

    async def entitled(token: str) -> bool:
        res = await client.get(f"/api/v1/playback/tracks/{track_id}/availability", headers=bearer(token))
        assert res.status_code == 200, res.text
        return res.json()["entitled"]

    async def access(token: str) -> list[str]:
        res = await client.get("/api/v1/me/stream-access", headers=bearer(token))
        assert res.status_code == 200, res.text
        return res.json()["track_ids"]

    # The artist and catalog staff may listen; a fan who hasn't bought it may not.
    assert await entitled(owner["access_token"]) is True
    assert await entitled(staff) is True
    assert await entitled(fan["access_token"]) is False
    assert await entitled(stranger["access_token"]) is False
    assert track_id in await access(owner["access_token"])
    assert track_id in await access(staff)
    assert await access(fan["access_token"]) == []

    # The playback gate itself, not only the flag the page reads.
    from cornerroom.infra.db import get_session_factory
    from cornerroom.infra.errors import AppError
    from cornerroom.modules.streaming.application.service import StreamingService

    async with get_session_factory()() as session:
        svc = StreamingService(session)
        await svc._require_entitlement(UUID(owner["user"]["id"]), UUID(track_id))
        with pytest.raises(AppError) as err:
            await svc._require_entitlement(UUID(fan["user"]["id"]), UUID(track_id))
        assert err.value.code == "ENTITLEMENT_REQUIRED"

    # Listening only: downloads still need a purchase, even for the artist.
    from cornerroom.modules.entitlements.application.service import EntitlementService

    async with get_session_factory()() as session:
        assert await EntitlementService(session).owns_by_purchase(UUID(owner["user"]["id"]), UUID(track_id)) is False
    assert release_id


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_staff_and_artist_plays_are_not_counted_as_listens(client: AsyncClient, monkeypatch) -> None:
    """D-LISTEN-03 (owner, 2026-10-30): "Staff and artist plays ... shouldn't" count as listens."""
    from cornerroom.infra.db import get_session_factory
    from cornerroom.infra.settings import get_settings
    from cornerroom.modules.entitlements.application.service import EntitlementService
    from tests.test_phase16_listens import _count, _play

    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    _release_id, track_id, owner, _artist = await _released(client, admin, label, "count-owner@example.com", "Count Act")
    staff = await _staff_with(client, admin, "count-staff@example.com", "content_manager", label)
    fan = await register_and_login(client, "count-fan@example.com")
    async with get_session_factory()() as session:
        await EntitlementService(session).grant(
            None, user_id=UUID(fan["user"]["id"]), entitlement_type="ADMIN_GRANT", ref_id=UUID(track_id), scope="TRACK"
        )
        await session.commit()
    assert await _count(client, track_id) == 0

    # The test song is only seconds long (plays are cut to its length), so count any play here.
    monkeypatch.setenv("LISTEN_MIN_MS", "1")
    get_settings.cache_clear()
    try:
        # The artist and catalog staff play it: no listens.
        await _play(client, owner["access_token"], track_id, 90_000)
        await _play(client, staff, track_id, 90_000)
        assert await _count(client, track_id) == 0
        # A fan's play counts as before.
        await _play(client, fan["access_token"], track_id, 90_000)
        assert await _count(client, track_id) == 1
    finally:
        monkeypatch.undo()
        get_settings.cache_clear()
