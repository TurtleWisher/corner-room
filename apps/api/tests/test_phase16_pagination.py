"""Keyset pagination: the second page loads, rows sharing a timestamp are never skipped, and a
garbled cursor is a 422 problem rather than a 500."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.settings import Settings
from cornerroom.kernel.pagination import (
    InvalidCursorError,
    decode_keyset,
    encode_cursor,
    keyset_before,
)
from tests.auth_helpers import admin_token, bearer

START = datetime(2026, 12, 6, 18, 0, tzinfo=timezone.utc)


def test_keyset_round_trip() -> None:
    moment = datetime(2026, 10, 11, 17, 37, 14, 553928, tzinfo=timezone.utc)
    entity_id = uuid4()
    assert decode_keyset(encode_cursor(moment.isoformat(), entity_id)) == (moment, entity_id)


@pytest.mark.parametrize(
    "cursor",
    [
        "not base64 at all!",
        "e30=",  # {}
        encode_cursor("yesterday", uuid4()),
        "eyJ0IjoiMjAyNi0xMC0xMVQxNzozNzoxNCswMDowMCIsImlkIjoibm9wZSJ9",  # id "nope"
    ],
)
def test_garbled_cursor_is_rejected(cursor: str) -> None:
    with pytest.raises(InvalidCursorError):
        decode_keyset(cursor)


def test_keyset_condition_has_id_tiebreak() -> None:
    from cornerroom.modules.events.domain.models import Event

    cursor = encode_cursor(START.isoformat(), uuid4())
    sql = str(keyset_before(Event.created_at, Event.id, cursor).compile())
    assert "created_at <" in sql
    assert "created_at =" in sql
    assert "id <" in sql


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase16_events_second_page_and_bad_cursor(client: AsyncClient) -> None:
    admin = await admin_token(client)
    orgs = (await client.get("/api/v1/organizations", headers=bearer(admin))).json()["items"]
    platform = next(row for row in orgs if row["type"] == "PLATFORM")
    switched = await client.post(f"/api/v1/organizations/{platform['id']}/switch", headers=bearer(admin))
    token = switched.json()["access_token"]
    created: set[str] = set()
    for title in ("Page One", "Page Two", "Page Three"):
        made = await client.post(
            "/api/v1/events",
            headers=bearer(token),
            json={
                "title": title,
                "description": "Public copy",
                "timezone": "UTC",
                "starts_at": START.isoformat(),
            },
        )
        assert made.status_code == 201, made.text
        event_id = made.json()["id"]
        for action in ("plan", "publish"):
            moved = await client.post(
                f"/api/v1/events/{event_id}/lifecycle", headers=bearer(token), json={"action": action}
            )
            assert moved.status_code == 200, moved.text
        created.add(event_id)

    seen: list[str] = []
    cursor: str | None = None
    for _ in range(10):
        params: dict[str, str | int] = {"limit": 1}
        if cursor:
            params["cursor"] = cursor
        page = await client.get("/api/v1/events", params=params)
        assert page.status_code == 200, page.text
        body = page.json()
        seen.extend(row["id"] for row in body["items"])
        cursor = body.get("next_cursor")
        if not cursor:
            break
    assert created <= set(seen)
    assert len(seen) == len(set(seen))

    bad = await client.get("/api/v1/events", params={"cursor": "garbage!"})
    assert bad.status_code == 422
    assert bad.json()["code"] == "VALIDATION_ERROR"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase16_rows_sharing_a_timestamp_are_not_skipped(
    pg_session: AsyncSession, settings: Settings
) -> None:
    from cornerroom.infra.seed import seed_foundation
    from cornerroom.modules.events.application.service import EventService
    from cornerroom.modules.events.domain.models import Event
    from cornerroom.modules.identity.domain.models import Organization

    await seed_foundation(pg_session, settings)
    org = (
        await pg_session.execute(
            select(Organization).where(Organization.type == "PLATFORM", Organization.deleted_at.is_(None))
        )
    ).scalar_one()
    same_moment = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
    ids = set()
    for n in range(3):
        event = Event(
            organization_id=org.id,
            title=f"Twin {n}",
            timezone="UTC",
            status="PUBLISHED",
            published_at=same_moment,
            created_at=same_moment,
        )
        pg_session.add(event)
        await pg_session.flush()
        ids.add(event.id)

    svc = EventService(pg_session)
    seen = []
    cursor = None
    for _ in range(10):
        rows, cursor, public_only = await svc.list_events(None, cursor=cursor, limit=1)
        assert public_only
        seen.extend(row.id for row in rows)
        if not cursor:
            break
    assert ids <= set(seen)
    assert len(seen) == len(set(seen))
