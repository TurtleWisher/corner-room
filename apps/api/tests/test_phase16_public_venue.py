"""Phase 16 Stage 6: public event pages show the venue's name and city (D-EV-03), nothing else
about the venue, and the postponed or cancelled context the poster prints (events.md section 3)."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from httpx import AsyncClient

from tests.auth_helpers import admin_token, bearer

START = datetime(2026, 12, 4, 18, 0, tzinfo=timezone.utc)
END = datetime(2026, 12, 4, 22, 0, tzinfo=timezone.utc)


async def _platform_token(client: AsyncClient) -> str:
    admin = await admin_token(client)
    orgs = (await client.get("/api/v1/organizations", headers=bearer(admin))).json()["items"]
    platform = next(row for row in orgs if row["type"] == "PLATFORM")
    switched = await client.post(f"/api/v1/organizations/{platform['id']}/switch", headers=bearer(admin))
    assert switched.status_code == 200, switched.text
    return switched.json()["access_token"]


async def _published_event(client: AsyncClient, token: str, title: str) -> str:
    created = await client.post(
        "/api/v1/events",
        headers=bearer(token),
        json={"title": title, "description": "Public copy", "timezone": "Asia/Dhaka", "starts_at": START.isoformat(), "ends_at": END.isoformat()},
    )
    assert created.status_code == 201, created.text
    event_id = created.json()["id"]
    for action in ("plan", "publish"):
        moved = await client.post(f"/api/v1/events/{event_id}/lifecycle", headers=bearer(token), json={"action": action})
        assert moved.status_code == 200, moved.text
    return event_id


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase16_public_event_shows_venue_name_and_city_only(client: AsyncClient) -> None:
    token = await _platform_token(client)
    event_id = await _published_event(client, token, "Venue Night")

    bare = (await client.get(f"/api/v1/events/{event_id}")).json()
    assert bare["venue"] is None

    venue = await client.post(
        "/api/v1/venues",
        headers=bearer(token),
        json={"name": "Hall Two", "capacity": 300, "address": {"city": "Dhaka", "line1": "Private street 9"}},
    )
    assert venue.status_code == 201, venue.text
    venue_id = venue.json()["id"]
    activated = await client.post(f"/api/v1/venues/{venue_id}/lifecycle", headers=bearer(token), json={"action": "activate"})
    assert activated.status_code == 200, activated.text
    assigned = await client.post(f"/api/v1/events/{event_id}/venue", headers=bearer(token), json={"venue_id": venue_id})
    assert assigned.status_code == 200, assigned.text

    guest = (await client.get(f"/api/v1/events/{event_id}")).json()
    assert guest["venue"] == {"name": "Hall Two", "city": "Dhaka"}
    # A poster prints the place, never the street, capacity or the venue's records.
    assert "Private street" not in str(guest)
    assert "capacity" not in str(guest)

    listed = (await client.get("/api/v1/events", params={"limit": 100})).json()["items"]
    row = next(item for item in listed if item["id"] == event_id)
    assert row["venue"] == {"name": "Hall Two", "city": "Dhaka"}

    # Venues still need sign-in on their own.
    assert (await client.get(f"/api/v1/venues/{venue_id}")).status_code in (401, 403, 404)

    # Once the venue is inactive it is no longer named publicly.
    deactivated = await client.post(f"/api/v1/venues/{venue_id}/lifecycle", headers=bearer(token), json={"action": "deactivate"})
    assert deactivated.status_code == 200, deactivated.text
    assert (await client.get(f"/api/v1/events/{event_id}")).json()["venue"] is None


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase16_public_event_carries_postponed_and_cancelled_context(client: AsyncClient) -> None:
    token = await _platform_token(client)
    event_id = await _published_event(client, token, "Moved Night")
    later = datetime(2026, 12, 11, 18, 0, tzinfo=timezone.utc)
    moved = await client.post(
        f"/api/v1/events/{event_id}/lifecycle",
        headers=bearer(token),
        json={"action": "postpone", "starts_at": later.isoformat(), "ends_at": later.replace(hour=22).isoformat(), "reason": "Storm warning"},
    )
    assert moved.status_code == 200, moved.text
    guest = (await client.get(f"/api/v1/events/{event_id}")).json()
    assert guest["status"] == "POSTPONED"
    assert guest["postponement_reason"] == "Storm warning"
    assert guest["previous_starts_at"].startswith("2026-12-04T18:00")
    assert guest["starts_at"].startswith("2026-12-11T18:00")
    assert "version" not in guest and "organization_id" not in guest

    cancelled = await client.post(
        f"/api/v1/events/{event_id}/lifecycle",
        headers=bearer(token),
        json={"action": "cancel", "reason": "Venue unavailable"},
    )
    assert cancelled.status_code == 200, cancelled.text
    assert (await client.get(f"/api/v1/events/{event_id}")).json()["cancellation_reason"] == "Venue unavailable"
