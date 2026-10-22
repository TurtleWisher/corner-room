"""Durable media work: inspect uploads, make playback copies, finish versions (design section 7).

Jobs live in documents.media_jobs with unique idempotency keys. The worker claims due jobs with
SKIP LOCKED in a short transaction, runs the heavy tool work, and writes results in a second
transaction. Transient tool failures back off and retry; after max_attempts a job is DEAD and
waits for a media operator. A rejected file is a finished job with a REJECTED outcome, not a
failure. Nothing becomes playable until every required copy is verified.
"""

from __future__ import annotations

import hashlib
import socket
from datetime import timedelta
from pathlib import Path
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, NotFoundError
from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.infra.settings import Settings
from cornerroom.infra.storage import ObjectStorage, get_storage, new_asset_id
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import MEDIA_INSPECTED, MEDIA_REJECTED, RENDITION_CREATED, DomainEvent
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.documents.application import media_tools as tools
from cornerroom.modules.documents.domain.audio_probe import probe
from cornerroom.modules.documents.domain.models import MediaAsset, MediaFinding, MediaInspection, MediaJob
from cornerroom.modules.documents.domain.qc import (
    Finding,
    Loudness,
    cover_findings,
    decode_findings,
    format_findings,
    outcome,
)

HASH_CHUNK = 1024 * 1024
WORKER_ID = f"{socket.gethostname()}"[:64]


