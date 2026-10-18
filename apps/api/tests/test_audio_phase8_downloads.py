"""Audio Phase 8: buyer downloads, takedown kinds and refunds (D-AUDIO-06, -13, -14)."""

from __future__ import annotations

import hashlib
from uuid import UUID

import pytest
from httpx import AsyncClient

from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase3_media import _drain_jobs, _new_version, _staff, _upload, wav_bytes


def test_download_filenames_are_safe_and_keep_bangla() -> None:
    from cornerroom.modules.streaming.application.downloads import safe_filename

    assert safe_filename("Rumi", "Low Tide", "flac") == "Rumi - Low Tide.flac"
    assert safe_filename(None, 'a/b:c*"d', "mp3") == "a b c d.mp3"
    assert safe_filename("রুমি", "বৃষ্টি", "flac") == "রুমি - বৃষ্টি.flac"
    assert safe_filename(None, "...", "mp3") == "Corner Room track.mp3"


async def _ready_released_track(client: AsyncClient) -> tuple[str, str, str]:
    """A released song with a verified master and its copies, made by the real worker."""
    token = await _staff(client)
    track_id, version_id = await _new_version(client, token)
    await _upload(client, token, version_id, wav_bytes(seconds=1.5, rate=48000, width=3))
    await _drain_jobs()
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.music.domain.models import Track

    async with get_session_factory()() as session:
        track = await session.get(Track, UUID(track_id))
        track.status = "RELEASED"
        await session.commit()
    return token, track_id, version_id


async def _grant(user_id: str, ref_id: str, *, scope: str = "TRACK", etype: str = "PURCHASE") -> UUID:
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.entitlements.domain.models import Entitlement

    async with get_session_factory()() as session:
        row = Entitlement(user_id=UUID(user_id), entitlement_type=etype, ref_id=UUID(ref_id), scope=scope, status="ACTIVE")
        session.add(row)
        await session.commit()
        return row.id


