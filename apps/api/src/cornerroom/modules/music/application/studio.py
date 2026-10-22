"""Artist Studio: self-service and staff-assisted release intake (AUDIO_PHASE_1_DESIGN 3, 5, 9, 10.1).

One catalog-only surface for profile owners (claimed solo artist, band admins) and Corner Room
staff who help them. Every answer is built from catalog fields only: no legal names, account
details, member user ids, payout or contract data ever leave this service (design 3.5). The one
exception is sales money, shown only to the profile's owners and to finance staff of its workspace.

Ownership and org always come from the server: the profile decides the organization, never the
client. Staff who touch a release are recorded as preparers; they cannot submit an artist's
release unless it is in managed mode (D-AUDIO-09), and Phase 6 keeps them from approving it.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, ConflictError, NotFoundError
from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.infra.settings import Settings, get_settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import (
    OFFER_PROPOSED,
    RELEASE_SUBMITTED,
    RELEASE_WITHDRAWN,
    TRACK_CREATED,
    DomainEvent,
)
from cornerroom.modules.artists.domain.models import Artist, Band, BandMember
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.commerce.application.sales import CatalogSales
from cornerroom.modules.documents.application.covers import CoverService, latest_artwork_report
from cornerroom.modules.commerce.domain.models import OfferProposal
from cornerroom.modules.documents.domain.models import MediaAsset
from cornerroom.modules.music.application.languages import LANGUAGES, is_language
from cornerroom.modules.music.application.review import ReviewService
from cornerroom.modules.music.application.service import MusicService
from cornerroom.modules.music.domain.models import (
    Credit,
    CreditRole,
    Genre,
    IntakeRecord,
    Release,
    ReleaseContributor,
    ReleaseTrack,
    Track,
    TrackVersion,
)

EDITABLE_RELEASE_STATUSES = frozenset({"IDEA", "DEMO", "IN_PRODUCTION", "QC"})
EDITABLE_TRACK_STATUSES = frozenset({"DRAFT"})
STUDIO_RELEASE_TYPES = frozenset({"SINGLE", "EP", "ALBUM", "COMPILATION", "LIVE"})
DEFAULT_CURRENCY = "BDT"


def _clean(value: str | None, limit: int) -> str | None:
    if value is None:
        return None
    text = " ".join(value.split())[:limit]
    return text or None


class StudioService:
    def __init__(
        self,
        session: AsyncSession,
        settings: Settings | None = None,
        clock: Clock | None = None,
    ) -> None:
        self.session = session
        self.settings = settings or get_settings()
        self.clock = clock or SystemClock()
        self.music = MusicService(session, clock=self.clock, settings=self.settings)
        self.audit = AuditService(session)

    # --- profiles and access ---------------------------------------------------------------

    async def my_profiles(self, ctx: AuthContext) -> list[dict[str, Any]]:
        """Artists and bands this account may publish for, with whether it can right now (S1)."""
        out: list[dict[str, Any]] = []
        artists = (
            await self.session.execute(
                select(Artist).where(Artist.claimed_user_id == ctx.user_id, Artist.deleted_at.is_(None))
            )
        ).scalars().all()
        for artist in artists:
            out.append(self._profile_card("artist", artist.id, artist.stage_name, artist.status, artist.primary_org_id))
        bands = (
            await self.session.execute(
                select(Band)
                .join(BandMember, BandMember.band_id == Band.id)
                .where(
                    BandMember.user_id == ctx.user_id,
                    BandMember.is_admin.is_(True),
                    BandMember.status == "ACTIVE",
                    BandMember.deleted_at.is_(None),
                    Band.deleted_at.is_(None),
                )
            )
        ).scalars().all()
        for band in bands:
            out.append(self._profile_card("band", band.id, band.name, band.status, band.primary_org_id))
        return out

    @staticmethod
    def _profile_card(kind: str, pid: UUID, name: str, status: str, org: UUID | None) -> dict[str, Any]:
        reason = None
        if status != "ACTIVE":
            reason = "PROFILE_NOT_ACTIVE"
        elif org is None:
            reason = "CATALOG_AFFILIATION_REQUIRED"
        return {"kind": kind, "id": pid, "display_name": name, "status": status, "can_publish": reason is None, "reason": reason}

    async def _profile(self, kind: str, pid: UUID) -> tuple[Artist | Band, UUID | None, str]:
        if kind == "artist":
            artist = await self.session.get(Artist, pid)
            if artist is None or artist.deleted_at is not None:
                raise NotFoundError("Profile not found")
            return artist, artist.primary_org_id, artist.stage_name
        if kind == "band":
            band = await self.session.get(Band, pid)
            if band is None or band.deleted_at is not None:
                raise NotFoundError("Profile not found")
            return band, band.primary_org_id, band.name
        raise AppError("VALIDATION_ERROR", "Profile kind must be artist or band", 422)

    async def _staff_in_org(self, ctx: AuthContext, org_id: UUID | None, resource_id: UUID) -> bool:
        """Catalog staff act only inside their active workspace, which must be the profile's org (A21)."""
        if org_id is None or ctx.organization_id != org_id:
            return False
        for perm in ("music.intake_assist", "music.write"):
            if await self.music._is_allowed(
                ctx.user_id, perm, resource_type="release", resource_id=resource_id, organization_id=org_id
            ):
                return True
        return False

    async def _role_for_profile(self, ctx: AuthContext, kind: str, pid: UUID) -> tuple[str, UUID | None, str, Any]:
        row, org, name = await self._profile(kind, pid)
        owners = await self.music.catalog_owner_ids(
            pid if kind == "artist" else None, pid if kind == "band" else None
        )
        if ctx.user_id in owners:
            return "owner", org, name, row
        if await self._staff_in_org(ctx, org, pid):
            return "staff", org, name, row
        raise NotFoundError("Profile not found")

    async def _role_for_release(self, ctx: AuthContext, release: Release) -> str:
        owners = await self.music.catalog_owner_ids(release.primary_artist_id, release.primary_band_id)
        if ctx.user_id in owners:
            return "owner"
        if await self._staff_in_org(ctx, release.primary_org_id, release.id):
            return "staff"
        raise NotFoundError("Release not found")

    async def _release(self, ctx: AuthContext, release_id: UUID) -> tuple[Release, str]:
        release = await self.music.get_release_row(release_id)
        if release.primary_artist_id is None and release.primary_band_id is None:
            raise NotFoundError("Release not found")
        return release, await self._role_for_release(ctx, release)

    async def _track(self, ctx: AuthContext, track_id: UUID) -> tuple[Track, Release, str]:
        track = await self.music.get_track_row(track_id)
        link = (
            await self.session.execute(select(ReleaseTrack).where(ReleaseTrack.track_id == track.id))
        ).scalars().first()
        if link is None:
            raise NotFoundError("Track not found")
        release, role = await self._release(ctx, link.release_id)
        return track, release, role

    async def _note_staff(self, ctx: AuthContext, release: Release, role: str) -> None:
        """Record staff work on an artist's release: preparer (two-person rule) and intake record."""
        if role != "staff":
            return
        now = self.clock.now()
        row = await self.session.get(ReleaseContributor, (release.id, ctx.user_id, "PREPARER"))
        if row is None:
            self.session.add(ReleaseContributor(release_id=release.id, user_id=ctx.user_id, role="PREPARER", first_at=now, last_at=now))
        else:
            row.last_at = now
        owners = await self.music.catalog_owner_ids(release.primary_artist_id, release.primary_band_id)
        if owners:
            intake = (
                await self.session.execute(select(IntakeRecord).where(IntakeRecord.release_id == release.id))
            ).scalar_one_or_none()
            if intake is None:
                kind, pid = MusicService.profile_of(release)
                self.session.add(
                    IntakeRecord(release_id=release.id, profile_type=kind, profile_id=pid, mode="ASSISTED", opened_by=ctx.user_id, status="OPEN")
                )
                if release.intake_mode == "SELF":
                    release.intake_mode = "ASSISTED"
        await self.session.flush()

    @staticmethod
    def _require_editable(release: Release) -> None:
        if release.status not in EDITABLE_RELEASE_STATUSES:
            raise AppError(
                "INVALID_TRANSITION",
                "This release can't be edited now",
                409,
                "Withdraw it from review first, or wait for the reviewer's changes request",
            )

    async def _event(self, event_type: str, agg: str, agg_id: UUID, payload: dict[str, Any], ctx: AuthContext, org: UUID | None) -> None:
        await enqueue_outbox(
            self.session,
            DomainEvent(
                event_type=event_type,
                producer="music",
                aggregate_type=agg,
                aggregate_id=agg_id,
                payload=payload,
                occurred_at=self.clock.now(),
                actor_id=ctx.user_id,
                organization_id=org,
                correlation_id=ctx.request_id,
            ),
        )

    # --- taxonomy ------------------------------------------------------------------------------

    async def taxonomy(self) -> dict[str, Any]:
        roles = (await self.session.execute(select(CreditRole).order_by(CreditRole.sort))).scalars().all()
        genres = (
            await self.session.execute(select(Genre).where(Genre.status == "ACTIVE").order_by(Genre.sort))
        ).scalars().all()
        return {
            "credit_roles": [
                {"key": r.key, "label_en": r.label_en, "label_bn": r.label_bn, "performer": r.performer, "allows_instrument": r.allows_instrument}
                for r in roles
            ],
            "genres": [{"key": g.key, "label_en": g.label_en, "label_bn": g.label_bn} for g in genres],
            "languages": [{"code": code, "label_en": en, "label_bn": bn} for code, en, bn in LANGUAGES],
            "release_types": ["SINGLE", "EP", "ALBUM", "COMPILATION", "LIVE"],
        }

    # --- releases ------------------------------------------------------------------------------

    async def list_releases(self, ctx: AuthContext, kind: str, pid: UUID) -> list[dict[str, Any]]:
        role, _org, _name, _row = await self._role_for_profile(ctx, kind, pid)
        column = Release.primary_artist_id if kind == "artist" else Release.primary_band_id
        rows = (
            await self.session.execute(
                select(Release).where(column == pid, Release.deleted_at.is_(None)).order_by(Release.updated_at.desc())
            )
        ).scalars().all()
        return [await self._release_card(r) for r in rows]

    def _cover_url(self, release: Release, size: int = 480) -> str | None:
        """A signed link to the release's accepted cover (unreleased covers have no public route)."""
        if release.cover_asset_id is None:
            return None
        return CoverService(self.session, self.settings).signed_path(release.cover_asset_id, size)

    async def _release_card(self, release: Release) -> dict[str, Any]:
        tracks = await self._tracks_of(release.id)
        return {
            "id": release.id,
            "title": release.title,
            "release_type": release.release_type,
            "status": release.status,
            "display_state": await self.display_state(release, tracks),
            "track_count": len(tracks),
            "cover_asset_id": release.cover_asset_id,
            "cover_url": self._cover_url(release),
            "updated_at": release.updated_at,
            "version": release.version,
        }

    async def create_release(self, ctx: AuthContext, *, kind: str, pid: UUID, release_type: str, title: str) -> Release:
        role, org, _name, row = await self._role_for_profile(ctx, kind, pid)
        if release_type not in STUDIO_RELEASE_TYPES:
            raise AppError("VALIDATION_ERROR", "Choose a single, EP, album, compilation or live release", 422)
        name = _clean(title, 300)
        if not name:
            raise AppError("VALIDATION_ERROR", "Title is required", 422)
        if role == "owner" and row.status != "ACTIVE":
            raise AppError("PROFILE_NOT_ACTIVE", "This profile can't publish yet", 409, "Corner Room must activate the profile first")
        if org is None:
            raise AppError(
                "CATALOG_AFFILIATION_REQUIRED",
                "Your profile isn't set up for releases yet",
                409,
                "Ask Corner Room to finish setting up your artist profile",
            )
        await self.music._require_active_org(org)
        release = Release(
            title=name,
            release_type=release_type,
            status="IDEA",
            primary_artist_id=pid if kind == "artist" else None,
            primary_band_id=pid if kind == "band" else None,
            primary_org_id=org,
            track_sales="TRACKS_ALLOWED" if release_type == "SINGLE" else "RELEASE_ONLY",
            created_by=ctx.user_id,
        )
        self.session.add(release)
        await self.session.flush()
        await self._note_staff(ctx, release, role)
        await self.audit.record_from_auth(
            ctx, action="release.created", entity_type="Release", entity_id=release.id,
            new_state={"title": release.title, "release_type": release_type, "profile": f"{kind}:{pid}", "via": "studio", "actor_role": role},
            organization_id=org,
        )
        return release

    async def release_detail(self, ctx: AuthContext, release_id: UUID) -> dict[str, Any]:
        release, role = await self._release(ctx, release_id)
        _kind, _pid = MusicService.profile_of(release)
        tracks = await self._tracks_of(release.id)
        _row, _org, profile_name = await self._profile(_kind, _pid)
        proposals = (
            await self.session.execute(
                select(OfferProposal).where(OfferProposal.release_id == release.id).order_by(OfferProposal.created_at.desc())
            )
        ).scalars().all()
        intake = (
            await self.session.execute(select(IntakeRecord).where(IntakeRecord.release_id == release.id))
        ).scalar_one_or_none()
        return {
            "release": self._release_fields(release),
            "cover_url": self._cover_url(release, 1200),
            "profile": {"kind": _kind, "id": _pid, "display_name": profile_name},
            "viewer_role": role,
            "display_state": await self.display_state(release, tracks),
            "tracks": [await self._track_view(t, pos) for pos, t in tracks],
            "readiness": await self.readiness(release, tracks),
            "proposals": [self._proposal_view(p) for p in proposals],
            "intake": None if intake is None else {"mode": intake.mode, "status": intake.status, "managed_reason": intake.managed_reason, "artist_confirmed_at": intake.artist_confirmed_at},
            "history": await ReviewService(self.session, self.settings, self.clock).history(release.id),
        }

    @staticmethod
    def _release_fields(r: Release) -> dict[str, Any]:
        return {
            "id": r.id, "title": r.title, "release_type": r.release_type, "status": r.status,
            "release_at": r.release_at, "release_timezone": r.release_timezone, "cover_asset_id": r.cover_asset_id,
            "language_code": r.language_code, "genre_primary": r.genre_primary, "genre_secondary": r.genre_secondary,
            "label_name": r.label_name, "p_line": r.p_line, "c_line": r.c_line, "upc": r.upc,
            "track_sales": r.track_sales, "intake_mode": r.intake_mode, "rights_declared_at": r.rights_declared_at,
            "version": r.version,
        }

    async def update_release(self, ctx: AuthContext, release_id: UUID, changes: dict[str, Any], expected_version: int | None) -> Release:
        release, role = await self._release(ctx, release_id)
        self._require_editable(release)
        if expected_version is not None and release.version != expected_version:
            raise ConflictError("Someone else changed this release. Reload to see their changes.")
        previous = self._release_fields(release)
        if "title" in changes:
            title = _clean(changes["title"], 300)
            if not title:
                raise AppError("VALIDATION_ERROR", "Title is required", 422)
            release.title = title
        if "release_type" in changes:
            if changes["release_type"] not in STUDIO_RELEASE_TYPES:
                raise AppError("VALIDATION_ERROR", "Invalid release type", 422)
            release.release_type = changes["release_type"]
        for key in ("genre_primary", "genre_secondary"):
            if key in changes:
                value = changes[key]
                if value is not None and await self.session.get(Genre, value) is None:
                    raise AppError("VALIDATION_ERROR", "Unknown genre", 422)
                setattr(release, key, value)
        if release.genre_secondary and release.genre_secondary == release.genre_primary:
            raise AppError("VALIDATION_ERROR", "The second genre must differ from the main genre", 422)
        if "language_code" in changes:
            if changes["language_code"] is not None and not is_language(changes["language_code"]):
                raise AppError("VALIDATION_ERROR", "Unknown language", 422)
            release.language_code = changes["language_code"]
        for key, limit in (("label_name", 200), ("p_line", 300), ("c_line", 300)):
            if key in changes:
                setattr(release, key, _clean(changes[key], limit))
        if "upc" in changes:
            upc = (changes["upc"] or "").strip() or None
            if upc is not None and (not upc.isdigit() or len(upc) not in (12, 13, 14)):
                raise AppError("VALIDATION_ERROR", "UPC/EAN must be 12 to 14 digits", 422)
            release.upc = upc
        if "release_timezone" in changes:
            from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

            try:
                ZoneInfo(changes["release_timezone"])
            except (ZoneInfoNotFoundError, ValueError) as exc:
                raise AppError("VALIDATION_ERROR", "Unknown time zone", 422) from exc
            release.release_timezone = changes["release_timezone"]
        if "release_at" in changes:
            release.release_at = changes["release_at"]
        if "track_sales" in changes:
            if changes["track_sales"] not in {"RELEASE_ONLY", "TRACKS_ALLOWED"}:
                raise AppError("VALIDATION_ERROR", "Invalid track sales option", 422)
            release.track_sales = changes["track_sales"]
        if release.release_type == "SINGLE":
            release.track_sales = "TRACKS_ALLOWED"
        release.updated_by = ctx.user_id
        try:
            await self.music._flush_versioned()
        except IntegrityError as exc:
            raise ConflictError("That UPC is already used by another release") from exc
        await self._note_staff(ctx, release, role)
        await self.audit.record_from_auth(
            ctx, action="release.details_updated", entity_type="Release", entity_id=release.id,
            previous_state={k: str(v) for k, v in previous.items() if k in changes},
            new_state={k: str(v) for k, v in self._release_fields(release).items() if k in changes},
            organization_id=release.primary_org_id,
        )
        return release

    # --- tracks ------------------------------------------------------------------------------

    async def _tracks_of(self, release_id: UUID) -> list[tuple[int, Track]]:
        rows = (
            await self.session.execute(
                select(ReleaseTrack.position, Track)
                .join(Track, Track.id == ReleaseTrack.track_id)
                .where(ReleaseTrack.release_id == release_id, Track.deleted_at.is_(None))
                .order_by(ReleaseTrack.position)
            )
        ).all()
        return [(pos, track) for pos, track in rows]

    async def _versions(self, track_id: UUID) -> list[TrackVersion]:
        return list(
            (
                await self.session.execute(
                    select(TrackVersion)
                    .where(TrackVersion.track_id == track_id, TrackVersion.deleted_at.is_(None), TrackVersion.status != "SUPERSEDED")
                    .order_by(TrackVersion.created_at.desc())
                )
            ).scalars().all()
        )

    async def _track_view(self, track: Track, position: int) -> dict[str, Any]:
        credits = (
            await self.session.execute(
                select(Credit).where(Credit.track_id == track.id, Credit.deleted_at.is_(None)).order_by(Credit.position, Credit.created_at)
            )
        ).scalars().all()
        artist_names: dict[UUID, str] = {}
        ids = {c.artist_id for c in credits if c.artist_id}
        if ids:
            for a in (await self.session.execute(select(Artist).where(Artist.id.in_(ids)))).scalars():
                artist_names[a.id] = a.stage_name
        return {
            "id": track.id, "position": position, "title": track.title, "version_title": track.version_title,
            "status": track.status, "explicit": track.explicit, "language_code": track.language_code,
            "genre_primary": track.genre_primary, "genre_secondary": track.genre_secondary, "isrc": track.isrc,
            "version": track.version,
            "audio": [
                {"version_id": v.id, "status": v.status, "processing_detail": v.processing_detail, "is_current": v.is_current,
                 "has_audio": v.media_asset_id is not None, "duration_ms": v.duration_ms}
                for v in await self._versions(track.id)
            ],
            "credits": [
                {"id": c.id, "role_key": c.role_key or c.credit_role, "artist_id": c.artist_id,
                 "artist_name": artist_names.get(c.artist_id) if c.artist_id else None,
                 "display_name": c.display_name, "instrument": c.instrument, "position": c.position}
                for c in credits
            ],
        }

    async def add_track(self, ctx: AuthContext, release_id: UUID, title: str) -> Track:
        release, role = await self._release(ctx, release_id)
        self._require_editable(release)
        name = _clean(title, 300)
        if not name:
            raise AppError("VALIDATION_ERROR", "Title is required", 422)
        existing = await self._tracks_of(release.id)
        if release.release_type == "SINGLE" and len(existing) >= 1:
            raise AppError("VALIDATION_ERROR", "A single has one track. Change the release type to add more.", 422)
        track = Track(
            title=name, status="DRAFT", primary_artist_id=release.primary_artist_id, primary_band_id=release.primary_band_id,
            primary_org_id=release.primary_org_id, created_by=ctx.user_id,
        )
        self.session.add(track)
        await self.session.flush()
        self.session.add(ReleaseTrack(release_id=release.id, track_id=track.id, position=len(existing) + 1, created_by=ctx.user_id))
        await self.session.flush()
        await self._note_staff(ctx, release, role)
        await self._event(TRACK_CREATED, "Track", track.id, {"title": track.title, "status": track.status, "release_id": str(release.id)}, ctx, release.primary_org_id)
        await self.audit.record_from_auth(
            ctx, action="track.created", entity_type="Track", entity_id=track.id,
            new_state={"title": track.title, "release_id": str(release.id), "via": "studio", "actor_role": role},
            organization_id=release.primary_org_id,
        )
        return track

    async def reorder_tracks(self, ctx: AuthContext, release_id: UUID, track_ids: list[UUID]) -> list[tuple[int, Track]]:
        release, role = await self._release(ctx, release_id)
        self._require_editable(release)
        links = (await self.session.execute(select(ReleaseTrack).where(ReleaseTrack.release_id == release.id))).scalars().all()
        if sorted(str(link.track_id) for link in links) != sorted(str(t) for t in track_ids) or len(set(track_ids)) != len(track_ids):
            raise AppError("VALIDATION_ERROR", "Send every track of the release exactly once", 422)
        by_id = {link.track_id: link for link in links}
        for link in links:  # step aside first so the unique position check never collides
            link.position += 10_000
        await self.session.flush()
        for pos, tid in enumerate(track_ids, start=1):
            by_id[tid].position = pos
        await self.session.flush()
        await self._note_staff(ctx, release, role)
        await self.audit.record_from_auth(
            ctx, action="release.tracks_reordered", entity_type="Release", entity_id=release.id,
            new_state={"order": [str(t) for t in track_ids]}, organization_id=release.primary_org_id,
        )
        return await self._tracks_of(release.id)

    async def remove_track(self, ctx: AuthContext, release_id: UUID, track_id: UUID) -> None:
        release, role = await self._release(ctx, release_id)
        self._require_editable(release)
        link = await self.session.get(ReleaseTrack, (release.id, track_id))
        if link is None:
            raise NotFoundError("Track not found")
        await self.session.delete(link)
        await self.session.flush()
        remaining = (
            await self.session.execute(select(ReleaseTrack).where(ReleaseTrack.release_id == release.id).order_by(ReleaseTrack.position))
        ).scalars().all()
        for link_row in remaining:
            link_row.position += 10_000
        await self.session.flush()
        for pos, link_row in enumerate(remaining, start=1):
            link_row.position = pos
        track = await self.music.get_track_row(track_id)
        other = (await self.session.execute(select(ReleaseTrack).where(ReleaseTrack.track_id == track_id))).scalars().first()
        if other is None and track.status == "DRAFT":
            track.deleted_at = self.clock.now()
        await self.session.flush()
        await self._note_staff(ctx, release, role)
        await self.audit.record_from_auth(
            ctx, action="release.track_removed", entity_type="Release", entity_id=release.id,
            new_state={"track_id": str(track_id)}, organization_id=release.primary_org_id,
        )

    async def update_track(self, ctx: AuthContext, track_id: UUID, changes: dict[str, Any], expected_version: int | None) -> Track:
        track, release, role = await self._track(ctx, track_id)
        self._require_editable(release)
        if track.status not in EDITABLE_TRACK_STATUSES:
            raise AppError("INVALID_TRANSITION", "This track can't be edited now", 409)
        if expected_version is not None and track.version != expected_version:
            raise ConflictError("Someone else changed this track. Reload to see their changes.")
        if "title" in changes:
            title = _clean(changes["title"], 300)
            if not title:
                raise AppError("VALIDATION_ERROR", "Title is required", 422)
            track.title = title
        if "version_title" in changes:
            track.version_title = _clean(changes["version_title"], 100)
        if "explicit" in changes:
            track.explicit = bool(changes["explicit"])
        if "language_code" in changes:
            if changes["language_code"] is not None and not is_language(changes["language_code"]):
                raise AppError("VALIDATION_ERROR", "Unknown language", 422)
            track.language_code = changes["language_code"]
        for key in ("genre_primary", "genre_secondary"):
            if key in changes:
                value = changes[key]
                if value is not None and await self.session.get(Genre, value) is None:
                    raise AppError("VALIDATION_ERROR", "Unknown genre", 422)
                setattr(track, key, value)
        if "isrc" in changes:
            code = (changes["isrc"] or "").replace("-", "").strip().upper() or None
            if code is not None and (len(code) != 12 or not code[:2].isalpha() or not code[2:5].isalnum() or not code[5:].isdigit()):
                raise AppError("VALIDATION_ERROR", "ISRC looks like CC-XXX-YY-NNNNN (12 characters)", 422)
            track.isrc = code
        track.updated_by = ctx.user_id
        try:
            await self.music._flush_versioned()
        except IntegrityError as exc:
            raise ConflictError("That ISRC is already used by another track") from exc
        await self._note_staff(ctx, release, role)
        await self.audit.record_from_auth(
            ctx, action="track.details_updated", entity_type="Track", entity_id=track.id,
            new_state={k: str(v) for k, v in changes.items()}, organization_id=release.primary_org_id,
        )
        return track

    async def set_credits(self, ctx: AuthContext, track_id: UUID, credits: list[dict[str, Any]]) -> list[Credit]:
        """Replace a track's credits (D-AUDIO-16): performer roles link to an artist profile;
        other roles may be a typed name. Credits are attribution only and pay nothing."""
        track, release, role = await self._track(ctx, track_id)
        self._require_editable(release)
        roles = {r.key: r for r in (await self.session.execute(select(CreditRole))).scalars()}
        if len(credits) > 50:
            raise AppError("VALIDATION_ERROR", "At most 50 credits per track", 422)
        prepared: list[Credit] = []
        for index, item in enumerate(credits):
            spec = roles.get(item.get("role_key") or "")
            if spec is None:
                raise AppError("VALIDATION_ERROR", "Unknown credit role", 422, extras={"index": index})
            artist_id = item.get("artist_id")
            name = _clean(item.get("display_name"), 200)
            if artist_id is not None:
                artist = await self.session.get(Artist, artist_id)
                if artist is None or artist.deleted_at is not None:
                    raise AppError("VALIDATION_ERROR", "Artist not found", 422, extras={"index": index})
                name = None
            elif spec.performer:
                raise AppError(
                    "VALIDATION_ERROR",
                    f"{spec.label_en} must be an artist on Corner Room",
                    422,
                    extras={"index": index},
                )
            elif not name:
                raise AppError("VALIDATION_ERROR", "Enter the person's name", 422, extras={"index": index})
            instrument = _clean(item.get("instrument"), 80) if spec.allows_instrument else None
            prepared.append(
                Credit(track_id=track.id, artist_id=artist_id, display_name=name, credit_role=spec.key, role_key=spec.key,
                       instrument=instrument, position=index, created_by=ctx.user_id)
            )
        now = self.clock.now()
        existing = (await self.session.execute(select(Credit).where(Credit.track_id == track.id, Credit.deleted_at.is_(None)))).scalars().all()
        for old in existing:
            old.deleted_at = now
        for row in prepared:
            self.session.add(row)
        await self.session.flush()
        await self._note_staff(ctx, release, role)
        await self.audit.record_from_auth(
            ctx, action="track.credits_set", entity_type="Track", entity_id=track.id,
            new_state={"credits": [f"{c.role_key}:{c.artist_id or c.display_name}" for c in prepared]},
            organization_id=release.primary_org_id,
        )
        return prepared

    async def new_version(self, ctx: AuthContext, track_id: UUID) -> TrackVersion:
        track, release, role = await self._track(ctx, track_id)
        if track.status not in {"DRAFT", "RELEASED", "APPROVED", "SCHEDULED"}:
            raise AppError("INVALID_TRANSITION", "This track can't take new audio now", 409)
        version = await self.music.create_version(ctx, track.id, version_type="MASTER")
        await self._note_staff(ctx, release, role)
        return version

    # --- readiness, state, submit -----------------------------------------------------------------

    async def readiness(self, release: Release, tracks: list[tuple[int, Track]] | None = None) -> dict[str, Any]:
        tracks = tracks if tracks is not None else await self._tracks_of(release.id)
        items: list[dict[str, Any]] = []

        def item(code: str, ok: bool, track_id: UUID | None = None) -> None:
            items.append({"code": code, "ok": ok, "track_id": track_id})

        item("TITLE", bool(release.title))
        item("LANGUAGE", bool(release.language_code))
        item("GENRE", bool(release.genre_primary))
        item("P_LINE", bool(release.p_line))
        item("C_LINE", bool(release.c_line))
        cover_ok = False
        if release.cover_asset_id:
            cover = await self.session.get(MediaAsset, release.cover_asset_id)
            cover_ok = cover is not None and cover.status in {"ACCEPTED", "READY"}
        item("COVER", cover_ok)
        item("TRACKS", len(tracks) > 0)
        item("TRACK_ORDER", [p for p, _ in tracks] == list(range(1, len(tracks) + 1)))
        proposals = (
            await self.session.execute(
                select(OfferProposal).where(OfferProposal.release_id == release.id, OfferProposal.status.in_(("PROPOSED", "ACCEPTED")))
            )
        ).scalars().all()
        item("PRICE", any(p.subject_type == "RELEASE" for p in proposals))
        sells_tracks = release.track_sales == "TRACKS_ALLOWED" and release.release_type != "SINGLE"
        for _pos, track in tracks:
            versions = await self._versions(track.id)
            ready = any(v.status == "READY" and v.is_current for v in versions)
            in_progress = any(v.status in {"UPLOADING", "PROCESSING"} for v in versions)
            item("TRACK_TITLE", bool(track.title), track.id)
            item("TRACK_AUDIO", ready and not in_progress, track.id)
            if sells_tracks:
                item("TRACK_PRICE", any(p.subject_type == "TRACK" and p.subject_id == track.id for p in proposals), track.id)
        return {"ready": all(i["ok"] for i in items), "items": items}

    async def display_state(self, release: Release, tracks: list[tuple[int, Track]]) -> str:
        """Artist-facing words for authoritative states (design 5.6)."""
        mapping = {"METADATA_REVIEW": "IN_REVIEW", "APPROVED": "APPROVED", "SCHEDULED": "SCHEDULED", "RELEASED": "RELEASED", "TAKEN_DOWN": "TAKEN_DOWN", "ARCHIVED": "ARCHIVED"}
        if release.status in mapping:
            return mapping[release.status]
        statuses = []
        for _pos, track in tracks:
            statuses += [v.status for v in await self._versions(track.id)]
        if "REJECTED" in statuses or any(t.status == "REJECTED" for _, t in tracks):
            return "NEEDS_ATTENTION"
        if any(s == "UPLOADING" for s in statuses):
            return "UPLOADING"
        if any(s == "PROCESSING" for s in statuses):
            return "CHECKING_AUDIO"
        return "DRAFT"

    async def submit(self, ctx: AuthContext, release_id: UUID, *, rights_declaration: bool) -> Release:
        release, role = await self._release(ctx, release_id)
        owners = await self.music.catalog_owner_ids(release.primary_artist_id, release.primary_band_id)
        if role == "staff" and owners and release.intake_mode != "MANAGED":
            raise AppError(
                "INTAKE_NOT_MANAGED",
                "The artist confirms and submits this release",
                403,
                "Staff prepare; the artist reviews and submits (D-AUDIO-09)",
            )
        if not rights_declaration:
            raise AppError("RIGHTS_DECLARATION_REQUIRED", "Confirm you hold the rights to release this music", 422)
        if release.status not in {"IDEA", "DEMO", "IN_PRODUCTION"}:
            raise AppError("INVALID_TRANSITION", "This release can't be submitted now", 409)
        tracks = await self._tracks_of(release.id)
        check = await self.readiness(release, tracks)
        if not check["ready"]:
            missing = [{"code": i["code"], "track_id": str(i["track_id"]) if i["track_id"] else None} for i in check["items"] if not i["ok"]]
            raise AppError("RELEASE_NOT_READY", "Some details are missing", 409, extras={"items": missing})
        now = self.clock.now()
        previous = release.status
        release.status = "METADATA_REVIEW"
        release.rights_declared_by = ctx.user_id
        release.rights_declared_at = now
        release.updated_by = ctx.user_id
        for _pos, track in tracks:
            if track.status == "DRAFT":
                track.status = "SUBMITTED"
                track.updated_by = ctx.user_id
        await self.music._flush_versioned()
        intake = (await self.session.execute(select(IntakeRecord).where(IntakeRecord.release_id == release.id))).scalar_one_or_none()
        if intake is not None and role == "owner":
            intake.artist_confirmed_by = ctx.user_id
            intake.artist_confirmed_at = now
            intake.status = "CONFIRMED"
            await self.session.flush()
        await self._event(RELEASE_SUBMITTED, "Release", release.id, {"release_id": str(release.id), "track_count": len(tracks), "actor_role": role}, ctx, release.primary_org_id)
        await self.audit.record_from_auth(
            ctx, action="release.submitted", entity_type="Release", entity_id=release.id,
            previous_state={"status": previous}, new_state={"status": release.status, "rights_declared": True, "actor_role": role},
            organization_id=release.primary_org_id,
        )
        return release

    async def withdraw(self, ctx: AuthContext, release_id: UUID) -> Release:
        release, role = await self._release(ctx, release_id)
        owners = await self.music.catalog_owner_ids(release.primary_artist_id, release.primary_band_id)
        if role == "staff" and owners and release.intake_mode != "MANAGED":
            raise AppError("INTAKE_NOT_MANAGED", "Only the artist can withdraw this release", 403)
        if release.status != "METADATA_REVIEW":
            raise AppError("INVALID_TRANSITION", "Only a release in review can be withdrawn", 409)
        tracks = await self._tracks_of(release.id)
        if any(t.status not in {"SUBMITTED", "DRAFT"} for _, t in tracks):
            raise AppError("INVALID_TRANSITION", "Review has started; ask the reviewer to send it back instead", 409)
        release.status = "IN_PRODUCTION"
        release.updated_by = ctx.user_id
        for _pos, track in tracks:
            if track.status == "SUBMITTED":
                track.status = "DRAFT"
        await self.music._flush_versioned()
        await self._event(RELEASE_WITHDRAWN, "Release", release.id, {"release_id": str(release.id)}, ctx, release.primary_org_id)
        await self.audit.record_from_auth(
            ctx, action="release.withdrawn", entity_type="Release", entity_id=release.id,
            previous_state={"status": "METADATA_REVIEW"}, new_state={"status": "IN_PRODUCTION"},
            organization_id=release.primary_org_id,
        )
        return release

    # --- prices -----------------------------------------------------------------------------------

    @staticmethod
    def _proposal_view(p: OfferProposal) -> dict[str, Any]:
        return {
            "id": p.id, "subject_type": p.subject_type, "subject_id": p.subject_id, "audience": p.audience,
            "amount_minor": p.amount_minor, "currency_code": p.currency_code, "note": p.note, "status": p.status,
            "decision_note": p.decision_note, "created_at": p.created_at,
        }

    async def propose_price(
        self, ctx: AuthContext, release_id: UUID, *, subject_type: str, subject_id: UUID, audience: str,
        amount_minor: int, currency_code: str, note: str | None,
    ) -> OfferProposal:
        release, role = await self._release(ctx, release_id)
        if subject_type == "RELEASE":
            if subject_id != release.id:
                raise AppError("VALIDATION_ERROR", "That release isn't this one", 422)
        elif subject_type == "TRACK":
            link = await self.session.get(ReleaseTrack, (release.id, subject_id))
            if link is None:
                raise AppError("VALIDATION_ERROR", "That track isn't on this release", 422)
        else:
            raise AppError("VALIDATION_ERROR", "Price a track or the release", 422)
        if audience not in {"EVERYONE", "OWNS_PART_OF_RELEASE"} or (
            audience != "EVERYONE" and (subject_type != "RELEASE" or release.release_type == "SINGLE")
        ):
            raise AppError("VALIDATION_ERROR", "Invalid audience", 422)
        currency = (currency_code or DEFAULT_CURRENCY).upper()
        if len(currency) != 3 or not currency.isalpha():
            raise AppError("VALIDATION_ERROR", "Currency must be a 3-letter code", 422)
        if amount_minor < 0:
            raise AppError("VALIDATION_ERROR", "Price can't be negative", 422)
        old = (
            await self.session.execute(
                select(OfferProposal).where(
                    OfferProposal.subject_type == subject_type, OfferProposal.subject_id == subject_id,
                    OfferProposal.audience == audience, OfferProposal.status == "PROPOSED",
                )
            )
        ).scalars().all()
        for row in old:
            row.status = "WITHDRAWN"
        proposal = OfferProposal(
            release_id=release.id, subject_type=subject_type, subject_id=subject_id, audience=audience,
            amount_minor=amount_minor, currency_code=currency, note=_clean(note, 500), proposed_by=ctx.user_id, status="PROPOSED",
        )
        self.session.add(proposal)
        await self.session.flush()
        await self._note_staff(ctx, release, role)
        await self._event(OFFER_PROPOSED, "Release", release.id, {"proposal_id": str(proposal.id), "subject_type": subject_type}, ctx, release.primary_org_id)
        await self.audit.record_from_auth(
            ctx, action="price.proposed", entity_type="OfferProposal", entity_id=proposal.id,
            new_state={"subject": f"{subject_type}:{subject_id}", "audience": audience, "amount_minor": amount_minor, "currency_code": currency},
            organization_id=release.primary_org_id,
        )
        return proposal

    # --- cover checks -----------------------------------------------------------------------------

    async def cover_report(self, ctx: AuthContext, release_id: UUID) -> dict[str, Any] | None:
        """What the checks found for the latest cover uploaded to this release (2026-10-22: rejected
        covers used to say only "Checking your artwork next"). None until a cover upload finished."""
        release, _role = await self._release(ctx, release_id)
        return await latest_artwork_report(
            self.session, target_type="release_cover", target_id=release.id, current_asset_id=release.cover_asset_id
        )

    # --- sales (HANDOFF 0.2 step 2) -------------------------------------------------------------------

    async def _sales_scope(self, ctx: AuthContext, kind: str, pid: UUID) -> tuple[str, dict[UUID, Track], dict[UUID, Release]]:
        """The profile's songs and releases, for its owners or finance staff of its workspace.

        Catalog staff alone may not see money (design 3.5), so staff need finance.read in the
        profile's organization on top of the active workspace check. Anyone else gets 404.
        """
        _row, org, name = await self._profile(kind, pid)
        owners = await self.music.catalog_owner_ids(pid if kind == "artist" else None, pid if kind == "band" else None)
        if ctx.user_id not in owners:
            in_workspace = org is not None and ctx.organization_id == org
            if not in_workspace or not await self.music._is_allowed(
                ctx.user_id, "finance.read", resource_type="organization", resource_id=org, organization_id=org
            ):
                raise NotFoundError("Profile not found")
        track_col = Track.primary_artist_id if kind == "artist" else Track.primary_band_id
        release_col = Release.primary_artist_id if kind == "artist" else Release.primary_band_id
        # Deleted songs and releases stay in: what sold before still counts.
        tracks = (await self.session.execute(select(Track).where(track_col == pid))).scalars().all()
        releases = (await self.session.execute(select(Release).where(release_col == pid))).scalars().all()
        return name, {t.id: t for t in tracks}, {r.id: r for r in releases}

    @staticmethod
    def _sale_subject(subject_type: str, subject_id: UUID, tracks: dict[UUID, Track], releases: dict[UUID, Release]) -> dict[str, Any]:
        if subject_type == "RELEASE":
            release = releases[subject_id]
            return {"title": release.title, "release_type": release.release_type}
        return {"title": tracks[subject_id].title, "release_type": None}

    async def sales(self, ctx: AuthContext, kind: str, pid: UUID) -> dict[str, Any]:
        """Totals per currency and per song or release. Money is what fans paid, before any share."""
        name, tracks, releases = await self._sales_scope(ctx, kind, pid)
        rows = await CatalogSales(self.session).by_subject(tracks.keys(), releases.keys())
        totals: dict[str, dict[str, Any]] = {}
        for r in rows:
            r.update(self._sale_subject(r["subject_type"], r["subject_id"], tracks, releases))
            t = totals.setdefault(
                r["currency_code"],
                {"currency_code": r["currency_code"], "sold_count": 0, "refunded_count": 0,
                 "gross_amount_minor": 0, "refunded_amount_minor": 0, "net_amount_minor": 0},
            )
            for key in ("sold_count", "refunded_count", "gross_amount_minor", "refunded_amount_minor", "net_amount_minor"):
                t[key] += r[key]
        rows.sort(key=lambda r: (-r["net_amount_minor"], r["title"].lower()))
        return {
            "profile": {"kind": kind, "id": pid, "display_name": name},
            "totals": sorted(totals.values(), key=lambda t: t["currency_code"]),
            "items": rows,
        }

    async def sales_lines(
        self, ctx: AuthContext, kind: str, pid: UUID, *, cursor: str | None, limit: int | None
    ) -> dict[str, Any]:
        _name, tracks, releases = await self._sales_scope(ctx, kind, pid)
        lines, next_cursor = await CatalogSales(self.session).lines(tracks.keys(), releases.keys(), cursor=cursor, limit=limit)
        for line in lines:
            line.update(self._sale_subject(line["subject_type"], line["subject_id"], tracks, releases))
        return {"items": lines, "next_cursor": next_cursor}

    # --- staff intake (design 3.5, 10.3; D-AUDIO-09) ------------------------------------------------

    async def _require_staff_workspace(self, ctx: AuthContext, permission: str = "music.intake_assist") -> UUID:
        org = ctx.organization_id
        if org is None:
            raise AppError("WORKSPACE_REQUIRED", "Choose a workspace first", 409)
        perms = (permission,) if permission != "music.intake_assist" else ("music.intake_assist", "music.write", "music.approve")
        for perm in perms:
            if await self.music._is_allowed(ctx.user_id, perm, resource_type="release", resource_id=org, organization_id=org):
                return org
        raise AppError("FORBIDDEN", "Forbidden", 403, f"Missing permission {permission}")

    async def staff_profiles(self, ctx: AuthContext, query: str | None) -> list[dict[str, Any]]:
        """Catalog profile cards in the staff member's workspace. Stage or band name only (3.5)."""
        org = await self._require_staff_workspace(ctx)
        text = (query or "").strip()
        artists_stmt = select(Artist).where(Artist.primary_org_id == org, Artist.deleted_at.is_(None))
        bands_stmt = select(Band).where(Band.primary_org_id == org, Band.deleted_at.is_(None))
        if text:
            artists_stmt = artists_stmt.where(Artist.stage_name.ilike(f"%{text}%"))
            bands_stmt = bands_stmt.where(Band.name.ilike(f"%{text}%"))
        out: list[dict[str, Any]] = []
        for artist in (await self.session.execute(artists_stmt.order_by(Artist.stage_name).limit(50))).scalars():
            owners = await self.music.catalog_owner_ids(artist.id, None)
            out.append({"kind": "artist", "id": artist.id, "display_name": artist.stage_name, "status": artist.status, "has_owner": bool(owners)})
        for band in (await self.session.execute(bands_stmt.order_by(Band.name).limit(50))).scalars():
            owners = await self.music.catalog_owner_ids(None, band.id)
            out.append({"kind": "band", "id": band.id, "display_name": band.name, "status": band.status, "has_owner": bool(owners)})
        return out

    async def intake_queue(self, ctx: AuthContext, *, in_review: bool = False) -> list[dict[str, Any]]:
        """Releases in the workspace made through Studio (a primary profile set), newest first."""
        org = await self._require_staff_workspace(ctx)
        stmt = select(Release).where(
            Release.primary_org_id == org,
            Release.deleted_at.is_(None),
            (Release.primary_artist_id.is_not(None)) | (Release.primary_band_id.is_not(None)),
        )
        if in_review:
            stmt = stmt.where(Release.status == "METADATA_REVIEW")
        rows = (await self.session.execute(stmt.order_by(Release.updated_at.desc()).limit(200))).scalars().all()
        out = []
        for release in rows:
            kind, pid = MusicService.profile_of(release)
            _row, _org, name = await self._profile(kind, pid)
            preparers = (
                await self.session.execute(select(func.count()).select_from(ReleaseContributor).where(ReleaseContributor.release_id == release.id))
            ).scalar_one()
            card = await self._release_card(release)
            out.append({**card, "profile_name": name, "intake_mode": release.intake_mode, "preparer_count": preparers})
        return out

    async def set_managed(self, ctx: AuthContext, release_id: UUID, *, enabled: bool, reason: str | None) -> IntakeRecord:
        """Turn managed mode (D) on or off for one release: very special cases only, with a reason."""
        release = await self.music.get_release_row(release_id)
        org = await self._require_staff_workspace(ctx, "music.intake_manage")
        if release.primary_org_id != org or (release.primary_artist_id is None and release.primary_band_id is None):
            raise NotFoundError("Release not found")
        text = (reason or "").strip()
        if enabled and len(text) < 20:
            raise AppError("VALIDATION_ERROR", "Explain why Corner Room manages this release (at least 20 characters)", 422)
        intake = (await self.session.execute(select(IntakeRecord).where(IntakeRecord.release_id == release.id))).scalar_one_or_none()
        if intake is None:
            kind, pid = MusicService.profile_of(release)
            intake = IntakeRecord(release_id=release.id, profile_type=kind, profile_id=pid, mode="ASSISTED", opened_by=ctx.user_id, status="OPEN")
            self.session.add(intake)
        previous = intake.mode
        now = self.clock.now()
        if enabled:
            intake.mode = "MANAGED"
            intake.managed_enabled_by = ctx.user_id
            intake.managed_reason = text
            intake.managed_enabled_at = now
            release.intake_mode = "MANAGED"
        else:
            intake.mode = "ASSISTED"
            release.intake_mode = "ASSISTED"
        await self.music._flush_versioned()
        from cornerroom.kernel.events import INTAKE_MANAGED_MODE_CHANGED

        await self._event(INTAKE_MANAGED_MODE_CHANGED, "Release", release.id, {"release_id": str(release.id), "mode": intake.mode}, ctx, org)
        await self.audit.record_from_auth(
            ctx, action="intake.managed_mode_changed", entity_type="Release", entity_id=release.id,
            previous_state={"mode": previous}, new_state={"mode": intake.mode, "reason": text if enabled else None},
            organization_id=org,
        )
        return intake

    async def count_open_drafts(self, kind: str, pid: UUID) -> int:
        column = Release.primary_artist_id if kind == "artist" else Release.primary_band_id
        return (
            await self.session.execute(
                select(func.count()).select_from(Release).where(column == pid, Release.status.in_(tuple(EDITABLE_RELEASE_STATUSES)), Release.deleted_at.is_(None))
            )
        ).scalar_one()
