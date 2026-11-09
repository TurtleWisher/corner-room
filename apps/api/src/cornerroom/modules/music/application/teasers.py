"""Teasers (owner, 2026-11-07, D-TEASER-00 to D-TEASER-04).

The main purpose: everyone who has not bought a song can hear its teaser for free, as often as they
like, for as long as the song is on Corner Room, until they decide to buy. Teasing before release is
a smaller, extra use.

Four things never mix:
- the master (the track's current `TrackVersion`): never sent to any browser, not even the artist's;
- the teaser: files of class `teaser_audio` cut from the master by edit settings;
- the released song: the existing `catalog_audio` playback copies behind entitlement checks;
- the entitlement: made only by the existing checkout.
A teaser play is never a `PlaybackEvent`, a listen or royalty input.

Studio: the music's own people (claimed artist, band owner and managers) or catalog staff in the
active workspace, through `StudioService._track` (404 for anyone else). Staff with `music.approve`
review each version (D-TEASER-01); whoever submitted it cannot approve it. Anyone may listen to a
published teaser without an account (D-TEASER-02). At most `teaser_max_ms` long (D-TEASER-03).
Before release the teaser names the song; the cover follows the cover reveal (D-TEASER-04).
"""

from __future__ import annotations

import hashlib
import hmac
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

import jwt
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, NotFoundError, UnauthorizedError
from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.infra.settings import Settings, get_settings
from cornerroom.infra.review_policy import second_review_on
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import TEASER_PROCESSING_FAILED, TEASER_PUBLISHED, DomainEvent
from cornerroom.kernel.ids import new_uuid
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.documents.domain.models import MediaAsset
from cornerroom.modules.music.domain import teasers as rules
from cornerroom.modules.music.domain.models import (
    Release,
    ReleaseTrack,
    Teaser,
    TeaserCount,
    TeaserRendition,
    TeaserVersion,
    Track,
    TrackRendition,
    TrackVersion,
    TrackWaveform,
)

log = logging.getLogger(__name__)

TOKEN_SECONDS = 300
STUDIO_TOKEN_USE = "studio_audio"
TEASER_TOKEN_USE = "teaser_delivery"
COUNT_KINDS = ("START", "COMPLETE", "PROMPT_CLICK")


@dataclass(frozen=True, slots=True)
class MintedAudio:
    url: str
    expires_at: datetime
    codec: str | None
    alternates: list[tuple[str, str]]
    duration_ms: int | None = None
    gain_db: float | None = None


def _ranked(rows: list[tuple[Any, MediaAsset]], accept: list[str] | None) -> list[tuple[Any, MediaAsset]]:
    order = [c.strip().lower() for c in (accept or ["mp3", "opus"]) if c.strip()]
    rank = {codec: i for i, codec in enumerate(order)}
    return sorted(rows, key=lambda r: rank.get(r[0].codec or "", len(order)))


async def processing_failed(session: AsyncSession, clock: Clock, version: TeaserVersion, code: str) -> None:
    """The worker gave up on a version: it is FAILED with the reason, the master and the settings stay,
    and the person who asked is told (notifications consumer)."""
    version.status = rules.V_FAILED
    version.failure_code = code[:64]
    teaser = await session.get(Teaser, version.teaser_id)
    track = await session.get(Track, teaser.track_id) if teaser else None
    await AuditService(session).record(
        actor_id="system:media-worker", actor_type="system", action="teaser.processing_failed",
        entity_type="TeaserVersion", entity_id=version.id, new_state={"status": rules.V_FAILED, "code": version.failure_code},
    )
    await enqueue_outbox(
        session,
        DomainEvent(
            event_type=TEASER_PROCESSING_FAILED,
            producer="music",
            aggregate_type="Teaser",
            aggregate_id=version.teaser_id,
            payload={
                "teaser_id": str(version.teaser_id),
                "version_id": str(version.id),
                "track_id": str(track.id) if track else None,
                "requested_by": str(version.created_by) if version.created_by else None,
                "code": version.failure_code,
            },
            occurred_at=clock.now(),
            actor_id=None,
            organization_id=track.primary_org_id if track else None,
        ),
    )
    await session.flush()


