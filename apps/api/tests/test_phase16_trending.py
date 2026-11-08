"""Trending Corner (owner, 2026-11-08, D-TRENDING-01): staff pick the music shown in the home
page's carousel, with sales and listens beside each to help; the public list holds released
music only, in staff's order, with what the mini player needs."""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import update

from cornerroom.infra.errors import AppError
from cornerroom.modules.music.application.trending import check_order, is_out
from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase5_intake import _orgs, _staff_with
from tests.test_audio_phase7_release_commerce import _released


# --- pure rules -------------------------------------------------------------------------------------


def test_only_music_that_is_out_shows() -> None:
    assert is_out("RELEASED", None)
    assert not is_out("RELEASED", "2026-11-08")
    assert not is_out("APPROVED", None)
    assert not is_out("TAKEN_DOWN", None)


def test_a_new_order_names_every_pick_once() -> None:
    a, b, c = uuid4(), uuid4(), uuid4()
    check_order([a, b, c], [c, a, b])
    for wrong in ([a, b], [a, b, c, c], [a, b, uuid4()]):
        with pytest.raises(AppError) as err:
            check_order([a, b, c], wrong)
        assert err.value.code == "STALE_ORDER"


# --- with the database ------------------------------------------------------------------------------


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_staff_pick_order_and_remove(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    release_id, track_id, _owner, _artist = await _released(client, admin, label, "tr-owner@example.com", "Trend Act")
    other_release, other_track, _o, _a = await _released(client, admin, label, "tr-owner2@example.com", "Second Act")
    staff = await _staff_with(client, admin, "tr-staff@example.com", "content_manager", label)
    fan = await register_and_login(client, "tr-fan@example.com")

    # Nobody picked yet: the public list is empty, for anyone.
    empty = await client.get("/api/v1/trending")
    assert empty.status_code == 200 and empty.json() == {"items": []}

    # Only catalog staff see the staff list; everyone else gets 404, never 403.
    assert (await client.get("/api/v1/staff/trending", headers=bearer(fan["access_token"]))).status_code == 404
    assert (await client.post("/api/v1/staff/trending", headers=bearer(fan["access_token"]), json={"kind": "RELEASE", "id": release_id})).status_code == 404

    # The second release gets a second song, so it is an EP whose songs can trend on their own.
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.music.domain.models import ReleaseTrack, Track

    async with get_session_factory()() as session:
        base = await session.get(Track, UUID(other_track))
        extra = Track(title="Second Song", status="RELEASED", primary_org_id=base.primary_org_id, primary_artist_id=base.primary_artist_id)
        session.add(extra)
        await session.flush()
        session.add(ReleaseTrack(release_id=UUID(other_release), track_id=extra.id, position=2))
        await session.commit()

    view = await client.get("/api/v1/staff/trending", headers=bearer(staff))
    assert view.status_code == 200, view.text
    kinds = {(c["kind"], c["id"]) for c in view.json()["candidates"]}
    # A single's song is the single: listed once, as the release (owner, 2026-11-08: two Chaya Pore).
    assert ("RELEASE", release_id) in kinds and ("TRACK", track_id) not in kinds
    assert ("TRACK", other_track) in kinds
    assert all(c["sold"] == 0 and c["picked"] is False for c in view.json()["candidates"])
    single_song = await client.post("/api/v1/staff/trending", headers=bearer(staff), json={"kind": "TRACK", "id": track_id})
    assert single_song.status_code == 409 and single_song.json()["code"] == "PICK_THE_RELEASE"

    added = await client.post("/api/v1/staff/trending", headers=bearer(staff), json={"kind": "RELEASE", "id": release_id})
    assert added.status_code == 201, added.text
    again = await client.post("/api/v1/staff/trending", headers=bearer(staff), json={"kind": "RELEASE", "id": release_id})
    assert again.status_code == 409 and again.json()["code"] == "ALREADY_PICKED"
    second = await client.post("/api/v1/staff/trending", headers=bearer(staff), json={"kind": "TRACK", "id": other_track})
    assert second.status_code == 201, second.text
    # Its release can't join beside it: the same music would show twice.
    overlap = await client.post("/api/v1/staff/trending", headers=bearer(staff), json={"kind": "RELEASE", "id": other_release})
    assert overlap.status_code == 409 and overlap.json()["code"] == "ALREADY_PICKED"
    picks = second.json()["picks"]
    assert [p["id"] for p in picks] == [release_id, other_track]
    assert next(c for c in second.json()["candidates"] if c["id"] == release_id)["picked"] is True

    public = (await client.get("/api/v1/trending")).json()["items"]
    assert [i["kind"] for i in public] == ["RELEASE", "TRACK"]
    first = public[0]
    assert first["release_id"] == release_id and first["track_id"] is None
    assert [t["id"] for t in first["tracks"]] == [track_id]
    assert first["tracks"][0]["release_ids"] == [release_id] and first["tracks"][0]["teaser_id"] is None
    # A song picked alone takes the cover of the release it is out on.
    assert public[1]["track_id"] == other_track and public[1]["release_id"] == other_release

    # Reorder: every pick once, or the list changed under the page.
    ids = [p["pick_id"] for p in picks]
    stale = await client.put("/api/v1/staff/trending/order", headers=bearer(staff), json={"pick_ids": ids[:1]})
    assert stale.status_code == 409 and stale.json()["code"] == "STALE_ORDER"
    ordered = await client.put("/api/v1/staff/trending/order", headers=bearer(staff), json={"pick_ids": ids[::-1]})
    assert ordered.status_code == 200, ordered.text
    assert [i["kind"] for i in (await client.get("/api/v1/trending")).json()["items"]] == ["TRACK", "RELEASE"]

    # Music taken down leaves the public list at once, while staff still see it marked.
    async with get_session_factory()() as session:
        await session.execute(update(Track).where(Track.id == UUID(other_track)).values(status="TAKEN_DOWN"))
        await session.commit()
    assert [i["kind"] for i in (await client.get("/api/v1/trending")).json()["items"]] == ["RELEASE"]
    marked = (await client.get("/api/v1/staff/trending", headers=bearer(staff))).json()["picks"]
    assert next(p for p in marked if p["id"] == other_track)["is_out"] is False

    removed = await client.delete(f"/api/v1/staff/trending/{ids[1]}", headers=bearer(staff))
    assert removed.status_code == 204
    assert (await client.delete(f"/api/v1/staff/trending/{ids[1]}", headers=bearer(staff))).status_code == 404
    assert [p["id"] for p in (await client.get("/api/v1/staff/trending", headers=bearer(staff))).json()["picks"]] == [release_id]


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_unreleased_music_cannot_trend(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    release_id, _track, _owner, _artist = await _released(client, admin, label, "tr-draft@example.com", "Draft Act")
    staff = await _staff_with(client, admin, "tr-staff2@example.com", "content_manager", label)
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.music.domain.models import Release

    async with get_session_factory()() as session:
        await session.execute(update(Release).where(Release.id == UUID(release_id)).values(status="APPROVED"))
        await session.commit()
    refused = await client.post("/api/v1/staff/trending", headers=bearer(staff), json={"kind": "RELEASE", "id": release_id})
    assert refused.status_code == 409 and refused.json()["code"] == "NOT_RELEASED"
    unknown = await client.post("/api/v1/staff/trending", headers=bearer(staff), json={"kind": "TRACK", "id": str(uuid4())})
    assert unknown.status_code == 404
