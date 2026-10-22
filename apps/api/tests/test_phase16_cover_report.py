"""Studio cover report (2026-10-22): an artist sees why a cover was not accepted, not only "checking"."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient

from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase4_studio import _artist_for
from tests.test_audio_phase5_intake import _orgs

REPORT_KEYS = {"filename", "uploaded_at", "asset_status", "outcome", "width_px", "height_px", "findings", "is_current"}


async def _cover(release_id: str, owner_id: str, *, name: str, status: str, size: tuple[int, int], findings: list[tuple[str, str, str, str]], when: datetime) -> str:
    """A finished cover upload with its inspection, as the worker leaves it."""
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.documents.domain.models import MediaAsset, MediaFinding, MediaInspection, UploadIntent

    async with get_session_factory()() as session:
        asset = MediaAsset(
            storage_class="COVER_ART", bucket="local", object_key=f"covers/{uuid4()}", mime="image/jpeg",
            byte_size=1000, sha256="0" * 64, status=status, scan_status="INSPECTED", purpose="COVER_ART",
        )
        session.add(asset)
        await session.flush()
        session.add(
            UploadIntent(
                media_asset_id=asset.id, purpose="COVER_ART", owner_user_id=UUID(owner_id), target_type="release_cover",
                target_id=UUID(release_id), filename=name, declared_byte_size=1000, part_size=1000, part_count=1,
                status="COMPLETED", expires_at=when + timedelta(days=1), completed_at=when,
            )
        )
        inspection = MediaInspection(
            media_asset_id=asset.id, tool="pillow", tool_version="test", container="jpeg", width_px=size[0], height_px=size[1],
            verified_sha256="0" * 64, outcome="REJECTED" if status == "REJECTED" else "ACCEPTED", inspected_at=when,
        )
        session.add(inspection)
        await session.flush()
        for code, severity, measured, limit in findings:
            session.add(MediaFinding(inspection_id=inspection.id, code=code, severity=severity, measured=measured, limit_value=limit))
        await session.commit()
        return str(asset.id)


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_owner_sees_why_the_latest_cover_was_not_accepted(client: AsyncClient) -> None:
    _admin, orgs = await _orgs(client)
    owner = await register_and_login(client, "cover-owner@example.com")
    artist_id = await _artist_for(owner["user"]["id"], orgs["LABEL"], name="Cover Act")
    created = await client.post(
        "/api/v1/studio/releases",
        headers=bearer(owner["access_token"]),
        json={"profile": {"kind": "artist", "id": artist_id}, "release_type": "SINGLE", "title": "Square One"},
    )
    assert created.status_code == 201, created.text
    release_id = created.json()["release"]["id"]
    url = f"/api/v1/studio/releases/{release_id}/cover-report"

    none_yet = await client.get(url, headers=bearer(owner["access_token"]))
    assert none_yet.status_code == 200 and none_yet.json() is None

    now = datetime.now(UTC)
    await _cover(release_id, owner["user"]["id"], name="old.jpg", status="REJECTED", size=(1316, 1088), when=now - timedelta(hours=1),
                 findings=[("COVER_TOO_SMALL", "BLOCK", "1316x1088", "1400 px")])
    await _cover(release_id, owner["user"]["id"], name="wide.jpg", status="REJECTED", size=(4000, 3000), when=now,
                 findings=[("COVER_BELOW_RECOMMENDED", "WARN", "3000 px", "3000 px"), ("COVER_NOT_SQUARE", "BLOCK", "4000x3000", "square")])

    report = await client.get(url, headers=bearer(owner["access_token"]))
    assert report.status_code == 200, report.text
    body = report.json()
    assert set(body) == REPORT_KEYS
    # The latest upload, blocking findings first.
    assert body["filename"] == "wide.jpg" and body["asset_status"] == "REJECTED" and body["outcome"] == "REJECTED"
    assert (body["width_px"], body["height_px"]) == (4000, 3000)
    assert [f["code"] for f in body["findings"]] == ["COVER_NOT_SQUARE", "COVER_BELOW_RECOMMENDED"]
    assert body["findings"][0] == {"code": "COVER_NOT_SQUARE", "severity": "BLOCK", "measured": "4000x3000", "limit": "square"}
    assert body["is_current"] is False

    stranger = await register_and_login(client, "cover-stranger@example.com")
    assert (await client.get(url, headers=bearer(stranger["access_token"]))).status_code == 404
