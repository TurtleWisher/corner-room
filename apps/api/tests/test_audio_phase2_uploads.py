"""Audio Phase 2: resumable, owner-bound uploads into write-once storage (AUDIO_PHASE_1_DESIGN 6).

Abuse cases A5 to A11 from the design, plus the F1 (attach someone else's audio) and F6 (fake S3
URLs) fixes.
"""

from __future__ import annotations

import hashlib
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update

from cornerroom.infra.errors import AppError
from cornerroom.infra.settings import Settings
from cornerroom.infra.storage import LocalObjectStorage, S3CompatibleStorage, StorageUnavailableError

PART = 1024


async def _chunks(*parts: bytes):
    for part in parts:
        yield part


# --- storage adapter units ----------------------------------------------------------------


@pytest.mark.asyncio
async def test_local_write_once_never_overwrites_and_reads_ranges(tmp_path: Path) -> None:
    storage = LocalObjectStorage(str(tmp_path))
    stored = await storage.write_once(object_key="a/b/original", chunks=_chunks(b"hello ", b"world"), mime="x")
    assert stored.byte_size == 11
    assert stored.sha256 == hashlib.sha256(b"hello world").hexdigest()
    with pytest.raises(AppError) as err:
        await storage.write_once(object_key="a/b/original", chunks=_chunks(b"evil"), mime="x")
    assert err.value.code == "OBJECT_EXISTS"
    assert (await storage.get_bytes("a/b/original")) == b"hello world"
    assert await storage.stat("a/b/original") == 11
    assert b"".join([c async for c in storage.read_range("a/b/original", 6, 10)]) == b"world"
    with pytest.raises(AppError):
        await storage.write_once(object_key="../escape", chunks=_chunks(b"x"), mime="x")


@pytest.mark.asyncio
async def test_s3_adapter_fails_closed_instead_of_faking() -> None:
    s3 = S3CompatibleStorage(Settings(app_env="test", storage_backend="s3", s3_bucket="b"))
    for call in (
        s3.signed_url("k"),
        s3.get_bytes("k"),
        s3.stat("k"),
        s3.put(object_key="k", data=b"x", mime="x", storage_class="public_media"),
    ):
        with pytest.raises(StorageUnavailableError):
            await call


# --- API (PostgreSQL) -----------------------------------------------------------------------


