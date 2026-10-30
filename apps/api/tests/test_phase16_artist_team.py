"""One kind of artist profile, run by a team (owner, 2026-10-30, D-ARTIST-UNIFY-01).

- Every band is an artist: its artist row has the band's id, kind BAND, and follows the band.
- A profile has one owner and any number of managers. The owner picks a manager by email; staff
  approve before the manager gets access; managers then see what the owner sees (sales included).
- Only the owner picks managers; the people on a profile can't approve its managers; staff can
  make someone else the owner, and the old owner stays on as a manager.
"""

from __future__ import annotations

from uuid import UUID

import pytest
from httpx import AsyncClient

from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase4_studio import _artist_for, _band_with
from tests.test_audio_phase5_intake import _orgs, _staff_with


async def _profiles(client: AsyncClient, token: str) -> list[dict]:
    res = await client.get("/api/v1/me/catalog-profiles", headers=bearer(token))
    assert res.status_code == 200, res.text
    return res.json()


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_every_band_is_an_artist(client: AsyncClient) -> None:
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.artists.domain.models import Artist, Band

    _admin, orgs = await _orgs(client)
    admin_user = await register_and_login(client, "unify-band-admin@example.com")
    member = await register_and_login(client, "unify-band-member@example.com")
    band_id = await _band_with(admin_user["user"]["id"], member["user"]["id"], orgs["LABEL"])

    async with get_session_factory()() as session:
        mirror = await session.get(Artist, UUID(band_id))
        assert mirror is not None
        assert (mirror.kind, mirror.stage_name, mirror.status) == ("BAND", "Night Shift", "ACTIVE")
        band = await session.get(Band, UUID(band_id))
        band.name, band.status = "Night Shift Live", "HIATUS"
        await session.commit()
    async with get_session_factory()() as session:
        mirror = await session.get(Artist, UUID(band_id))
        # Renamed with the band; a band on a break is not public, like before.
        assert (mirror.stage_name, mirror.status) == ("Night Shift Live", "SUSPENDED")
        band = await session.get(Band, UUID(band_id))
        band.status = "ACTIVE"
        await session.commit()

    everyone = (await client.get("/api/v1/artists?limit=100")).json()["items"]
    listed = next(a for a in everyone if a["id"] == band_id)
    assert listed["kind"] == "BAND" and listed["stage_name"] == "Night Shift Live"
    solo = (await client.get("/api/v1/artists?limit=100&kind=SOLO")).json()["items"]
    assert band_id not in {a["id"] for a in solo}
    # The band's admin runs it in Studio as a band.
    assert [(p["kind"], p["id"]) for p in await _profiles(client, admin_user["access_token"])] == [("band", band_id)]


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_owner_picks_a_manager_and_staff_approve(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    owner = await register_and_login(client, "team-owner@example.com")
    manager = await register_and_login(client, "team-manager@example.com")
    artist_id = await _artist_for(owner["user"]["id"], label, name="Team Act")
    staff = await _staff_with(client, admin, "team-staff@example.com", "label_manager", label)
    team_url = f"/api/v1/studio/profiles/artist/{artist_id}/team"
    sales_url = f"/api/v1/studio/profiles/artist/{artist_id}/sales"

    view = (await client.get(team_url, headers=bearer(owner["access_token"]))).json()
    assert view["my_role"] == "OWNER" and view["can_pick_managers"] is True
    assert [(m["role"], m["status"]) for m in view["members"]] == [("OWNER", "ACTIVE")]

    unknown = await client.post(team_url, headers=bearer(owner["access_token"]), json={"email": "nobody@example.com"})
    assert unknown.status_code == 422 and unknown.json()["code"] == "ACCOUNT_NOT_FOUND"
    picked = await client.post(team_url, headers=bearer(owner["access_token"]), json={"email": " Team-Manager@example.com "})
    assert picked.status_code == 201, picked.text
    waiting = next(m for m in picked.json()["members"] if m["role"] == "MANAGER")
    assert waiting["status"] == "PENDING"
    again = await client.post(team_url, headers=bearer(owner["access_token"]), json={"email": "team-manager@example.com"})
    assert again.status_code == 409

    # Waiting for staff: no access yet.
    assert await _profiles(client, manager["access_token"]) == []
    assert (await client.get(sales_url, headers=bearer(manager["access_token"]))).status_code == 404

    queue = (await client.get("/api/v1/artist-team-requests", headers=bearer(staff))).json()
    [request] = [r for r in queue if r["profile"]["id"] == artist_id]
    assert request["email"] == "team-manager@example.com" and request["picked_by"]
    # The owner can't approve their own pick.
    own = await client.post(
        f"/api/v1/artist-team-requests/{request['id']}/review",
        headers=bearer(owner["access_token"]), json={"action": "approve"},
    )
    assert own.status_code == 403 and own.json()["code"] == "SAME_PERSON_REVIEW"
    no_note = await client.post(
        f"/api/v1/artist-team-requests/{request['id']}/review", headers=bearer(staff), json={"action": "reject"}
    )
    assert no_note.status_code == 422
    approved = await client.post(
        f"/api/v1/artist-team-requests/{request['id']}/review", headers=bearer(staff), json={"action": "approve"}
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "ACTIVE"

    # A manager sees what the owner sees, money included.
    assert [p["id"] for p in await _profiles(client, manager["access_token"])] == [artist_id]
    assert (await client.get(sales_url, headers=bearer(manager["access_token"]))).status_code == 200
    me = (await client.get("/api/v1/me", headers=bearer(manager["access_token"]))).json()
    assert me["is_artist"] is True
    # Only the owner picks managers.
    third = await register_and_login(client, "team-third@example.com")
    by_manager = await client.post(team_url, headers=bearer(manager["access_token"]), json={"email": "team-third@example.com"})
    assert by_manager.status_code == 403 and by_manager.json()["code"] == "OWNER_ONLY"
    # A manager can't approve someone else's pick for the same profile.
    await client.post(team_url, headers=bearer(owner["access_token"]), json={"email": "team-third@example.com"})
    third_request = next(
        r for r in (await client.get("/api/v1/artist-team-requests", headers=bearer(staff))).json()
        if r["email"] == "team-third@example.com"
    )
    assert (
        await client.post(
            f"/api/v1/artist-team-requests/{third_request['id']}/review",
            headers=bearer(manager["access_token"]), json={"action": "approve"},
        )
    ).status_code == 403
    assert await _profiles(client, third["access_token"]) == []

    # The owner takes the manager off: access ends at once.
    owner_view = (await client.get(team_url, headers=bearer(owner["access_token"]))).json()
    member_id = next(m["id"] for m in owner_view["members"] if m["email"] == "team-manager@example.com")
    owner_row = next(m["id"] for m in owner_view["members"] if m["role"] == "OWNER")
    assert (await client.delete(f"{team_url}/{owner_row}", headers=bearer(owner["access_token"]))).status_code == 409
    off = await client.delete(f"{team_url}/{member_id}", headers=bearer(owner["access_token"]))
    assert off.status_code == 200, off.text
    assert await _profiles(client, manager["access_token"]) == []
    assert (await client.get(sales_url, headers=bearer(manager["access_token"]))).status_code == 404


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_staff_make_someone_else_the_owner(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    first = await register_and_login(client, "owner-first@example.com")
    official = await register_and_login(client, "owner-official@example.com")
    member = await register_and_login(client, "owner-member@example.com")
    band_id = await _band_with(first["user"]["id"], member["user"]["id"], label)
    staff = await _staff_with(client, admin, "owner-staff@example.com", "label_manager", label)

    # Only label staff can change the owner.
    assert (
        await client.put(
            f"/api/v1/artists/{band_id}/team/owner",
            headers=bearer(first["access_token"]), json={"email": "owner-official@example.com"},
        )
    ).status_code == 404
    moved = await client.put(
        f"/api/v1/artists/{band_id}/team/owner", headers=bearer(staff), json={"email": "owner-official@example.com"}
    )
    assert moved.status_code == 200, moved.text
    roles = {m["email"]: (m["role"], m["status"]) for m in moved.json()["members"]}
    assert roles == {
        "owner-official@example.com": ("OWNER", "ACTIVE"),
        "owner-first@example.com": ("MANAGER", "ACTIVE"),
    }
    assert [p["id"] for p in await _profiles(client, official["access_token"])] == [band_id]
    assert [p["id"] for p in await _profiles(client, first["access_token"])] == [band_id]
    view = (await client.get(f"/api/v1/studio/profiles/band/{band_id}/team", headers=bearer(official["access_token"]))).json()
    assert view["can_pick_managers"] is True


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_owner_hands_the_profile_to_an_approved_manager(client: AsyncClient) -> None:
    """Owner, 2026-10-31: the current owner can change the owner (for example to a band's official
    email account). Only an approved manager can be handed the profile; the old owner stays on."""
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    first = await register_and_login(client, "hand-first@example.com")
    official = await register_and_login(client, "hand-official@example.com")
    member = await register_and_login(client, "hand-member@example.com")
    band_id = await _band_with(first["user"]["id"], member["user"]["id"], label)
    staff = await _staff_with(client, admin, "hand-staff@example.com", "label_manager", label)
    team_url = f"/api/v1/studio/profiles/band/{band_id}/team"

    picked = (await client.post(team_url, headers=bearer(first["access_token"]), json={"email": "hand-official@example.com"})).json()
    waiting = next(m for m in picked["members"] if m["email"] == "hand-official@example.com")
    # Not approved yet: it can't be handed over.
    early = await client.put(f"{team_url}/{waiting['id']}/owner", headers=bearer(first["access_token"]))
    assert early.status_code == 409 and early.json()["code"] == "MANAGER_NOT_APPROVED"
    approved = await client.post(
        f"/api/v1/artist-team-requests/{waiting['id']}/review", headers=bearer(staff), json={"action": "approve"}
    )
    assert approved.status_code == 200, approved.text

    # A manager can't hand the profile over, even to themselves.
    by_manager = await client.put(f"{team_url}/{waiting['id']}/owner", headers=bearer(official["access_token"]))
    assert by_manager.status_code == 403 and by_manager.json()["code"] == "OWNER_ONLY"
    # Someone with nothing to do with the profile sees nothing.
    stranger = await register_and_login(client, "hand-stranger@example.com")
    assert (await client.put(f"{team_url}/{waiting['id']}/owner", headers=bearer(stranger["access_token"]))).status_code == 404

    handed = await client.put(f"{team_url}/{waiting['id']}/owner", headers=bearer(first["access_token"]))
    assert handed.status_code == 200, handed.text
    roles = {m["email"]: (m["role"], m["status"]) for m in handed.json()["members"]}
    assert roles == {
        "hand-official@example.com": ("OWNER", "ACTIVE"),
        "hand-first@example.com": ("MANAGER", "ACTIVE"),
    }
    assert handed.json()["can_pick_managers"] is False

    # The new owner runs the team now and can take the old owner off.
    view = (await client.get(team_url, headers=bearer(official["access_token"]))).json()
    assert view["my_role"] == "OWNER" and view["can_pick_managers"] is True
    old = next(m for m in view["members"] if m["email"] == "hand-first@example.com")
    assert (await client.delete(f"{team_url}/{old['id']}", headers=bearer(official["access_token"]))).status_code == 200
    assert (await client.get("/api/v1/me/catalog-profiles", headers=bearer(first["access_token"]))).json() == []
