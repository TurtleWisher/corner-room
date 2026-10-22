"""Official event posters (OD-06; owner 2026-10-23: square, same rules as music covers)."""

from __future__ import annotations

import hashlib
import io
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient

from tests.auth_helpers import admin_token, bearer, register_and_login
from tests.test_audio_phase3_media import _drain_jobs

START = datetime.now(UTC) + timedelta(days=30)


def _image(width: int, height: int) -> bytes:
    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", (width, height), (178, 31, 36)).save(out, format="PNG")
    return out.getvalue()


async def _workspace_admin(client: AsyncClient) -> str:
    admin = await admin_token(client)
    orgs = (await client.get("/api/v1/organizations", headers=bearer(admin))).json()["items"]
    platform = next(row for row in orgs if row["type"] == "PLATFORM")
    return (await client.post(f"/api/v1/organizations/{platform['id']}/switch", headers=bearer(admin))).json()["access_token"]


async def _upload_poster(client: AsyncClient, token: str, event_id: str, data: bytes) -> int:
    intent = await client.post(
        "/api/v1/uploads/intents",
        headers=bearer(token),
        json={"purpose": "COVER_ART", "target_type": "event_cover", "target_id": event_id, "filename": "poster.png", "byte_size": len(data)},
    )
    if intent.status_code != 201:
        return intent.status_code
    it = intent.json()
    for n in range(1, it["part_count"] + 1):
        chunk = data[(n - 1) * it["part_size"] : n * it["part_size"]]
        put = await client.put(
            f"/api/v1/uploads/intents/{it['id']}/parts/{n}",
            headers={**bearer(token), "X-Part-SHA256": hashlib.sha256(chunk).hexdigest()},
            content=chunk,
        )
        assert put.status_code == 200, put.text
    done = await client.post(f"/api/v1/uploads/intents/{it['id']}/complete", headers=bearer(token))
    assert done.status_code == 200, done.text
    await _drain_jobs()
    return 201


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_staff_upload_a_square_poster_that_shows_once_published(client: AsyncClient) -> None:
    staff = await _workspace_admin(client)
    created = await client.post(
        "/api/v1/events",
        headers=bearer(staff),
        json={
            "title": "Poster Night", "timezone": "UTC", "description": "Public copy",
            "starts_at": START.isoformat(), "ends_at": (START + timedelta(hours=3)).isoformat(),
        },
    )
    assert created.status_code == 201, created.text
    event_id = created.json()["id"]
    assert created.json()["has_cover"] is False

    # Only people who may edit the event may upload its poster.
    fan = await register_and_login(client, "poster-fan@example.com")
    assert await _upload_poster(client, fan["access_token"], event_id, _image(1500, 1500)) == 404

    # A non-square poster is turned down, and staff are told why.
    assert await _upload_poster(client, staff, event_id, _image(2000, 1500)) == 201
    report = (await client.get(f"/api/v1/events/{event_id}/cover-report", headers=bearer(staff))).json()
    assert report["asset_status"] == "REJECTED" and report["cover_url"] is None
    assert "COVER_NOT_SQUARE" in {f["code"] for f in report["findings"]}

    # A square one is accepted and attached; staff see it through a signed link.
    assert await _upload_poster(client, staff, event_id, _image(1500, 1500)) == 201
    report = (await client.get(f"/api/v1/events/{event_id}/cover-report", headers=bearer(staff))).json()
    assert report["asset_status"] == "ACCEPTED" and report["is_current"] is True
    assert report["cover_url"].startswith("/api/v1/covers/signed/")
    assert (await client.get(report["cover_url"])).status_code == 200
    assert (await client.get(f"/api/v1/events/{event_id}", headers=bearer(staff))).json()["has_cover"] is True
    assert (await client.get(f"/api/v1/events/{event_id}/cover-report", headers=bearer(fan["access_token"]))).status_code == 404

    # Not public until the event is published.
    url = f"/api/v1/covers/events/{event_id}/480"
    hidden = await client.get(url)
    assert hidden.status_code == 404 and hidden.content == b""
    for action in ("plan", "publish"):
        moved = await client.post(f"/api/v1/events/{event_id}/lifecycle", headers=bearer(staff), json={"action": action})
        assert moved.status_code == 200, moved.text
    public = await client.get(url)
    assert public.status_code == 200 and public.headers["content-type"] == "image/jpeg"
    listed = (await client.get("/api/v1/events")).json()["items"]
    assert next(e for e in listed if e["id"] == event_id)["has_cover"] is True
