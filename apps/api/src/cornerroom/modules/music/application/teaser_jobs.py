"""Worker side of teasers (D-TEASER-00): editor peaks and teaser copies, made from the master.

Both run as documents.media_jobs (kinds WAVEFORM and TEASER) through the existing worker loop, so
they share its claim, retry, back-off, DEAD state and operator retry. The master is only read.
Teaser files are class teaser_audio, so the song media route can never serve them and the teaser
media route can never serve a song.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import select

from cornerroom.infra.storage import new_asset_id
from cornerroom.modules.documents.application import media_tools as tools
from cornerroom.modules.documents.domain.models import MediaAsset, MediaJob
from cornerroom.modules.music.domain import teasers as rules
from cornerroom.modules.music.domain.models import (
    TeaserRendition,
    TeaserVersion,
    TrackVersion,
    TrackWaveform,
)

if TYPE_CHECKING:
    from cornerroom.modules.documents.application.media_jobs import MediaJobService

TEASER_CLASS = "teaser_audio"


def waveform_key(track_version_id: object) -> str:
    return f"waveform:{track_version_id}:v1"


def teaser_key(version: TeaserVersion, profile: tools.Profile) -> str:
    return f"teaser:{version.id}:{version.processing_version}:{profile.key}:{profile.profile_version}"


async def playback_profiles(svc: MediaJobService) -> list[tools.Profile]:
    """Teasers use the decided playback copies (D-AUDIO-03): never the lossless download profile."""
    return [p for p in await svc._profiles() if p.purpose == "PLAYBACK" and p.codec in ("opus", "mp3")]


async def run_waveform(svc: MediaJobService, job: MediaJob, master: MediaAsset) -> None:
    version = await svc.session.get(TrackVersion, job.target_id)
    if version is None or version.media_asset_id != master.id or not version.duration_ms:
        return
    if await svc.session.get(TrackWaveform, version.id) is not None:
        return  # made by an earlier attempt
    source = svc.storage.local_path(master.object_key)
    scratch = svc.storage.scratch_dir() / f"{job.id}.pcm"
    points, bucket = await tools.waveform_peaks(svc.settings, source, scratch, version.duration_ms)
    svc.session.add(
        TrackWaveform(track_version_id=version.id, points=points, bucket_ms=bucket, duration_ms=version.duration_ms)
    )
    await svc.session.flush()


async def run_teaser(svc: MediaJobService, job: MediaJob, master: MediaAsset) -> None:
    from cornerroom.modules.documents.application.media_jobs import _file_chunks, _mime

    version = await svc.session.get(TeaserVersion, job.target_id)
    if version is None or version.status != rules.V_PROCESSING:
        return  # withdrawn or already finished
    profile = next((p for p in await playback_profiles(svc) if p.key == job.profile_key), None)
    if profile is None:
        raise tools.MediaToolError("PROFILE_RETIRED", job.profile_key or "")
    done = (
        await svc.session.execute(
            select(TeaserRendition).where(
                TeaserRendition.teaser_version_id == version.id,
                TeaserRendition.profile_key == profile.key,
                TeaserRendition.profile_version == profile.profile_version,
            )
        )
    ).scalar_one_or_none()
    if done is None:
        encoder = tools.tool_version(svc.settings)
        source = svc.storage.local_path(master.object_key)
        scratch = svc.storage.scratch_dir() / f"{job.id}.{profile.container}"
        audio_filter = tools.teaser_filter(
            start_ms=version.start_ms,
            end_ms=version.end_ms,
            fade_in_ms=version.fade_in_ms,
            fade_out_ms=version.fade_out_ms,
            gain_cdb=version.gain_cdb,
        )
        try:
            await tools.cut_teaser(svc.settings, source, scratch, profile, audio_filter)
            decoded = await tools.decoded_duration_ms(svc.settings, scratch)
            wanted = version.end_ms - version.start_ms
            if decoded is None or abs(decoded - wanted) > 150:
                raise tools.MediaToolError("TEASER_VERIFY_FAILED", f"decoded {decoded} ms vs {wanted} ms")
            loud = await tools.analyse(svc.settings, scratch)
            asset_id = new_asset_id()
            key = f"{TEASER_CLASS}/{version.teaser_id}/{version.id}/{profile.key}-v{profile.profile_version}-{asset_id.hex}.{profile.container}"
            stored = await svc.storage.write_once(object_key=key, chunks=_file_chunks(scratch), mime=_mime(profile.codec))
        finally:
            scratch.unlink(missing_ok=True)
        svc.session.add(
            MediaAsset(
                id=asset_id,
                storage_class=TEASER_CLASS,
                bucket=stored.bucket,
                object_key=key,
                mime=_mime(profile.codec),
                byte_size=stored.byte_size,
                sha256=stored.sha256,
                status="READY",
                scan_status="DERIVED",
                purpose="TEASER_AUDIO",
                parent_asset_id=master.id,
                immutable=True,
            )
        )
        await svc.session.flush()
        svc.session.add(
            TeaserRendition(
                teaser_version_id=version.id,
                profile_key=profile.key,
                profile_version=profile.profile_version,
                media_asset_id=asset_id,
                codec=profile.codec,
                container=profile.container,
                bitrate_kbps=profile.bitrate_kbps,
                duration_ms=decoded,
                byte_size=stored.byte_size,
                sha256=stored.sha256,
                encoder_version=encoder,
            )
        )
        if version.integrated_lufs is None and loud.integrated_lufs is not None:
            version.integrated_lufs = loud.integrated_lufs
            version.true_peak_dbtp = loud.true_peak_dbtp
        await svc.session.flush()
    await finish_if_complete(svc, version)


async def finish_if_complete(svc: MediaJobService, version: TeaserVersion) -> None:
    needed = {(p.key, p.profile_version) for p in await playback_profiles(svc)}
    rows = (
        await svc.session.execute(select(TeaserRendition).where(TeaserRendition.teaser_version_id == version.id))
    ).scalars().all()
    have = {(r.profile_key, r.profile_version) for r in rows}
    if needed and needed <= have and version.status == rules.V_PROCESSING:
        version.status = rules.V_READY
        version.failure_code = None
        version.duration_ms = min(r.duration_ms for r in rows)
        await svc.audit.record(
            actor_id="system:media-worker",
            actor_type="system",
            action="teaser.processed",
            entity_type="TeaserVersion",
            entity_id=version.id,
            new_state={"status": rules.V_READY, "teaser_id": str(version.teaser_id)},
        )
        await svc.session.flush()


async def job_dead(svc: MediaJobService, job: MediaJob) -> None:
    """A TEASER job gave up: the version is FAILED with the reason; master and settings stay."""
    from cornerroom.modules.music.application.teasers import processing_failed

    if job.kind != "TEASER" or job.target_id is None:
        return
    version = await svc.session.get(TeaserVersion, job.target_id)
    if version is None or version.status != rules.V_PROCESSING:
        return
    await processing_failed(svc.session, svc.clock, version, job.last_error_code or "PROCESSING_FAILED")