async def _set(model, row_id: UUID, **values) -> None:  # type: ignore[no-untyped-def]
    from cornerroom.infra.db import get_session_factory

    async with get_session_factory()() as session:
        row = await session.get(model, row_id)
        for k, v in values.items():
            setattr(row, k, v)
        await session.commit()


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_buyer_downloads_lossless_and_mp3_with_integrity(client: AsyncClient) -> None:
    _staff_token, track_id, _version = await _ready_released_track(client)
    fan = await register_and_login(client, "dl-fan@example.com")
    await _grant(fan["user"]["id"], track_id)
    h = bearer(fan["access_token"])

    options = (await client.get(f"/api/v1/me/downloads/tracks/{track_id}", headers=h)).json()
    by = {o["format"]: o for o in options}
    assert by["flac"]["available"] and by["mp3"]["available"]
    assert (by["flac"]["bit_depth"], by["flac"]["sample_rate_hz"]) == (24, 48000)
    assert by["mp3"]["bitrate_kbps"] == 320

    for fmt, magic in (("flac", b"fLaC"), ("mp3", None)):
        grant = await client.post("/api/v1/me/downloads", headers=h, json={"track_id": track_id, "format": fmt})
        assert grant.status_code == 201, grant.text
        g = grant.json()
        assert g["filename"].endswith(f".{fmt}") and "/" not in g["filename"]
        body = await client.get(g["url"])
        assert body.status_code == 200
        assert body.headers["content-disposition"].startswith("attachment;")
        assert body.headers["cache-control"] == "private, no-store"
        assert len(body.content) == g["byte_size"]
        assert hashlib.sha256(body.content).hexdigest() == g["sha256"]
        if magic:
            assert body.content[:4] == magic
        # Ranges work, so a browser can resume.
        part = await client.get(g["url"], headers={"Range": "bytes=0-9"})
        assert part.status_code == 206 and part.content == body.content[:10]

    # Every grant is audited (unlimited downloads, but never unrecorded).
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.audit.domain.models import AuditLog
    from sqlalchemy import func, select

    async with get_session_factory()() as session:
        n = await session.scalar(
            select(func.count()).select_from(AuditLog).where(
                AuditLog.action == "track.download.granted", AuditLog.entity_id == track_id
            )
        )
    assert n == 2


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_only_buyers_download_and_tokens_are_bound(client: AsyncClient) -> None:
    _staff_token, track_id, _version = await _ready_released_track(client)
    subscriber = await register_and_login(client, "dl-sub@example.com")
    stranger = await register_and_login(client, "dl-none@example.com")
    buyer = await register_and_login(client, "dl-buyer@example.com")
    await _grant(subscriber["user"]["id"], track_id, scope="CATALOG", etype="SUBSCRIPTION")
    await _grant(buyer["user"]["id"], track_id)

    # A plan lets you listen, not download (D-AUDIO-06).
    sub = await client.post("/api/v1/me/downloads", headers=bearer(subscriber["access_token"]), json={"track_id": track_id, "format": "flac"})
    assert sub.status_code == 403 and sub.json()["code"] == "DOWNLOAD_NOT_OWNED"
    none = await client.get(f"/api/v1/me/downloads/tracks/{track_id}", headers=bearer(stranger["access_token"]))
    assert none.status_code == 403
    assert (await client.post("/api/v1/me/downloads", json={"track_id": track_id, "format": "flac"})).status_code == 401

    grant = (await client.post("/api/v1/me/downloads", headers=bearer(buyer["access_token"]), json={"track_id": track_id, "format": "flac"})).json()
    token = grant["url"].rsplit("/", 1)[1]
    # A download link is not a playback link, and a playback link is not a download link.
    assert (await client.get(f"/api/v1/playback/media/{token}")).status_code == 401
    audio = await client.get(f"/api/v1/playback/tracks/{track_id}/audio", headers=bearer(buyer["access_token"]))
    assert audio.status_code == 200, audio.text
    assert all(a["codec"] != "flac" for a in audio.json()["alternates"]) and audio.json()["codec"] != "flac"
    play_token = audio.json()["url"].rsplit("/", 1)[1]
    assert (await client.get(f"/api/v1/downloads/{play_token}")).status_code == 401
    assert (await client.get("/api/v1/downloads/garbage")).status_code == 401


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_takedown_kinds_and_refund_decide_buyer_access(client: AsyncClient) -> None:
    from cornerroom.modules.entitlements.domain.models import Entitlement
    from cornerroom.modules.music.domain.models import Track

    staff, track_id, _version = await _ready_released_track(client)
    buyer = await register_and_login(client, "dl-keep@example.com")
    subscriber = await register_and_login(client, "dl-sub2@example.com")
    ent = await _grant(buyer["user"]["id"], track_id)
    await _grant(subscriber["user"]["id"], track_id, scope="CATALOG", etype="SUBSCRIPTION")

    # Ordinary takedown (the default): buyers keep streaming and downloading; listeners on a plan lose it.
    down = await client.post(f"/api/v1/tracks/{track_id}/transition", headers=bearer(staff), json={"action": "takedown"})
    assert down.status_code == 200, down.text
    kept = await client.get(f"/api/v1/playback/tracks/{track_id}/audio", headers=bearer(buyer["access_token"]))
    assert kept.status_code == 200, kept.text
    dl = await client.post("/api/v1/me/downloads", headers=bearer(buyer["access_token"]), json={"track_id": track_id, "format": "mp3"})
    assert dl.status_code == 201, dl.text
    lost = await client.get(f"/api/v1/playback/tracks/{track_id}/audio", headers=bearer(subscriber["access_token"]))
    assert lost.status_code == 409 and lost.json()["code"] == "TRACK_TAKEN_DOWN"
    # Module pass 10: the buyer can still open the song's page; others and visitors cannot.
    assert (await client.get(f"/api/v1/tracks/{track_id}", headers=bearer(buyer["access_token"]))).status_code == 200
    assert (await client.get(f"/api/v1/tracks/{track_id}", headers=bearer(subscriber["access_token"]))).status_code == 404
    assert (await client.get(f"/api/v1/tracks/{track_id}")).status_code == 404

    # A legal takedown removes it for buyers too, including links already handed out.
    await _set(Track, UUID(track_id), takedown_kind="LEGAL")
    assert (await client.get(f"/api/v1/tracks/{track_id}", headers=bearer(buyer["access_token"]))).status_code == 404
    assert (await client.get(f"/api/v1/playback/tracks/{track_id}/audio", headers=bearer(buyer["access_token"]))).status_code == 409
    assert (await client.get(dl.json()["url"])).status_code == 409
    again = await client.post("/api/v1/me/downloads", headers=bearer(buyer["access_token"]), json={"track_id": track_id, "format": "mp3"})
    assert again.status_code == 409 and again.json()["code"] == "TRACK_TAKEN_DOWN"

    # A refund (entitlement revoked) removes it even after an ordinary takedown.
    await _set(Track, UUID(track_id), takedown_kind="STANDARD")
    assert (await client.get(f"/api/v1/playback/tracks/{track_id}/audio", headers=bearer(buyer["access_token"]))).status_code == 200
    await _set(Entitlement, ent, status="REVOKED")
    gone = await client.post("/api/v1/me/downloads", headers=bearer(buyer["access_token"]), json={"track_id": track_id, "format": "mp3"})
    assert gone.status_code == 403
    assert (await client.get(f"/api/v1/playback/tracks/{track_id}/audio", headers=bearer(buyer["access_token"]))).status_code == 409


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_takedown_kind_is_validated_and_recorded(client: AsyncClient) -> None:
    staff, track_id, _version = await _ready_released_track(client)
    bad = await client.post(
        f"/api/v1/tracks/{track_id}/transition", headers=bearer(staff), json={"action": "takedown", "takedown_kind": "MAYBE"}
    )
    assert bad.status_code == 422
    ok = await client.post(
        f"/api/v1/tracks/{track_id}/transition", headers=bearer(staff), json={"action": "takedown", "takedown_kind": "LEGAL"}
    )
    assert ok.status_code == 200, ok.text
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.music.domain.models import Track

    async with get_session_factory()() as session:
        assert (await session.get(Track, UUID(track_id))).takedown_kind == "LEGAL"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_songs_already_ready_get_their_download_copy_backfilled(client: AsyncClient) -> None:
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.music.domain.models import TrackRendition
    from sqlalchemy import delete, select

    _staff_token, track_id, version_id = await _ready_released_track(client)
    async with get_session_factory()() as session:
        # As if the song went live before the FLAC download profile existed.
        await session.execute(
            delete(TrackRendition).where(TrackRendition.track_version_id == UUID(version_id), TrackRendition.purpose == "DOWNLOAD")
        )
        from cornerroom.modules.documents.domain.models import MediaJob

        await session.execute(delete(MediaJob).where(MediaJob.profile_key == "flac_download", MediaJob.target_id == UUID(version_id)))
        await session.commit()
    buyer = await register_and_login(client, "dl-late@example.com")
    await _grant(buyer["user"]["id"], track_id)
    preparing = await client.post("/api/v1/me/downloads", headers=bearer(buyer["access_token"]), json={"track_id": track_id, "format": "flac"})
    assert preparing.status_code == 409 and preparing.json()["code"] == "DOWNLOAD_PREPARING"

    await _drain_jobs()
    async with get_session_factory()() as session:
        rows = (
            await session.execute(select(TrackRendition).where(TrackRendition.track_version_id == UUID(version_id)))
        ).scalars().all()
    assert {r.purpose for r in rows} == {"PLAYBACK", "DOWNLOAD"}
    ready = await client.post("/api/v1/me/downloads", headers=bearer(buyer["access_token"]), json={"track_id": track_id, "format": "flac"})
    assert ready.status_code == 201, ready.text


