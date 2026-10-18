"""Audio Phase 3: media checks, playback copies and READY only after verification (design 7).

Fixtures are generated in the test (no stored audio): tiny WAVs written with the standard library,
an MP3 made with the pinned FFmpeg, and malformed files built byte by byte.
"""

from __future__ import annotations

import hashlib
import io
import math
import struct
import subprocess
import wave
from pathlib import Path

import pytest
from httpx import AsyncClient

from cornerroom.modules.documents.domain.audio_probe import probe
from cornerroom.modules.documents.domain.qc import (
    Loudness,
    decode_findings,
    format_findings,
    outcome,
    playback_gain_db,
)


def wav_bytes(*, seconds: float = 1.0, rate: int = 44100, channels: int = 2, width: int = 2, amp: float = 0.3) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(width)
        w.setframerate(rate)
        peak = (1 << (8 * width - 1)) - 1
        frames = bytearray()
        for i in range(int(seconds * rate)):
            v = int(amp * peak * math.sin(2 * math.pi * 440 * i / rate))
            sample = v.to_bytes(width, "little", signed=True) if width != 1 else bytes([v + 128])
            frames += sample * channels
        w.writeframes(bytes(frames))
    return buf.getvalue()


def with_format_code(data: bytes, code: int) -> bytes:
    i = data.index(b"fmt ") + 8
    return data[:i] + struct.pack("<H", code) + data[i + 2 :]


def facts_of(data: bytes):
    return probe(io.BytesIO(data), len(data))


def codes(data: bytes) -> set[str]:
    return {f.code for f in format_findings(facts_of(data), byte_size=len(data), max_bytes=2**31, max_duration_s=3600)}


# --- pure units -----------------------------------------------------------------------------


def test_probe_reads_real_wav_facts() -> None:
    f = facts_of(wav_bytes(seconds=1.0, rate=48000, width=3))
    assert (f.container, f.sample_rate_hz, f.bit_depth, f.channels, f.wav_format_code) == ("wav", 48000, 24, 2, 1)
    assert f.duration_ms == 1000 and not f.problems
    assert codes(wav_bytes()) == set()


def test_format_rules_block_non_conforming_masters() -> None:
    assert codes(wav_bytes(channels=1)) == {"NOT_STEREO"}
    assert codes(wav_bytes(rate=22050)) == {"SAMPLE_RATE_TOO_LOW"}
    assert codes(with_format_code(wav_bytes(), 0xFFFE)) == {"WAV_NOT_PCM"}
    assert "WAV_NOT_PCM" in codes(with_format_code(wav_bytes(), 0x0003))  # float is not plain PCM
    assert codes(wav_bytes() + b"JUNKJUNK") == {"WAV_TRAILING_DATA"}
    assert codes(b"ID3\x03\x00\x00\x00\x00\x00\x00" + b"\x00" * 100) == {"LOSSY_SOURCE"}
    assert codes(b"hello this is not audio at all") == {"UNSUPPORTED_FORMAT"}
    assert codes(b"") == {"ZERO_LENGTH"}
    truncated = wav_bytes()
    assert "CORRUPT_AUDIO" in codes(truncated[:60])
    over = format_findings(facts_of(wav_bytes(seconds=2)), byte_size=10, max_bytes=2**31, max_duration_s=1)
    assert {f.code for f in over} == {"DURATION_TOO_LONG"}


def test_loudness_rules_warn_but_never_block() -> None:
    facts = facts_of(wav_bytes())
    peaky = decode_findings(facts, Loudness(-16.0, 5.0, -0.4, 1000, True))
    assert [(f.code, f.severity) for f in peaky] == [("TRUE_PEAK_HIGH", "WARN")]
    loud = decode_findings(facts, Loudness(-9.0, 4.0, -1.5, 1000, True))
    assert [f.code for f in loud] == ["LOUD_MASTER_PEAK"]
    assert outcome(loud) == "ACCEPTED_WITH_WARNINGS"
    broken = decode_findings(facts, Loudness(None, None, None, 300, False))
    assert outcome(broken) == "REJECTED"
    short = decode_findings(facts, Loudness(-14, 3, -3, 100, True))
    assert [f.code for f in short] == ["CORRUPT_AUDIO"]


def test_playback_gain_levels_to_minus_14_with_headroom() -> None:
    assert playback_gain_db(-9.0, -0.5) == -5.0  # loud: always turned down
    assert playback_gain_db(-20.0, -10.0) == 6.0  # quiet with room: turned up
    assert playback_gain_db(-20.0, -3.0) == 2.0  # quiet but peaky: only to -1 dBTP
    assert playback_gain_db(None, None) is None


# --- pipeline (PostgreSQL + FFmpeg) ---------------------------------------------------------


async def _staff(client: AsyncClient) -> str:
    from tests.auth_helpers import admin_token, bearer

    admin = await admin_token(client)
    orgs = (await client.get("/api/v1/organizations", headers=bearer(admin))).json()["items"]
    label = next(row for row in orgs if row["type"] == "LABEL")
    return (await client.post(f"/api/v1/organizations/{label['id']}/switch", headers=bearer(admin))).json()["access_token"]


