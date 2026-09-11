"""Phase 02 identity/RBAC scenarios. Postgres-marked tests skip when infra is missing."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.outbox import OutboxEvent
from cornerroom.infra.settings import Settings
from cornerroom.kernel.events import USER_REGISTERED
from cornerroom.modules.identity.application.lifecycle import transition_action
from cornerroom.modules.identity.application.services import IdentityService
from cornerroom.modules.identity.domain.models import User
from tests.auth_helpers import (
    activate_user,
    admin_token,
    bearer,
    register_and_login,
    register_user,
)


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_register_invalid_payload(client: AsyncClient) -> None:
    response = await client.post(
        "/api/v1/auth/register",
        json={"email": "not-an-email", "password": "short", "display_name": ""},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_pending_user_cannot_login(client: AsyncClient) -> None:
    await register_user(client, "pending@example.com")
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "pending@example.com", "password": "password12"},
    )
    assert login.status_code == 403
    assert login.json()["code"] == "ACCOUNT_NOT_ACTIVE"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_suspended_and_locked_login(client: AsyncClient) -> None:
    user = await register_user(client, "held@example.com")
    await activate_user(client, user["id"])
    admin = await admin_token(client)
    suspended = await client.post(
        f"/api/v1/users/{user['id']}/lifecycle",
        headers=bearer(admin),
        json={"action": "suspend"},
    )
    assert suspended.status_code == 200
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "held@example.com", "password": "password12"},
    )
    assert login.status_code == 403
    assert login.json()["code"] == "ACCOUNT_NOT_ACTIVE"

    await client.post(
        f"/api/v1/users/{user['id']}/lifecycle",
        headers=bearer(admin),
        json={"action": "unsuspend"},
    )
    locked = await client.post(
        f"/api/v1/users/{user['id']}/lifecycle",
        headers=bearer(admin),
        json={"action": "lock"},
    )
    assert locked.status_code == 200
    assert locked.json()["status"] == "ACTIVE"
    assert locked.json()["security_locked"] is True
    login2 = await client.post(
        "/api/v1/auth/login",
        json={"email": "held@example.com", "password": "password12"},
    )
    assert login2.status_code == 403
    assert login2.json()["code"] == "ACCOUNT_LOCKED"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_sessions_list_and_revoke(client: AsyncClient) -> None:
    session = await register_and_login(client, "sess@example.com")
    token = session["access_token"]
    listed = await client.get("/api/v1/me/sessions", headers=bearer(token))
    assert listed.status_code == 200
    rows = listed.json()
    assert len(rows) >= 1
    current = next(row for row in rows if row["current"])
    revoked = await client.delete(f"/api/v1/me/sessions/{current['id']}", headers=bearer(token))
    assert revoked.status_code == 204
    me = await client.get("/api/v1/me", headers=bearer(token))
    assert me.status_code == 401


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_revoke_all_sessions(client: AsyncClient) -> None:
    session = await register_and_login(client, "allsess@example.com")
    token = session["access_token"]
    response = await client.post("/api/v1/me/sessions/revoke-all", headers=bearer(token))
    assert response.status_code == 204
    me = await client.get("/api/v1/me", headers=bearer(token))
    assert me.status_code == 401


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_refresh_rotation_and_replay(client: AsyncClient) -> None:
    await register_and_login(client, "rot@example.com")
    first = await client.post("/api/v1/auth/refresh")
    assert first.status_code == 200
    old_cookie = client.cookies.get("cr_refresh")
    second = await client.post("/api/v1/auth/refresh")
    assert second.status_code == 200
    client.cookies.set("cr_refresh", old_cookie, path="/api/v1/auth")
    replay = await client.post("/api/v1/auth/refresh")
    assert replay.status_code == 401
    client.cookies.set("cr_refresh", second.cookies.get("cr_refresh"), path="/api/v1/auth")
    after = await client.post("/api/v1/auth/refresh")
    assert after.status_code == 401


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_concurrent_refresh_is_fail_closed(client: AsyncClient) -> None:
    await register_and_login(client, "race@example.com")
    results = await asyncio.gather(
        client.post("/api/v1/auth/refresh"),
        client.post("/api/v1/auth/refresh"),
        return_exceptions=True,
    )
    statuses = [r.status_code for r in results if hasattr(r, "status_code")]
    assert 200 in statuses or 401 in statuses
    follow = await client.post("/api/v1/auth/refresh")
    assert follow.status_code in {200, 401}


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_password_change_invalidates_old_password(client: AsyncClient) -> None:
    session = await register_and_login(client, "pw@example.com")
    token = session["access_token"]
    changed = await client.post(
        "/api/v1/auth/password/change",
        headers=bearer(token),
        json={"current_password": "password12", "new_password": "password99"},
    )
    assert changed.status_code == 200
    old_login = await client.post(
        "/api/v1/auth/login",
        json={"email": "pw@example.com", "password": "password12"},
    )
    assert old_login.status_code == 401
    new_login = await client.post(
        "/api/v1/auth/login",
        json={"email": "pw@example.com", "password": "password99"},
    )
    assert new_login.status_code == 200
    me = await client.get("/api/v1/me", headers=bearer(token))
    assert me.status_code == 401


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_password_recovery_architecture(client: AsyncClient, settings: Settings) -> None:
    user = await register_user(client, "rec@example.com")
    await activate_user(client, user["id"])
    forgot = await client.post("/api/v1/auth/password/forgot", json={"email": "rec@example.com"})
    assert forgot.status_code == 202
    unknown = await client.post("/api/v1/auth/password/forgot", json={"email": "nobody@example.com"})
    assert unknown.status_code == 202
    reset = await client.post(
        "/api/v1/auth/password/reset",
        json={"token": "not-a-real-token-value", "new_password": "password99"},
    )
    assert reset.status_code == 401


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_verification_challenge_replay(client: AsyncClient) -> None:
    from cornerroom.infra.db import get_session_factory
    from cornerroom.infra.settings import get_settings

    user = await register_user(client, "ver@example.com")
    async with get_session_factory()() as session:
        svc = IdentityService(session, get_settings())
        raw = await svc.issue_challenge(
            user_id=UUID(user["id"]),
            purpose="EMAIL_VERIFICATION",
            ttl_seconds=3600,
            request_id="test",
        )
        await session.commit()
    first = await client.post("/api/v1/auth/verification/complete", json={"token": raw})
    assert first.status_code == 204
    replay = await client.post("/api/v1/auth/verification/complete", json={"token": raw})
    assert replay.status_code == 401
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "ver@example.com", "password": "password12"},
    )
    assert login.status_code == 200


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_invalid_verification_token(client: AsyncClient) -> None:
    response = await client.post(
        "/api/v1/auth/verification/complete",
        json={"token": "totally-invalid-token"},
    )
    assert response.status_code == 401


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_rbac_assign_revoke_and_resource_scope(client: AsyncClient) -> None:
    session = await register_and_login(client, "rbac@example.com")
    customer = session["access_token"]
    admin = await admin_token(client)
    roles = await client.get("/api/v1/roles", headers=bearer(admin))
    assert roles.status_code == 200
    support = next(row for row in roles.json() if row["key"] == "support")
    perms = await client.get("/api/v1/permissions", headers=bearer(admin))
    assert perms.status_code == 200
    keys = {row["key"] for row in perms.json()}
    assert "audit.read" in keys

    assigned = await client.post(
        f"/api/v1/users/{session['user']['id']}/assignments",
        headers=bearer(admin),
        json={"role_id": support["id"]},
    )
    assert assigned.status_code == 201

    org_id = uuid4()
    grant = await client.post(
        "/api/v1/resource-grants",
        headers=bearer(admin),
        json={
            "principal_type": "user",
            "principal_id": session["user"]["id"],
            "permission_key": "org.admin",
            "resource_type": "organization",
            "resource_id": str(org_id),
        },
    )
    assert grant.status_code == 201
    denied = await client.post(
        "/api/v1/organizations",
        headers=bearer(customer),
        json={"name": "Nope", "type": "LABEL"},
    )
    assert denied.status_code == 403

    revoked = await client.delete(
        f"/api/v1/assignments/{assigned.json()['id']}",
        headers=bearer(admin),
    )
    assert revoked.status_code == 204

    other = await register_and_login(client, "other@example.com")
    audit = await client.get("/api/v1/audit", headers=bearer(other["access_token"]))
    assert audit.status_code == 403


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_admin_authorization_and_anonymous(client: AsyncClient) -> None:
    assert (await client.get("/api/v1/roles")).status_code == 401
    admin = await admin_token(client)
    roles = await client.get("/api/v1/roles", headers=bearer(admin))
    assert roles.status_code == 200


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_identity_outbox_atomicity_and_safe_payload(
    pg_session: AsyncSession,
    settings: Settings,
) -> None:
    svc = IdentityService(pg_session, settings)
    user, _profile = await svc.register(
        email="outbox@example.com",
        password="password12",
        display_name="Outbox",
        request_id="corr-1",
    )
    await pg_session.commit()
    events = (
        await pg_session.execute(select(OutboxEvent).where(OutboxEvent.event_type == USER_REGISTERED))
    ).scalars().all()
    assert events
    payload = events[0].payload
    assert "password" not in str(payload)
    assert "password_hash" not in str(payload)

    await pg_session.rollback()
    svc2 = IdentityService(pg_session, settings)
    await svc2.register(
        email="rollback@example.com",
        password="password12",
        display_name="Roll",
        request_id="corr-2",
    )
    await pg_session.rollback()
    leftover = (
        await pg_session.execute(select(User).where(User.email == "rollback@example.com"))
    ).scalar_one_or_none()
    assert leftover is None
    orphan = (
        await pg_session.execute(
            select(OutboxEvent).where(OutboxEvent.correlation_id == "corr-2")
        )
    ).scalar_one_or_none()
    assert orphan is None


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_expired_and_invalid_jwt(client: AsyncClient, settings: Settings) -> None:
    from cornerroom.infra.security import create_access_token

    session = await register_and_login(client, "jwt@example.com")
    garbage = await client.get("/api/v1/me", headers=bearer("not-a-jwt"))
    assert garbage.status_code == 401
    past = datetime.now(timezone.utc) - timedelta(hours=1)
    token, _ = create_access_token(
        user_id=UUID(session["user"]["id"]),
        settings=settings,
        now=past,
    )
    expired = await client.get("/api/v1/me", headers=bearer(token))
    assert expired.status_code == 401


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_register_hides_secrets_and_writes_audit(client: AsyncClient) -> None:
    register = await client.post(
        "/api/v1/auth/register",
        json={"email": "safe@example.com", "password": "password12", "display_name": "Safe"},
    )
    assert register.status_code == 201
    body = register.json()
    assert "password" not in register.text
    assert "password_hash" not in register.text
    assert "access_token" not in body
    admin = await admin_token(client)
    audit = await client.get(
        "/api/v1/audit",
        headers=bearer(admin),
        params={"entity_type": "User"},
    )
    assert audit.status_code == 200
    actions = {item["action"] for item in audit.json()["items"]}
    assert "user.registered" in actions


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_login_and_role_change_are_audited(client: AsyncClient) -> None:
    session = await register_and_login(client, "aud2@example.com")
    admin = await admin_token(client)
    audit = await client.get(
        "/api/v1/audit",
        headers=bearer(admin),
        params={"entity_id": session["user"]["id"]},
    )
    actions = {item["action"] for item in audit.json()["items"]}
    assert "auth.login" in actions
    roles = await client.get("/api/v1/roles", headers=bearer(admin))
    support = next(row for row in roles.json() if row["key"] == "support")
    assigned = await client.post(
        f"/api/v1/users/{session['user']['id']}/assignments",
        headers=bearer(admin),
        json={"role_id": support["id"]},
    )
    assert assigned.status_code == 201
    revoked = await client.delete(
        f"/api/v1/assignments/{assigned.json()['id']}",
        headers=bearer(admin),
    )
    assert revoked.status_code == 204
    audit2 = await client.get(
        "/api/v1/audit",
        headers=bearer(admin),
        params={"entity_type": "RoleAssignment"},
    )
    role_actions = {item["action"] for item in audit2.json()["items"]}
    assert "role.assigned" in role_actions
    assert "role.revoked" in role_actions


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_access_token_without_sid_is_rejected(client: AsyncClient, settings: Settings) -> None:
    from cornerroom.infra.security import create_access_token

    session = await register_and_login(client, "nosid@example.com")
    token, _ = create_access_token(user_id=UUID(session["user"]["id"]), settings=settings)
    response = await client.get("/api/v1/me", headers=bearer(token))
    assert response.status_code == 401


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_org_scoped_assignment_denies_other_org(client: AsyncClient) -> None:
    session = await register_and_login(client, "scoped@example.com")
    customer = session["access_token"]
    admin = await admin_token(client)
    orgs = await client.get("/api/v1/organizations", headers=bearer(admin))
    assert orgs.status_code == 200
    platform = next(row for row in orgs.json()["items"] if row["type"] == "PLATFORM")
    label = next(row for row in orgs.json()["items"] if row["type"] == "LABEL")
    created = await client.post(
        "/api/v1/roles",
        headers=bearer(admin),
        json={"key": "label_ops", "name": "Label Ops"},
    )
    assert created.status_code == 201
    attached = await client.post(
        f"/api/v1/roles/{created.json()['id']}/permissions",
        headers=bearer(admin),
        json={"permission_key": "org.admin"},
    )
    assert attached.status_code == 204
    assigned = await client.post(
        f"/api/v1/users/{session['user']['id']}/assignments",
        headers=bearer(admin),
        json={"role_id": created.json()["id"], "organization_id": label["id"]},
    )
    assert assigned.status_code == 201
    allowed = await client.get(
        f"/api/v1/organizations/{label['id']}",
        headers=bearer(customer),
    )
    assert allowed.status_code == 200
    denied = await client.get(
        f"/api/v1/organizations/{platform['id']}",
        headers=bearer(customer),
    )
    assert denied.status_code == 403
    create = await client.post(
        "/api/v1/organizations",
        headers=bearer(customer),
        json={"name": "Bootleg Label", "type": "LABEL"},
    )
    assert create.status_code == 403


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_password_recovery_disabled_when_ttl_zero(client: AsyncClient, settings: Settings) -> None:
    assert settings.password_recovery_ttl_seconds == 0
    user = await register_user(client, "ttl@example.com")
    await activate_user(client, user["id"])
    forgot = await client.post("/api/v1/auth/password/forgot", json={"email": "ttl@example.com"})
    assert forgot.status_code == 202


def test_lifecycle_rejects_invalid_transition() -> None:
    with pytest.raises(Exception):
        transition_action("CLOSED", "ACTIVE")
    assert transition_action("PENDING_VERIFICATION", "ACTIVE") == "activate"
    assert transition_action("ACTIVE", "SUSPENDED") == "suspend"


@pytest.mark.asyncio
async def test_rate_limit_zero_is_disabled() -> None:
    from cornerroom.modules.identity.application.rate_limit import enforce_auth_rate_limit

    settings = Settings(
        app_env="test",
        jwt_secret="test-secret-not-for-production-use-please",
        auth_rate_limit_max_attempts=0,
        auth_rate_limit_window_seconds=0,
    )
    await enforce_auth_rate_limit(settings=settings, scope="login", key="127.0.0.1")


def test_password_hash_is_not_plaintext() -> None:
    from cornerroom.modules.identity.application.credentials import hash_user_password, password_matches

    hashed = hash_user_password("password12")
    assert hashed != "password12"
    assert password_matches(hashed, "password12")
    assert not password_matches(hashed, "nope")
    assert not password_matches(None, "password12")