@pytest.fixture
def small_parts(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("UPLOAD_PART_SIZE_BYTES", str(PART))


async def _staff(client: AsyncClient) -> str:
    from tests.auth_helpers import admin_token, bearer

    admin = await admin_token(client)
    orgs = (await client.get("/api/v1/organizations", headers=bearer(admin))).json()["items"]
    label = next(row for row in orgs if row["type"] == "LABEL")
    switched = await client.post(f"/api/v1/organizations/{label['id']}/switch", headers=bearer(admin))
    assert switched.status_code == 200, switched.text
    return switched.json()["access_token"]


async def _version(client: AsyncClient, token: str) -> tuple[str, str]:
    from tests.auth_helpers import bearer

    track = await client.post("/api/v1/tracks", headers=bearer(token), json={"title": f"Upload {uuid4().hex[:6]}"})
    assert track.status_code == 201, track.text
    version = await client.post(
        f"/api/v1/tracks/{track.json()['id']}/versions", headers=bearer(token), json={"version_type": "MASTER"}
    )
    assert version.status_code == 201, version.text
    return track.json()["id"], version.json()["id"]


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _parts(data: bytes) -> list[bytes]:
    return [data[i : i + PART] for i in range(0, len(data), PART)]


async def _put(client: AsyncClient, token: str, intent_id: str, number: int, data: bytes, sha: str | None = None):
    from tests.auth_helpers import bearer

    headers = {**bearer(token), "X-Part-SHA256": sha or _sha(data), "Content-Type": "application/octet-stream"}
    return await client.put(f"/api/v1/uploads/intents/{intent_id}/parts/{number}", headers=headers, content=data)


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_master_upload_in_parts_resumes_and_completes(small_parts: None, client: AsyncClient) -> None:
    from cornerroom.infra.db import get_session_factory
    from cornerroom.infra.outbox import OutboxEvent
    from tests.auth_helpers import bearer

    token = await _staff(client)
    track_id, version_id = await _version(client, token)
    data = bytes(range(256)) * 10  # 2560 bytes -> 3 parts
    body = {
        "purpose": "AUDIO_MASTER",
        "target_type": "track_version",
        "target_id": version_id,
        "filename": "C:\\Users\\me\\Song.flac",
        "byte_size": len(data),
        "sha256": _sha(data),
    }
    created = await client.post("/api/v1/uploads/intents", headers=bearer(token), json=body)
    assert created.status_code == 201, created.text
    intent = created.json()
    assert intent["part_count"] == 3 and intent["part_size"] == PART
    assert intent["filename"] == "Song.flac"
    chunks = _parts(data)

    assert (await _put(client, token, intent["id"], 2, chunks[1])).json()["parts_received"] == [2]
    # Refresh / relogin: asking again for the same file resumes the same upload.
    again = await client.post("/api/v1/uploads/intents", headers=bearer(token), json=body)
    assert again.status_code == 200
    assert again.json()["id"] == intent["id"] and again.json()["resumed"] is True
    assert again.json()["parts_received"] == [2]
    found = await client.get(
        "/api/v1/uploads/intents/open",
        headers=bearer(token),
        params={"target_type": "track_version", "target_id": version_id},
    )
    assert found.json()["id"] == intent["id"]

    # Resending a part with the same bytes is fine; with other bytes it is refused.
    assert (await _put(client, token, intent["id"], 2, chunks[1])).status_code == 200
    assert (await _put(client, token, intent["id"], 2, b"x" * PART)).status_code == 409

    early = await client.post(f"/api/v1/uploads/intents/{intent['id']}/complete", headers=bearer(token))
    assert early.status_code == 409 and early.json()["missing_parts"] == [1, 3]

    await _put(client, token, intent["id"], 1, chunks[0])
    await _put(client, token, intent["id"], 3, chunks[2])
    done = await client.post(f"/api/v1/uploads/intents/{intent['id']}/complete", headers=bearer(token))
    assert done.status_code == 200, done.text
    result = done.json()
    assert result["asset_status"] == "QUARANTINED"
    assert result["sha256"] == _sha(data) and result["byte_size"] == len(data)
    repeat = await client.post(f"/api/v1/uploads/intents/{intent['id']}/complete", headers=bearer(token))
    assert repeat.status_code == 200 and repeat.json()["media_asset_id"] == result["media_asset_id"]

    versions = (await client.get(f"/api/v1/tracks/{track_id}/versions", headers=bearer(token))).json()
    rows = versions["items"] if isinstance(versions, dict) else versions
    row = next(v for v in rows if v["id"] == version_id)
    assert row["status"] == "PROCESSING"
    assert row["media_asset_id"] == result["media_asset_id"]

    async with get_session_factory()() as session:
        events = (
            await session.execute(select(OutboxEvent).where(OutboxEvent.event_type == "MediaUploadCompleted"))
        ).scalars().all()
        assert any(e.payload["payload"].get("media_asset_id") == result["media_asset_id"] for e in events)
        from cornerroom.modules.documents.domain.models import MediaAsset

        asset = await session.get(MediaAsset, result["media_asset_id"])
        assert asset is not None and asset.immutable and asset.purpose == "AUDIO_MASTER"
        stored = Path(Settings().storage_local_path) / asset.object_key
        assert stored.read_bytes() == data

    # A second upload into the same version is refused: replacing audio needs a new version.
    blocked = await client.post(
        "/api/v1/uploads/intents", headers=bearer(token), json={**body, "filename": "other.flac"}
    )
    assert blocked.status_code == 409


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_upload_guards_size_and_checksum(small_parts: None, client: AsyncClient) -> None:
    from tests.auth_helpers import bearer

    token = await _staff(client)
    _, version_id = await _version(client, token)

    too_big = await client.post(
        "/api/v1/uploads/intents",
        headers=bearer(token),
        json={
            "purpose": "AUDIO_MASTER",
            "target_type": "track_version",
            "target_id": version_id,
            "filename": "huge.wav",
            "byte_size": 3 * 1024 * 1024 * 1024,
        },
    )
    assert too_big.status_code == 422 and too_big.json()["code"] == "UPLOAD_TOO_LARGE"

    mismatch = await client.post(
        "/api/v1/uploads/intents",
        headers=bearer(token),
        json={"purpose": "COVER_ART", "target_type": "track_version", "target_id": version_id, "filename": "a.png", "byte_size": 10},
    )
    assert mismatch.status_code == 422

    data = b"a" * (PART + 10)
    intent = (
        await client.post(
            "/api/v1/uploads/intents",
            headers=bearer(token),
            json={
                "purpose": "AUDIO_MASTER",
                "target_type": "track_version",
                "target_id": version_id,
                "filename": "s.wav",
                "byte_size": len(data),
                "sha256": _sha(b"something else"),
            },
        )
    ).json()
    bad_hash = await _put(client, token, intent["id"], 1, data[:PART], sha=_sha(b"nope"))
    assert bad_hash.status_code == 422 and bad_hash.json()["code"] == "CHECKSUM_MISMATCH"
    oversized = await _put(client, token, intent["id"], 2, b"b" * 50)
    assert oversized.status_code == 422 and oversized.json()["code"] == "SIZE_MISMATCH"
    no_header = await client.put(
        f"/api/v1/uploads/intents/{intent['id']}/parts/1", headers=bearer(token), content=data[:PART]
    )
    assert no_header.status_code == 422
    await _put(client, token, intent["id"], 1, data[:PART])
    await _put(client, token, intent["id"], 2, data[PART:])
    done = await client.post(f"/api/v1/uploads/intents/{intent['id']}/complete", headers=bearer(token))
    assert done.status_code == 422 and done.json()["code"] == "CHECKSUM_MISMATCH"
    state = await client.get(f"/api/v1/uploads/intents/{intent['id']}", headers=bearer(token))
    assert state.json()["status"] == "CANCELLED"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_uploads_are_owner_bound(small_parts: None, client: AsyncClient) -> None:
    from tests.auth_helpers import bearer, register_and_login

    token = await _staff(client)
    _, version_id = await _version(client, token)
    data = b"z" * 100
    intent = (
        await client.post(
            "/api/v1/uploads/intents",
            headers=bearer(token),
            json={"purpose": "AUDIO_MASTER", "target_type": "track_version", "target_id": version_id, "filename": "a.flac", "byte_size": len(data)},
        )
    ).json()
    stranger = (await register_and_login(client, "upload-stranger@example.com"))["access_token"]

    sneak = await client.post(
        "/api/v1/uploads/intents",
        headers=bearer(stranger),
        json={"purpose": "AUDIO_MASTER", "target_type": "track_version", "target_id": version_id, "filename": "x.flac", "byte_size": 10},
    )
    assert sneak.status_code == 404
    assert (await client.get(f"/api/v1/uploads/intents/{intent['id']}", headers=bearer(stranger))).status_code == 404
    assert (await _put(client, stranger, intent["id"], 1, data)).status_code == 404
    assert (
        await client.post(f"/api/v1/uploads/intents/{intent['id']}/complete", headers=bearer(stranger))
    ).status_code == 404
    assert (await client.delete(f"/api/v1/uploads/intents/{intent['id']}", headers=bearer(stranger))).status_code == 404
    assert (await client.post("/api/v1/uploads/intents", json={})).status_code == 401

    cancelled = await client.delete(f"/api/v1/uploads/intents/{intent['id']}", headers=bearer(token))
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "CANCELLED"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_expired_upload_is_closed_and_cleaned(small_parts: None, client: AsyncClient) -> None:
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.documents.domain.models import MediaAsset, UploadIntent
    from cornerroom.worker import expire_upload_intents
    from tests.auth_helpers import bearer

    token = await _staff(client)
    _, version_id = await _version(client, token)
    data = b"q" * (PART * 2)
    intent = (
        await client.post(
            "/api/v1/uploads/intents",
            headers=bearer(token),
            json={"purpose": "AUDIO_MASTER", "target_type": "track_version", "target_id": version_id, "filename": "a.flac", "byte_size": len(data)},
        )
    ).json()
    await _put(client, token, intent["id"], 1, data[:PART])
    async with get_session_factory()() as session:
        await session.execute(
            update(UploadIntent)
            .where(UploadIntent.id == intent["id"])
            .values(expires_at=UploadIntent.expires_at - timedelta(days=2))
        )
        await session.commit()
    assert await expire_upload_intents({}) == 1
    late = await _put(client, token, intent["id"], 2, data[PART:])
    assert late.status_code == 410 and late.json()["code"] == "INTENT_EXPIRED"
    async with get_session_factory()() as session:
        row = await session.get(UploadIntent, intent["id"])
        asset = await session.get(MediaAsset, intent["media_asset_id"])
        assert row is not None and row.status == "EXPIRED"
        assert asset is not None and asset.status == "REJECTED"
    parts_dir = Path(Settings().storage_local_path) / "_upload_parts" / intent["id"]
    assert not any(parts_dir.glob("*")) if parts_dir.exists() else True


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_cannot_attach_someone_elses_audio_asset(small_parts: None, client: AsyncClient) -> None:
    """F1: an asset id belonging to another user is treated as not found."""
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.documents.domain.models import MediaAsset
    from tests.auth_helpers import bearer

    token = await _staff(client)
    track_id, _ = await _version(client, token)
    async with get_session_factory()() as session:
        foreign = MediaAsset(
            storage_class="catalog_audio",
            bucket="local",
            object_key=f"catalog_audio/{uuid4()}/x.wav",
            mime="audio/wav",
            byte_size=10,
            sha256="0" * 64,
            status="READY",
            scan_status="SKIPPED_LOCAL",
            created_by=uuid4(),
        )
        session.add(foreign)
        await session.commit()
        foreign_id = str(foreign.id)
    attempt = await client.post(
        f"/api/v1/tracks/{track_id}/versions",
        headers=bearer(token),
        json={"version_type": "MASTER", "media_asset_id": foreign_id},
    )
    assert attempt.status_code == 422
    assert attempt.json()["title"] == "Audio media was not found"
