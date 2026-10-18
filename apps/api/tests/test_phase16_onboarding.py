"""Onboarding: artists apply and are approved into Studio; staff are invited into a workspace.

Also the no-escalation rule: a workspace admin can only give roles whose permissions they hold.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.auth_helpers import admin_token, bearer, register_and_login


async def _label(client: AsyncClient) -> tuple[str, str]:
    """(super admin token switched into the label, label id)."""
    admin = await admin_token(client)
    orgs = (await client.get("/api/v1/organizations", headers=bearer(admin))).json()["items"]
    label = next(o["id"] for o in orgs if o["type"] == "LABEL")
    switched = (await client.post(f"/api/v1/organizations/{label}/switch", headers=bearer(admin))).json()["access_token"]
    return switched, label


async def _role_id(client: AsyncClient, token: str, key: str) -> str:
    return next(r["id"] for r in (await client.get("/api/v1/roles", headers=bearer(token))).json() if r["key"] == key)


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_workspace_admin_cannot_give_more_than_they_hold(client: AsyncClient) -> None:
    owner, label = await _label(client)
    person = await register_and_login(client, "label-admin@example.com")
    joined = await client.post(
        f"/api/v1/organizations/{label}/memberships",
        headers=bearer(owner),
        json={"user_id": person["user"]["id"], "status": "ACTIVE", "role_id": await _role_id(client, owner, "admin")},
    )
    assert joined.status_code == 201, joined.text
    label_admin = (await client.post(f"/api/v1/organizations/{label}/switch", headers=bearer(person["access_token"]))).json()["access_token"]

    grantable = {r["key"] for r in (await client.get(f"/api/v1/organizations/{label}/grantable-roles", headers=bearer(label_admin))).json()}
    assert "admin" in grantable
    assert "super_admin" not in grantable and "content_manager" not in grantable
    owner_grantable = {r["key"] for r in (await client.get(f"/api/v1/organizations/{label}/grantable-roles", headers=bearer(owner))).json()}
    assert {"content_manager", "label_manager", "catalog_manager", "finance_manager"} <= owner_grantable

    for key in ("super_admin", "content_manager"):
        refused = await client.post(
            f"/api/v1/organizations/{label}/invites",
            headers=bearer(label_admin),
            json={"email": f"x-{key}@example.com", "role_id": await _role_id(client, owner, key)},
        )
        assert refused.status_code == 403 and refused.json()["code"] == "ROLE_NOT_GRANTABLE", refused.text
    victim = await register_and_login(client, "escalate-me@example.com")
    direct = await client.post(
        f"/api/v1/organizations/{label}/memberships",
        headers=bearer(label_admin),
        json={"user_id": victim["user"]["id"], "status": "ACTIVE", "role_id": await _role_id(client, owner, "super_admin")},
    )
    assert direct.status_code == 403 and direct.json()["code"] == "ROLE_NOT_GRANTABLE"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_invited_staff_join_with_their_role_and_details_stay_with_admins(client: AsyncClient) -> None:
    owner, label = await _label(client)
    invite = await client.post(
        f"/api/v1/organizations/{label}/invites",
        headers=bearer(owner),
        json={"email": "New.Reviewer@example.com", "role_id": await _role_id(client, owner, "content_manager")},
    )
    assert invite.status_code == 201, invite.text
    token = invite.json()["token"]

    stranger = await register_and_login(client, "not-invited@example.com")
    wrong = await client.post("/api/v1/organizations/invitations/accept", headers=bearer(stranger["access_token"]), json={"token": token})
    assert wrong.status_code == 403

    reviewer = await register_and_login(client, "new.reviewer@example.com")
    accepted = await client.post("/api/v1/organizations/invitations/accept", headers=bearer(reviewer["access_token"]), json={"token": token})
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["status"] == "ACTIVE" and accepted.json()["organization_id"] == label
    again = await client.post("/api/v1/organizations/invitations/accept", headers=bearer(reviewer["access_token"]), json={"token": token})
    assert again.status_code in (404, 409)
    switched = await client.post(f"/api/v1/organizations/{label}/switch", headers=bearer(reviewer["access_token"]))
    assert switched.status_code == 200, switched.text
    reviewer_ws = switched.json()["access_token"]

    as_admin = (await client.get(f"/api/v1/organizations/{label}/memberships", headers=bearer(owner))).json()["items"]
    mine = next(m for m in as_admin if m["user_id"] == reviewer["user"]["id"])
    assert mine["email"] == "new.reviewer@example.com" and mine["role_key"] == "content_manager"
    as_member = (await client.get(f"/api/v1/organizations/{label}/memberships", headers=bearer(reviewer_ws))).json()["items"]
    assert all(m["email"] is None and m["display_name"] is None for m in as_member)


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_artist_applies_is_approved_and_can_publish(client: AsyncClient) -> None:
    owner, _label_id = await _label(client)
    artist = await register_and_login(client, "applying-artist@example.com")
    token = artist["access_token"]
    before = (await client.get("/api/v1/me/catalog-profiles", headers=bearer(token))).json()
    assert before == []

    applied = await client.post("/api/v1/artist-applications", headers=bearer(token), json={"stage_name": "Rain Theory", "bio": "Dhaka shoegaze.", "legal_name": "Private Person"})
    assert applied.status_code == 201, applied.text
    app = applied.json()
    assert app["stage_name"] == "Rain Theory" and app["status"] == "SUBMITTED" and app["artist_status"] == "APPLIED"
    mine = (await client.get("/api/v1/artist-applications?mine=true", headers=bearer(token))).json()["items"]
    assert [a["id"] for a in mine] == [app["id"]]
    pending = (await client.get("/api/v1/me/catalog-profiles", headers=bearer(token))).json()
    assert pending[0]["can_publish"] is False

    staff_view = await client.get("/api/v1/artist-applications", headers=bearer(owner))
    row = next(a for a in staff_view.json()["items"] if a["id"] == app["id"])
    assert row["stage_name"] == "Rain Theory" and row["bio"] == "Dhaka shoegaze."
    assert "Private Person" not in staff_view.text  # the legal name is not part of the review

    for action in ("start_review", "approve"):
        res = await client.post(f"/api/v1/artist-applications/{app['id']}/lifecycle", headers=bearer(owner), json={"action": action})
        assert res.status_code == 200, res.text
    activated = await client.post(f"/api/v1/artists/{app['artist_id']}/lifecycle", headers=bearer(owner), json={"action": "activate"})
    assert activated.status_code == 200, activated.text
    ready = (await client.get("/api/v1/me/catalog-profiles", headers=bearer(token))).json()
    assert ready[0]["can_publish"] is True and ready[0]["display_name"] == "Rain Theory"
    assert (await client.get("/api/v1/artist-applications?mine=true", headers=bearer(token))).json()["items"][0]["status"] == "APPROVED"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_artist_join_link_sends_applications_to_its_label(client: AsyncClient) -> None:
    owner, label = await _label(client)
    fan = await register_and_login(client, "join-fan@example.com")
    assert (await client.post("/api/v1/artist-join-links", headers=bearer(fan["access_token"]), json={"label": "x"})).status_code == 403

    link = await client.post("/api/v1/artist-join-links", headers=bearer(owner), json={"label": "Indie night", "max_uses": 1})
    assert link.status_code == 201, link.text
    code = link.json()["code"]
    assert len(code) >= 20 and link.json()["usable"] is True

    checked = await client.post("/api/v1/artist-join-links/check", json={"code": code})
    assert checked.status_code == 200 and checked.json() == {"organization_name": "Corner Room Label"}
    for bad in ("nope", code[:-2] + "zz"):
        miss = await client.post("/api/v1/artist-join-links/check", json={"code": bad})
        assert miss.status_code == 404 and miss.json()["code"] == "JOIN_LINK_INVALID"

    first = await register_and_login(client, "join-artist-1@example.com")
    applied = await client.post("/api/v1/artist-applications", headers=bearer(first["access_token"]), json={"stage_name": "Link Band", "join_code": code})
    assert applied.status_code == 201, applied.text
    assert applied.json()["organization_id"] == label
    # max_uses 1: the link is now full, for applying and for checking alike.
    second = await register_and_login(client, "join-artist-2@example.com")
    full = await client.post("/api/v1/artist-applications", headers=bearer(second["access_token"]), json={"stage_name": "Late", "join_code": code})
    assert full.status_code == 404 and full.json()["code"] == "JOIN_LINK_INVALID"
    assert (await client.post("/api/v1/artist-join-links/check", json={"code": code})).status_code == 404
    listed = (await client.get("/api/v1/artist-join-links", headers=bearer(owner))).json()
    assert next(row for row in listed if row["code"] == code)["uses"] == 1

    # Approval places the artist in the link's label.
    for action in ("start_review", "approve"):
        assert (await client.post(f"/api/v1/artist-applications/{applied.json()['id']}/lifecycle", headers=bearer(owner), json={"action": action})).status_code == 200

    # Switching a link off stops it at once.
    other = (await client.post("/api/v1/artist-join-links", headers=bearer(owner), json={"label": "Old"})).json()
    off = await client.post(f"/api/v1/artist-join-links/{other['id']}/disable", headers=bearer(owner))
    assert off.status_code == 200 and off.json()["status"] == "DISABLED" and off.json()["usable"] is False
    assert (await client.post("/api/v1/artist-join-links/check", json={"code": other["code"]})).status_code == 404


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_applications_through_a_link_stay_with_that_label(client: AsyncClient) -> None:
    owner, label = await _label(client)
    code = (await client.post("/api/v1/artist-join-links", headers=bearer(owner), json={"label": "Label only"})).json()["code"]
    artist = await register_and_login(client, "label-only-artist@example.com")
    app_id = (await client.post("/api/v1/artist-applications", headers=bearer(artist["access_token"]), json={"stage_name": "Mine", "join_code": code})).json()["id"]

    admin = await admin_token(client)
    orgs = (await client.get("/api/v1/organizations", headers=bearer(admin))).json()["items"]
    platform = next(o["id"] for o in orgs if o["type"] == "PLATFORM")
    platform_staff = (await client.post(f"/api/v1/organizations/{platform}/switch", headers=bearer(admin))).json()["access_token"]
    seen = (await client.get("/api/v1/artist-applications", headers=bearer(platform_staff))).json()["items"]
    assert all(a["id"] != app_id for a in seen)
    assert (await client.get(f"/api/v1/artist-applications/{app_id}", headers=bearer(platform_staff))).status_code == 404
    assert (await client.post(f"/api/v1/artist-applications/{app_id}/lifecycle", headers=bearer(platform_staff), json={"action": "start_review"})).status_code == 404
    assert any(a["id"] == app_id for a in (await client.get("/api/v1/artist-applications", headers=bearer(owner))).json()["items"])


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_invitation_check_and_menu_flags(client: AsyncClient) -> None:
    owner, label = await _label(client)
    token = (
        await client.post(
            f"/api/v1/organizations/{label}/invites",
            headers=bearer(owner),
            json={"email": "check-me@example.com", "role_id": await _role_id(client, owner, "content_manager")},
        )
    ).json()["token"]
    checked = await client.post("/api/v1/organizations/invitations/check", json={"token": token})
    assert checked.status_code == 200, checked.text
    assert checked.json() == {"organization_name": "Corner Room Label", "role_name": "Content Manager", "email_hint": "c***@example.com"}
    assert (await client.post("/api/v1/organizations/invitations/check", json={"token": "x" * 43})).status_code == 404

    fan = await register_and_login(client, "flags-fan@example.com")
    me = (await client.get("/api/v1/me", headers=bearer(fan["access_token"]))).json()
    assert me["is_artist"] is False and me["has_workspace"] is False
    staff = await register_and_login(client, "check-me@example.com")
    assert (await client.post("/api/v1/organizations/invitations/accept", headers=bearer(staff["access_token"]), json={"token": token})).status_code == 200
    assert (await client.get("/api/v1/me", headers=bearer(staff["access_token"]))).json()["has_workspace"] is True
    assert (await client.get("/api/v1/me", headers=bearer(owner))).json()["has_workspace"] is True

    applied = (await client.post("/api/v1/artist-applications", headers=bearer(fan["access_token"]), json={"stage_name": "Flag"})).json()
    assert (await client.get("/api/v1/me", headers=bearer(fan["access_token"]))).json()["is_artist"] is False  # applied, not approved
    for action in ("start_review", "approve"):
        await client.post(f"/api/v1/artist-applications/{applied['id']}/lifecycle", headers=bearer(owner), json={"action": action})
    assert (await client.get("/api/v1/me", headers=bearer(fan["access_token"]))).json()["is_artist"] is True