class TeaserService:
    def __init__(self, session: AsyncSession, settings: Settings | None = None, clock: Clock | None = None) -> None:
        from cornerroom.modules.music.application.studio import StudioService

        self.session = session
        self.settings = settings or get_settings()
        self.clock = clock or SystemClock()
        self.studio = StudioService(session, self.settings, self.clock)
        self.music = self.studio.music
        self.audit = AuditService(session)

    # --- access --------------------------------------------------------------------------------

    async def _track(self, ctx: AuthContext, track_id: UUID) -> tuple[Track, Release, str]:
        return await self.studio._track(ctx, track_id)

    async def _teaser(self, ctx: AuthContext, teaser_id: UUID) -> tuple[Teaser, Track, Release, str]:
        teaser = await self.session.get(Teaser, teaser_id)
        if teaser is None or teaser.deleted_at is not None:
            raise NotFoundError("Teaser not found")
        track, release, role = await self._track(ctx, teaser.track_id)
        return teaser, track, release, role

    async def act_of(self, teaser_id: UUID) -> UUID | None:
        """The act whose song this teaser is (D-REVIEW-ARTIST-01 decides who waits by it)."""
        teaser = await self.session.get(Teaser, teaser_id)
        if teaser is None:
            return None
        link = (await self.session.execute(select(ReleaseTrack).where(ReleaseTrack.track_id == teaser.track_id))).scalars().first()
        release = await self.session.get(Release, link.release_id) if link else None
        return (release.primary_artist_id or release.primary_band_id) if release else None

    async def _is_reviewer(self, ctx: AuthContext, track: Track) -> bool:
        if track.primary_org_id is None:
            return False
        return await self.music._is_allowed(
            ctx.user_id, "music.approve", resource_type="track", resource_id=track.id, organization_id=track.primary_org_id
        )

    async def _reviewable(self, ctx: AuthContext, teaser_id: UUID) -> tuple[Teaser, Track]:
        teaser = await self.session.get(Teaser, teaser_id)
        if teaser is None or teaser.deleted_at is not None:
            raise NotFoundError("Teaser not found")
        track = await self.session.get(Track, teaser.track_id)
        if track is None or not await self._is_reviewer(ctx, track):
            raise NotFoundError("Teaser not found")
        return teaser, track

    # --- facts ---------------------------------------------------------------------------------

    async def _master(self, track_id: UUID) -> TrackVersion | None:
        return (
            await self.session.execute(
                select(TrackVersion).where(
                    TrackVersion.track_id == track_id,
                    TrackVersion.is_current.is_(True),
                    TrackVersion.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()

    async def _ready_master(self, track_id: UUID) -> TrackVersion:
        master = await self._master(track_id)
        if master is None or master.status != "READY" or master.media_asset_id is None or not master.duration_ms:
            raise AppError(
                "MASTER_NOT_READY", "Upload the song's master first", 409,
                "A teaser is cut from the song's checked master; upload it in the release editor",
            )
        return master

    async def _versions(self, teaser_id: UUID) -> list[TeaserVersion]:
        return list(
            (
                await self.session.execute(
                    select(TeaserVersion).where(TeaserVersion.teaser_id == teaser_id).order_by(TeaserVersion.number)
                )
            ).scalars()
        )

    async def _latest(self, teaser_id: UUID) -> TeaserVersion | None:
        versions = await self._versions(teaser_id)
        return versions[-1] if versions else None

    def _limits(self) -> dict[str, int]:
        return {
            "min_ms": self.settings.teaser_min_ms,
            "max_ms": self.settings.teaser_max_ms,
            "fade_max_ms": rules.FADE_MAX_MS,
            "gain_min_cdb": rules.GAIN_MIN_CDB,
            "gain_max_cdb": rules.GAIN_MAX_CDB,
        }

    def _check(self, settings: rules.Settings, master_ms: int) -> None:
        found = rules.problems(
            settings, master_ms=master_ms, min_ms=self.settings.teaser_min_ms, max_ms=self.settings.teaser_max_ms
        )
        if found:
            raise AppError("TEASER_SETTINGS_INVALID", "These teaser settings can't be used", 422, ",".join(found))

    def _actions(self, teaser: Teaser, latest: TeaserVersion | None) -> list[str]:
        facts = None
        if latest is not None:
            facts = rules.VersionFacts(latest.status, latest.review_status, latest.id == teaser.live_version_id)
        return rules.artist_actions(teaser.status, facts, ever_published=teaser.published_at is not None)

    async def _refresh_status(self, teaser: Teaser) -> None:
        versions = await self._versions(teaser.id)
        waiting = any(v.review_status == rules.WAITING for v in versions)
        if teaser.live_version_id is None:
            teaser.status = rules.status_after(has_live=False, live_shown=False, waiting=waiting)

    async def _totals(self, teaser_id: UUID) -> dict[str, int]:
        row = (
            await self.session.execute(
                select(
                    func.coalesce(func.sum(TeaserCount.starts), 0),
                    func.coalesce(func.sum(TeaserCount.completes), 0),
                    func.coalesce(func.sum(TeaserCount.prompt_clicks), 0),
                ).where(TeaserCount.teaser_id == teaser_id)
            )
        ).one()
        return {"starts": int(row[0]), "completes": int(row[1]), "prompt_clicks": int(row[2])}

    @staticmethod
    def _version_out(v: TeaserVersion, live_id: UUID | None) -> dict[str, Any]:
        return {
            "id": v.id,
            "number": v.number,
            "start_ms": v.start_ms,
            "end_ms": v.end_ms,
            "fade_in_ms": v.fade_in_ms,
            "fade_out_ms": v.fade_out_ms,
            "gain_cdb": v.gain_cdb,
            "status": v.status,
            "failure_code": v.failure_code,
            "duration_ms": v.duration_ms,
            "review_status": v.review_status,
            "review_note": v.review_note,
            "submitted_at": v.submitted_at,
            "published_at": v.published_at,
            "retired_at": v.retired_at,
            "is_live": v.id == live_id,
            "created_at": v.created_at,
        }

    async def _detail(self, teaser: Teaser, track: Track, release: Release) -> dict[str, Any]:
        versions = await self._versions(teaser.id)
        latest = versions[-1] if versions else None
        master = await self._master(track.id)
        return {
            "id": teaser.id,
            "title": teaser.title,
            "status": teaser.status,
            "track_id": track.id,
            "track_title": track.title,
            "track_status": track.status,
            "release_id": release.id,
            "release_title": release.title,
            "published_at": teaser.published_at,
            "master": {
                "version_id": master.id if master else None,
                "status": master.status if master else None,
                "duration_ms": master.duration_ms if master else None,
                "processing_detail": master.processing_detail if master else None,
            },
            "versions": [self._version_out(v, teaser.live_version_id) for v in reversed(versions)],
            "latest_version_id": latest.id if latest else None,
            "actions": self._actions(teaser, latest),
            "limits": self._limits(),
            "counts": await self._totals(teaser.id),
        }

    # --- studio: read ------------------------------------------------------------------------

    async def release_overview(self, ctx: AuthContext, release_id: UUID) -> dict[str, Any]:
        release, _role = await self.studio._release(ctx, release_id)
        links = (
            await self.session.execute(
                select(ReleaseTrack).where(ReleaseTrack.release_id == release.id).order_by(ReleaseTrack.position)
            )
        ).scalars().all()
        songs = []
        for link in links:
            track = await self.session.get(Track, link.track_id)
            if track is None or track.deleted_at is not None:
                continue
            master = await self._master(track.id)
            teasers = (
                await self.session.execute(
                    select(Teaser)
                    .where(Teaser.track_id == track.id, Teaser.deleted_at.is_(None))
                    .order_by(Teaser.created_at.desc())
                )
            ).scalars().all()
            rows = []
            for teaser in teasers:
                latest = await self._latest(teaser.id)
                live = await self.session.get(TeaserVersion, teaser.live_version_id) if teaser.live_version_id else None
                rows.append(
                    {
                        "id": teaser.id,
                        "title": teaser.title,
                        "status": teaser.status,
                        "live_duration_ms": live.duration_ms if live else None,
                        "latest_status": latest.status if latest else None,
                        "latest_review_status": latest.review_status if latest else None,
                        "latest_review_note": latest.review_note if latest else None,
                        "counts": await self._totals(teaser.id),
                    }
                )
            songs.append(
                {
                    "track_id": track.id,
                    "title": track.title,
                    "track_status": track.status,
                    "master_status": master.status if master else None,
                    "master_duration_ms": master.duration_ms if master else None,
                    "teasers": rows,
                }
            )
        return {"release_id": release.id, "release_title": release.title, "release_status": release.status, "songs": songs}

    async def detail(self, ctx: AuthContext, teaser_id: UUID) -> dict[str, Any]:
        teaser, track, release, _role = await self._teaser(ctx, teaser_id)
        return await self._detail(teaser, track, release)

    async def waveform(self, ctx: AuthContext, track_id: UUID) -> dict[str, Any]:
        from cornerroom.modules.documents.application.media_jobs import MediaJobService
        from cornerroom.modules.music.application.teaser_jobs import waveform_key

        track, _release, _role = await self._track(ctx, track_id)
        master = await self._ready_master(track.id)
        row = await self.session.get(TrackWaveform, master.id)
        if row is not None:
            return {
                "status": "READY",
                "track_version_id": master.id,
                "points": row.points,
                "bucket_ms": row.bucket_ms,
                "duration_ms": row.duration_ms,
            }
        job = await MediaJobService(self.session, self.settings, clock=self.clock).enqueue(
            asset_id=master.media_asset_id, kind="WAVEFORM", key=waveform_key(master.id), target_id=master.id
        )
        status = "FAILED" if job.status in ("DEAD", "CANCELLED") else "PENDING"
        return {"status": status, "track_version_id": master.id, "points": [], "bucket_ms": 0, "duration_ms": master.duration_ms}

    # --- studio: write -----------------------------------------------------------------------

    async def create(self, ctx: AuthContext, track_id: UUID, title: str | None) -> dict[str, Any]:
        track, release, _role = await self._track(ctx, track_id)
        if track.status == "TAKEN_DOWN":
            raise AppError("TRACK_TAKEN_DOWN", "This song was taken down", 409)
        master = await self._ready_master(track.id)
        teaser = Teaser(
            id=new_uuid(), track_id=track.id, title=_clean_title(title), status=rules.DRAFT,
            created_by=ctx.user_id, updated_by=ctx.user_id,
        )
        self.session.add(teaser)
        await self.session.flush()
        first = rules.default_settings(master.duration_ms or 0, max_ms=self.settings.teaser_max_ms)
        self.session.add(
            TeaserVersion(
                teaser_id=teaser.id, number=1, source_track_version_id=master.id, start_ms=first.start_ms,
                end_ms=first.end_ms, status=rules.V_DRAFT, processing_version=rules.PROCESSING_VERSION,
                created_by=ctx.user_id,
            )
        )
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx, action="teaser.created", entity_type="Teaser", entity_id=teaser.id,
            new_state={"track_id": str(track.id), "title": teaser.title}, organization_id=track.primary_org_id,
        )
        return await self._detail(teaser, track, release)

    async def rename(self, ctx: AuthContext, teaser_id: UUID, title: str | None) -> dict[str, Any]:
        teaser, track, release, _role = await self._teaser(ctx, teaser_id)
        previous = teaser.title
        teaser.title = _clean_title(title)
        teaser.updated_by = ctx.user_id
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx, action="teaser.renamed", entity_type="Teaser", entity_id=teaser.id,
            previous_state={"title": previous}, new_state={"title": teaser.title}, organization_id=track.primary_org_id,
        )
        return await self._detail(teaser, track, release)

    async def save_draft(self, ctx: AuthContext, teaser_id: UUID, settings: rules.Settings) -> dict[str, Any]:
        """Save edit settings. A version that was never processed is changed in place; anything
        processed (or live) stays as it was and a new version holds the change."""
        teaser, track, release, _role = await self._teaser(ctx, teaser_id)
        master = await self._ready_master(track.id)
        self._check(settings, master.duration_ms or 0)
        latest = await self._latest(teaser.id)
        if latest is not None and latest.review_status == rules.WAITING:
            raise AppError("TEASER_IN_REVIEW", "Take this teaser back from review to change it", 409)
        if latest is not None and latest.status == rules.V_DRAFT and latest.id != teaser.live_version_id:
            version = latest
            previous = {"start_ms": version.start_ms, "end_ms": version.end_ms}
        else:
            version = TeaserVersion(
                teaser_id=teaser.id, number=(latest.number + 1) if latest else 1, status=rules.V_DRAFT,
                processing_version=rules.PROCESSING_VERSION, created_by=ctx.user_id,
                source_track_version_id=master.id, start_ms=0, end_ms=1,
            )
            self.session.add(version)
            previous = None
        version.source_track_version_id = master.id
        version.start_ms = settings.start_ms
        version.end_ms = settings.end_ms
        version.fade_in_ms = settings.fade_in_ms
        version.fade_out_ms = settings.fade_out_ms
        version.gain_cdb = settings.gain_cdb
        version.review_status = None
        version.review_note = None
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx, action="teaser.draft_saved", entity_type="TeaserVersion", entity_id=version.id,
            previous_state=previous,
            new_state={
                "teaser_id": str(teaser.id), "number": version.number, "start_ms": version.start_ms,
                "end_ms": version.end_ms, "fade_in_ms": version.fade_in_ms, "fade_out_ms": version.fade_out_ms,
                "gain_cdb": version.gain_cdb,
            },
            organization_id=track.primary_org_id,
        )
        return await self._detail(teaser, track, release)

    async def process(self, ctx: AuthContext, teaser_id: UUID) -> dict[str, Any]:
        """Queue the teaser copies of the open version. Asking twice queues nothing new; a failed
        version is retried with the same jobs (reset, never duplicated)."""
        from cornerroom.modules.documents.application.media_jobs import MediaJobService
        from cornerroom.modules.music.application.teaser_jobs import playback_profiles, teaser_key

        teaser, track, release, _role = await self._teaser(ctx, teaser_id)
        latest = await self._latest(teaser.id)
        if latest is None or latest.status not in (rules.V_DRAFT, rules.V_FAILED, rules.V_PROCESSING):
            raise AppError("INVALID_TRANSITION", "Change the settings to make a new version first", 409)
        if latest.status == rules.V_PROCESSING:
            return await self._detail(teaser, track, release)
        master = await self._ready_master(track.id)
        if master.id != latest.source_track_version_id:
            raise AppError("MASTER_CHANGED", "The song's master changed: save the settings again", 409)
        self._check(
            rules.Settings(latest.start_ms, latest.end_ms, latest.fade_in_ms, latest.fade_out_ms, latest.gain_cdb),
            master.duration_ms or 0,
        )
        jobs = MediaJobService(self.session, self.settings, clock=self.clock)
        profiles = await playback_profiles(jobs)
        if not profiles:
            raise AppError("NO_PLAYBACK_PROFILE", "Teasers can't be made right now", 409)
        latest.status = rules.V_PROCESSING
        latest.failure_code = None
        made = {
            (r.profile_key, r.profile_version)
            for r in (
                await self.session.execute(select(TeaserRendition).where(TeaserRendition.teaser_version_id == latest.id))
            ).scalars()
        }
        for profile in profiles:
            job = await jobs.enqueue(
                asset_id=master.media_asset_id, kind="TEASER", key=teaser_key(latest, profile),
                target_id=latest.id, profile_key=profile.key,
            )
            # A retry runs again every job whose file is missing: a failed one, and also a sibling
            # that finished without making its file because the version had failed meanwhile.
            missing = (profile.key, profile.profile_version) not in made
            if missing and job.status not in ("QUEUED", "RUNNING"):
                job.status = "QUEUED"
                job.attempts = 0
                job.last_error_code = None
                job.next_attempt_at = self.clock.now()
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx, action="teaser.processing_requested", entity_type="TeaserVersion", entity_id=latest.id,
            new_state={"teaser_id": str(teaser.id), "number": latest.number}, organization_id=track.primary_org_id,
        )
        return await self._detail(teaser, track, release)

    async def transition(self, ctx: AuthContext, teaser_id: UUID, action: str) -> dict[str, Any]:
        teaser, track, release, _role = await self._teaser(ctx, teaser_id)
        latest = await self._latest(teaser.id)
        action = (action or "").strip().lower()
        if action not in self._actions(teaser, latest) or action in ("process", "delete"):
            raise AppError("INVALID_TRANSITION", "That can't be done to this teaser now", 409)
        before = teaser.status
        now = self.clock.now()
        if action == "submit":
            assert latest is not None
            latest.review_status = rules.WAITING
            latest.submitted_at = now
            latest.submitted_by = ctx.user_id
            latest.review_note = None
        elif action == "withdraw":
            assert latest is not None
            latest.review_status = rules.WITHDRAWN
        elif action == "unpublish":
            teaser.status = rules.UNPUBLISHED
        elif action == "republish":
            teaser.status = rules.PUBLISHED
        await self._refresh_status(teaser)
        teaser.updated_by = ctx.user_id
        await self.music._flush_versioned()
        await self.audit.record_from_auth(
            ctx, action=f"teaser.{_past(action)}", entity_type="Teaser", entity_id=teaser.id,
            previous_state={"status": before}, new_state={"status": teaser.status}, organization_id=track.primary_org_id,
        )
        return await self._detail(teaser, track, release)

    async def delete(self, ctx: AuthContext, teaser_id: UUID) -> None:
        teaser, track, _release, _role = await self._teaser(ctx, teaser_id)
        if "delete" not in self._actions(teaser, await self._latest(teaser.id)):
            raise AppError("TEASER_WAS_PUBLIC", "A teaser that was public can be unpublished, not deleted", 409)
        # Owner, 2026-11-07: deleting a teaser removes it with every version, not only the teaser.
        # It was never public, so nobody heard it: its versions, made files' records, counts and
        # waiting jobs go too. The audit entry below keeps the trace.
        from sqlalchemy import delete, update

        from cornerroom.modules.documents.domain.models import MediaJob

        now = self.clock.now()
        version_ids = list(
            (await self.session.execute(select(TeaserVersion.id).where(TeaserVersion.teaser_id == teaser.id))).scalars()
        )
        previous = {"status": teaser.status, "versions": len(version_ids)}
        if version_ids:
            await self.session.execute(
                update(MediaJob)
                .where(MediaJob.kind == "TEASER", MediaJob.target_id.in_(version_ids), MediaJob.status.in_(("QUEUED", "FAILED")))
                .values(status="CANCELLED", finished_at=now)
            )
            asset_ids = list(
                (
                    await self.session.execute(
                        select(TeaserRendition.media_asset_id).where(TeaserRendition.teaser_version_id.in_(version_ids))
                    )
                ).scalars()
            )
            await self.session.execute(delete(TeaserRendition).where(TeaserRendition.teaser_version_id.in_(version_ids)))
            if asset_ids:
                await self.session.execute(
                    update(MediaAsset).where(MediaAsset.id.in_(asset_ids), MediaAsset.deleted_at.is_(None)).values(deleted_at=now)
                )
        teaser.live_version_id = None
        await self.music._flush_versioned()
        await self.session.execute(delete(TeaserCount).where(TeaserCount.teaser_id == teaser.id))
        if version_ids:
            await self.session.execute(delete(TeaserVersion).where(TeaserVersion.id.in_(version_ids)))
        await self.session.execute(delete(Teaser).where(Teaser.id == teaser_id))
        await self.audit.record_from_auth(
            ctx, action="teaser.deleted", entity_type="Teaser", entity_id=teaser_id,
            previous_state=previous, new_state={"deleted": True, "versions_deleted": len(version_ids)},
            organization_id=track.primary_org_id,
        )

    # --- staff review ------------------------------------------------------------------------

    async def review_queue(self, ctx: AuthContext) -> list[dict[str, Any]]:
        org = await self.studio._require_staff_workspace(ctx, "music.approve")
        rows = (
            await self.session.execute(
                select(TeaserVersion, Teaser, Track)
                .join(Teaser, Teaser.id == TeaserVersion.teaser_id)
                .join(Track, Track.id == Teaser.track_id)
                .where(
                    TeaserVersion.review_status == rules.WAITING,
                    Teaser.deleted_at.is_(None),
                    Track.primary_org_id == org,
                )
                .order_by(TeaserVersion.submitted_at)
                .limit(200)
            )
        ).all()
        out = []
        for version, teaser, track in rows:
            out.append(await self._queue_item(version, teaser, track))
        return out

    async def _queue_item(self, version: TeaserVersion, teaser: Teaser, track: Track) -> dict[str, Any]:
        profile_name = None
        for kind, pid in (("artist", track.primary_artist_id), ("band", track.primary_band_id)):
            if pid is not None:
                try:
                    _row, _org, profile_name = await self.studio._profile(kind, pid)
                except NotFoundError:
                    profile_name = None
                break
        return {
            "teaser_id": teaser.id,
            "version_id": version.id,
            "number": version.number,
            "title": teaser.title,
            "track_id": track.id,
            "track_title": track.title,
            "track_status": track.status,
            "profile_name": profile_name,
            "start_ms": version.start_ms,
            "end_ms": version.end_ms,
            "duration_ms": version.duration_ms,
            "submitted_at": version.submitted_at,
            "replaces_live": teaser.live_version_id is not None,
        }

    async def review(self, ctx: AuthContext, teaser_id: UUID, action: str, note: str | None) -> dict[str, Any]:
        teaser, track = await self._reviewable(ctx, teaser_id)
        action = (action or "").strip().lower()
        text = " ".join((note or "").split())[:2000] or None
        before = teaser.status
        now = self.clock.now()
        if action == "unpublish":
            if teaser.status != rules.PUBLISHED:
                raise AppError("INVALID_TRANSITION", "This teaser is not public", 409)
            teaser.status = rules.UNPUBLISHED
            audit_action = "teaser.unpublished_by_staff"
        elif action in ("approve", "return"):
            version = (
                await self.session.execute(
                    select(TeaserVersion).where(
                        TeaserVersion.teaser_id == teaser.id, TeaserVersion.review_status == rules.WAITING
                    )
                )
            ).scalars().first()
            if version is None:
                raise AppError("INVALID_TRANSITION", "Nothing is waiting for review on this teaser", 409)
            if action == "return":
                if not text:
                    raise AppError("VALIDATION_ERROR", "Tell the artist what to change", 422)
                version.review_status = rules.RETURNED
                version.review_note = text
                version.decided_at = now
                version.decided_by = ctx.user_id
                audit_action = "teaser.returned"
            else:
                if version.status != rules.V_READY:
                    raise AppError("TEASER_NOT_READY", "This version isn't made yet", 409)
                links = (
                    await self.session.execute(select(ReleaseTrack.release_id).where(ReleaseTrack.track_id == track.id))
                ).scalars().all()
                await self.music.assert_independent_reviewer(ctx, list(links))
                if second_review_on(self.settings) and ctx.user_id in {version.submitted_by, version.created_by}:
                    raise AppError("SAME_PERSON_REVIEW", "Someone else must approve this", 403, "You made or sent this teaser")
                if teaser.live_version_id is not None:
                    old = await self.session.get(TeaserVersion, teaser.live_version_id)
                    if old is not None:
                        old.retired_at = now
                version.review_status = rules.APPROVED
                version.review_note = None
                version.decided_at = now
                version.decided_by = ctx.user_id
                version.published_at = now
                teaser.live_version_id = version.id
                teaser.status = rules.PUBLISHED
                teaser.published_at = teaser.published_at or now
                audit_action = "teaser.approved"
                await enqueue_outbox(
                    self.session,
                    DomainEvent(
                        event_type=TEASER_PUBLISHED,
                        producer="music",
                        aggregate_type="Teaser",
                        aggregate_id=teaser.id,
                        payload={
                            "teaser_id": str(teaser.id),
                            "version_id": str(version.id),
                            "track_id": str(track.id),
                            "track_title": track.title,
                            "submitted_by": str(version.submitted_by) if version.submitted_by else None,
                        },
                        occurred_at=now,
                        actor_id=ctx.user_id,
                        organization_id=track.primary_org_id,
                        correlation_id=ctx.request_id,
                    ),
                )
        else:
            raise AppError("VALIDATION_ERROR", "Action must be approve, return or unpublish", 422)
        await self._refresh_status(teaser)
        teaser.updated_by = ctx.user_id
        await self.music._flush_versioned()
        await self.audit.record_from_auth(
            ctx, action=audit_action, entity_type="Teaser", entity_id=teaser.id,
            previous_state={"status": before}, new_state={"status": teaser.status, "note": text},
            organization_id=track.primary_org_id,
        )
        return {"teaser_id": teaser.id, "status": teaser.status}

    # --- audio tokens --------------------------------------------------------------------------

    def _mint(self, payload: dict[str, Any], use: str, route: str) -> tuple[str, datetime]:
        issued = self.clock.now()
        expires = issued + timedelta(seconds=TOKEN_SECONDS)
        body = {
            **payload,
            "iss": self.settings.jwt_issuer,
            "iat": int(issued.timestamp()),
            "exp": int(expires.timestamp()),
            "jti": str(new_uuid()),
            "token_use": use,
        }
        token = jwt.encode(body, self.settings.media_secret, algorithm="HS256")
        return f"/api/v1/{route}/{token}", expires

    def _parse(self, token: str, use: str) -> dict[str, Any]:
        try:
            payload = jwt.decode(token, self.settings.media_secret, algorithms=["HS256"], issuer=self.settings.jwt_issuer)
        except jwt.PyJWTError as exc:
            raise UnauthorizedError("Invalid or expired audio token") from exc
        if payload.get("token_use") != use:
            raise UnauthorizedError("Invalid token type")
        return payload

    async def _song_copies(self, version_id: UUID) -> list[tuple[TrackRendition, MediaAsset]]:
        """The song's playback copies only: never the master, never the lossless download copy."""
        return list(
            (
                await self.session.execute(
                    select(TrackRendition, MediaAsset)
                    .join(MediaAsset, MediaAsset.id == TrackRendition.media_asset_id)
                    .where(
                        TrackRendition.track_version_id == version_id,
                        TrackRendition.status == "READY",
                        TrackRendition.purpose == "PLAYBACK",
                        MediaAsset.storage_class == "catalog_audio",
                        MediaAsset.purpose == "AUDIO_RENDITION",
                        MediaAsset.deleted_at.is_(None),
                    )
                )
            ).all()
        )

    async def _teaser_copies(self, version_id: UUID) -> list[tuple[TeaserRendition, MediaAsset]]:
        return list(
            (
                await self.session.execute(
                    select(TeaserRendition, MediaAsset)
                    .join(MediaAsset, MediaAsset.id == TeaserRendition.media_asset_id)
                    .where(
                        TeaserRendition.teaser_version_id == version_id,
                        MediaAsset.storage_class == "teaser_audio",
                        MediaAsset.deleted_at.is_(None),
                    )
                )
            ).all()
        )

    def _minted(self, rows: list[tuple[Any, MediaAsset]], accept: list[str] | None, base: dict[str, Any],
                use: str, route: str) -> MintedAudio:
        if not rows:
            raise AppError("AUDIO_NOT_READY", "This audio isn't ready yet", 409)
        ranked = _ranked(rows, accept)
        urls = [(r.codec, *self._mint({**base, "aid": str(a.id)}, use, route)) for r, a in ranked]
        codec, url, expires = urls[0]
        return MintedAudio(url=url, expires_at=expires, codec=codec, alternates=[(c, u) for c, u, _e in urls[1:]])

    async def studio_listen_song(self, ctx: AuthContext, track_id: UUID, accept: list[str] | None) -> MintedAudio:
        """The artist hears their own song while editing, released or not: the playback copy only."""
        track, _release, _role = await self._track(ctx, track_id)
        master = await self._ready_master(track.id)
        minted = self._minted(
            await self._song_copies(master.id), accept,
            {"sub": str(ctx.user_id), "kind": "song", "ref": str(track.id), "vid": str(master.id)},
            STUDIO_TOKEN_USE, "studio/audio",
        )
        return MintedAudio(minted.url, minted.expires_at, minted.codec, minted.alternates, master.duration_ms)

    async def studio_listen_version(self, ctx: AuthContext, teaser_id: UUID, version_id: UUID,
                                    accept: list[str] | None) -> MintedAudio:
        """The team or a reviewer hears a made version exactly as fans would."""
        teaser = await self.session.get(Teaser, teaser_id)
        if teaser is None or teaser.deleted_at is not None:
            raise NotFoundError("Teaser not found")
        try:
            await self._track(ctx, teaser.track_id)
        except NotFoundError:
            await self._reviewable(ctx, teaser_id)
        version = await self.session.get(TeaserVersion, version_id)
        if version is None or version.teaser_id != teaser.id or version.status != rules.V_READY:
            raise NotFoundError("Version not found")
        minted = self._minted(
            await self._teaser_copies(version.id), accept,
            {"sub": str(ctx.user_id), "kind": "teaser", "ref": str(teaser.id), "vid": str(version.id)},
            STUDIO_TOKEN_USE, "studio/audio",
        )
        return MintedAudio(minted.url, minted.expires_at, minted.codec, minted.alternates, version.duration_ms)

    async def open_studio_media(self, token: str) -> MediaAsset:
        """Every byte request re-checks the person and that the asset is one this token may name."""
        payload = self._parse(token, STUDIO_TOKEN_USE)
        ctx = AuthContext(user_id=UUID(str(payload["sub"])), request_id="studio-audio")
        asset_id = UUID(str(payload["aid"]))
        version_id = UUID(str(payload["vid"]))
        if payload.get("kind") == "song":
            await self._track(ctx, UUID(str(payload["ref"])))
            rows = await self._song_copies(version_id)
        elif payload.get("kind") == "teaser":
            teaser_id = UUID(str(payload["ref"]))
            teaser = await self.session.get(Teaser, teaser_id)
            if teaser is None or teaser.deleted_at is not None:
                raise NotFoundError("Teaser not found")
            try:
                await self._track(ctx, teaser.track_id)
            except NotFoundError:
                await self._reviewable(ctx, teaser_id)
            version = await self.session.get(TeaserVersion, version_id)
            if version is None or version.teaser_id != teaser_id:
                raise NotFoundError("Version not found")
            rows = await self._teaser_copies(version_id)
        else:
            raise UnauthorizedError("Invalid token")
        for _r, asset in rows:
            if asset.id == asset_id:
                return asset
        raise AppError("AUDIO_NOT_READY", "This audio isn't available", 409)

    # --- public --------------------------------------------------------------------------------

    async def _public_parts(self, teaser_id: UUID) -> tuple[Teaser, TeaserVersion, Track]:
        teaser = await self.session.get(Teaser, teaser_id)
        if teaser is None or teaser.live_version_id is None:
            raise NotFoundError("Teaser not found")
        version = await self.session.get(TeaserVersion, teaser.live_version_id)
        track = await self.session.get(Track, teaser.track_id)
        live_ready = version is not None and version.status == rules.V_READY
        ok = rules.public(
            teaser_status=teaser.status, teaser_deleted=teaser.deleted_at is not None, live_ready=live_ready,
            track_status=track.status if track else None, track_deleted=track is None or track.deleted_at is not None,
        )
        if not ok or version is None or track is None:
            raise NotFoundError("Teaser not found")
        if not await self._release_of(track):
            raise NotFoundError("Teaser not found")
        return teaser, version, track

    async def _release_of(self, track: Track) -> Release | None:
        """The release the song is on (released first), never a deleted one."""
        rows = (
            await self.session.execute(
                select(Release)
                .join(ReleaseTrack, ReleaseTrack.release_id == Release.id)
                .where(ReleaseTrack.track_id == track.id, Release.deleted_at.is_(None))
            )
        ).scalars().all()
        rows = [r for r in rows if r.status != "TAKEN_DOWN"]
        rows.sort(key=lambda r: (r.status != "RELEASED", r.created_at))
        return rows[0] if rows else None

    async def _artist_name(self, track: Track) -> tuple[str | None, str | None, UUID | None]:
        for kind, pid in (("artist", track.primary_artist_id), ("band", track.primary_band_id)):
            if pid is not None:
                try:
                    _row, _org, name = await self.studio._profile(kind, pid)
                    return name, kind, pid
                except NotFoundError:
                    return None, kind, pid
        return None, None, None

    async def _next_step(self, viewer: UUID | None, track: Track, release: Release) -> dict[str, Any]:
        """What a listener can do next, from existing sources only: never an invented offer."""
        from cornerroom.modules.commerce.application.catalog import CatalogCommerceService
        from cornerroom.modules.commerce.application.onsite_presale import presale_open
        from cornerroom.modules.entitlements.application.service import EntitlementService
        from cornerroom.modules.streaming.application.stream_access import StreamAccess

        if viewer is not None:
            if await EntitlementService(self.session, clock=self.clock).owns_by_purchase(viewer, track.id):
                return {"kind": "OWNED", "track_id": track.id, "release_id": release.id}
            if await StreamAccess(self.session).can_stream(viewer, track.id):
                return {"kind": "OWNED", "track_id": track.id, "release_id": release.id}
        if track.status == "RELEASED":
            catalog = CatalogCommerceService(self.session, clock=self.clock)
            offers, _next = await catalog.list_public_offers(limit=200)
            for _offer, product in offers:
                if product.product_type == "TRACK" and product.subject_id == track.id:
                    return {"kind": "BUY", "track_id": track.id, "release_id": release.id}
            released = {
                r for r in (
                    await self.session.execute(
                        select(Release.id)
                        .join(ReleaseTrack, ReleaseTrack.release_id == Release.id)
                        .where(ReleaseTrack.track_id == track.id, Release.status == "RELEASED", Release.deleted_at.is_(None))
                    )
                ).scalars()
            }
            for _offer, product in offers:
                if product.product_type == "RELEASE" and product.subject_id in released:
                    return {"kind": "BUY_RELEASE", "track_id": track.id, "release_id": product.subject_id}
            return {"kind": "NONE", "track_id": track.id, "release_id": release.id}
        if presale_open(release, self.clock.now()):
            return {"kind": "PREBOOK", "track_id": track.id, "release_id": release.id}
        return {"kind": "NONE", "track_id": track.id, "release_id": release.id}

    async def public_view(self, teaser_id: UUID, viewer: UUID | None) -> dict[str, Any]:
        from cornerroom.modules.documents.application.covers import CoverService
        from cornerroom.modules.music.domain.cover_reveal import cover_revealed

        teaser, version, track = await self._public_parts(teaser_id)
        release = await self._release_of(track)
        assert release is not None
        artist, artist_kind, artist_id = await self._artist_name(track)
        now = self.clock.now()
        shown = release.cover_asset_id is not None and (release.status == "RELEASED" or cover_revealed(release, now))
        others = await self.track_teasers(track.id)
        return {
            "id": teaser.id,
            "title": teaser.title,
            "track_id": track.id,
            "track_title": track.title,
            "track_released": track.status == "RELEASED",
            "release_id": release.id,
            "release_title": release.title,
            "release_at": release.release_at,
            "artist": artist,
            "artist_kind": artist_kind,
            "artist_id": artist_id,
            "cover_url": CoverService(self.session, self.settings).signed_path(release.cover_asset_id, 1200) if shown else None,
            "duration_ms": version.duration_ms,
            "published_at": teaser.published_at,
            "next_step": await self._next_step(viewer, track, release),
            "other_teasers": [t for t in others if t["id"] != teaser.id],
        }

    async def track_teasers(self, track_id: UUID) -> list[dict[str, Any]]:
        """Published teasers of a song, newest first (Q-TS-08), for the song page."""
        rows = (
            await self.session.execute(
                select(Teaser, TeaserVersion)
                .join(TeaserVersion, TeaserVersion.id == Teaser.live_version_id)
                .where(
                    Teaser.track_id == track_id,
                    Teaser.deleted_at.is_(None),
                    Teaser.status == rules.PUBLISHED,
                    TeaserVersion.status == rules.V_READY,
                )
                .order_by(Teaser.published_at.desc())
            )
        ).all()
        return [{"id": t.id, "title": t.title, "duration_ms": v.duration_ms} for t, v in rows]

    async def release_teasers(self, release_id: UUID) -> list[dict[str, Any]]:
        """Published teasers of a release's songs, in track order, for the release page (also while
        it is on pre-sale: publishing a teaser names its song, D-TEASER-04). Empty for anything else."""
        release = await self.session.get(Release, release_id)
        if release is None or release.deleted_at is not None or release.status == "TAKEN_DOWN":
            return []
        links = (
            await self.session.execute(
                select(ReleaseTrack).where(ReleaseTrack.release_id == release.id).order_by(ReleaseTrack.position)
            )
        ).scalars().all()
        out: list[dict[str, Any]] = []
        for link in links:
            track = await self.session.get(Track, link.track_id)
            if track is None or track.deleted_at is not None or track.status == "TAKEN_DOWN":
                continue
            for row in await self.track_teasers(track.id):
                out.append({**row, "track_id": track.id, "track_title": track.title})
        return out

    async def teasers_for_tracks(self, track_ids: list[UUID]) -> dict[UUID, UUID]:
        """The newest published teaser per song, for rows of songs (release pages)."""
        if not track_ids:
            return {}
        rows = (
            await self.session.execute(
                select(Teaser.track_id, Teaser.id)
                .join(TeaserVersion, TeaserVersion.id == Teaser.live_version_id)
                .where(
                    Teaser.track_id.in_(track_ids),
                    Teaser.deleted_at.is_(None),
                    Teaser.status == rules.PUBLISHED,
                    TeaserVersion.status == rules.V_READY,
                )
                .order_by(Teaser.published_at.asc())
            )
        ).all()
        return {track_id: teaser_id for track_id, teaser_id in rows}

    async def public_audio(self, teaser_id: UUID, accept: list[str] | None) -> MintedAudio:
        """Anyone may listen (D-TEASER-02): the token names the teaser, its live version and one
        teaser copy; no account, no listening session, no PlaybackEvent."""
        from cornerroom.modules.documents.domain.qc import playback_gain_db

        teaser, version, _track = await self._public_parts(teaser_id)
        minted = self._minted(
            await self._teaser_copies(version.id), accept, {"tz": str(teaser.id), "vid": str(version.id)},
            TEASER_TOKEN_USE, "teasers/media",
        )
        return MintedAudio(
            minted.url, minted.expires_at, minted.codec, minted.alternates, version.duration_ms,
            playback_gain_db(version.integrated_lufs, version.true_peak_dbtp),
        )

    async def open_public_media(self, token: str) -> MediaAsset:
        payload = self._parse(token, TEASER_TOKEN_USE)
        teaser, version, _track = await self._public_parts(UUID(str(payload["tz"])))
        if str(version.id) != str(payload.get("vid")):
            raise AppError("AUDIO_NOT_READY", "This teaser changed: start it again", 409)
        asset_id = UUID(str(payload["aid"]))
        for _r, asset in await self._teaser_copies(version.id):
            if asset.id == asset_id:
                return asset
        raise AppError("AUDIO_NOT_READY", "This audio isn't available", 409)

    # --- counts (Q-TS-14) ----------------------------------------------------------------------

    async def count(self, teaser_id: UUID, kind: str, *, address: str | None, viewer: UUID | None,
                    user_agent: str | None) -> bool:
        """Add one start, completed listen or buy-suggestion press. Never raises for the listener."""
        from cornerroom.modules.commerce.domain import presale_campaign as campaign_rules

        kind = (kind or "").strip().upper()
        if kind not in COUNT_KINDS or campaign_rules.looks_like_bot(user_agent):
            return False
        try:
            teaser, _version, track = await self._public_parts(teaser_id)
        except NotFoundError:
            return False
        if viewer is not None:
            owners = await self.music.catalog_owner_ids(track.primary_artist_id, track.primary_band_id)
            ctx = AuthContext(user_id=viewer, request_id="teaser-count")
            if viewer in owners or await self._is_reviewer(ctx, track):
                return False
        now = self.clock.now()
        if not await self._within_limit(address, teaser.id, now):
            return False
        hour = now.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
        column = {"START": "starts", "COMPLETE": "completes", "PROMPT_CLICK": "prompt_clicks"}[kind]
        stmt = pg_insert(TeaserCount).values(teaser_id=teaser.id, hour=hour, **{column: 1})
        stmt = stmt.on_conflict_do_update(
            index_elements=[TeaserCount.teaser_id, TeaserCount.hour],
            set_={column: getattr(TeaserCount, column) + 1},
        )
        await self.session.execute(stmt)
        return True

    async def _within_limit(self, address: str | None, teaser_id: UUID, now: datetime) -> bool:
        from cornerroom.infra.redis import get_redis, namespaced_key

        cap = self.settings.teaser_count_max_per_hour
        if cap <= 0:
            return True
        secret = (self.settings.jwt_secret or "cornerroom").encode()
        token = hmac.new(secret, (address or "unknown").encode(), hashlib.sha256).hexdigest()[:24]
        key = namespaced_key("teaser", "count", token, str(teaser_id), now.strftime("%Y%m%d%H"), settings=self.settings)
        try:
            client = get_redis()
            seen = await client.incr(key)
            if seen == 1:
                await client.expire(key, 3600)
        except Exception:
            log.warning("teaser_count_limiter_unavailable")
            return False
        return seen <= cap


def _clean_title(title: str | None) -> str | None:
    text = " ".join((title or "").split())[:120]
    return text or None


def _past(action: str) -> str:
    return {"submit": "submitted", "withdraw": "withdrawn", "unpublish": "unpublished", "republish": "republished"}.get(
        action, action
    )

