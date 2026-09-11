"""Organization and membership integration tests."""

from __future__ import annotations

import pytest
from httpx import AsyncClient


def _admin_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_admin_lists_seed_orgs_and_adds_membership(client: AsyncClient) -> None:
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "adminpass12"},
    )
    token = login.json()["access_token"]

    orgs = await client.get("/api/v1/organizations", headers=_admin_headers(token))
    assert orgs.status_code == 200
    names = {row["name"] for row in orgs.json()["items"]}
    assert "Corner Room Platform" in names
    assert "Corner Room Label" in names

    fan = await client.post(
        "/api/v1/auth/register",
        json={"email": "member@example.com", "password": "password12", "display_name": "Member"},
    )
    user_id = fan.json()["user"]["id"]
    platform = next(row for row in orgs.json()["items"] if row["type"] == "PLATFORM")

    membership = await client.post(
        f"/api/v1/organizations/{platform['id']}/memberships",
        headers=_admin_headers(token),
        json={"user_id": user_id, "status": "ACTIVE"},
    )
    assert membership.status_code == 201, membership.text
    assert membership.json()["status"] == "ACTIVE"

    revoked = await client.patch(
        f"/api/v1/organizations/{platform['id']}/memberships/{membership.json()['id']}",
        headers=_admin_headers(token),
        json={"status": "REVOKED"},
    )
    assert revoked.status_code == 200
    assert revoked.json()["status"] == "REVOKED"
