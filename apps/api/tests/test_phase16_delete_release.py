"""Delete a release that isn't out yet (owner, 2026-11-03): the artist or staff can clear music that
isn't released so the artist can start again, but never once someone has paid for it."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
from httpx import AsyncClient

from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase4_studio import _artist_for
from tests.test_audio_phase5_intake import _orgs, _staff_with
from tests.test_audio_phase7_release_commerce import _buy, _released


async def _draft_on_presale(client: AsyncClient, token: str, artist_id: str, reviewer: str, ops: str, title: str) -> str:
    rid = (
        await client.post("/api/v1/studio/releases", headers=bearer(token), json={"profile": {"kind": "artist", "id": artist_id}, "release_type": "SINGLE", "title": title})
    ).json()["release"]["id"]
    await client.post(f"/api/v1/studio/releases/{rid}/tracks", headers=bearer(token), json={"title": "Song"})
    await client.post(
        f"/api/v1/studio/releases/{rid}/price-proposals", headers=bearer(token),
        json={"subject_type": "RELEASE", "subject_id": rid, "audience": "PRESALE", "amount_minor": 1000},
    )
    when = datetime.now(timezone.utc) + timedelta(days=5)
    assert (await client.post(f"/api/v1/studio/releases/{rid}/presale/request", headers=bearer(token), json={"release_at": when.isoformat()})).status_code == 200
    return rid


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_delete_unreleased_release(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    owner = await register_and_login(client, "del-owner@example.com")
    token = owner["access_token"]
    artist_id = await _artist_for(owner["user"]["id"], label, name="Delete Act")
    reviewer = await _staff_with(client, admin, "del-reviewer@example.com", "content_manager", label)
    ops = await _staff_with(client, admin, "del-ops@example.com", "finance_manager", label)

    # A draft with a song, a pre-sale price and a pre-sale waiting for review: gone in one step.
    first = await _draft_on_presale(client, token, artist_id, reviewer, ops, "Start Again")
    track_id = (await client.get(f"/api/v1/studio/releases/{first}", headers=bearer(token))).json()["tracks"][0]["id"]
    stranger = await register_and_login(client, "del-stranger@example.com")
    assert (await client.delete(f"/api/v1/studio/releases/{first}", headers=bearer(stranger["access_token"]))).status_code == 404
    assert (await client.delete(f"/api/v1/studio/releases/{first}", headers=bearer(token))).status_code == 204
    assert (await client.get(f"/api/v1/studio/releases/{first}", headers=bearer(token))).status_code == 404
    listed = (await client.get(f"/api/v1/studio/profiles/artist/{artist_id}/releases", headers=bearer(token))).json()
    assert first not in [r["id"] for r in listed]
    assert first not in [i["release_id"] for i in (await client.get("/api/v1/catalog-intake/presales", headers=bearer(reviewer))).json()]
    assert not [p for p in (await client.get("/api/v1/offer-proposals", headers=bearer(ops))).json() if p["release_id"] == first and p["status"] == "PROPOSED"]
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.music.domain.models import Track

    async with get_session_factory()() as session:
        assert (await session.get(Track, UUID(track_id))).deleted_at is not None
    assert (await client.delete(f"/api/v1/studio/releases/{first}", headers=bearer(token))).status_code == 404

    # Once someone has pre-ordered, it can't be deleted.
    second = await _draft_on_presale(client, token, artist_id, reviewer, ops, "Paid For")
    assert (await client.post(f"/api/v1/catalog-intake/releases/{second}/presale/review", headers=bearer(reviewer), json={"decision": "approve"})).status_code == 200
    pid = next(p["id"] for p in (await client.get("/api/v1/offer-proposals", headers=bearer(ops))).json() if p["release_id"] == second)
    assert (await client.post(f"/api/v1/offer-proposals/{pid}/decision", headers=bearer(ops), json={"decision": "accept"})).status_code == 200
    fan = await register_and_login(client, "del-fan@example.com")
    await _buy(client, fan["access_token"], (await client.get(f"/api/v1/presales/releases/{second}")).json()["offer"]["id"])
    refused = await client.delete(f"/api/v1/studio/releases/{second}", headers=bearer(token))
    assert refused.status_code == 409 and refused.json()["code"] == "HAS_BUYERS"
    assert (await client.get(f"/api/v1/presales/releases/{second}")).status_code == 200

    # Released music can't be deleted here (it is taken down instead).
    released, _track, owner2, _artist2 = await _released(client, admin, label, "del-released@example.com", "Out Act")
    out = await client.delete(f"/api/v1/studio/releases/{released}", headers=bearer(owner2["access_token"]))
    assert out.status_code == 409
