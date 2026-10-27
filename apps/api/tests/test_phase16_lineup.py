"""Band lineup (owner, 2026-10-27, D-LINEUP-01): song, release and band pages fold out the band's
members. A member can be listed by typed name alone (attribution only), and fans never see members'
accounts."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.auth_helpers import admin_token, bearer, register_and_login
from tests.test_phase06_artists import _activate_artist, _workspace


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_lineup_shows_named_members_and_hides_accounts(client: AsyncClient) -> None:
    admin = await admin_token(client)
    orgs = (await client.get("/api/v1/organizations", headers=bearer(admin))).json()["items"]
    platform = next(row for row in orgs if row["type"] == "PLATFORM")
    staff = await _workspace(client, admin, platform["id"])

    band = (await client.post("/api/v1/bands", headers=bearer(staff), json={"name": "Lineup Band"})).json()
    band_id = band["id"]
    active = await client.post(
        f"/api/v1/bands/{band_id}/lifecycle", headers=bearer(staff), json={"action": "activate", "version": band["version"]}
    )
    assert active.status_code == 200, active.text

    # A member with an artist page.
    artist = (await client.post("/api/v1/artists", headers=bearer(staff), json={"stage_name": "Drummer Page"})).json()
    await _activate_artist(client, staff, artist["id"])
    with_page = await client.post(
        f"/api/v1/bands/{band_id}/members", headers=bearer(staff), json={"artist_id": artist["id"], "role_label": "Drums"}
    )
    assert with_page.status_code == 201
    # Artist members still accept like before; here staff list a name-only member, active at once.
    named = await client.post(
        f"/api/v1/bands/{band_id}/members", headers=bearer(staff), json={"display_name": "  Rafi   Ahmed ", "role_label": "Bass"}
    )
    assert named.status_code == 201, named.text
    assert named.json()["status"] == "ACTIVE" and named.json()["display_name"] == "Rafi Ahmed"
    assert (await client.post(f"/api/v1/bands/{band_id}/members", headers=bearer(staff), json={"role_label": "x"})).status_code == 422

    # An account member without a name or page is not shown, and their account stays private.
    person = await register_and_login(client, "lineup-member@example.com")
    invited = (
        await client.post(f"/api/v1/bands/{band_id}/members", headers=bearer(staff), json={"user_id": person["user"]["id"]})
    ).json()
    accepted = await client.post(
        f"/api/v1/bands/{band_id}/members/{invited['id']}/lifecycle",
        headers=bearer(person["access_token"]),
        json={"action": "accept"},
    )
    assert accepted.status_code == 200

    lineup = (await client.get(f"/api/v1/bands/{band_id}/lineup")).json()["items"]
    assert [(m["name"], m["role_label"]) for m in lineup] == [("Rafi Ahmed", "Bass")]
    public_members = (await client.get(f"/api/v1/bands/{band_id}/members")).json()["items"]
    assert public_members and all(m["user_id"] is None for m in public_members)

    # Staff name the account member; the lineup shows them, still without the account.
    renamed = await client.patch(
        f"/api/v1/bands/{band_id}/members/{invited['id']}", headers=bearer(staff), json={"display_name": "Mitu", "role_label": "Vocals"}
    )
    assert renamed.status_code == 200, renamed.text
    fan = await register_and_login(client, "lineup-fan@example.com")
    assert (
        await client.patch(f"/api/v1/bands/{band_id}/members/{invited['id']}", headers=bearer(fan["access_token"]), json={"display_name": "x"})
    ).status_code == 404
    lineup = (await client.get(f"/api/v1/bands/{band_id}/lineup")).json()["items"]
    assert [m["name"] for m in lineup] == ["Rafi Ahmed", "Mitu"]
    assert all(set(m) == {"id", "name", "role_label", "artist_id", "portrait_asset_id"} for m in lineup)
    # A name-only member can't lose their only name.
    cleared = await client.patch(f"/api/v1/bands/{band_id}/members/{named.json()['id']}", headers=bearer(staff), json={"display_name": None})
    assert cleared.status_code == 422
