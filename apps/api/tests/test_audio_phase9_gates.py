"""Audio Phase 9 gates: production tells the truth when storage or audio is not ready.

Owner spec acceptance: "Production configuration cannot claim upload/playback readiness when
region/provider credentials are absent; it shows a truthful unavailable/setup state and exposes no
placeholder media URL." Q-P0-12 keeps production master upload off until a region is named.
"""

from __future__ import annotations

from tests.settings_helpers import PROD_HARDENING

import pytest

from cornerroom.infra.settings import Settings
from cornerroom.infra.storage import StorageUnavailableError, get_storage

PROD = dict(app_env="production", jwt_secret="a-sufficiently-long-production-secret!!", cookie_secure=True, **PROD_HARDENING)


@pytest.mark.asyncio
async def test_cloud_storage_without_setup_refuses_instead_of_pretending() -> None:
    from pydantic import ValidationError

    # Production refuses to start on cloud storage with no bucket at all...
    with pytest.raises(ValidationError):
        Settings(**PROD, residency_region="ap-south-1", storage_backend="s3")
    # ...and with a bucket named but no adapter wired, every call says so instead of pretending.
    storage = get_storage(Settings(**PROD, residency_region="ap-south-1", storage_backend="s3", s3_bucket="cr-masters"))

    async def chunks():  # type: ignore[no-untyped-def]
        yield b"x"

    for call in (
        lambda: storage.write_once(object_key="k", chunks=chunks(), mime="audio/flac"),
        lambda: storage.stat("k"),
    ):
        with pytest.raises(StorageUnavailableError) as raised:
            await call()
        assert raised.value.code == "STORAGE_NOT_CONFIGURED" and raised.value.status == 503
    with pytest.raises(StorageUnavailableError):
        storage.local_path("k")


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_production_never_streams_masters_or_unprepared_demo_audio(client) -> None:  # type: ignore[no-untyped-def]
    """Audio without verified playback copies is refused in production (no fallback URL)."""
    from uuid import uuid4

    from cornerroom.infra.db import get_session_factory
    from cornerroom.infra.errors import AppError
    from cornerroom.modules.documents.domain.models import MediaAsset
    from cornerroom.modules.streaming.application.service import StreamingService

    async with get_session_factory()() as session:
        demo = MediaAsset(
            storage_class="catalog_audio", bucket="local", object_key=f"catalog_audio/demo/{uuid4()}.wav",
            mime="audio/wav", byte_size=10, sha256="0" * 64, status="READY", scan_status="CLEAN", purpose=None,
        )
        master = MediaAsset(
            storage_class="catalog_audio", bucket="local", object_key=f"catalog_audio/masters/{uuid4()}/original",
            mime="audio/wav", byte_size=10, sha256="1" * 64, status="ACCEPTED", scan_status="INSPECTED", purpose="AUDIO_MASTER",
        )
        session.add_all([demo, master])
        await session.flush()
        prod = StreamingService(session, settings=Settings(**PROD, residency_region="ap-south-1"))
        local = StreamingService(session, settings=Settings(app_env="local"))
        for asset in (demo, master):
            with pytest.raises(AppError) as refused:
                await prod._delivery_choices(uuid4(), asset.id, ["opus", "mp3"])
            assert refused.value.code == "AUDIO_NOT_PREPARED"
        # Outside production the old demo audio still plays as stored; a master never does.
        assert (await local._delivery_choices(uuid4(), demo.id, None))[0].legacy is True
        with pytest.raises(AppError):
            await local._delivery_choices(uuid4(), master.id, None)
        await session.rollback()


def test_malware_test_file_and_disguised_files_are_refused_as_audio() -> None:
    """No malware scanner is chosen yet (owner spec 9.12). Until one is, anything that is not real
    lossless audio is blocked by the format checks before it is ever decoded or stored as READY."""
    from tests.test_audio_phase3_media import codes, wav_bytes

    eicar = rb"X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
    from cornerroom.modules.documents.domain.qc import BLOCK, format_findings
    from tests.test_audio_phase3_media import facts_of

    for disguised in (eicar, b"RIFF" + eicar, b"fLaC" + eicar, b"ID3" + eicar, wav_bytes(seconds=0.5)[:60]):
        findings = format_findings(facts_of(disguised), byte_size=len(disguised), max_bytes=2**31, max_duration_s=3600)
        assert any(f.severity == BLOCK for f in findings), (disguised[:8], findings)
    assert codes(wav_bytes(seconds=0.5)) == set()  # a real master still passes