def test_signed_links_never_reach_logs_or_error_bodies() -> None:
    import logging

    from cornerroom.infra.logging import AccessLogQueryRedactor, redact_path

    assert redact_path("/api/v1/playback/media/eyJhbGciOi.secret.sig") == "/api/v1/playback/media/[token]"
    assert redact_path("/api/v1/downloads/eyJ.x.y") == "/api/v1/downloads/[token]"
    assert redact_path("/api/v1/downloads/") == "/api/v1/downloads/"
    assert redact_path("/api/v1/tracks/123") == "/api/v1/tracks/123"
    record = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, '%s - "%s %s HTTP/%s" %d',
                               ("127.0.0.1", "GET", "/api/v1/downloads/eyJ.secret.sig", "1.1", 200), None)
    AccessLogQueryRedactor().filter(record)
    assert "secret" not in record.getMessage() and "[token]" in record.getMessage()


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_error_bodies_do_not_echo_signed_links(client: AsyncClient) -> None:
    res = await client.get("/api/v1/downloads/eyJ.not-a-real.secret")
    assert res.status_code == 401
    assert "secret" not in res.text and res.json()["instance"] == "/api/v1/downloads/[token]"


def test_logs_mask_email_and_phone() -> None:
    from cornerroom.infra.logging import mask_email, mask_phone

    assert mask_email("pilot-artist@example.com") == "p***@example.com"
    assert mask_email("") == "***" and mask_email("not-an-email") == "***"
    assert mask_phone("+880 1712-345678") == "***5678"
    assert mask_phone("12") == "***"