class MediaJobService:
    def __init__(
        self,
        session: AsyncSession,
        settings: Settings,
        *,
        clock: Clock | None = None,
        storage: ObjectStorage | None = None,
    ) -> None:
        self.session = session
        self.settings = settings
        self.clock = clock or SystemClock()
        self.storage = storage or get_storage(settings)
        self.audit = AuditService(session)

    # --- queue ---------------------------------------------------------------------------

    async def enqueue(
        self,
        *,
        asset_id: UUID,
        kind: str,
        key: str,
        target_id: UUID | None = None,
        profile_key: str | None = None,
    ) -> MediaJob:
        existing = (
            await self.session.execute(select(MediaJob).where(MediaJob.idempotency_key == key))
        ).scalar_one_or_none()
        if existing is not None:
            return existing
        job = MediaJob(
            media_asset_id=asset_id,
            kind=kind,
            target_id=target_id,
            profile_key=profile_key,
            idempotency_key=key,
            status="QUEUED",
            attempts=0,
            max_attempts=self.settings.media_job_max_attempts,
            next_attempt_at=self.clock.now(),
        )
        self.session.add(job)
        await self.session.flush()
        return job

    async def enqueue_inspection(self, asset_id: UUID) -> MediaJob:
        return await self.enqueue(asset_id=asset_id, kind="INSPECT", key=f"inspect:{asset_id}")

    async def claim_due(self, *, batch: int = 2) -> list[UUID]:
        now = self.clock.now()
        rows = (
            await self.session.execute(
                select(MediaJob)
                .where(MediaJob.status.in_(("QUEUED", "FAILED")), MediaJob.next_attempt_at <= now)
                .order_by(MediaJob.next_attempt_at, MediaJob.created_at)
                .limit(batch)
                .with_for_update(skip_locked=True)
            )
        ).scalars().all()
        for job in rows:
            job.status = "RUNNING"
            job.attempts += 1
            job.started_at = now
            job.worker_id = WORKER_ID
        await self.session.flush()
        return [job.id for job in rows]

    async def enqueue_missing_inspections(self, *, batch: int = 50) -> int:
        """Quarantined uploads that have no inspection job (for example uploaded before jobs
        existed, or a lost write) get one. Idempotent through the job key."""
        rows = (
            await self.session.execute(
                select(MediaAsset.id)
                .where(
                    MediaAsset.status == "QUARANTINED",
                    MediaAsset.purpose.in_(("AUDIO_MASTER", "COVER_ART")),
                    ~select(MediaJob.id)
                    .where(MediaJob.media_asset_id == MediaAsset.id, MediaJob.kind == "INSPECT")
                    .exists(),
                )
                .limit(batch)
            )
        ).scalars().all()
        for asset_id in rows:
            await self.enqueue_inspection(asset_id)
        return len(rows)

    async def reclaim_stalled(self) -> int:
        """RUNNING jobs older than the timeout (a crashed worker) go back to the queue."""
        cutoff = self.clock.now() - timedelta(seconds=self.settings.media_job_timeout_seconds * 2)
        rows = (
            await self.session.execute(
                select(MediaJob)
                .where(MediaJob.status == "RUNNING", MediaJob.started_at < cutoff)
                .with_for_update(skip_locked=True)
            )
        ).scalars().all()
        for job in rows:
            self._failed(job, "WORKER_LOST")
        await self.session.flush()
        return len(rows)

    def _failed(self, job: MediaJob, code: str) -> None:
        job.last_error_code = code[:64]
        job.finished_at = self.clock.now()
        if job.attempts >= job.max_attempts:
            job.status = "DEAD"
        else:
            job.status = "FAILED"
            job.next_attempt_at = self.clock.now() + timedelta(
                seconds=self.settings.media_job_backoff_seconds * (2 ** max(0, job.attempts - 1))
            )

    async def record_failure(self, job_id: UUID, code: str) -> None:
        job = await self.session.get(MediaJob, job_id)
        if job is None or job.status != "RUNNING":
            return
        self._failed(job, code)
        if job.status == "DEAD":
            await self._mark_versions_stalled(job)
        await self.session.flush()

    async def _mark_versions_stalled(self, job: MediaJob) -> None:
        from cornerroom.modules.music.application.service import MusicService

        music = MusicService(self.session, settings=self.settings)
        for version in await music.versions_for_master(job.media_asset_id):
            if version.status == "PROCESSING":
                await music.system_version_progress(version, "PROCESSING_STALLED")

    # --- run -----------------------------------------------------------------------------

    async def execute(self, job_id: UUID) -> None:
        job = await self.session.get(MediaJob, job_id)
        if job is None or job.status != "RUNNING":
            return
        asset = await self.session.get(MediaAsset, job.media_asset_id)
        if asset is None:
            raise NotFoundError("Media asset not found")
        if job.kind == "INSPECT":
            if asset.purpose == "COVER_ART":
                await self._inspect_cover(job, asset)
            else:
                await self._inspect_master(job, asset)
        elif job.kind == "TRANSCODE":
            await self._transcode(job, asset)
        job.status = "SUCCEEDED"
        job.finished_at = self.clock.now()
        job.last_error_code = None
        await self.session.flush()

    async def _verify_bytes(self, asset: MediaAsset, path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(HASH_CHUNK), b""):
                digest.update(chunk)
        found = digest.hexdigest()
        if asset.sha256 and found != asset.sha256:
            raise tools.MediaToolError("STORED_BYTES_CHANGED", asset.id.hex)
        return found

    async def _save_inspection(
        self,
        asset: MediaAsset,
        *,
        tool_version: str,
        sha: str,
        findings: list[Finding],
        facts: dict[str, object],
    ) -> MediaInspection:
        result = outcome(findings)
        existing = (
            await self.session.execute(
                select(MediaInspection).where(
                    MediaInspection.media_asset_id == asset.id, MediaInspection.tool_version == tool_version
                )
            )
        ).scalar_one_or_none()
        if existing is not None:  # a retried job after a crash: replace, same idempotent result
            await self.session.delete(existing)
            await self.session.flush()
        row = MediaInspection(
            media_asset_id=asset.id,
            tool="probe+ffmpeg-ebur128" if asset.purpose != "COVER_ART" else "pillow",
            tool_version=tool_version,
            verified_sha256=sha,
            outcome=result,
            inspected_at=self.clock.now(),
            **facts,
        )
        self.session.add(row)
        await self.session.flush()
        for f in findings:
            self.session.add(
                MediaFinding(inspection_id=row.id, code=f.code, severity=f.severity, measured=f.measured, limit_value=f.limit)
            )
        await self.session.flush()
        asset.status = "REJECTED" if result == "REJECTED" else "ACCEPTED"
        asset.scan_status = "INSPECTED"
        await self.session.flush()
        await self._event(
            MEDIA_REJECTED if result == "REJECTED" else MEDIA_INSPECTED,
            asset,
            {"media_asset_id": str(asset.id), "outcome": result, "codes": [f.code for f in findings]},
        )
        await self.audit.record(
            action="media.inspected",
            entity_type="MediaAsset",
            entity_id=asset.id,
            actor_id="system:media",
            actor_type="system",
            new_state={"outcome": result, "codes": [f.code for f in findings]},
        )
        return row

    async def _event(self, event_type: str, asset: MediaAsset, payload: dict[str, object]) -> None:
        await enqueue_outbox(
            self.session,
            DomainEvent(
                event_type=event_type,
                producer="documents",
                aggregate_type="MediaAsset",
                aggregate_id=asset.id,
                payload=payload,
                occurred_at=self.clock.now(),
                actor_id=None,
                organization_id=None,
                correlation_id=f"media:{asset.id}",
            ),
        )

    async def _inspect_master(self, job: MediaJob, asset: MediaAsset) -> None:
        from cornerroom.modules.music.application.service import MusicService

        version_name = tools.tool_version(self.settings)
        path = self.storage.local_path(asset.object_key)
        sha = await self._verify_bytes(asset, path)
        size = path.stat().st_size
        with path.open("rb") as handle:
            facts = probe(handle, size)
        findings = format_findings(
            facts,
            byte_size=size,
            max_bytes=self.settings.media_master_max_bytes,
            max_duration_s=self.settings.media_master_max_duration_seconds,
        )
        loud = Loudness(None, None, None, None, True)
        if not any(f.severity == "BLOCK" for f in findings):
            loud = await tools.analyse(self.settings, path)
            findings += decode_findings(facts, loud)
            if await self._duplicate_elsewhere(asset, sha):
                findings.append(Finding("DUPLICATE_AUDIO", "WARN"))
        inspection = await self._save_inspection(
            asset,
            tool_version=version_name,
            sha=sha,
            findings=findings,
            facts={
                "container": facts.container,
                "codec": facts.codec,
                "wav_format_code": facts.wav_format_code,
                "sample_rate_hz": facts.sample_rate_hz,
                "bit_depth": facts.bit_depth,
                "sample_format": facts.sample_format,
                "channels": facts.channels,
                "duration_ms": facts.duration_ms,
                "integrated_lufs": loud.integrated_lufs,
                "loudness_range_lu": loud.loudness_range_lu,
                "true_peak_dbtp": loud.true_peak_dbtp,
            },
        )
        music = MusicService(self.session, settings=self.settings)
        versions = await music.versions_for_master(asset.id)
        if inspection.outcome == "REJECTED":
            for version in versions:
                await music.system_reject_version(version, "QC_REJECTED")
            return
        profiles = await self._profiles()
        if not profiles:
            raise tools.MediaToolError("NO_RENDITION_PROFILES", "no usable rendition profile")
        for version in versions:
            await music.system_version_progress(version, "TRANSCODING", facts.duration_ms)
            for profile in profiles:
                await self.enqueue(
                    asset_id=asset.id,
                    kind="TRANSCODE",
                    key=f"transcode:{version.id}:{profile.key}:{profile.profile_version}",
                    target_id=version.id,
                    profile_key=profile.key,
                )

    async def _duplicate_elsewhere(self, asset: MediaAsset, sha: str) -> bool:
        """The same master bytes already belong to a different track (S8: warn the reviewer;
        re-releasing a single on an album legitimately reuses audio)."""
        from cornerroom.modules.music.domain.models import TrackVersion

        mine = select(TrackVersion.track_id).where(TrackVersion.media_asset_id == asset.id)
        row = (
            await self.session.execute(
                select(MediaAsset.id)
                .join(TrackVersion, TrackVersion.media_asset_id == MediaAsset.id)
                .where(
                    MediaAsset.sha256 == sha,
                    MediaAsset.id != asset.id,
                    MediaAsset.purpose == "AUDIO_MASTER",
                    MediaAsset.status != "REJECTED",
                    TrackVersion.track_id.not_in(mine),
                )
                .limit(1)
            )
        ).first()
        return row is not None

    async def _profiles(self) -> list[tools.Profile]:
        from cornerroom.modules.music.domain.models import RenditionProfile

        rows = (
            await self.session.execute(
                select(RenditionProfile).where(RenditionProfile.required.is_(True)).order_by(RenditionProfile.sort)
            )
        ).scalars().all()
        chosen = []
        # Per purpose (playback, download): ACTIVE profiles if any; until the listening test approves
        # playback bitrates, CANDIDATE ones run outside production only.
        for purpose in ("PLAYBACK", "DOWNLOAD"):
            mine = [r for r in rows if r.purpose == purpose]
            active = [r for r in mine if r.status == "ACTIVE"]
            chosen += active or ([r for r in mine if r.status == "CANDIDATE"] if not self.settings.is_production else [])
        if not any(r.purpose == "PLAYBACK" for r in chosen):
            return []  # never make a song READY with nothing to stream
        return [
            tools.Profile(
                r.key, r.codec, r.container, r.bitrate_kbps, r.sample_rate_hz, r.channels, r.profile_version, r.purpose
            )
            for r in sorted(chosen, key=lambda r: r.sort)
        ]

    async def _transcode(self, job: MediaJob, master: MediaAsset) -> None:
        from cornerroom.modules.music.application.service import MusicService
        from cornerroom.modules.music.domain.models import TrackRendition, TrackVersion

        version = await self.session.get(TrackVersion, job.target_id)
        # PROCESSING: a new master. READY: a copy added later (a new download profile) is backfilled
        # without touching the version's state. Anything else was replaced or cancelled meanwhile.
        if version is None or version.status not in {"PROCESSING", "READY"}:
            return
        profile = next((p for p in await self._profiles() if p.key == job.profile_key), None)
        if profile is None:
            raise tools.MediaToolError("PROFILE_RETIRED", job.profile_key or "")
        done = (
            await self.session.execute(
                select(TrackRendition).where(
                    TrackRendition.track_version_id == version.id,
                    TrackRendition.profile_key == profile.key,
                    TrackRendition.profile_version == profile.profile_version,
                )
            )
        ).scalar_one_or_none()
        if done is None:
            encoder = tools.tool_version(self.settings)
            source = self.storage.local_path(master.object_key)
            scratch = self.storage.scratch_dir() / f"{job.id}.{profile.container}"
            try:
                await tools.transcode(self.settings, source, scratch, profile)
                decoded = await tools.decoded_duration_ms(self.settings, scratch)
                if decoded is None or version.duration_ms is None or abs(decoded - version.duration_ms) > 150:
                    raise tools.MediaToolError(
                        "RENDITION_VERIFY_FAILED", f"decoded {decoded} ms vs master {version.duration_ms} ms"
                    )
                # Lossless copies keep the master's rate and depth: read what was actually written.
                with scratch.open("rb") as handle:
                    written = probe(handle, scratch.stat().st_size)
                asset_id = new_asset_id()
                # The full asset id: its first characters are only a timestamp (UUIDv7), so a short
                # prefix collides when a copy is remade (a retry, or a backfill) within a minute.
                key = f"catalog_audio/renditions/{version.id}/{profile.key}-v{profile.profile_version}-{asset_id.hex}.{profile.container}"
                stored = await self.storage.write_once(
                    object_key=key, chunks=_file_chunks(scratch), mime=_mime(profile.codec)
                )
            finally:
                scratch.unlink(missing_ok=True)
            rendition_asset = MediaAsset(
                id=asset_id,
                storage_class="catalog_audio",
                bucket=stored.bucket,
                object_key=key,
                mime=_mime(profile.codec),
                byte_size=stored.byte_size,
                sha256=stored.sha256,
                status="READY",
                scan_status="DERIVED",
                purpose="AUDIO_RENDITION",
                parent_asset_id=master.id,
                immutable=True,
            )
            self.session.add(rendition_asset)
            await self.session.flush()
            self.session.add(
                TrackRendition(
                    track_version_id=version.id,
                    profile_key=profile.key,
                    profile_version=profile.profile_version,
                    media_asset_id=asset_id,
                    codec=profile.codec,
                    container=profile.container,
                    bitrate_kbps=profile.bitrate_kbps or round(stored.byte_size * 8 / max(decoded, 1)),
                    sample_rate_hz=profile.sample_rate_hz or written.sample_rate_hz or 0,
                    channels=profile.channels,
                    duration_ms=decoded,
                    byte_size=stored.byte_size,
                    sha256=stored.sha256,
                    encoder="ffmpeg",
                    encoder_version=encoder,
                    status="READY",
                    purpose=profile.purpose,
                    bit_depth=written.bit_depth if profile.codec == "flac" else None,
                )
            )
            await self.session.flush()
            await self._event(
                RENDITION_CREATED,
                master,
                {"track_version_id": str(version.id), "profile": profile.key, "sha256": stored.sha256},
            )
        if version.status == "PROCESSING":
            await self._finish_if_complete(version, MusicService(self.session, settings=self.settings))

    async def enqueue_missing_renditions(self, *, batch: int = 20) -> int:
        """READY versions missing a required copy (a profile added later, such as the FLAC download
        copy, D-AUDIO-06) get it made from their verified master. Legacy demo audio has no master."""
        from cornerroom.modules.music.domain.models import TrackRendition, TrackVersion

        profiles = await self._profiles()
        made = 0
        for profile in profiles:
            have = select(TrackRendition.track_version_id).where(
                TrackRendition.profile_key == profile.key, TrackRendition.profile_version == profile.profile_version
            )
            # A job already made for it (queued, running or failed for an operator) is not repeated.
            asked = select(MediaJob.target_id).where(
                MediaJob.kind == "TRANSCODE", MediaJob.profile_key == profile.key, MediaJob.target_id.is_not(None)
            )
            rows = (
                await self.session.execute(
                    select(TrackVersion, MediaAsset)
                    .join(MediaAsset, MediaAsset.id == TrackVersion.media_asset_id)
                    .where(
                        TrackVersion.status == "READY",
                        TrackVersion.deleted_at.is_(None),
                        MediaAsset.purpose == "AUDIO_MASTER",
                        MediaAsset.deleted_at.is_(None),
                        TrackVersion.id.not_in(have),
                        TrackVersion.id.not_in(asked),
                    )
                    .limit(batch)
                )
            ).all()
            for version, master in rows:
                await self.enqueue(
                    asset_id=master.id,
                    kind="TRANSCODE",
                    key=f"transcode:{version.id}:{profile.key}:{profile.profile_version}",
                    target_id=version.id,
                    profile_key=profile.key,
                )
                made += 1
        return made

    async def _finish_if_complete(self, version, music) -> None:  # type: ignore[no-untyped-def]
        from cornerroom.modules.music.domain.models import TrackRendition

        needed = {(p.key, p.profile_version) for p in await self._profiles()}
        have = {
            (r.profile_key, r.profile_version)
            for r in (
                await self.session.execute(
                    select(TrackRendition).where(
                        TrackRendition.track_version_id == version.id, TrackRendition.status == "READY"
                    )
                )
            ).scalars()
        }
        if needed and needed <= have:
            await music.system_version_ready(version)

    # --- operator actions ------------------------------------------------------------------

    async def list_jobs(self, statuses: tuple[str, ...], limit: int = 100) -> list[MediaJob]:
        stmt = select(MediaJob).order_by(MediaJob.updated_at.desc()).limit(limit)
        if statuses:
            stmt = stmt.where(MediaJob.status.in_(statuses))
        return list((await self.session.execute(stmt)).scalars().all())

    async def retry(self, job_id: UUID, actor_id: UUID) -> MediaJob:
        job = await self.session.get(MediaJob, job_id)
        if job is None:
            raise NotFoundError("Media job not found")
        if job.status not in {"DEAD", "FAILED"}:
            raise AppError("INVALID_TRANSITION", "Only failed jobs can be retried", 409)
        job.status = "QUEUED"
        job.attempts = 0
        job.next_attempt_at = self.clock.now()
        await self.session.flush()
        await self.audit.record(
            action="media_job.retried", entity_type="MediaJob", entity_id=job.id, actor_id=str(actor_id),
            new_state={"status": "QUEUED"},
        )
        await self.session.refresh(job)
        return job

    async def cancel(self, job_id: UUID, actor_id: UUID) -> MediaJob:
        from cornerroom.modules.music.application.service import MusicService

        job = await self.session.get(MediaJob, job_id)
        if job is None:
            raise NotFoundError("Media job not found")
        if job.status not in {"DEAD", "FAILED", "QUEUED"}:
            raise AppError("INVALID_TRANSITION", "This job can't be cancelled now", 409)
        job.status = "CANCELLED"
        job.finished_at = self.clock.now()
        music = MusicService(self.session, settings=self.settings)
        for version in await music.versions_for_master(job.media_asset_id):
            await music.system_reject_version(version, "PROCESSING_FAILED")
        await self.session.flush()
        await self.audit.record(
            action="media_job.cancelled", entity_type="MediaJob", entity_id=job.id, actor_id=str(actor_id),
            new_state={"status": "CANCELLED"},
        )
        await self.session.refresh(job)
        return job

    async def _inspect_cover(self, job: MediaJob, asset: MediaAsset) -> None:
        from PIL import Image, UnidentifiedImageError

        from cornerroom.modules.documents.domain.models import UploadIntent
        from cornerroom.modules.music.application.service import MusicService

        path = self.storage.local_path(asset.object_key)
        sha = await self._verify_bytes(asset, path)
        size = path.stat().st_size
        fmt = width = height = mode = None
        try:
            with Image.open(path) as img:
                fmt, (width, height), mode = img.format, img.size, img.mode
                img.verify()
        except (UnidentifiedImageError, OSError, SyntaxError, ValueError):
            fmt = fmt or None
            width = height = None
        findings = cover_findings(
            fmt=fmt, width=width, height=height, mode=mode, byte_size=size,
            max_bytes=self.settings.media_cover_max_bytes,
            min_px=self.settings.media_cover_min_px, max_px=self.settings.media_cover_max_px,
        )
        import PIL

        inspection = await self._save_inspection(
            asset, tool_version=f"pillow-{PIL.__version__}", sha=sha, findings=findings,
            facts={"container": (fmt or "unknown").lower()[:16], "width_px": width, "height_px": height},
        )
        if inspection.outcome == "REJECTED":
            return
        asset.mime = "image/jpeg" if fmt == "JPEG" else "image/png"
        intent = (
            await self.session.execute(
                select(UploadIntent).where(UploadIntent.media_asset_id == asset.id)
            )
        ).scalar_one_or_none()
        if intent is not None and intent.target_type in {"release_cover", "event_cover"}:
            if intent.target_type == "release_cover":
                await MusicService(self.session, settings=self.settings).system_attach_cover(intent.target_id, asset.id)
            else:
                from cornerroom.modules.events.application.service import EventService

                await EventService(self.session).system_attach_cover(intent.target_id, asset.id)
            # Make the web sizes now, so the first visitor doesn't wait for them (OD-05, OD-06).
            from cornerroom.modules.documents.application.covers import COVER_SIZES, CoverService

            covers = CoverService(self.session, self.settings, self.storage)
            for size in COVER_SIZES:
                try:
                    await covers.image(asset.id, size)
                except Exception:  # noqa: BLE001 - the cover route makes any missing size on demand
                    break


def _mime(codec: str) -> str:
    return {"opus": "audio/ogg; codecs=opus", "mp3": "audio/mpeg", "flac": "audio/flac"}.get(codec, "application/octet-stream")


async def _file_chunks(path: Path):  # type: ignore[no-untyped-def]
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(256 * 1024), b""):
            yield chunk