async def _new_version(client: AsyncClient, token: str, track_id: str | None = None) -> tuple[str, str]:
    from tests.auth_helpers import bearer

    if track_id is None:
        track_id = (await client.post("/api/v1/tracks", headers=bearer(token), json={"title": "Pipeline"})).json()["id"]
    version = await client.post(f"/api/v1/tracks/{track_id}/versions", headers=bearer(token), json={"version_type": "MASTER"})
    assert version.status_code == 201, version.text
    return track_id, version.json()["id"]


async def _upload(client: AsyncClient, token: str, version_id: str, data: bytes, name: str = "master.wav") -> dict:
    from tests.auth_helpers import bearer

    intent = await client.post(
        "/api/v1/uploads/intents",
        headers=bearer(token),
        json={"purpose": "AUDIO_MASTER", "target_type": "track_version", "target_id": version_id, "filename": name, "byte_size": len(data)},
    )
    assert intent.status_code == 201, intent.text
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
    return done.json()


async def _drain_jobs() -> None:
    from cornerroom.worker import run_media_jobs

    for _ in range(12):
        if await run_media_jobs({}) == 0:
            from cornerroom.infra.db import get_session_factory
            from cornerroom.modules.documents.domain.models import MediaJob
            from sqlalchemy import select

            async with get_session_factory()() as session:
                left = (
                    await session.execute(select(MediaJob).where(MediaJob.status.in_(("QUEUED",))))
                ).scalars().first()
            if left is None:
                return


