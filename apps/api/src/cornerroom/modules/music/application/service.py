"""Music catalog application service. Controllers stay thin. No streaming or royalties."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Select, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.exc import StaleDataError

from cornerroom.infra.errors import AppError, ConflictError, ForbiddenError, NotFoundError
from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.infra.settings import Settings, get_settings
from cornerroom.infra.storage import assert_storage_class_allowed
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import (
    METADATA_CORRECTED,
    RELEASE_RELEASED,
    RELEASE_STAGE_CHANGED,
    TRACK_APPROVED,
    TRACK_CREATED,
    TRACK_RELEASED,
    TRACK_TAKEN_DOWN,
    TRACK_UPLOADED,
    TRACK_VERSION_READY,
    TRACK_VERSION_REJECTED,
    DomainEvent,
)
from cornerroom.kernel.pagination import clamp_limit, encode_cursor, keyset_before
from cornerroom.modules.artists.domain.models import Artist, Band, BandMember
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.authorization.application.service import AuthorizationService
from cornerroom.modules.documents.domain.models import MediaAsset
from cornerroom.modules.identity.domain.models import Organization, User
from cornerroom.modules.music.domain.lifecycle import (
    PUBLIC_RELEASE_STATUSES,
    PUBLIC_TRACK_STATUSES,
    RELEASE_TYPES,
    VERSION_TYPES,
    permission_for_release_action,
    permission_for_track_action,
    release_action_target,
    track_action_target,
    version_target_for_action,
    version_transition_action,
)
from cornerroom.modules.music.domain.models import Credit, Release, ReleaseTrack, Track, TrackVersion

FLEXIBLE_META_KEYS = frozenset({"genres", "liner_notes"})
SYSTEM_VERSION_ACTIONS = frozenset({"start_processing", "mark_ready", "reject"})


class MusicService:
    def __init__(
        self,
        session: AsyncSession,
        clock: Clock | None = None,
        settings: Settings | None = None,
    ) -> None:
        self.session = session
        self.clock = clock or SystemClock()
        self.settings = settings or get_settings()
        self.audit = AuditService(session)
        self.authz = AuthorizationService(session, clock=self.clock)

    async def list_ids_for_projection_tracks(self) -> list[UUID]:
        stmt = select(Track.id).where(Track.deleted_at.is_(None))
        return list((await self.session.execute(stmt)).scalars().all())

    async def list_ids_for_projection_releases(self) -> list[UUID]:
        stmt = select(Release.id).where(Release.deleted_at.is_(None))
        return list((await self.session.execute(stmt)).scalars().all())

    async def _org(self, org_id: UUID) -> Organization:
        org = await self.session.get(Organization, org_id)
        if org is None or org.deleted_at is not None:
            raise NotFoundError("Organization not found")
        return org

    async def _require_active_org(self, org_id: UUID) -> Organization:
        org = await self._org(org_id)
        if org.status != "ACTIVE":
            raise AppError(
                "ORG_NOT_ACTIVE",
                "Organization is not active",
                409,
                "Suspended or archived organizations cannot mutate catalog resources",
            )
        return org

    def _workspace_org_id(self, ctx: AuthContext, claimed: UUID | None) -> UUID:
        if claimed is not None and ctx.organization_id is not None and claimed != ctx.organization_id:
            raise AppError(
                "ORG_SCOPE_MISMATCH",
                "organization_id does not match the active workspace",
                403,
                "Client organization_id cannot override the workspace",
            )
        org_id = ctx.organization_id
        if org_id is None:
            raise AppError(
                "WORKSPACE_REQUIRED",
                "Active organization workspace is required",
                409,
                "Switch to an organization before mutating catalog resources",
            )
        return org_id

    async def _is_allowed(
        self,
        user_id: UUID,
        permission: str,
        *,
        resource_type: str,
        resource_id: UUID,
        organization_id: UUID | None,
        owner_user_id: UUID | None = None,
    ) -> bool:
        try:
            await self.authz.authorize(
                user_id,
                permission,
                resource_type=resource_type,
                resource_id=resource_id,
                owner_user_id=owner_user_id,
                scope_organization_id=organization_id,
            )
            return True
        except ForbiddenError:
            return False

    async def catalog_owner_ids(
        self, primary_artist_id: UUID | None, primary_band_id: UUID | None
    ) -> set[UUID]:
        """Who may self-publish this profile's music (D-AUDIO-05, design S1).

        Solo artist: the claimed user, artist ACTIVE. Band: ACTIVE band admins with an account,
        band ACTIVE. Anything else owns nothing (fail closed).
        """
        if primary_artist_id is not None:
            artist = await self.session.get(Artist, primary_artist_id)
            if (
                artist is None
                or artist.deleted_at is not None
                or artist.status != "ACTIVE"
                or artist.claimed_user_id is None
            ):
                return set()
            return {artist.claimed_user_id}
        if primary_band_id is not None:
            band = await self.session.get(Band, primary_band_id)
            if band is None or band.deleted_at is not None or band.status != "ACTIVE":
                return set()
            rows = await self.session.execute(
                select(BandMember.user_id).where(
                    BandMember.band_id == band.id,
                    BandMember.status == "ACTIVE",
                    BandMember.is_admin.is_(True),
                    BandMember.user_id.is_not(None),
                    BandMember.deleted_at.is_(None),
                )
            )
            return {user_id for user_id in rows.scalars().all() if user_id is not None}
        return set()

    async def _owner_user_id(
        self,
        primary_artist_id: UUID | None,
        primary_band_id: UUID | None,
        user_id: UUID | None = None,
    ) -> UUID | None:
        """The owner id to hand the kernel: the caller when they are an owner, else None."""
        owners = await self.catalog_owner_ids(primary_artist_id, primary_band_id)
        if user_id is not None:
            return user_id if user_id in owners else None
        return next(iter(owners)) if len(owners) == 1 else None

    async def _assert_track_perm(
        self,
        ctx: AuthContext,
        track: Track,
        permission: str,
    ) -> None:
        owner = await self._owner_user_id(track.primary_artist_id, track.primary_band_id, ctx.user_id)
        allowed = await self._is_allowed(
            ctx.user_id,
            permission,
            resource_type="track",
            resource_id=track.id,
            organization_id=track.primary_org_id,
            owner_user_id=owner if permission == "music.write" else None,
        )
        if not allowed:
            raise NotFoundError("Track not found")

    async def _assert_release_perm(
        self,
        ctx: AuthContext,
        release: Release,
        permission: str,
    ) -> None:
        owner = await self._owner_user_id(release.primary_artist_id, release.primary_band_id, ctx.user_id)
        allowed = await self._is_allowed(
            ctx.user_id,
            permission,
            resource_type="release",
            resource_id=release.id,
            organization_id=release.primary_org_id,
            owner_user_id=owner if permission == "music.write" else None,
        )
        if not allowed:
            raise NotFoundError("Release not found")

    async def _can_staff_write_workspace(self, ctx: AuthContext, org_id: UUID) -> bool:
        return await self._is_allowed(
            ctx.user_id,
            "music.write",
            resource_type="track",
            resource_id=org_id,
            organization_id=org_id,
        )

    async def _flush_versioned(self) -> None:
        try:
            await self.session.flush()
        except StaleDataError as exc:
            raise ConflictError("The resource was updated concurrently") from exc
        except IntegrityError as exc:
            raise ConflictError("Conflicting catalog state") from exc

    def _meta(self, extra_metadata: dict[str, Any] | None) -> dict[str, Any] | None:
        if extra_metadata is None:
            return None
        cleaned = {k: v for k, v in extra_metadata.items() if k in FLEXIBLE_META_KEYS}
        return cleaned or None

    async def _cover(self, asset_id: UUID | None) -> UUID | None:
        if asset_id is None:
            return None
        asset = await self.session.get(MediaAsset, asset_id)
        if asset is None or asset.deleted_at is not None:
            raise AppError("VALIDATION_ERROR", "Artwork media was not found", 422)
        if asset.storage_class in {"catalog_audio", "legal_document"}:
            raise AppError(
                "RESIDENCY_GATE",
                "Audio and identity documents are not allowed as catalog artwork",
                403,
            )
        if asset.storage_class != "public_media":
            raise AppError("VALIDATION_ERROR", "Artwork must use public_media", 422)
        if asset.status != "READY":
            raise AppError("VALIDATION_ERROR", "Artwork upload is not ready", 422)
        return asset.id

    async def _audio_asset(self, asset_id: UUID | None, ctx: AuthContext) -> UUID | None:
        if asset_id is None:
            return None
        asset = await self.session.get(MediaAsset, asset_id)
        if asset is None or asset.deleted_at is not None:
            raise AppError("VALIDATION_ERROR", "Audio media was not found", 422)
        # Only audio the caller uploaded (fix F1). Same answer as "not found": no existence hint.
        if ctx.user_id not in {asset.created_by, asset.uploaded_by}:
            raise AppError("VALIDATION_ERROR", "Audio media was not found", 422)
        if asset.purpose == "AUDIO_MASTER":
            raise AppError(
                "VALIDATION_ERROR",
                "Masters attach through an upload",
                422,
                "Upload the master to the track version instead of attaching an asset id",
            )
        if asset.storage_class == "legal_document":
            raise AppError("RESIDENCY_GATE", "Identity documents are not catalog audio", 403)
        if asset.storage_class != "catalog_audio":
            raise AppError("VALIDATION_ERROR", "Audio master must use catalog_audio", 422)
        assert_storage_class_allowed("catalog_audio", self.settings)
        if asset.status != "READY":
            raise AppError("VALIDATION_ERROR", "Audio upload is not ready", 422)
        return asset.id

    async def _emit(
        self,
        *,
        event_type: str,
        aggregate_type: str,
        aggregate_id: UUID,
        payload: dict[str, Any],
        ctx: AuthContext,
        organization_id: UUID | None,
    ) -> None:
        event = DomainEvent(
            event_type=event_type,
            producer="music",
            aggregate_type=aggregate_type,
            aggregate_id=aggregate_id,
            payload=payload,
            occurred_at=self.clock.now(),
            actor_id=ctx.user_id,
            organization_id=organization_id,
            correlation_id=ctx.request_id,
        )
        await enqueue_outbox(self.session, event)

    async def _primary_party(
        self,
        *,
        org_id: UUID,
        primary_artist_id: UUID | None,
        primary_band_id: UUID | None,
    ) -> tuple[UUID | None, UUID | None]:
        if primary_artist_id is not None and primary_band_id is not None:
            raise AppError(
                "VALIDATION_ERROR",
                "A catalog item may have a primary artist or a primary band, not both",
                422,
            )
        if primary_artist_id is not None:
            artist = await self.session.get(Artist, primary_artist_id)
            if artist is None or artist.deleted_at is not None:
                raise AppError("VALIDATION_ERROR", "Primary artist was not found", 422)
            if artist.primary_org_id is not None and artist.primary_org_id != org_id:
                raise AppError(
                    "ORG_SCOPE_MISMATCH",
                    "Primary artist belongs to another organization",
                    409,
                    "Cross-org catalog collaboration is not enabled",
                )
        if primary_band_id is not None:
            band = await self.session.get(Band, primary_band_id)
            if band is None or band.deleted_at is not None:
                raise AppError("VALIDATION_ERROR", "Primary band was not found", 422)
            if band.primary_org_id is not None and band.primary_org_id != org_id:
                raise AppError(
                    "ORG_SCOPE_MISMATCH",
                    "Primary band belongs to another organization",
                    409,
                    "Cross-org catalog collaboration is not enabled",
                )
        return primary_artist_id, primary_band_id

    def _require_version(self, row_version: int, expected: int | None) -> None:
        if expected is not None and row_version != expected:
            raise ConflictError("The resource was updated concurrently")

    async def get_track_row(self, track_id: UUID) -> Track:
        track = await self.session.get(Track, track_id)
        if track is None or track.deleted_at is not None:
            raise NotFoundError("Track not found")
        return track

    async def get_release_row(self, release_id: UUID) -> Release:
        release = await self.session.get(Release, release_id)
        if release is None or release.deleted_at is not None:
            raise NotFoundError("Release not found")
        return release

    async def create_track(
        self,
        ctx: AuthContext,
        *,
        title: str,
        isrc: str | None = None,
        extra_metadata: dict[str, Any] | None = None,
        primary_artist_id: UUID | None = None,
        primary_band_id: UUID | None = None,
        organization_id: UUID | None = None,
    ) -> Track:
        org_id = self._workspace_org_id(ctx, organization_id)
        await self._require_active_org(org_id)
        if not await self._can_staff_write_workspace(ctx, org_id):
            raise ForbiddenError("Missing permission music.write")
        name = title.strip()
        if not name:
            raise AppError("VALIDATION_ERROR", "Title is required", 422)
        artist_id, band_id = await self._primary_party(
            org_id=org_id,
            primary_artist_id=primary_artist_id,
            primary_band_id=primary_band_id,
        )
        code = isrc.strip() if isrc else None
        if code == "":
            code = None
        track = Track(
            title=name,
            isrc=code,
            status="DRAFT",
            primary_artist_id=artist_id,
            primary_band_id=band_id,
            primary_org_id=org_id,
            extra_metadata=self._meta(extra_metadata),
            created_by=ctx.user_id,
        )
        self.session.add(track)
        try:
            await self.session.flush()
        except IntegrityError as exc:
            raise ConflictError("ISRC already exists") from exc
        await self._emit(
            event_type=TRACK_CREATED,
            aggregate_type="Track",
            aggregate_id=track.id,
            payload={"title": track.title, "status": track.status},
            ctx=ctx,
            organization_id=org_id,
        )
        await self.audit.record_from_auth(
            ctx,
            action="track.created",
            entity_type="Track",
            entity_id=track.id,
            new_state={"title": track.title, "status": track.status, "primary_org_id": str(org_id)},
            organization_id=org_id,
        )
        return track

    async def create_release(
        self,
        ctx: AuthContext,
        *,
        title: str,
        release_type: str,
        extra_metadata: dict[str, Any] | None = None,
        primary_artist_id: UUID | None = None,
        primary_band_id: UUID | None = None,
        cover_asset_id: UUID | None = None,
        release_at: datetime | None = None,
        organization_id: UUID | None = None,
    ) -> Release:
        org_id = self._workspace_org_id(ctx, organization_id)
        await self._require_active_org(org_id)
        if not await self._can_staff_write_workspace(ctx, org_id):
            raise ForbiddenError("Missing permission music.write")
        if release_type not in RELEASE_TYPES:
            raise AppError("VALIDATION_ERROR", "Invalid release_type", 422)
        name = title.strip()
        if not name:
            raise AppError("VALIDATION_ERROR", "Title is required", 422)
        artist_id, band_id = await self._primary_party(
            org_id=org_id,
            primary_artist_id=primary_artist_id,
            primary_band_id=primary_band_id,
        )
        release = Release(
            title=name,
            release_type=release_type,
            status="IDEA",
            primary_artist_id=artist_id,
            primary_band_id=band_id,
            primary_org_id=org_id,
            cover_asset_id=await self._cover(cover_asset_id),
            release_at=release_at,
            extra_metadata=self._meta(extra_metadata),
            created_by=ctx.user_id,
        )
        self.session.add(release)
        await self.session.flush()
        await self._emit(
            event_type=RELEASE_STAGE_CHANGED,
            aggregate_type="Release",
            aggregate_id=release.id,
            payload={"title": release.title, "status": release.status, "release_type": release.release_type},
            ctx=ctx,
            organization_id=org_id,
        )
        await self.audit.record_from_auth(
            ctx,
            action="release.created",
            entity_type="Release",
            entity_id=release.id,
            new_state={
                "title": release.title,
                "status": release.status,
                "release_type": release.release_type,
                "primary_org_id": str(org_id),
            },
            organization_id=org_id,
        )
        return release

    def _is_public_track(self, track: Track) -> bool:
        return track.status in PUBLIC_TRACK_STATUSES

    def _is_public_release(self, release: Release) -> bool:
        return release.status in PUBLIC_RELEASE_STATUSES

    async def get_track(self, track_id: UUID, ctx: AuthContext | None) -> tuple[Track, bool]:
        track = await self.get_track_row(track_id)
        public = self._is_public_track(track)
        if ctx is None:
            if not public:
                raise NotFoundError("Track not found")
            return track, True
        owner = await self._owner_user_id(track.primary_artist_id, track.primary_band_id, ctx.user_id)
        allowed = False
        for perm in ("music.write", "music.approve", "music.takedown"):
            if await self._is_allowed(
                ctx.user_id,
                perm,
                resource_type="track",
                resource_id=track.id,
                organization_id=track.primary_org_id,
                owner_user_id=owner if perm == "music.write" else None,
            ):
                allowed = True
                break
        if allowed:
            return track, False
        if public:
            return track, True
        if await self._buyer_keeps_after_takedown(ctx.user_id, track=track):
            return track, True
        raise NotFoundError("Track not found")

    async def _buyer_keeps_after_takedown(
        self, user_id: UUID, *, track: Track | None = None, release: Release | None = None
    ) -> bool:
        """D-AUDIO-14: after an ordinary takedown the people who bought the song (or its release)
        keep it, so they can still open its page. A legal takedown hides it from everyone."""
        from cornerroom.modules.entitlements.application.service import EntitlementService

        entitlements = EntitlementService(self.session)
        if track is not None:
            return (
                track.status == "TAKEN_DOWN"
                and getattr(track, "takedown_kind", None) != "LEGAL"
                and await entitlements.owns_by_purchase(user_id, track.id)
            )
        if release is not None:
            return (
                release.status == "TAKEN_DOWN"
                and getattr(release, "takedown_kind", None) != "LEGAL"
                and await entitlements.find_active_release(user_id, release.id) is not None
            )
        return False

    async def get_release(self, release_id: UUID, ctx: AuthContext | None) -> tuple[Release, bool]:
        release = await self.get_release_row(release_id)
        public = self._is_public_release(release)
        if ctx is None:
            if not public:
                raise NotFoundError("Release not found")
            return release, True
        owner = await self._owner_user_id(release.primary_artist_id, release.primary_band_id, ctx.user_id)
        allowed = False
        for perm in ("music.write", "music.approve", "music.takedown"):
            if await self._is_allowed(
                ctx.user_id,
                perm,
                resource_type="release",
                resource_id=release.id,
                organization_id=release.primary_org_id,
                owner_user_id=owner if perm == "music.write" else None,
            ):
                allowed = True
                break
        if allowed:
            return release, False
        if public:
            return release, True
        if await self._buyer_keeps_after_takedown(ctx.user_id, release=release):
            return release, True
        raise NotFoundError("Release not found")

    async def list_tracks(
        self,
        ctx: AuthContext | None,
        *,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> tuple[list[Track], str | None, bool]:
        page = clamp_limit(limit)
        stmt: Select[tuple[Track]] = select(Track).where(Track.deleted_at.is_(None))
        public_only = True
        if ctx is not None and ctx.organization_id is not None:
            if await self._can_staff_write_workspace(ctx, ctx.organization_id):
                public_only = False
                stmt = stmt.where(Track.primary_org_id == ctx.organization_id)
        if public_only:
            stmt = stmt.where(Track.status.in_(tuple(PUBLIC_TRACK_STATUSES)))
        stmt = stmt.order_by(Track.created_at.desc(), Track.id.desc())
        if cursor:
            stmt = stmt.where(keyset_before(Track.created_at, Track.id, cursor))
        stmt = stmt.limit(page + 1)
        rows = list((await self.session.execute(stmt)).scalars().all())
        next_cursor = None
        if len(rows) > page:
            last = rows[page - 1]
            next_cursor = encode_cursor(last.created_at.isoformat(), last.id)
            rows = rows[:page]
        return rows, next_cursor, public_only

    async def list_releases(
        self,
        ctx: AuthContext | None,
        *,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> tuple[list[Release], str | None, bool]:
        page = clamp_limit(limit)
        stmt: Select[tuple[Release]] = select(Release).where(Release.deleted_at.is_(None))
        public_only = True
        if ctx is not None and ctx.organization_id is not None:
            if await self._can_staff_write_workspace(ctx, ctx.organization_id):
                public_only = False
                stmt = stmt.where(Release.primary_org_id == ctx.organization_id)
        if public_only:
            stmt = stmt.where(Release.status.in_(tuple(PUBLIC_RELEASE_STATUSES)))
        stmt = stmt.order_by(Release.created_at.desc(), Release.id.desc())
        if cursor:
            stmt = stmt.where(keyset_before(Release.created_at, Release.id, cursor))
        stmt = stmt.limit(page + 1)
        rows = list((await self.session.execute(stmt)).scalars().all())
        next_cursor = None
        if len(rows) > page:
            last = rows[page - 1]
            next_cursor = encode_cursor(last.created_at.isoformat(), last.id)
            rows = rows[:page]
        return rows, next_cursor, public_only

    async def update_track(
        self,
        ctx: AuthContext,
        track_id: UUID,
        *,
        title: str | None = None,
        isrc: str | None | object = ...,
        extra_metadata: dict[str, Any] | None | object = ...,
        primary_artist_id: UUID | None | object = ...,
        primary_band_id: UUID | None | object = ...,
        expected_version: int | None = None,
    ) -> Track:
        track = await self.get_track_row(track_id)
        await self._assert_track_perm(ctx, track, "music.write")
        if track.primary_org_id is not None:
            await self._require_active_org(track.primary_org_id)
        if track.status in {"TAKEN_DOWN", "ARCHIVED", "REJECTED"}:
            raise AppError("INVALID_TRANSITION", "Track cannot be edited in this state", 409)
        self._require_version(track.version, expected_version)
        previous = {"title": track.title, "status": track.status, "isrc": track.isrc}
        if title is not None:
            trimmed = title.strip()
            if not trimmed:
                raise AppError("VALIDATION_ERROR", "Title is required", 422)
            track.title = trimmed
        if isrc is not ...:
            code = isrc.strip() if isinstance(isrc, str) and isrc else None
            track.isrc = code or None
        if extra_metadata is not ...:
            track.extra_metadata = self._meta(extra_metadata if isinstance(extra_metadata, dict) else None)
        if primary_artist_id is not ... or primary_band_id is not ...:
            next_artist = (
                primary_artist_id if primary_artist_id is not ... else track.primary_artist_id
            )
            next_band = primary_band_id if primary_band_id is not ... else track.primary_band_id
            org_id = track.primary_org_id or ctx.organization_id
            if org_id is None:
                raise AppError("WORKSPACE_REQUIRED", "Active organization workspace is required", 409)
            artist_id, band_id = await self._primary_party(
                org_id=org_id,
                primary_artist_id=next_artist if isinstance(next_artist, UUID) or next_artist is None else track.primary_artist_id,
                primary_band_id=next_band if isinstance(next_band, UUID) or next_band is None else track.primary_band_id,
            )
            track.primary_artist_id = artist_id
            track.primary_band_id = band_id
        track.updated_by = ctx.user_id
        await self._flush_versioned()
        await self._emit(
            event_type=METADATA_CORRECTED,
            aggregate_type="Track",
            aggregate_id=track.id,
            payload={"title": track.title, "status": track.status},
            ctx=ctx,
            organization_id=track.primary_org_id,
        )
        await self.audit.record_from_auth(
            ctx,
            action="track.metadata_corrected",
            entity_type="Track",
            entity_id=track.id,
            previous_state=previous,
            new_state={"title": track.title, "status": track.status, "isrc": track.isrc},
            organization_id=track.primary_org_id,
        )
        return track

    async def update_release(
        self,
        ctx: AuthContext,
        release_id: UUID,
        *,
        title: str | None = None,
        release_type: str | None = None,
        extra_metadata: dict[str, Any] | None | object = ...,
        primary_artist_id: UUID | None | object = ...,
        primary_band_id: UUID | None | object = ...,
        cover_asset_id: UUID | None | object = ...,
        release_at: datetime | None | object = ...,
        expected_version: int | None = None,
    ) -> Release:
        release = await self.get_release_row(release_id)
        await self._assert_release_perm(ctx, release, "music.write")
        if release.primary_org_id is not None:
            await self._require_active_org(release.primary_org_id)
        if release.status in {"TAKEN_DOWN", "ARCHIVED"}:
            raise AppError("INVALID_TRANSITION", "Release cannot be edited in this state", 409)
        self._require_version(release.version, expected_version)
        previous = {"title": release.title, "status": release.status, "release_type": release.release_type}
        if title is not None:
            trimmed = title.strip()
            if not trimmed:
                raise AppError("VALIDATION_ERROR", "Title is required", 422)
            release.title = trimmed
        if release_type is not None:
            if release_type not in RELEASE_TYPES:
                raise AppError("VALIDATION_ERROR", "Invalid release_type", 422)
            release.release_type = release_type
        if extra_metadata is not ...:
            release.extra_metadata = self._meta(extra_metadata if isinstance(extra_metadata, dict) else None)
        if cover_asset_id is not ...:
            release.cover_asset_id = await self._cover(
                cover_asset_id if isinstance(cover_asset_id, UUID) else None
            )
        if release_at is not ...:
            release.release_at = release_at if isinstance(release_at, datetime) else None
        if primary_artist_id is not ... or primary_band_id is not ...:
            next_artist = (
                primary_artist_id if primary_artist_id is not ... else release.primary_artist_id
            )
            next_band = primary_band_id if primary_band_id is not ... else release.primary_band_id
            org_id = release.primary_org_id or ctx.organization_id
            if org_id is None:
                raise AppError("WORKSPACE_REQUIRED", "Active organization workspace is required", 409)
            artist_id, band_id = await self._primary_party(
                org_id=org_id,
                primary_artist_id=next_artist if isinstance(next_artist, UUID) or next_artist is None else release.primary_artist_id,
                primary_band_id=next_band if isinstance(next_band, UUID) or next_band is None else release.primary_band_id,
            )
            release.primary_artist_id = artist_id
            release.primary_band_id = band_id
        release.updated_by = ctx.user_id
        await self._flush_versioned()
        await self._emit(
            event_type=METADATA_CORRECTED,
            aggregate_type="Release",
            aggregate_id=release.id,
            payload={"title": release.title, "status": release.status},
            ctx=ctx,
            organization_id=release.primary_org_id,
        )
        await self.audit.record_from_auth(
            ctx,
            action="release.metadata_corrected",
            entity_type="Release",
            entity_id=release.id,
            previous_state=previous,
            new_state={"title": release.title, "status": release.status, "release_type": release.release_type},
            organization_id=release.primary_org_id,
        )
        return release

    async def _current_ready_version(self, track_id: UUID) -> TrackVersion | None:
        stmt = select(TrackVersion).where(
            TrackVersion.track_id == track_id,
            TrackVersion.is_current.is_(True),
            TrackVersion.status == "READY",
            TrackVersion.deleted_at.is_(None),
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def transition_track(
        self,
        ctx: AuthContext,
        track_id: UUID,
        *,
        action: str,
        expected_version: int | None = None,
        takedown_kind: str | None = None,
    ) -> Track:
        track = await self.get_track_row(track_id)
        permission = permission_for_track_action(action)
        await self._assert_track_perm(ctx, track, permission)
        if track.primary_org_id is not None:
            await self._require_active_org(track.primary_org_id)
        self._require_version(track.version, expected_version)
        target = track_action_target(track.status, action)
        if action in {"approve", "schedule", "release"}:
            await self.assert_independent_reviewer(ctx, await self._releases_of_track(track.id))
        if target == "RELEASED":
            ready = await self._current_ready_version(track.id)
            if ready is None:
                raise AppError(
                    "VERSION_NOT_READY",
                    "A current READY track version is required before RELEASED",
                    409,
                    "Audio bytes may be absent (Q-P0-12); a READY version row is still required",
                )
        previous = track.status
        track.status = target
        if target == "TAKEN_DOWN":
            # D-AUDIO-14: ordinary takedowns keep buyers' access; LEGAL removes it for everyone.
            kind = (takedown_kind or "STANDARD").upper()
            if kind not in {"STANDARD", "LEGAL"}:
                raise AppError("VALIDATION_ERROR", "Takedown kind must be STANDARD or LEGAL", 422)
            track.takedown_kind = kind
        track.updated_by = ctx.user_id
        await self._flush_versioned()
        event_type = TRACK_APPROVED if target == "APPROVED" else None
        if target == "RELEASED":
            event_type = TRACK_RELEASED
        elif target == "TAKEN_DOWN":
            event_type = TRACK_TAKEN_DOWN
        if event_type:
            await self._emit(
                event_type=event_type,
                aggregate_type="Track",
                aggregate_id=track.id,
                payload={"status": track.status, "previous_status": previous, "takedown_kind": track.takedown_kind},
                ctx=ctx,
                organization_id=track.primary_org_id,
            )
        await self.audit.record_from_auth(
            ctx,
            action=f"track.{action}",
            entity_type="Track",
            entity_id=track.id,
            previous_state={"status": previous},
            new_state={"status": track.status, **({"takedown_kind": track.takedown_kind} if target == "TAKEN_DOWN" else {})},
            organization_id=track.primary_org_id,
        )
        return track

    async def transition_release(
        self,
        ctx: AuthContext,
        release_id: UUID,
        *,
        action: str,
        expected_version: int | None = None,
        release_at: datetime | None = None,
    ) -> Release:
        release = await self.get_release_row(release_id)
        permission = permission_for_release_action(action)
        await self._assert_release_perm(ctx, release, permission)
        if release.primary_org_id is not None:
            await self._require_active_org(release.primary_org_id)
        self._require_version(release.version, expected_version)
        target = release_action_target(release.status, action)
        if action in {"approve", "schedule", "release"}:
            await self.assert_independent_reviewer(ctx, [release.id])
        previous = release.status
        release.status = target
        if action == "schedule" and release_at is not None:
            release.release_at = release_at
        release.updated_by = ctx.user_id
        await self._flush_versioned()
        # RELEASED is catalog state only — child tracks are not auto-released.
        event_type = RELEASE_RELEASED if target == "RELEASED" else RELEASE_STAGE_CHANGED
        await self._emit(
            event_type=event_type,
            aggregate_type="Release",
            aggregate_id=release.id,
            payload={
                "status": release.status,
                "previous_status": previous,
                "release_type": release.release_type,
            },
            ctx=ctx,
            organization_id=release.primary_org_id,
        )
        await self.audit.record_from_auth(
            ctx,
            action=f"release.{action}",
            entity_type="Release",
            entity_id=release.id,
            previous_state={"status": previous},
            new_state={"status": release.status},
            organization_id=release.primary_org_id,
        )
        return release

    async def add_release_track(
        self,
        ctx: AuthContext,
        release_id: UUID,
        *,
        track_id: UUID,
        position: int,
    ) -> ReleaseTrack:
        release = await self.get_release_row(release_id)
        await self._assert_release_perm(ctx, release, "music.write")
        if release.primary_org_id is not None:
            await self._require_active_org(release.primary_org_id)
        if release.status in {"TAKEN_DOWN", "ARCHIVED"}:
            raise AppError("INVALID_TRANSITION", "Release cannot be edited in this state", 409)
        if position < 1:
            raise AppError("VALIDATION_ERROR", "Position must be >= 1", 422)
        track = await self.get_track_row(track_id)
        if track.primary_org_id is not None and release.primary_org_id is not None:
            if track.primary_org_id != release.primary_org_id:
                raise AppError(
                    "ORG_SCOPE_MISMATCH",
                    "Track belongs to another organization",
                    409,
                    "Cross-org catalog collaboration is not enabled",
                )
        row = ReleaseTrack(
            release_id=release.id,
            track_id=track.id,
            position=position,
            created_by=ctx.user_id,
        )
        self.session.add(row)
        try:
            await self.session.flush()
        except IntegrityError as exc:
            raise ConflictError("Track or position already exists on this release") from exc
        await self.audit.record_from_auth(
            ctx,
            action="release_track.added",
            entity_type="Release",
            entity_id=release.id,
            new_state={"track_id": str(track.id), "position": position},
            organization_id=release.primary_org_id,
        )
        return row

    async def remove_release_track(
        self,
        ctx: AuthContext,
        release_id: UUID,
        track_id: UUID,
    ) -> None:
        release = await self.get_release_row(release_id)
        await self._assert_release_perm(ctx, release, "music.write")
        if release.primary_org_id is not None:
            await self._require_active_org(release.primary_org_id)
        if release.status in {"TAKEN_DOWN", "ARCHIVED"}:
            raise AppError("INVALID_TRANSITION", "Release cannot be edited in this state", 409)
        row = await self.session.get(ReleaseTrack, (release_id, track_id))
        if row is None:
            raise NotFoundError("Release track not found")
        await self.session.delete(row)
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx,
            action="release_track.removed",
            entity_type="Release",
            entity_id=release.id,
            previous_state={"track_id": str(track_id), "position": row.position},
            organization_id=release.primary_org_id,
        )

    async def list_release_tracks(self, release_id: UUID) -> list[ReleaseTrack]:
        stmt = (
            select(ReleaseTrack)
            .where(ReleaseTrack.release_id == release_id)
            .order_by(ReleaseTrack.position.asc())
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def create_version(
        self,
        ctx: AuthContext,
        track_id: UUID,
        *,
        version_type: str = "MASTER",
        media_asset_id: UUID | None = None,
        duration_ms: int | None = None,
    ) -> TrackVersion:
        track = await self.get_track_row(track_id)
        await self._assert_track_editor(ctx, track)
        if track.primary_org_id is not None:
            await self._require_active_org(track.primary_org_id)
        if version_type not in VERSION_TYPES:
            raise AppError("VALIDATION_ERROR", "Invalid version_type", 422)
        if duration_ms is not None and duration_ms < 0:
            raise AppError("VALIDATION_ERROR", "duration_ms must be >= 0", 422)
        audio_id = await self._audio_asset(media_asset_id, ctx)
        in_progress = (
            await self.session.execute(
                select(TrackVersion.id).where(
                    TrackVersion.track_id == track.id,
                    TrackVersion.status.in_(("UPLOADING", "PROCESSING")),
                    TrackVersion.deleted_at.is_(None),
                )
            )
        ).first()
        if in_progress is not None:
            raise ConflictError("A track version is already in progress")
        existing_current = (
            await self.session.execute(
                select(TrackVersion).where(
                    TrackVersion.track_id == track.id,
                    TrackVersion.is_current.is_(True),
                    TrackVersion.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        # Fix F3: a READY current version keeps playing; the new one waits as a candidate and
        # takes over only when its audio is ready (system_version_ready).
        candidate = existing_current is not None and existing_current.status == "READY"
        if existing_current is not None and not candidate:
            existing_current.is_current = False
            existing_current.updated_by = ctx.user_id
            await self.session.flush()
        row = TrackVersion(
            track_id=track.id,
            version_type=version_type,
            media_asset_id=audio_id,
            duration_ms=duration_ms,
            status="UPLOADING",
            is_current=not candidate,
            created_by=ctx.user_id,
        )
        self.session.add(row)
        await self._flush_versioned()
        if audio_id is not None:
            await self._emit(
                event_type=TRACK_UPLOADED,
                aggregate_type="Track",
                aggregate_id=track.id,
                payload={"version_id": str(row.id), "status": row.status},
                ctx=ctx,
                organization_id=track.primary_org_id,
            )
        await self.audit.record_from_auth(
            ctx,
            action="track_version.created",
            entity_type="TrackVersion",
            entity_id=row.id,
            new_state={
                "track_id": str(track.id),
                "status": row.status,
                "media_asset_id": str(audio_id) if audio_id else None,
            },
            organization_id=track.primary_org_id,
        )
        return row

    # --- Upload targets (called by the documents upload service; AUDIO_PHASE_1_DESIGN 6) ---

    @staticmethod
    def profile_of(row: Track | Release) -> tuple[str | None, UUID | None]:
        if row.primary_artist_id is not None:
            return "artist", row.primary_artist_id
        if row.primary_band_id is not None:
            return "band", row.primary_band_id
        return None, None

    async def studio_can_edit(self, ctx: AuthContext, row: Track | Release) -> bool:
        """Studio editors: the profile's owner (solo artist / band admin), or staff with catalog
        intake or catalog write in the profile's organization (design 3.4)."""
        owners = await self.catalog_owner_ids(row.primary_artist_id, row.primary_band_id)
        if ctx.user_id in owners:
            return True
        if row.primary_org_id is None:
            return False
        for perm in ("music.intake_assist", "music.write"):
            if await self._is_allowed(
                ctx.user_id, perm, resource_type="track" if isinstance(row, Track) else "release",
                resource_id=row.id, organization_id=row.primary_org_id,
            ):
                return True
        return False

    async def assert_independent_reviewer(self, ctx: AuthContext, release_ids: list[UUID]) -> None:
        """Two-person rule (D-AUDIO-09, A17): whoever prepared a release, or owns it, may not approve,
        schedule or release it."""
        from cornerroom.modules.music.domain.models import ReleaseContributor

        if not release_ids:
            return
        prepared = (
            await self.session.execute(
                select(ReleaseContributor.release_id).where(
                    ReleaseContributor.release_id.in_(release_ids), ReleaseContributor.user_id == ctx.user_id
                )
            )
        ).first()
        owns = False
        for release in (await self.session.execute(select(Release).where(Release.id.in_(release_ids)))).scalars():
            if ctx.user_id in await self.catalog_owner_ids(release.primary_artist_id, release.primary_band_id):
                owns = True
        if prepared is not None or owns:
            raise AppError(
                "SAME_PERSON_REVIEW",
                "Someone else must approve this",
                403,
                "The person who prepared or owns a release can't approve or publish it",
            )

    async def _releases_of_track(self, track_id: UUID) -> list[UUID]:
        rows = await self.session.execute(select(ReleaseTrack.release_id).where(ReleaseTrack.track_id == track_id))
        return list(rows.scalars().all())

    async def _assert_track_editor(self, ctx: AuthContext, track: Track) -> None:
        if await self.studio_can_edit(ctx, track):
            return
        await self._assert_track_perm(ctx, track, "music.write")

    async def authorize_master_upload(self, ctx: AuthContext, version_id: UUID) -> tuple[Track, TrackVersion]:
        """The caller may upload this version's master: write access, version still waiting for audio."""
        version = await self.session.get(TrackVersion, version_id)
        if version is None or version.deleted_at is not None:
            raise NotFoundError("Track version not found")
        track = await self.get_track_row(version.track_id)
        await self._assert_track_editor(ctx, track)
        if track.primary_org_id is not None:
            await self._require_active_org(track.primary_org_id)
        if track.status in {"TAKEN_DOWN", "ARCHIVED", "REJECTED"}:
            raise AppError("INVALID_TRANSITION", "This track no longer accepts audio", 409)
        if version.status != "UPLOADING" or version.media_asset_id is not None:
            raise AppError(
                "INVALID_TRANSITION",
                "This version already has audio",
                409,
                "Start a new version to replace the audio",
            )
        return track, version

    async def attach_uploaded_master(
        self, ctx: AuthContext, version_id: UUID, asset_id: UUID
    ) -> TrackVersion:
        """Bytes verified and quarantined: the version moves to PROCESSING (checks run next)."""
        track, version = await self.authorize_master_upload(ctx, version_id)
        version_transition_action(version.status, "PROCESSING")
        previous = version.status
        version.media_asset_id = asset_id
        version.status = "PROCESSING"
        version.processing_detail = "QUEUED"
        version.uploaded_by = ctx.user_id
        version.on_behalf_profile_type, version.on_behalf_profile_id = self.profile_of(track)
        version.updated_by = ctx.user_id
        await self._flush_versioned()
        await self._emit(
            event_type=TRACK_UPLOADED,
            aggregate_type="Track",
            aggregate_id=track.id,
            payload={"version_id": str(version.id), "status": version.status},
            ctx=ctx,
            organization_id=track.primary_org_id,
        )
        await self.audit.record_from_auth(
            ctx,
            action="track_version.uploaded",
            entity_type="TrackVersion",
            entity_id=version.id,
            previous_state={"status": previous},
            new_state={"status": version.status, "media_asset_id": str(asset_id)},
            organization_id=track.primary_org_id,
        )
        return version

    # --- System transitions (media worker only; AUDIO_PHASE_1_DESIGN 5.3, fixes F2/F3) ---

    async def _system_event(
        self, event_type: str, aggregate_type: str, aggregate_id: UUID, payload: dict[str, Any], org: UUID | None
    ) -> None:
        await enqueue_outbox(
            self.session,
            DomainEvent(
                event_type=event_type,
                producer="music",
                aggregate_type=aggregate_type,
                aggregate_id=aggregate_id,
                payload=payload,
                occurred_at=self.clock.now(),
                actor_id=None,
                organization_id=org,
                correlation_id=f"media:{aggregate_id}",
            ),
        )

    async def versions_for_master(self, asset_id: UUID) -> list[TrackVersion]:
        rows = await self.session.execute(
            select(TrackVersion).where(TrackVersion.media_asset_id == asset_id, TrackVersion.deleted_at.is_(None))
        )
        return list(rows.scalars().all())

    async def system_version_progress(self, version: TrackVersion, detail: str, duration_ms: int | None = None) -> None:
        version.processing_detail = detail
        if duration_ms is not None:
            version.duration_ms = duration_ms
        await self._flush_versioned()

    async def system_reject_version(self, version: TrackVersion, detail: str) -> None:
        if version.status not in {"UPLOADING", "PROCESSING"}:
            return
        track = await self.get_track_row(version.track_id)
        previous = version.status
        version_transition_action(previous, "REJECTED")
        version.status = "REJECTED"
        version.processing_detail = detail
        version.is_current = False
        await self._flush_versioned()
        await self._system_event(
            TRACK_VERSION_REJECTED, "TrackVersion", version.id,
            {"track_id": str(track.id), "version_id": str(version.id), "reason": detail}, track.primary_org_id,
        )
        await self.audit.record(
            action="track_version.rejected", entity_type="TrackVersion", entity_id=version.id,
            actor_id="system:media", actor_type="system",
            previous_state={"status": previous}, new_state={"status": "REJECTED", "reason": detail},
        )

    async def system_version_ready(self, version: TrackVersion) -> None:
        """All required playback copies verified: the version becomes READY and, if it was a
        candidate replacing a READY version, takes over as current in the same transaction."""
        if version.status != "PROCESSING":
            return
        track = await self.get_track_row(version.track_id)
        if not version.is_current:
            current = (
                await self.session.execute(
                    select(TrackVersion).where(
                        TrackVersion.track_id == track.id,
                        TrackVersion.is_current.is_(True),
                        TrackVersion.deleted_at.is_(None),
                    )
                )
            ).scalar_one_or_none()
            if current is not None:
                if current.status == "READY":
                    current.status = "SUPERSEDED"
                current.is_current = False
                await self._flush_versioned()
            version.is_current = True
        version_transition_action(version.status, "READY")
        version.status = "READY"
        version.processing_detail = "READY"
        await self._flush_versioned()
        await self._system_event(
            TRACK_VERSION_READY, "TrackVersion", version.id,
            {"track_id": str(track.id), "version_id": str(version.id)}, track.primary_org_id,
        )
        await self.audit.record(
            action="track_version.ready", entity_type="TrackVersion", entity_id=version.id,
            actor_id="system:media", actor_type="system",
            previous_state={"status": "PROCESSING"}, new_state={"status": "READY", "is_current": True},
        )

    async def system_attach_cover(self, release_id: UUID, asset_id: UUID) -> None:
        release = await self.get_release_row(release_id)
        previous = release.cover_asset_id
        release.cover_asset_id = asset_id
        await self._flush_versioned()
        await self.audit.record(
            action="release.cover_attached", entity_type="Release", entity_id=release.id,
            actor_id="system:media", actor_type="system",
            previous_state={"cover_asset_id": str(previous) if previous else None},
            new_state={"cover_asset_id": str(asset_id)},
        )

    async def media_report(self, ctx: AuthContext, track_id: UUID, version_id: UUID) -> dict[str, Any]:
        """What the checks found for one version: for its editors and reviewers only (404 otherwise).
        No storage keys, tool paths or bytes."""
        from cornerroom.modules.documents.domain.models import MediaFinding, MediaInspection, MediaJob
        from cornerroom.modules.music.domain.models import TrackRendition

        track = await self.get_track_row(track_id)
        owner = await self._owner_user_id(track.primary_artist_id, track.primary_band_id, ctx.user_id)
        allowed = await self.studio_can_edit(ctx, track)
        for perm in () if allowed else ("music.write", "music.approve"):
            if await self._is_allowed(
                ctx.user_id, perm, resource_type="track", resource_id=track.id,
                organization_id=track.primary_org_id, owner_user_id=owner if perm == "music.write" else None,
            ):
                allowed = True
                break
        if not allowed:
            raise NotFoundError("Track not found")
        version = await self.session.get(TrackVersion, version_id)
        if version is None or version.deleted_at is not None or version.track_id != track.id:
            raise NotFoundError("Track version not found")
        report: dict[str, Any] = {
            "version_id": version.id,
            "status": version.status,
            "processing_detail": version.processing_detail,
            "is_current": version.is_current,
            "asset_status": None,
            "inspection": None,
            "findings": [],
            "renditions": [],
            "jobs": [],
        }
        if version.media_asset_id is None:
            return report
        asset = await self.session.get(MediaAsset, version.media_asset_id)
        report["asset_status"] = asset.status if asset else None
        inspection = (
            await self.session.execute(
                select(MediaInspection)
                .where(MediaInspection.media_asset_id == version.media_asset_id)
                .order_by(MediaInspection.inspected_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if inspection is not None:
            report["inspection"] = {
                "outcome": inspection.outcome,
                "container": inspection.container,
                "codec": inspection.codec,
                "sample_rate_hz": inspection.sample_rate_hz,
                "bit_depth": inspection.bit_depth,
                "sample_format": inspection.sample_format,
                "channels": inspection.channels,
                "duration_ms": inspection.duration_ms,
                "integrated_lufs": inspection.integrated_lufs,
                "loudness_range_lu": inspection.loudness_range_lu,
                "true_peak_dbtp": inspection.true_peak_dbtp,
                "inspected_at": inspection.inspected_at,
            }
            findings = (
                await self.session.execute(select(MediaFinding).where(MediaFinding.inspection_id == inspection.id))
            ).scalars().all()
            order = {"BLOCK": 0, "WARN": 1}
            report["findings"] = sorted(
                (
                    {"code": f.code, "severity": f.severity, "measured": f.measured, "limit": f.limit_value}
                    for f in findings
                ),
                key=lambda f: order.get(f["severity"], 2),
            )
        renditions = (
            await self.session.execute(
                select(TrackRendition).where(TrackRendition.track_version_id == version.id).order_by(TrackRendition.profile_key)
            )
        ).scalars().all()
        report["renditions"] = [
            {
                "profile_key": r.profile_key,
                "codec": r.codec,
                "bitrate_kbps": r.bitrate_kbps,
                "sample_rate_hz": r.sample_rate_hz,
                "duration_ms": r.duration_ms,
                "byte_size": r.byte_size,
                "status": r.status,
                "purpose": r.purpose,
                "bit_depth": r.bit_depth,
            }
            for r in renditions
        ]
        jobs = (
            await self.session.execute(
                select(MediaJob).where(MediaJob.media_asset_id == version.media_asset_id).order_by(MediaJob.created_at)
            )
        ).scalars().all()
        report["jobs"] = [
            {"kind": j.kind, "profile_key": j.profile_key, "status": j.status, "attempts": j.attempts,
             "last_error_code": j.last_error_code}
            for j in jobs
            if j.kind == "INSPECT" or j.target_id == version.id
        ]
        return report

    async def authorize_cover_upload(self, ctx: AuthContext, release_id: UUID) -> Release:
        release = await self.get_release_row(release_id)
        if not await self.studio_can_edit(ctx, release):
            await self._assert_release_perm(ctx, release, "music.write")
        if release.primary_org_id is not None:
            await self._require_active_org(release.primary_org_id)
        if release.status in {"TAKEN_DOWN", "ARCHIVED"}:
            raise AppError("INVALID_TRANSITION", "This release no longer accepts artwork", 409)
        return release

    async def transition_version(
        self,
        ctx: AuthContext,
        track_id: UUID,
        version_id: UUID,
        *,
        action: str,
        expected_version: int | None = None,
    ) -> TrackVersion:
        track = await self.get_track_row(track_id)
        await self._assert_track_perm(ctx, track, "music.write")
        if track.primary_org_id is not None:
            await self._require_active_org(track.primary_org_id)
        row = await self.session.get(TrackVersion, version_id)
        if row is None or row.deleted_at is not None or row.track_id != track_id:
            raise NotFoundError("Track version not found")
        self._require_version(row.version, expected_version)
        if action in SYSTEM_VERSION_ACTIONS:
            # Fix F2: only the media worker decides that audio is ready or rejected.
            raise AppError(
                "SYSTEM_TRANSITION",
                "Only Corner Room's audio checks can change this",
                403,
                "Upload audio to the version; it becomes ready when its checks pass",
            )
        target = version_target_for_action(action)
        version_transition_action(row.status, target)
        previous = row.status
        row.status = target
        if target in {"SUPERSEDED", "REJECTED"}:
            row.is_current = False
        row.updated_by = ctx.user_id
        await self._flush_versioned()
        await self.audit.record_from_auth(
            ctx,
            action=f"track_version.{action}",
            entity_type="TrackVersion",
            entity_id=row.id,
            previous_state={"status": previous},
            new_state={"status": row.status},
            organization_id=track.primary_org_id,
        )
        return row

    async def list_versions(self, track_id: UUID) -> list[TrackVersion]:
        stmt = (
            select(TrackVersion)
            .where(TrackVersion.track_id == track_id, TrackVersion.deleted_at.is_(None))
            .order_by(TrackVersion.created_at.desc())
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def add_credit(
        self,
        ctx: AuthContext,
        *,
        track_id: UUID | None = None,
        release_id: UUID | None = None,
        artist_id: UUID | None = None,
        user_id: UUID | None = None,
        credit_role: str,
    ) -> Credit:
        if track_id is None and release_id is None:
            raise AppError("VALIDATION_ERROR", "Credit requires a track or a release", 422)
        if artist_id is None and user_id is None:
            raise AppError("VALIDATION_ERROR", "Credit requires an artist or a user party", 422)
        role = credit_role.strip()
        if not role:
            raise AppError("VALIDATION_ERROR", "credit_role is required", 422)
        org_id: UUID | None = None
        if track_id is not None:
            track = await self.get_track_row(track_id)
            await self._assert_track_perm(ctx, track, "music.write")
            org_id = track.primary_org_id
        if release_id is not None:
            release = await self.get_release_row(release_id)
            await self._assert_release_perm(ctx, release, "music.write")
            org_id = release.primary_org_id
        if org_id is not None:
            await self._require_active_org(org_id)
        if artist_id is not None:
            artist = await self.session.get(Artist, artist_id)
            if artist is None or artist.deleted_at is not None:
                raise AppError("VALIDATION_ERROR", "Credit artist was not found", 422)
            if artist.primary_org_id is not None and org_id is not None and artist.primary_org_id != org_id:
                raise AppError(
                    "ORG_SCOPE_MISMATCH",
                    "Credit artist belongs to another organization",
                    409,
                    "Cross-org catalog collaboration is not enabled",
                )
        if user_id is not None:
            user = await self.session.get(User, user_id)
            if user is None or user.deleted_at is not None:
                raise AppError("VALIDATION_ERROR", "Credit user was not found", 422)
        credit = Credit(
            track_id=track_id,
            release_id=release_id,
            artist_id=artist_id,
            user_id=user_id,
            credit_role=role,
            created_by=ctx.user_id,
        )
        self.session.add(credit)
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx,
            action="credit.created",
            entity_type="Credit",
            entity_id=credit.id,
            new_state={
                "credit_role": role,
                "track_id": str(track_id) if track_id else None,
                "release_id": str(release_id) if release_id else None,
                "artist_id": str(artist_id) if artist_id else None,
                "user_id": str(user_id) if user_id else None,
            },
            organization_id=org_id,
        )
        return credit

    async def list_credits(
        self, *, track_id: UUID | None = None, release_id: UUID | None = None
    ) -> list[Credit]:
        stmt = select(Credit).where(Credit.deleted_at.is_(None))
        if track_id is not None:
            stmt = stmt.where(Credit.track_id == track_id)
        if release_id is not None:
            stmt = stmt.where(Credit.release_id == release_id)
        stmt = stmt.order_by(Credit.created_at.asc())
        return list((await self.session.execute(stmt)).scalars().all())
