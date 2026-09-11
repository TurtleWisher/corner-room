"""Streaming application service. Controllers stay thin. No royalties or subscriptions."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Select, case, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.exc import StaleDataError

from cornerroom.infra.errors import AppError, ConflictError, ForbiddenError, NotFoundError, UnauthorizedError
from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.infra.settings import Settings, get_settings
from cornerroom.infra.storage import get_storage
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import (
    TRACK_LIKED,
    TRACK_PLAYED,
    USER_SUSPENDED,
    DomainEvent,
)
from cornerroom.kernel.pagination import clamp_limit, decode_cursor, encode_cursor
from cornerroom.modules.artists.domain.models import Artist
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.authorization.application.service import AuthorizationService
from cornerroom.modules.documents.domain.models import MediaAsset
from cornerroom.modules.entitlements.application.service import EntitlementService
from cornerroom.modules.identity.application.rate_limit import enforce_auth_rate_limit
from cornerroom.modules.music.domain.models import Release, ReleaseTrack, Track, TrackVersion
from cornerroom.modules.streaming.application.delivery import ObjectStorageAudioDelivery, SignedAudioUrl
from cornerroom.modules.streaming.domain.lifecycle import (
    LIBRARY_ITEM_TYPES,
    LIBRARY_KINDS_WRITABLE,
    PLAYLIST_KINDS,
    permission_for_editorial_action,
    playlist_target_for_action,
    playlist_transition_action,
    session_transition_action,
)
from cornerroom.modules.streaming.domain.models import (
    LibraryItem,
    ListeningSession,
    PlaybackEvent,
    Playlist,
    PlaylistItem,
)
from cornerroom.modules.streaming.domain.playability import CatalogSnapshot, Playability, evaluate_playability


class StreamingService:
    def __init__(
        self,
        session: AsyncSession,
        clock: Clock | None = None,
        settings: Settings | None = None,
        delivery: ObjectStorageAudioDelivery | None = None,
    ) -> None:
        self.session = session
        self.clock = clock or SystemClock()
        self.settings = settings or get_settings()
        self.audit = AuditService(session)
        self.authz = AuthorizationService(session, clock=self.clock)
        self.entitlements = EntitlementService(session, clock=self.clock)
        self.delivery = delivery or ObjectStorageAudioDelivery(
            self.settings, get_storage(self.settings)
        )

    async def _emit(
        self,
        *,
        event_type: str,
        aggregate_type: str,
        aggregate_id: UUID,
        payload: dict[str, Any],
        ctx: AuthContext | None,
        organization_id: UUID | None = None,
        actor_id: UUID | None = None,
    ) -> None:
        event = DomainEvent(
            event_type=event_type,
            producer="streaming",
            aggregate_type=aggregate_type,
            aggregate_id=aggregate_id,
            payload=payload,
            occurred_at=self.clock.now(),
            actor_id=actor_id if actor_id is not None else (ctx.user_id if ctx else None),
            organization_id=organization_id,
            correlation_id=ctx.request_id if ctx else None,
        )
        await enqueue_outbox(self.session, event)

    async def _flush_versioned(self) -> None:
        try:
            await self.session.flush()
        except StaleDataError as exc:
            raise ConflictError("The resource was updated concurrently") from exc
        except IntegrityError as exc:
            raise ConflictError("Conflicting streaming state") from exc

    async def _snapshot(
        self,
        track_id: UUID,
        *,
        release_id: UUID | None = None,
        track_version_id: UUID | None = None,
    ) -> tuple[CatalogSnapshot, Track | None, TrackVersion | None, int | None]:
        track = await self.session.get(Track, track_id)
        version: TrackVersion | None = None
        if track is not None and track.deleted_at is None:
            if track_version_id is not None:
                version = await self.session.get(TrackVersion, track_version_id)
                if (
                    version is None
                    or version.track_id != track.id
                    or version.deleted_at is not None
                    or not version.is_current
                ):
                    version = None
            if version is None:
                stmt = select(TrackVersion).where(
                    TrackVersion.track_id == track.id,
                    TrackVersion.is_current.is_(True),
                    TrackVersion.deleted_at.is_(None),
                )
                version = (await self.session.execute(stmt)).scalar_one_or_none()
        asset: MediaAsset | None = None
        if version is not None and version.media_asset_id is not None:
            asset = await self.session.get(MediaAsset, version.media_asset_id)
        release_track_present: bool | None = None
        release_status: str | None = None
        if release_id is not None:
            rt = await self.session.get(ReleaseTrack, (release_id, track_id))
            release_track_present = rt is not None
            release = await self.session.get(Release, release_id)
            release_status = None if release is None or release.deleted_at is not None else release.status
        snapshot = CatalogSnapshot(
            track_id=None if track is None or track.deleted_at is not None else track.id,
            track_status=None if track is None or track.deleted_at is not None else track.status,
            track_deleted=track is None or track.deleted_at is not None,
            version_id=None if version is None else version.id,
            version_status=None if version is None else version.status,
            version_is_current=bool(version is not None and version.is_current),
            version_deleted=version is None or version.deleted_at is not None,
            media_asset_id=None if asset is None or asset.deleted_at is not None else asset.id,
            media_status=None if asset is None or asset.deleted_at is not None else asset.status,
            media_class=None if asset is None or asset.deleted_at is not None else asset.storage_class,
            media_deleted=asset is None or asset.deleted_at is not None,
            release_id=release_id,
            release_status=release_status,
            release_track_present=release_track_present,
        )
        duration = None if version is None else version.duration_ms
        return snapshot, track, version, duration

    def _playability_error(self, playability: Playability, *, require_audio: bool) -> None:
        if playability.catalog_playable and (playability.audio_deliverable or not require_audio):
            return
        reason = playability.reason or "TRACK_NOT_PLAYABLE"
        if reason == "TRACK_NOT_FOUND":
            raise NotFoundError("Track not found")
        if reason in {"TRACK_TAKEN_DOWN", "TRACK_NOT_RELEASED", "VERSION_NOT_READY", "RELEASE_TRACK_MISSING"}:
            raise AppError(
                reason,
                "Track is not playable",
                409,
                "Availability is evaluated from Track, TrackVersion, ReleaseTrack, and MediaAsset independently",
            )
        if reason == "TRACK_AUDIO_UNAVAILABLE":
            raise AppError(
                reason,
                "Audio is not available",
                409,
                "A READY catalog_audio MediaAsset is required to deliver audio (Q-P0-12)",
            )
        raise AppError(reason, "Track is not playable", 409)

    async def _require_entitlement(self, user_id, track_id) -> None:
        await self.entitlements.require_catalog_access(user_id, track_id)

    async def availability(
        self,
        ctx: AuthContext,
        track_id: UUID,
        *,
        release_id: UUID | None = None,
        track_version_id: UUID | None = None,
    ) -> Playability:
        snapshot, _track, version, duration = await self._snapshot(
            track_id, release_id=release_id, track_version_id=track_version_id
        )
        playability = evaluate_playability(snapshot)
        return Playability(
            catalog_playable=playability.catalog_playable,
            audio_deliverable=playability.audio_deliverable,
            reason=playability.reason,
            track_id=playability.track_id,
            track_version_id=playability.track_version_id,
            media_asset_id=playability.media_asset_id,
            duration_ms=duration if version is not None else playability.duration_ms,
        )

    async def open_session(
        self,
        ctx: AuthContext,
        *,
        track_id: UUID,
        device: str | None = None,
        release_id: UUID | None = None,
        track_version_id: UUID | None = None,
    ) -> tuple[ListeningSession, Playability]:
        playability = await self.availability(
            ctx, track_id, release_id=release_id, track_version_id=track_version_id
        )
        self._playability_error(playability, require_audio=False)
        await self._require_entitlement(ctx.user_id, track_id)
        now = self.clock.now()
        row = ListeningSession(
            user_id=ctx.user_id,
            device=(device.strip()[:120] if device else None) or None,
            started_at=now,
            status="OPEN",
            created_by=ctx.user_id,
        )
        self.session.add(row)
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx,
            action="listening_session.opened",
            entity_type="ListeningSession",
            entity_id=row.id,
            new_state={"status": row.status, "track_id": str(track_id)},
            organization_id=None,
        )
        return row, playability

    async def get_session(self, ctx: AuthContext, session_id: UUID) -> ListeningSession:
        row = await self.session.get(ListeningSession, session_id)
        if row is None or row.user_id != ctx.user_id:
            raise NotFoundError("Listening session not found")
        return row

    async def close_session(
        self,
        ctx: AuthContext,
        session_id: UUID,
        *,
        expected_version: int | None = None,
    ) -> ListeningSession:
        row = await self.get_session(ctx, session_id)
        if expected_version is not None and row.version != expected_version:
            raise ConflictError("The resource was updated concurrently")
        if row.status == "CLOSED":
            return row
        session_transition_action(row.status, "CLOSED")
        row.status = "CLOSED"
        row.ended_at = self.clock.now()
        row.updated_by = ctx.user_id
        await self._flush_versioned()
        await self.audit.record_from_auth(
            ctx,
            action="listening_session.closed",
            entity_type="ListeningSession",
            entity_id=row.id,
            new_state={"status": row.status},
            organization_id=None,
        )
        return row

    async def close_sessions_for_user(self, user_id: UUID) -> int:
        stmt = select(ListeningSession).where(
            ListeningSession.user_id == user_id,
            ListeningSession.status == "OPEN",
        )
        rows = list((await self.session.execute(stmt)).scalars())
        now = self.clock.now()
        for row in rows:
            row.status = "CLOSED"
            row.ended_at = now
            row.updated_by = None
        if rows:
            await self.session.flush()
        return len(rows)

    async def ingest_event(
        self,
        ctx: AuthContext,
        *,
        client_event_id: str,
        track_id: UUID,
        session_id: UUID,
        duration_ms: int,
        completed: bool = False,
        started_at: datetime | None = None,
        region: str | None = None,
        track_version_id: UUID | None = None,
        release_id: UUID | None = None,
    ) -> tuple[PlaybackEvent, bool]:
        await enforce_auth_rate_limit(
            settings=self.settings,
            scope="playback_ingest",
            key=str(ctx.user_id),
        )
        token = client_event_id.strip()
        if not token:
            raise AppError("VALIDATION_ERROR", "client_event_id is required", 422)
        if duration_ms < 0:
            raise AppError("VALIDATION_ERROR", "duration_ms must be a non-negative integer", 422)
        listening = await self.get_session(ctx, session_id)
        if listening.status != "OPEN":
            raise AppError(
                "SESSION_CLOSED",
                "Listening session is closed",
                409,
                "Open a new listening session before recording playback",
            )
        existing = (
            await self.session.execute(
                select(PlaybackEvent).where(
                    PlaybackEvent.user_id == ctx.user_id,
                    PlaybackEvent.client_event_id == token,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            return existing, False
        playability = await self.availability(
            ctx, track_id, release_id=release_id, track_version_id=track_version_id
        )
        self._playability_error(playability, require_audio=False)
        if playability.track_version_id is None:
            raise AppError("VERSION_NOT_READY", "Track is not playable", 409)
        event = PlaybackEvent(
            client_event_id=token,
            user_id=ctx.user_id,
            track_id=track_id,
            track_version_id=playability.track_version_id,
            session_id=session_id,
            started_at=started_at or self.clock.now(),
            duration_ms=duration_ms,
            completed=completed,
            region=region.strip()[:64] if region else None,
            eligible_hint=None,
            ignored=False,
            created_at=self.clock.now(),
        )
        try:
            async with self.session.begin_nested():
                self.session.add(event)
                await self.session.flush()
        except IntegrityError:
            replay = (
                await self.session.execute(
                    select(PlaybackEvent).where(
                        PlaybackEvent.user_id == ctx.user_id,
                        PlaybackEvent.client_event_id == token,
                    )
                )
            ).scalar_one_or_none()
            if replay is None:
                raise ConflictError("Conflicting playback ingest")
            return replay, False
        await self._emit(
            event_type=TRACK_PLAYED,
            aggregate_type="PlaybackEvent",
            aggregate_id=event.id,
            payload={
                "playback_event_id": str(event.id),
                "user_id": str(event.user_id),
                "track_id": str(event.track_id),
                "version_id": str(event.track_version_id),
                "session_id": str(event.session_id),
                "started_at": event.started_at.isoformat(),
                "duration_ms": event.duration_ms,
                "completed": event.completed,
                "device": listening.device,
                "region": event.region,
                "client_event_id": event.client_event_id,
                "eligible_hint": None,
            },
            ctx=ctx,
            organization_id=None,
        )
        return event, True

    async def ingest_batch(
        self,
        ctx: AuthContext,
        events: list[dict[str, Any]],
    ) -> list[tuple[PlaybackEvent, bool]]:
        results: list[tuple[PlaybackEvent, bool]] = []
        for item in events:
            row, created = await self.ingest_event(
                ctx,
                client_event_id=str(item["client_event_id"]),
                track_id=item["track_id"],
                session_id=item["session_id"],
                duration_ms=int(item["duration_ms"]),
                completed=bool(item.get("completed", False)),
                started_at=item.get("started_at"),
                region=item.get("region"),
                track_version_id=item.get("track_version_id"),
                release_id=item.get("release_id"),
            )
            results.append((row, created))
        return results

    async def mint_audio(
        self,
        ctx: AuthContext,
        track_id: UUID,
        *,
        release_id: UUID | None = None,
        track_version_id: UUID | None = None,
    ) -> SignedAudioUrl:
        playability = await self.availability(
            ctx, track_id, release_id=release_id, track_version_id=track_version_id
        )
        self._playability_error(playability, require_audio=True)
        await self._require_entitlement(ctx.user_id, track_id)
        if playability.media_asset_id is None or playability.track_version_id is None:
            raise AppError("TRACK_AUDIO_UNAVAILABLE", "Audio is not available", 409)
        asset = await self.session.get(MediaAsset, playability.media_asset_id)
        if asset is None or asset.deleted_at is not None:
            raise AppError("TRACK_AUDIO_UNAVAILABLE", "Audio is not available", 409)
        return self.delivery.mint(
            user_id=ctx.user_id,
            track_id=track_id,
            track_version_id=playability.track_version_id,
            media_asset_id=asset.id,
            object_key=asset.object_key,
            now=self.clock.now(),
        )

    async def load_media_bytes(self, token: str) -> tuple[bytes, str]:
        payload = self.delivery.parse_token(token)
        track_id = UUID(str(payload["tid"]))
        version_id = UUID(str(payload["vid"]))
        user_id = UUID(str(payload["sub"]))
        ctx = AuthContext(user_id=user_id, request_id="audio-delivery")
        playability = await self.availability(ctx, track_id, track_version_id=version_id)
        self._playability_error(playability, require_audio=True)
        await self._require_entitlement(user_id, track_id)
        if playability.media_asset_id is None:
            raise AppError("TRACK_AUDIO_UNAVAILABLE", "Audio is not available", 409)
        asset = await self.session.get(MediaAsset, playability.media_asset_id)
        if asset is None or asset.deleted_at is not None:
            raise AppError("TRACK_AUDIO_UNAVAILABLE", "Audio is not available", 409)
        data = await self.delivery.read_bytes(asset.object_key)
        return data, asset.mime

    async def list_playable_tracks(
        self,
        ctx: AuthContext,
        *,
        limit: int | None = None,
        cursor: str | None = None,
    ) -> tuple[list[tuple[Track, Playability]], str | None]:
        size = clamp_limit(limit)
        stmt: Select[tuple[Track]] = (
            select(Track)
            .where(Track.deleted_at.is_(None), Track.status == "RELEASED")
            .order_by(Track.created_at.desc(), Track.id.desc())
        )
        if cursor:
            data = decode_cursor(cursor)
            stmt = stmt.where(
                (Track.created_at < datetime.fromisoformat(data["t"]))
                | ((Track.created_at == datetime.fromisoformat(data["t"])) & (Track.id < UUID(data["id"])))
            )
        rows = list((await self.session.execute(stmt.limit(size + 1))).scalars())
        items: list[tuple[Track, Playability]] = []
        for track in rows[:size]:
            playability = await self.availability(ctx, track.id)
            if playability.catalog_playable:
                items.append((track, playability))
        next_cursor = None
        if len(rows) > size:
            last = rows[size - 1]
            next_cursor = encode_cursor(last.created_at.isoformat(), last.id)
        return items, next_cursor

    async def release_track_playability(
        self,
        ctx: AuthContext,
        release_id: UUID,
    ) -> list[tuple[ReleaseTrack, Playability]]:
        stmt = (
            select(ReleaseTrack)
            .where(ReleaseTrack.release_id == release_id)
            .order_by(ReleaseTrack.position.asc())
        )
        rows = list((await self.session.execute(stmt)).scalars())
        out: list[tuple[ReleaseTrack, Playability]] = []
        for row in rows:
            playability = await self.availability(ctx, row.track_id, release_id=release_id)
            out.append((row, playability))
        return out

    async def add_library_item(
        self,
        ctx: AuthContext,
        *,
        item_type: str,
        item_id: UUID,
        kind: str,
    ) -> LibraryItem:
        if item_type not in LIBRARY_ITEM_TYPES:
            raise AppError("VALIDATION_ERROR", "Invalid library item_type", 422)
        if kind not in LIBRARY_KINDS_WRITABLE:
            raise AppError(
                "VALIDATION_ERROR",
                "Library kind is not writable in this phase",
                422,
                "PURCHASE_REF is reserved for Phase 09",
            )
        existing = (
            await self.session.execute(
                select(LibraryItem).where(
                    LibraryItem.user_id == ctx.user_id,
                    LibraryItem.item_type == item_type,
                    LibraryItem.item_id == item_id,
                    LibraryItem.kind == kind,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            return existing
        row = LibraryItem(
            user_id=ctx.user_id,
            item_type=item_type,
            item_id=item_id,
            kind=kind,
            created_at=self.clock.now(),
        )
        self.session.add(row)
        await self.session.flush()
        if item_type == "track" and kind == "LIKE":
            await self._emit(
                event_type=TRACK_LIKED,
                aggregate_type="LibraryItem",
                aggregate_id=row.id,
                payload={"track_id": str(item_id), "user_id": str(ctx.user_id), "kind": kind},
                ctx=ctx,
                organization_id=None,
            )
            await self.audit.record_from_auth(
                ctx,
                action="library.liked",
                entity_type="LibraryItem",
                entity_id=row.id,
                new_state={"item_type": item_type, "item_id": str(item_id), "kind": kind},
                organization_id=None,
            )
        return row

    async def list_library(
        self,
        ctx: AuthContext,
        *,
        limit: int | None = None,
        cursor: str | None = None,
    ) -> tuple[list[LibraryItem], str | None]:
        size = clamp_limit(limit)
        stmt = (
            select(LibraryItem)
            .where(LibraryItem.user_id == ctx.user_id)
            .order_by(LibraryItem.created_at.desc(), LibraryItem.id.desc())
        )
        if cursor:
            data = decode_cursor(cursor)
            stmt = stmt.where(
                (LibraryItem.created_at < datetime.fromisoformat(data["t"]))
                | (
                    (LibraryItem.created_at == datetime.fromisoformat(data["t"]))
                    & (LibraryItem.id < UUID(data["id"]))
                )
            )
        rows = list((await self.session.execute(stmt.limit(size + 1))).scalars())
        next_cursor = None
        if len(rows) > size:
            last = rows[size - 1]
            next_cursor = encode_cursor(last.created_at.isoformat(), last.id)
        return rows[:size], next_cursor

    async def delete_library_item(self, ctx: AuthContext, item_id: UUID) -> None:
        row = await self.session.get(LibraryItem, item_id)
        if row is None or row.user_id != ctx.user_id:
            raise NotFoundError("Library item not found")
        await self.session.delete(row)
        await self.session.flush()

    async def create_playlist(
        self,
        ctx: AuthContext,
        *,
        title: str,
        kind: str = "USER",
    ) -> Playlist:
        if kind not in PLAYLIST_KINDS:
            raise AppError("VALIDATION_ERROR", "Invalid playlist kind", 422)
        name = title.strip()
        if not name:
            raise AppError("VALIDATION_ERROR", "Title is required", 422)
        if kind == "EDITORIAL":
            try:
                await self.authz.authorize(ctx.user_id, "music.write")
            except ForbiddenError as exc:
                raise ForbiddenError("Missing permission music.write") from exc
            status = "DRAFT"
            owner = None
        else:
            status = "ACTIVE"
            owner = ctx.user_id
        row = Playlist(
            owner_user_id=owner,
            kind=kind,
            status=status,
            title=name,
            created_by=ctx.user_id,
        )
        self.session.add(row)
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx,
            action="playlist.created",
            entity_type="Playlist",
            entity_id=row.id,
            new_state={"kind": row.kind, "status": row.status, "title": row.title},
            organization_id=None,
        )
        return row

    async def _get_playlist_row(self, playlist_id: UUID) -> Playlist:
        row = await self.session.get(Playlist, playlist_id)
        if row is None:
            raise NotFoundError("Playlist not found")
        return row

    async def get_playlist(self, ctx: AuthContext | None, playlist_id: UUID) -> Playlist:
        row = await self._get_playlist_row(playlist_id)
        if row.kind == "EDITORIAL" and row.status == "PUBLISHED":
            return row
        if ctx is None:
            raise UnauthorizedError()
        if row.kind == "USER" and row.owner_user_id == ctx.user_id:
            return row
        if row.kind == "EDITORIAL":
            allowed = False
            for perm in ("music.write", "music.approve"):
                try:
                    await self.authz.authorize(ctx.user_id, perm)
                    allowed = True
                    break
                except ForbiddenError:
                    continue
            if allowed:
                return row
        raise NotFoundError("Playlist not found")

    async def list_playlists(
        self,
        ctx: AuthContext,
        *,
        limit: int | None = None,
        cursor: str | None = None,
    ) -> tuple[list[Playlist], str | None]:
        size = clamp_limit(limit)
        stmt = (
            select(Playlist)
            .where(
                (Playlist.owner_user_id == ctx.user_id)
                | ((Playlist.kind == "EDITORIAL") & (Playlist.status == "PUBLISHED"))
            )
            .order_by(Playlist.created_at.desc(), Playlist.id.desc())
        )
        if cursor:
            data = decode_cursor(cursor)
            stmt = stmt.where(
                (Playlist.created_at < datetime.fromisoformat(data["t"]))
                | ((Playlist.created_at == datetime.fromisoformat(data["t"])) & (Playlist.id < UUID(data["id"])))
            )
        rows = list((await self.session.execute(stmt.limit(size + 1))).scalars())
        next_cursor = None
        if len(rows) > size:
            last = rows[size - 1]
            next_cursor = encode_cursor(last.created_at.isoformat(), last.id)
        return rows[:size], next_cursor

    async def transition_playlist(
        self,
        ctx: AuthContext,
        playlist_id: UUID,
        *,
        action: str,
        expected_version: int | None = None,
    ) -> Playlist:
        row = await self.get_playlist(ctx, playlist_id)
        if row.kind == "USER" and row.owner_user_id != ctx.user_id:
            raise NotFoundError("Playlist not found")
        if row.kind == "EDITORIAL":
            perm = permission_for_editorial_action(action)
            try:
                await self.authz.authorize(ctx.user_id, perm)
            except ForbiddenError as exc:
                raise ForbiddenError(f"Missing permission {perm}") from exc
        if expected_version is not None and row.version != expected_version:
            raise ConflictError("The resource was updated concurrently")
        target = playlist_target_for_action(row.kind, action)
        playlist_transition_action(row.kind, row.status, target)
        previous = row.status
        row.status = target
        row.updated_by = ctx.user_id
        await self._flush_versioned()
        await self.audit.record_from_auth(
            ctx,
            action=f"playlist.{action}",
            entity_type="Playlist",
            entity_id=row.id,
            previous_state={"status": previous},
            new_state={"status": row.status},
            organization_id=None,
        )
        return row

    async def add_playlist_item(
        self,
        ctx: AuthContext,
        playlist_id: UUID,
        *,
        track_id: UUID,
        position: int,
    ) -> PlaylistItem:
        playlist = await self.get_playlist(ctx, playlist_id)
        if playlist.kind == "USER" and playlist.owner_user_id != ctx.user_id:
            raise NotFoundError("Playlist not found")
        if playlist.kind == "EDITORIAL":
            try:
                await self.authz.authorize(ctx.user_id, "music.write")
            except ForbiddenError as exc:
                raise ForbiddenError("Missing permission music.write") from exc
        if position < 1:
            raise AppError("VALIDATION_ERROR", "position must be >= 1", 422)
        track = await self.session.get(Track, track_id)
        if track is None or track.deleted_at is not None:
            raise AppError("VALIDATION_ERROR", "Track was not found", 422)
        item = PlaylistItem(
            playlist_id=playlist_id,
            track_id=track_id,
            position=position,
            created_by=ctx.user_id,
        )
        self.session.add(item)
        try:
            await self.session.flush()
        except IntegrityError as exc:
            raise ConflictError("Playlist item position or track already exists") from exc
        return item

    async def list_playlist_items(self, ctx: AuthContext | None, playlist_id: UUID) -> list[PlaylistItem]:
        await self.get_playlist(ctx, playlist_id)
        stmt = (
            select(PlaylistItem)
            .where(PlaylistItem.playlist_id == playlist_id)
            .order_by(PlaylistItem.position.asc())
        )
        return list((await self.session.execute(stmt)).scalars())

    async def delete_playlist_item(self, ctx: AuthContext, playlist_id: UUID, track_id: UUID) -> None:
        playlist = await self.get_playlist(ctx, playlist_id)
        if playlist.kind == "USER" and playlist.owner_user_id != ctx.user_id:
            raise NotFoundError("Playlist not found")
        if playlist.kind == "EDITORIAL":
            try:
                await self.authz.authorize(ctx.user_id, "music.write")
            except ForbiddenError as exc:
                raise ForbiddenError("Missing permission music.write") from exc
        item = await self.session.get(PlaylistItem, (playlist_id, track_id))
        if item is None:
            raise NotFoundError("Playlist item not found")
        await self.session.delete(item)
        await self.session.flush()

    async def listening_history(
        self,
        ctx: AuthContext,
        *,
        limit: int | None = None,
        cursor: str | None = None,
    ) -> tuple[list[PlaybackEvent], str | None]:
        size = clamp_limit(limit)
        stmt = (
            select(PlaybackEvent)
            .where(PlaybackEvent.user_id == ctx.user_id, PlaybackEvent.ignored.is_(False))
            .order_by(PlaybackEvent.started_at.desc(), PlaybackEvent.id.desc())
        )
        if cursor:
            data = decode_cursor(cursor)
            stmt = stmt.where(
                (PlaybackEvent.started_at < datetime.fromisoformat(data["t"]))
                | (
                    (PlaybackEvent.started_at == datetime.fromisoformat(data["t"]))
                    & (PlaybackEvent.id < UUID(data["id"]))
                )
            )
        rows = list((await self.session.execute(stmt.limit(size + 1))).scalars())
        next_cursor = None
        if len(rows) > size:
            last = rows[size - 1]
            next_cursor = encode_cursor(last.started_at.isoformat(), last.id)
        return rows[:size], next_cursor

    async def _can_read_artist_aggregates(self, ctx: AuthContext, artist: Artist) -> bool:
        if artist.claimed_user_id == ctx.user_id:
            return True
        try:
            await self.authz.authorize(
                ctx.user_id,
                "analytics.read",
                resource_type="artist",
                resource_id=artist.id,
                owner_user_id=artist.claimed_user_id,
                scope_organization_id=artist.primary_org_id,
            )
            return True
        except ForbiddenError:
            return False

    async def artist_play_aggregates(self, ctx: AuthContext, artist_id: UUID) -> dict[str, Any]:
        artist = await self.session.get(Artist, artist_id)
        if artist is None or artist.deleted_at is not None:
            raise NotFoundError("Artist not found")
        if not await self._can_read_artist_aggregates(ctx, artist):
            raise NotFoundError("Artist not found")
        stmt = (
            select(
                PlaybackEvent.track_id,
                Track.title,
                func.count(PlaybackEvent.id),
                func.count(func.distinct(PlaybackEvent.user_id)),
                func.coalesce(func.sum(PlaybackEvent.duration_ms), 0),
                func.coalesce(
                    func.sum(case((PlaybackEvent.completed.is_(True), 1), else_=0)),
                    0,
                ),
            )
            .join(Track, Track.id == PlaybackEvent.track_id)
            .where(
                Track.primary_artist_id == artist_id,
                Track.deleted_at.is_(None),
                PlaybackEvent.ignored.is_(False),
            )
            .group_by(PlaybackEvent.track_id, Track.title)
            .order_by(func.count(PlaybackEvent.id).desc())
        )
        rows = (await self.session.execute(stmt)).all()
        tracks = []
        for track_id, title, plays, uniques, duration, completed in rows:
            play_count = int(plays)
            completed_count = int(completed or 0)
            tracks.append(
                {
                    "track_id": track_id,
                    "title": title,
                    "play_count": play_count,
                    "unique_listener_count": int(uniques),
                    "total_duration_ms": int(duration),
                    "completed_count": completed_count,
                    "skip_count": play_count - completed_count,
                }
            )
        return {
            "artist_id": artist_id,
            "label": "all plays",
            "eligibility": "not_computed",
            "tracks": tracks,
        }


async def handle_user_suspended(event: DomainEvent, session: AsyncSession) -> None:
    user_id = event.aggregate_id
    raw = event.payload.get("user_id")
    if raw:
        user_id = UUID(str(raw))
    service = StreamingService(session)
    await service.close_sessions_for_user(user_id)


def register_streaming_handlers() -> None:
    from cornerroom.infra.outbox_dispatch import register_handler

    register_handler(USER_SUSPENDED, handle_user_suspended)
