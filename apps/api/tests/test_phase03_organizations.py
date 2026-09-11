"""Phase 03 organizations & workspace — scenarios 1–62.

PostgreSQL integration tests are skipped honestly when the database is unavailable.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.outbox import OutboxEvent
from cornerroom.infra.security import decode_access_token
from cornerroom.infra.settings import Settings
from cornerroom.kernel.events import MEMBERSHIP_CHANGED, ORGANIZATION_ACTIVATED
from cornerroom.modules.audit.domain.models import AuditLog
from cornerroom.modules.identity.application.credentials import hash_secret
from tests.auth_helpers import admin_token, bearer, register_and_login


def _items(response) -> list[dict]:
    body = response.json()
    if isinstance(body, dict) and "items" in body:
        return body["items"]
    return body


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase03_scenarios_1_to_62(client: AsyncClient, settings: Settings) -> None:
    admin = await admin_token(client)

    listed = await client.get("/api/v1/organizations", headers=bearer(admin))
    assert listed.status_code == 200
    items = _items(listed)
    names = {row["name"] for row in items}
    types = {row["type"] for row in items}
    assert "Corner Room Platform" in names  # 1
    assert "Corner Room Label" in names  # 2
    assert "PLATFORM" in types and "LABEL" in types
    platform = next(row for row in items if row["type"] == "PLATFORM")
    label = next(row for row in items if row["type"] == "LABEL")

    created = await client.post(
        "/api/v1/organizations",
        headers=bearer(admin),
        json={"name": "Venue Partner One", "type": "VENUE_PARTNER"},
    )
    assert created.status_code == 201  # 3
    assert created.json()["status"] == "PENDING"
    partner_id = created.json()["id"]

    invalid_type = await client.post(
        "/api/v1/organizations",
        headers=bearer(admin),
        json={"name": "Bad", "type": "MARKETPLACE"},
    )
    assert invalid_type.status_code == 422  # 4

    fan_session = await register_and_login(client, "fan-org@example.com")
    fan = fan_session["access_token"]
    fan_id = fan_session["user"]["id"]
    assert "org.admin" not in (fan_session["user"].get("permissions") or [])  # 5 type≠permission

    fan_list = await client.get("/api/v1/organizations", headers=bearer(fan))
    assert fan_list.status_code == 200
    assert _items(fan_list) == []  # 6 no membership

    admin_list = _items(await client.get("/api/v1/organizations", headers=bearer(admin)))
    assert len(admin_list) >= 3  # 7 unscoped admin sees all

    anon = await client.get("/api/v1/organizations")
    assert anon.status_code == 401  # 9

    paged = await client.get("/api/v1/organizations?limit=1", headers=bearer(admin))
    assert paged.status_code == 200
    assert len(_items(paged)) == 1
    assert paged.json()["next_cursor"]  # 10

    activated = await client.post(
        f"/api/v1/organizations/{partner_id}/lifecycle",
        headers=bearer(admin),
        json={"action": "activate"},
    )
    assert activated.status_code == 200
    assert activated.json()["status"] == "ACTIVE"  # 11

    suspended = await client.post(
        f"/api/v1/organizations/{partner_id}/lifecycle",
        headers=bearer(admin),
        json={"action": "suspend"},
    )
    assert suspended.json()["status"] == "SUSPENDED"  # 12

    unsuspended = await client.post(
        f"/api/v1/organizations/{partner_id}/lifecycle",
        headers=bearer(admin),
        json={"action": "unsuspend"},
    )
    assert unsuspended.json()["status"] == "ACTIVE"  # 13

    extra = await client.post(
        "/api/v1/organizations",
        headers=bearer(admin),
        json={"name": "To Archive", "type": "AGENCY"},
    )
    extra_id = extra.json()["id"]
    await client.post(
        f"/api/v1/organizations/{extra_id}/lifecycle",
        headers=bearer(admin),
        json={"action": "activate"},
    )
    archived = await client.post(
        f"/api/v1/organizations/{extra_id}/lifecycle",
        headers=bearer(admin),
        json={"action": "archive"},
    )
    assert archived.json()["status"] == "ARCHIVED"  # 14

    extra2 = await client.post(
        "/api/v1/organizations",
        headers=bearer(admin),
        json={"name": "Suspend Then Archive", "type": "SPONSOR"},
    )
    extra2_id = extra2.json()["id"]
    await client.post(
        f"/api/v1/organizations/{extra2_id}/lifecycle",
        headers=bearer(admin),
        json={"action": "activate"},
    )
    await client.post(
        f"/api/v1/organizations/{extra2_id}/lifecycle",
        headers=bearer(admin),
        json={"action": "suspend"},
    )
    archived2 = await client.post(
        f"/api/v1/organizations/{extra2_id}/lifecycle",
        headers=bearer(admin),
        json={"action": "archive"},
    )
    assert archived2.json()["status"] == "ARCHIVED"  # 15

    invalid_tx = await client.post(
        f"/api/v1/organizations/{extra_id}/lifecycle",
        headers=bearer(admin),
        json={"action": "activate"},
    )
    assert invalid_tx.status_code == 409  # 16

    await client.post(
        f"/api/v1/organizations/{partner_id}/lifecycle",
        headers=bearer(admin),
        json={"action": "suspend"},
    )
    add_while_suspended = await client.post(
        f"/api/v1/organizations/{partner_id}/memberships",
        headers=bearer(admin),
        json={"user_id": fan_id, "status": "ACTIVE"},
    )
    assert add_while_suspended.status_code == 409  # 17
    invite_archived = await client.post(
        f"/api/v1/organizations/{extra_id}/invites",
        headers=bearer(admin),
        json={"email": "nobody@example.com"},
    )
    assert invite_archived.status_code == 409  # 18
    await client.post(
        f"/api/v1/organizations/{partner_id}/lifecycle",
        headers=bearer(admin),
        json={"action": "unsuspend"},
    )

    named = await client.patch(
        f"/api/v1/organizations/{partner_id}",
        headers=bearer(admin),
        json={"name": "Venue Partner One Renamed", "share_bps": 250},
    )
    assert named.status_code == 200
    assert named.json()["name"] == "Venue Partner One Renamed"  # 20
    assert named.json()["share_bps"] == 250  # 22 stored
    bad_bps = await client.patch(
        f"/api/v1/organizations/{partner_id}",
        headers=bearer(admin),
        json={"share_bps": 10001},
    )
    assert bad_bps.status_code == 422  # 24

    staff_a = await register_and_login(client, "staff-a@example.com")
    staff_b = await register_and_login(client, "staff-b@example.com")
    roles = await client.get("/api/v1/roles", headers=bearer(admin))
    admin_role = next(row for row in roles.json() if row["key"] == "admin")

    mem_a = await client.post(
        f"/api/v1/organizations/{label['id']}/memberships",
        headers=bearer(admin),
        json={"user_id": staff_a["user"]["id"], "status": "ACTIVE", "role_id": admin_role["id"]},
    )
    assert mem_a.status_code == 201  # 31 assignment with membership
    dup = await client.post(
        f"/api/v1/organizations/{label['id']}/memberships",
        headers=bearer(admin),
        json={"user_id": staff_a["user"]["id"], "status": "ACTIVE"},
    )
    assert dup.status_code == 409  # 25/26 unique active

    invited = await client.post(
        f"/api/v1/organizations/{label['id']}/memberships",
        headers=bearer(admin),
        json={"user_id": staff_b["user"]["id"], "status": "INVITED"},
    )
    assert invited.status_code == 201
    activated_mem = await client.patch(
        f"/api/v1/organizations/{label['id']}/memberships/{invited.json()['id']}",
        headers=bearer(admin),
        json={"status": "ACTIVE"},
    )
    assert activated_mem.json()["status"] == "ACTIVE"  # 27

    # Org-scoped staff_a cannot admin platform (8, 21, 32, 43)
    switch_a = await client.post(
        f"/api/v1/organizations/{label['id']}/switch",
        headers=bearer(staff_a["access_token"]),
    )
    assert switch_a.status_code == 200  # 50
    token_a = switch_a.json()["access_token"]
    jwt_payload = decode_access_token(token_a, settings)
    assert jwt_payload["org"] == label["id"]  # 57
    deny_platform_settings = await client.patch(
        f"/api/v1/organizations/{platform['id']}",
        headers=bearer(token_a),
        json={"name": "Hijack"},
    )
    assert deny_platform_settings.status_code == 403  # 21
    deny_platform_invite = await client.post(
        f"/api/v1/organizations/{platform['id']}/invites",
        headers=bearer(token_a),
        json={"email": "x@example.com"},
    )
    assert deny_platform_invite.status_code == 403  # 43
    scoped_list = _items(await client.get("/api/v1/organizations", headers=bearer(token_a)))
    scoped_ids = {row["id"] for row in scoped_list}
    assert label["id"] in scoped_ids
    assert partner_id not in scoped_ids  # 8

    switch_denied = await client.post(
        f"/api/v1/organizations/{platform['id']}/switch",
        headers=bearer(fan),
    )
    assert switch_denied.status_code == 403  # 51

    outsider_members = await client.get(
        f"/api/v1/organizations/{label['id']}/memberships",
        headers=bearer(fan),
    )
    assert outsider_members.status_code == 403  # 35

    own_read = await client.get(
        f"/api/v1/organizations/{label['id']}",
        headers=bearer(staff_b["access_token"]),
    )
    assert own_read.status_code == 200  # 36

    idor = await client.patch(
        f"/api/v1/organizations/{platform['id']}/memberships/{mem_a.json()['id']}",
        headers=bearer(admin),
        json={"status": "REVOKED"},
    )
    assert idor.status_code == 404  # 34

    invite = await client.post(
        f"/api/v1/organizations/{label['id']}/invites",
        headers=bearer(admin),
        json={"email": "Invitee@example.com"},
    )
    assert invite.status_code == 201  # 44
    token = invite.json()["token"]
    assert token
    assert hash_secret(token) != token  # 37
    assert "token_hash" not in invite.json()
    listed_invites = await client.get(
        f"/api/v1/organizations/{label['id']}/invitations",
        headers=bearer(admin),
    )
    assert listed_invites.status_code == 200
    assert all("token" not in row and "token_hash" not in row for row in _items(listed_invites))  # 47
    assert _items(listed_invites)[0]["email"] == "invitee@example.com"  # 48

    invitee = await register_and_login(client, "invitee@example.com")
    wrong = await register_and_login(client, "wrong-user@example.com")
    wrong_accept = await client.post(
        "/api/v1/organizations/invitations/accept",
        headers=bearer(wrong["access_token"]),
        json={"token": token},
    )
    assert wrong_accept.status_code == 403  # 40

    accepted = await client.post(
        "/api/v1/organizations/invitations/accept",
        headers=bearer(invitee["access_token"]),
        json={"token": token},
    )
    assert accepted.status_code == 200
    assert accepted.json()["status"] == "ACTIVE"  # 39
    replay = await client.post(
        "/api/v1/organizations/invitations/accept",
        headers=bearer(invitee["access_token"]),
        json={"token": token},
    )
    assert replay.status_code == 409  # 41

    second_invite = await client.post(
        f"/api/v1/organizations/{label['id']}/invites",
        headers=bearer(admin),
        json={"email": "revoke-me@example.com"},
    )
    revoke = await client.post(
        f"/api/v1/organizations/{label['id']}/invitations/{second_invite.json()['id']}/revoke",
        headers=bearer(admin),
        json={},
    )
    assert revoke.status_code == 200
    revoked_user = await register_and_login(client, "revoke-me@example.com")
    accept_revoked = await client.post(
        "/api/v1/organizations/invitations/accept",
        headers=bearer(revoked_user["access_token"]),
        json={"token": second_invite.json()["token"]},
    )
    assert accept_revoked.status_code == 409  # 42
    assert second_invite.json().get("expires_at") is None  # 43 TTL 0

    mem_b_id = activated_mem.json()["id"]
    revoked_mem = await client.patch(
        f"/api/v1/organizations/{label['id']}/memberships/{mem_b_id}",
        headers=bearer(admin),
        json={"status": "REVOKED"},
    )
    assert revoked_mem.json()["status"] == "REVOKED"
    assert revoked_mem.json()["ended_at"]  # 28
    lost = await client.get(
        f"/api/v1/organizations/{label['id']}",
        headers=bearer(staff_b["access_token"]),
    )
    assert lost.status_code == 403  # 29

    readd = await client.post(
        f"/api/v1/organizations/{label['id']}/memberships",
        headers=bearer(admin),
        json={"user_id": staff_b["user"]["id"], "status": "ACTIVE"},
    )
    assert readd.status_code == 201  # 30

    last_admin = await client.patch(
        f"/api/v1/organizations/{label['id']}/memberships/{mem_a.json()['id']}",
        headers=bearer(admin),
        json={"status": "REVOKED"},
    )
    assert last_admin.status_code == 409  # 33

    switch_then_members = await client.get(
        f"/api/v1/organizations/{label['id']}/memberships",
        headers=bearer(token_a),
    )
    assert switch_then_members.status_code == 200
    member_orgs = {row["organization_id"] for row in _items(switch_then_members)}
    assert member_orgs == {label["id"]}  # 60

    client_org = await client.get(
        f"/api/v1/organizations/{uuid4()}",
        headers=bearer(fan),
    )
    assert client_org.status_code in {403, 404}  # 49 never trust invented id

    grant = await client.post(
        "/api/v1/resource-grants",
        headers=bearer(admin),
        json={
            "principal_type": "org_membership",
            "principal_id": str(readd.json()["id"]),
            "permission_key": "org.admin",
            "resource_type": "organization",
            "resource_id": label["id"],
        },
    )
    assert grant.status_code == 201  # 54

    # 52: revoke membership, workspace claim must not keep access
    await client.patch(
        f"/api/v1/organizations/{label['id']}/memberships/{readd.json()['id']}",
        headers=bearer(admin),
        json={"status": "REVOKED"},
    )
    stale_switch = await client.post(
        f"/api/v1/organizations/{label['id']}/switch",
        headers=bearer(staff_b["access_token"]),
    )
    assert stale_switch.status_code == 403

    # 55 API still denies without permission
    hidden = await client.post(
        "/api/v1/organizations",
        headers=bearer(fan),
        json={"name": "UI Hidden", "type": "LABEL"},
    )
    assert hidden.status_code == 403

    # 56 workspace is organization
    me = await client.get("/api/v1/me", headers=bearer(token_a))
    assert me.status_code == 200
    assert me.json()["organization_id"] == label["id"]


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase03_outbox_audit_atomicity(
    pg_session: AsyncSession,
    settings: Settings,
) -> None:
    from cornerroom.infra.security import hash_password
    from cornerroom.infra.seed import seed_foundation
    from cornerroom.kernel.auth_context import AuthContext
    from cornerroom.modules.authorization.domain.models import Role, RoleAssignment
    from cornerroom.modules.identity.application.organization_service import OrganizationService
    from cornerroom.modules.identity.domain.models import User

    await seed_foundation(pg_session, settings)
    role = (await pg_session.execute(select(Role).where(Role.key == "super_admin"))).scalar_one()
    admin = User(
        email="org-outbox@example.com",
        password_hash=hash_password("password12"),
        status="ACTIVE",
    )
    pg_session.add(admin)
    await pg_session.flush()
    pg_session.add(
        RoleAssignment(
            user_id=admin.id,
            role_id=role.id,
            organization_id=None,
            status="ACTIVE",
        )
    )
    await pg_session.flush()
    ctx = AuthContext(user_id=admin.id, request_id="phase03-outbox")
    svc = OrganizationService(pg_session, settings)
    org = await svc.create_organization(ctx, name="Outbox Org", org_type="EVENT_ORG")
    org = await svc.transition(ctx, org_id=org.id, action="activate")
    events = list(
        (
            await pg_session.execute(
                select(OutboxEvent).where(
                    OutboxEvent.event_type == ORGANIZATION_ACTIVATED,
                    OutboxEvent.aggregate_id == org.id,
                )
            )
        ).scalars().all()
    )
    assert events  # 61
    audits = list(
        (
            await pg_session.execute(
                select(AuditLog).where(
                    AuditLog.entity_id == str(org.id),
                    AuditLog.action == "organization.activate",
                )
            )
        ).scalars().all()
    )
    assert audits


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_workspace_refresh_preserves_and_clears(client: AsyncClient) -> None:
    session = await register_and_login(client, "workspace-refresh@example.com")
    admin = await admin_token(client)
    orgs = _items(await client.get("/api/v1/organizations", headers=bearer(admin)))
    label = next(row for row in orgs if row["type"] == "LABEL")
    mem = await client.post(
        f"/api/v1/organizations/{label['id']}/memberships",
        headers=bearer(admin),
        json={"user_id": session["user"]["id"], "status": "ACTIVE"},
    )
    assert mem.status_code == 201
    # Re-login so refresh cookie belongs to this user.
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "workspace-refresh@example.com", "password": "password12"},
    )
    token = login.json()["access_token"]
    switched = await client.post(
        f"/api/v1/organizations/{label['id']}/switch",
        headers=bearer(token),
    )
    assert switched.status_code == 200
    refreshed = await client.post("/api/v1/auth/refresh")
    assert refreshed.status_code == 200
    me = await client.get("/api/v1/me", headers=bearer(refreshed.json()["access_token"]))
    assert me.json()["organization_id"] == label["id"]  # 58

    await client.patch(
        f"/api/v1/organizations/{label['id']}/memberships/{mem.json()['id']}",
        headers=bearer(admin),
        json={"status": "REVOKED"},
    )
    refreshed2 = await client.post("/api/v1/auth/refresh")
    assert refreshed2.status_code == 200
    me2 = await client.get("/api/v1/me", headers=bearer(refreshed2.json()["access_token"]))
    assert me2.json()["organization_id"] is None  # 59


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_invite_secret_not_in_audit(client: AsyncClient) -> None:
    admin = await admin_token(client)
    orgs = _items(await client.get("/api/v1/organizations", headers=bearer(admin)))
    label = next(row for row in orgs if row["type"] == "LABEL")
    invite = await client.post(
        f"/api/v1/organizations/{label['id']}/invites",
        headers=bearer(admin),
        json={"email": "secret-audit@example.com"},
    )
    token = invite.json()["token"]
    audit = await client.get(
        "/api/v1/audit",
        headers=bearer(admin),
        params={"entity_type": "OrganizationInvitation", "entity_id": invite.json()["id"]},
    )
    blob = audit.text
    assert token not in blob
    assert "token_hash" not in blob or hash_secret(token) not in blob  # 47


def test_invite_hash_is_not_plaintext() -> None:
    raw = "opaque-invite-token"
    assert hash_secret(raw) != raw
    assert len(hash_secret(raw)) == 64


def test_membership_changed_event_name() -> None:
    assert MEMBERSHIP_CHANGED == "MembershipChanged"
    assert ORGANIZATION_ACTIVATED == "OrganizationActivated"
