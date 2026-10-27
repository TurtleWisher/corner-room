"""Bands (owner, 2026-10-27, D-BAND-01): staff can make band admins, applicants choose "band" or
"solo", and a solo artist profile (MIZULS) can become a band profile with everything public on it.
Money records keep their existing references."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase5_intake import _orgs
from tests.test_audio_phase7_release_commerce import _released
from tests.test_phase16_onboarding import _platform


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_a_solo_artist_becomes_a_band_with_everything_public_on_it(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    release_id, track_id, owner, artist_id = await _released(client, admin, label, "move-artist@example.com", "Move Act")
    fan = await register_and_login(client, "move-fan@example.com")
    assert (await client.post(f"/api/v1/artists/{artist_id}/follow", headers=bearer(fan["access_token"]))).status_code == 201
    # The follow is remembered on the next visit, and everyone sees the count (owner, 2026-10-27).
    mine = (await client.get(f"/api/v1/artists/{artist_id}/followers/summary", headers=bearer(fan["access_token"]))).json()
    assert mine == {"followers": 1, "following": True}
    assert (await client.get(f"/api/v1/artists/{artist_id}/followers/summary")).json() == {"followers": 1, "following": False}

    # Only staff can do it; the artist themselves gets 404.
    assert (await client.post(f"/api/v1/artists/{artist_id}/move-to-band", headers=bearer(owner["access_token"]))).status_code == 404
    moved = await client.post(f"/api/v1/artists/{artist_id}/move-to-band", headers=bearer(admin))
    assert moved.status_code == 200, moved.text
    band_id = moved.json()["band_id"]
    assert moved.json()["name"] == "Move Act"

    release = (await client.get(f"/api/v1/releases/{release_id}")).json()
    assert release["primary_band_id"] == band_id and release["primary_artist_id"] is None
    track = (await client.get(f"/api/v1/tracks/{track_id}")).json()
    assert track["primary_band_id"] == band_id and track["primary_artist_id"] is None

    # The solo profile is gone from public pages; the band is there.
    assert all(a["id"] != artist_id for a in (await client.get("/api/v1/artists")).json()["items"])
    assert (await client.get(f"/api/v1/artists/{artist_id}")).status_code == 404
    band = (await client.get(f"/api/v1/bands/{band_id}")).json()
    assert band["name"] == "Move Act" and band["status"] == "ACTIVE"
    # Followers moved with it.
    followed = (await client.get(f"/api/v1/bands/{band_id}/followers/summary", headers=bearer(fan["access_token"]))).json()
    assert followed == {"followers": 1, "following": True}
    # Unfollow and follow a band from its page.
    assert (await client.delete(f"/api/v1/bands/{band_id}/follow", headers=bearer(fan["access_token"]))).status_code == 200
    assert (await client.get(f"/api/v1/bands/{band_id}/followers/summary")).json()["followers"] == 0
    assert (await client.post(f"/api/v1/bands/{band_id}/follow", headers=bearer(fan["access_token"]))).status_code == 201

    # The account that ran the artist is the band's admin, and Studio shows only the band.
    members = (await client.get(f"/api/v1/bands/{band_id}/members", headers=bearer(admin))).json()["items"]
    assert [(m["user_id"], m["status"], m["is_admin"]) for m in members] == [(owner["user"]["id"], "ACTIVE", True)]
    profiles = (await client.get("/api/v1/me/catalog-profiles", headers=bearer(owner["access_token"]))).json()
    assert [(p["kind"], p["id"], p["can_publish"]) for p in profiles] == [("band", band_id, True)]
    # Past sales show under the band.
    sales = await client.get(f"/api/v1/studio/profiles/band/{band_id}/sales", headers=bearer(owner["access_token"]))
    assert sales.status_code == 200, sales.text

    # Done once only.
    assert (await client.post(f"/api/v1/artists/{artist_id}/move-to-band", headers=bearer(admin))).status_code == 404

    # Staff can take admin away (and give it back); the band member can't.
    member_id = members[0]["id"]
    assert (
        await client.post(f"/api/v1/bands/{band_id}/members/{member_id}/admin", headers=bearer(owner["access_token"]), json={"is_admin": False})
    ).status_code == 404
    off = await client.post(f"/api/v1/bands/{band_id}/members/{member_id}/admin", headers=bearer(admin), json={"is_admin": False})
    assert off.status_code == 200 and off.json()["is_admin"] is False
    assert (await client.get("/api/v1/me/catalog-profiles", headers=bearer(owner["access_token"]))).json() == []
    on = await client.post(f"/api/v1/bands/{band_id}/members/{member_id}/admin", headers=bearer(admin), json={"is_admin": True})
    assert on.status_code == 200 and on.json()["is_admin"] is True


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_an_application_made_as_a_band_becomes_a_band_when_activated(client: AsyncClient) -> None:
    person = await register_and_login(client, "band-applicant@example.com")
    token = person["access_token"]
    applied = await client.post(
        "/api/v1/artist-applications",
        headers=bearer(token),
        json={"stage_name": "Night Lanterns", "bio": "Four friends from Sylhet.", "profile_kind": "BAND"},
    )
    assert applied.status_code == 201, applied.text
    app = applied.json()
    platform = await _platform(client)
    for action in ("start_review", "approve"):
        res = await client.post(f"/api/v1/artist-applications/{app['id']}/lifecycle", headers=bearer(platform), json={"action": action})
        assert res.status_code == 200, res.text
    activated = await client.post(f"/api/v1/artists/{app['artist_id']}/lifecycle", headers=bearer(platform), json={"action": "activate"})
    assert activated.status_code == 200, activated.text

    profiles = (await client.get("/api/v1/me/catalog-profiles", headers=bearer(token))).json()
    assert len(profiles) == 1 and profiles[0]["kind"] == "band" and profiles[0]["display_name"] == "Night Lanterns"
    assert profiles[0]["can_publish"] is True
    # The applicant can still see their application.
    mine = await client.get("/api/v1/artist-applications?mine=true", headers=bearer(token))
    assert mine.status_code == 200, mine.text
    assert mine.json()["items"][0]["status"] == "APPROVED"

    # A solo application stays a solo artist.
    solo = await register_and_login(client, "solo-applicant@example.com")
    solo_app = (
        await client.post("/api/v1/artist-applications", headers=bearer(solo["access_token"]), json={"stage_name": "Mira"})
    ).json()
    for action in ("start_review", "approve"):
        await client.post(f"/api/v1/artist-applications/{solo_app['id']}/lifecycle", headers=bearer(platform), json={"action": action})
    await client.post(f"/api/v1/artists/{solo_app['artist_id']}/lifecycle", headers=bearer(platform), json={"action": "activate"})
    assert [p["kind"] for p in (await client.get("/api/v1/me/catalog-profiles", headers=bearer(solo["access_token"]))).json()] == ["artist"]
