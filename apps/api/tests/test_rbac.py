"""RBAC HTTP matrix: anonymous, wrong role, right role."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.auth_helpers import register_and_login


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_anonymous_cannot_read_audit(client: AsyncClient) -> None:
    response = await client.get("/api/v1/audit")
    assert response.status_code == 401


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_customer_forbidden_audit(client: AsyncClient) -> None:
    session = await register_and_login(client, "cust@example.com")
    token = session["access_token"]
    response = await client.get(
        "/api/v1/audit",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 403
    assert response.json()["code"] == "FORBIDDEN"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_admin_can_read_audit(client: AsyncClient) -> None:
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "adminpass12"},
    )
    assert login.status_code == 200, login.text
    token = login.json()["access_token"]
    response = await client.get(
        "/api/v1/audit",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    assert "items" in response.json()


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_customer_cannot_create_org(client: AsyncClient) -> None:
    session = await register_and_login(client, "nope@example.com")
    token = session["access_token"]
    response = await client.post(
        "/api/v1/organizations",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "Bootleg", "type": "LABEL"},
    )
    assert response.status_code == 403
