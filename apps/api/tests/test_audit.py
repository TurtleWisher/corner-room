"""Audit is written on identity/authz mutations and is append-only."""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_register_writes_audit(client: AsyncClient) -> None:
    await client.post(
        "/api/v1/auth/register",
        json={"email": "audited@example.com", "password": "password12", "display_name": "Aud"},
    )
    admin = await client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "adminpass12"},
    )
    token = admin.json()["access_token"]
    response = await client.get(
        "/api/v1/audit",
        headers={"Authorization": f"Bearer {token}"},
        params={"entity_type": "User"},
    )
    assert response.status_code == 200
    actions = {item["action"] for item in response.json()["items"]}
    assert "user.registered" in actions
    for item in response.json()["items"]:
        assert "password" not in (item.get("new_state") or {})
        assert "password_hash" not in (item.get("new_state") or {})