async def _report(client: AsyncClient, token: str, track_id: str, version_id: str) -> dict:
    from tests.auth_helpers import bearer

    res = await client.get(f"/api/v1/tracks/{track_id}/versions/{version_id}/media-report", headers=bearer(token))
    assert res.status_code == 200, res.text
    return res.json()


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_good_master_is_checked_transcoded_and_ready(client: AsyncClient) -> None:
    from tests.auth_helpers import bearer

    token = await _staff(client)
    track_id, version_id = await _new_version(client, token)
    await _upload(client, token, version_id, wav_bytes(seconds=2.0, rate=48000, width=3))
    before = await _report(client, token, track_id, version_id)
    assert before["status"] == "PROCESSING" and before["jobs"][0]["kind"] == "INSPECT"

    await _drain_jobs()
    report = await _report(client, token, track_id, version_id)
    assert report["status"] == "READY", report
    assert report["is_current"] is True
    assert report["asset_status"] == "ACCEPTED"
    insp = report["inspection"]
    assert (insp["container"], insp["sample_rate_hz"], insp["bit_depth"], insp["channels"]) == ("wav", 48000, 24, 2)
    assert insp["duration_ms"] == 2000 and insp["integrated_lufs"] is not None
    assert {(r["codec"], r["purpose"]) for r in report["renditions"]} == {
        ("opus", "PLAYBACK"), ("mp3", "PLAYBACK"), ("flac", "DOWNLOAD")
    }
    # The buyer's lossless copy keeps the master's rate and bit depth (D-AUDIO-06).
    flac = next(r for r in report["renditions"] if r["codec"] == "flac")
    assert (flac["sample_rate_hz"], flac["bit_depth"]) == (48000, 24)
    assert all(abs(r["duration_ms"] - 2000) <= 150 for r in report["renditions"])
    assert all(j["status"] == "SUCCEEDED" for j in report["jobs"])

    # The owner cannot shortcut READY (F2), and nothing streams the master.
    refused = await client.post(
        f"/api/v1/tracks/{track_id}/versions/{version_id}/transition",
        headers=bearer(token),
        json={"action": "reject"},
    )
    assert refused.status_code == 403 and refused.json()["code"] == "SYSTEM_TRANSITION"

    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.streaming.application.service import StreamingService
    from uuid import UUID

    async with get_session_factory()() as session:
        from cornerroom.modules.music.domain.models import TrackVersion

        svc = StreamingService(session)
        master_id = (await session.get(TrackVersion, UUID(version_id))).media_asset_id
        choices = await svc._delivery_choices(UUID(version_id), master_id, ["opus", "mp3"])
        assert [c.codec for c in choices] == ["opus", "mp3"]
        assert all(c.asset.purpose == "AUDIO_RENDITION" and c.asset.id != master_id for c in choices)
        choices = await svc._delivery_choices(UUID(version_id), master_id, ["mp3"])
        assert choices[0].codec == "mp3"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_rejected_master_explains_why_and_never_becomes_playable(client: AsyncClient) -> None:
    token = await _staff(client)
    track_id, version_id = await _new_version(client, token)
    await _upload(client, token, version_id, wav_bytes(channels=1), name="mono.wav")
    await _drain_jobs()
    report = await _report(client, token, track_id, version_id)
    assert report["status"] == "REJECTED" and report["processing_detail"] == "QC_REJECTED"
    assert [(f["code"], f["severity"]) for f in report["findings"]] == [("NOT_STEREO", "BLOCK")]
    assert report["renditions"] == []
    assert report["asset_status"] == "REJECTED"

    # A lossy file renamed .wav is caught from its bytes, not its name.
    _, version2 = await _new_version(client, token, track_id)
    import imageio_ffmpeg
    import tempfile

    src = Path(tempfile.mkdtemp()) / "x.wav"
    src.write_bytes(wav_bytes())
    mp3 = src.with_suffix(".mp3")
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-nostdin", "-y", "-i", str(src), str(mp3)], capture_output=True, check=True)
    await _upload(client, token, version2, mp3.read_bytes(), name="actually-mp3.wav")
    await _drain_jobs()
    report2 = await _report(client, token, track_id, version2)
    assert report2["status"] == "REJECTED"
    assert [f["code"] for f in report2["findings"]] == ["LOSSY_SOURCE"]


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_replacement_keeps_old_audio_current_until_new_is_ready(client: AsyncClient) -> None:
    """F3: replacing a master never takes the song off air."""
    from tests.auth_helpers import bearer

    token = await _staff(client)
    track_id, first = await _new_version(client, token)
    await _upload(client, token, first, wav_bytes())
    await _drain_jobs()
    _, second = await _new_version(client, token, track_id)
    listed = {v["id"]: v for v in (await client.get(f"/api/v1/tracks/{track_id}/versions", headers=bearer(token))).json()["items"]}
    assert listed[first]["is_current"] is True and listed[first]["status"] == "READY"
    assert listed[second]["is_current"] is False and listed[second]["status"] == "UPLOADING"
    # A third version while one is in progress is refused.
    third = await client.post(f"/api/v1/tracks/{track_id}/versions", headers=bearer(token), json={"version_type": "MASTER"})
    assert third.status_code == 409

    await _upload(client, token, second, wav_bytes(seconds=1.5))
    await _drain_jobs()
    listed = {v["id"]: v for v in (await client.get(f"/api/v1/tracks/{track_id}/versions", headers=bearer(token))).json()["items"]}
    assert listed[second]["is_current"] is True and listed[second]["status"] == "READY"
    assert listed[first]["is_current"] is False and listed[first]["status"] == "SUPERSEDED"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_same_master_gives_the_same_playback_copies(client: AsyncClient) -> None:
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.music.domain.models import TrackRendition
    from sqlalchemy import select

    token = await _staff(client)
    data = wav_bytes(seconds=1.0)
    hashes = []
    for _ in range(2):
        _, version = await _new_version(client, token)
        await _upload(client, token, version, data)
        await _drain_jobs()
        async with get_session_factory()() as session:
            rows = (await session.execute(select(TrackRendition).where(TrackRendition.track_version_id == version))).scalars().all()
            hashes.append(sorted((r.profile_key, r.sha256) for r in rows))
    # Two playback copies and the buyer's FLAC download copy, byte-identical both times.
    assert hashes[0] == hashes[1] and [k for k, _ in hashes[0]] == ["flac_download", "mp3_compat", "opus_hq"]


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_failing_tool_retries_then_stalls_and_operator_can_cancel(client: AsyncClient, monkeypatch) -> None:
    from cornerroom.modules.documents.application import media_tools
    from tests.auth_helpers import admin_token, bearer

    async def broken(*args, **kwargs):
        raise media_tools.MediaToolError("TRANSCODE_FAILED", "simulated")

    monkeypatch.setattr(media_tools, "transcode", broken)
    monkeypatch.setenv("MEDIA_JOB_BACKOFF_SECONDS", "0")
    from cornerroom.infra.settings import get_settings

    get_settings.cache_clear()
    token = await _staff(client)
    track_id, version_id = await _new_version(client, token)
    await _upload(client, token, version_id, wav_bytes())
    for _ in range(12):
        await _drain_jobs()
    report = await _report(client, token, track_id, version_id)
    assert report["status"] == "PROCESSING" and report["processing_detail"] == "PROCESSING_STALLED"
    assert report["renditions"] == []
    dead = [j for j in report["jobs"] if j["status"] == "DEAD"]
    assert dead and all(j["last_error_code"] == "TRANSCODE_FAILED" for j in dead)

    admin = await admin_token(client)
    queue = await client.get("/api/v1/media-jobs", headers=bearer(admin), params={"status": "DEAD"})
    assert queue.status_code == 200 and queue.json()["items"]
    from tests.auth_helpers import register_and_login

    plain = (await register_and_login(client, "media-plain@example.com"))["access_token"]
    assert (await client.get("/api/v1/media-jobs", headers=bearer(plain))).status_code == 403
    job_id = queue.json()["items"][0]["id"]
    cancelled = await client.post(f"/api/v1/media-jobs/{job_id}/cancel", headers=bearer(admin))
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "CANCELLED"
    report = await _report(client, token, track_id, version_id)
    assert report["status"] == "REJECTED" and report["processing_detail"] == "PROCESSING_FAILED"
    get_settings.cache_clear()

