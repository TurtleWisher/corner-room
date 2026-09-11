"""Auth integration tests."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.auth_helpers import register_user


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_register_login_refresh_logout(client: AsyncClient) -> None:
    register = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "fan@example.com",
            "password": "password12",
            "display_name": "Fan One",
        },
    )
    assert register.status_code == 201, register.text
    body = register.json()
    assert "access_token" not in body
    assert body["user"]["email"] == "fan@example.com"
    assert body["user"]["status"] == "PENDING_VERIFICATION"
    assert "cr_refresh" not in register.cookies

    from tests.auth_helpers import activate_user

    await activate_user(client, body["user"]["id"])
    session_login = await client.post(
        "/api/v1/auth/login",
        json={"email": "fan@example.com", "password": "password12"},
    )
    assert session_login.status_code == 200, session_login.text
    session = session_login.json()

    me = await client.get(
        "/api/v1/me",
        headers={"Authorization": f"Bearer {session['access_token']}"},
    )
    assert me.status_code == 200
    assert me.json()["display_name"] == "Fan One"
    assert me.json()["status"] == "ACTIVE"
    assert me.json()["email_verified"] is False

    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "fan@example.com", "password": "password12"},
    )
    assert login.status_code == 200
    assert login.json()["access_token"]
    assert "password" not in login.text
    assert "password_hash" not in login.text

    refresh = await client.post("/api/v1/auth/refresh")
    assert refresh.status_code == 200
    new_access = refresh.json()["access_token"]
    assert "refresh_token" not in refresh.json()

    logout = await client.post(
        "/api/v1/auth/logout",
        headers={"Authorization": f"Bearer {new_access}"},
    )
    assert logout.status_code == 204


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_login_rejected_wrong_password(client: AsyncClient) -> None:
    user = await register_user(client, "a@example.com")
    from tests.auth_helpers import activate_user

    await activate_user(client, user["id"])
    bad = await client.post(
        "/api/v1/auth/login",
        json={"email": "a@example.com", "password": "nope-nope"},
    )
    assert bad.status_code == 401
    assert bad.json()["code"] == "UNAUTHENTICATED"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_duplicate_email_conflict(client: AsyncClient) -> None:
    payload = {"email": "dup@example.com", "password": "password12", "display_name": "Dup"}
    first = await client.post("/api/v1/auth/register", json=payload)
    assert first.status_code == 201
    second = await client.post("/api/v1/auth/register", json=payload)
    assert second.status_code == 409


@pytest.mark.asyncio
async def test_me_requires_auth() -> None:
    from httpx import ASGITransport

    from cornerroom.infra.settings import Settings
    from cornerroom.main import create_app

    app = create_app(
        Settings(app_env="test", jwt_secret="test-secret-not-for-production-use-please"),
        enable_lifespan=False,
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/me")
    assert response.status_code == 401
