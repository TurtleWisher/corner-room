"""Shared auth helpers for postgres integration tests."""

from __future__ import annotations

from httpx import AsyncClient

ADMIN = {"email": "admin@example.com", "password": "adminpass12"}


async def admin_token(client: AsyncClient) -> str:
    login = await client.post("/api/v1/auth/login", json=ADMIN)
    assert login.status_code == 200, login.text
    return login.json()["access_token"]


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def register_user(
    client: AsyncClient,
    email: str,
    password: str = "password12",
    display_name: str = "Fan",
) -> dict:
    response = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "display_name": display_name},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert "access_token" not in body
    assert body["user"]["status"] == "PENDING_VERIFICATION"
    return body["user"]


async def activate_user(client: AsyncClient, user_id: str) -> None:
    token = await admin_token(client)
    response = await client.post(
        f"/api/v1/users/{user_id}/lifecycle",
        headers=bearer(token),
        json={"action": "activate"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "ACTIVE"


async def register_and_login(
    client: AsyncClient,
    email: str,
    password: str = "password12",
    display_name: str = "Fan",
) -> dict:
    user = await register_user(client, email, password, display_name)
    await activate_user(client, user["id"])
    login = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert login.status_code == 200, login.text
    return login.json()
