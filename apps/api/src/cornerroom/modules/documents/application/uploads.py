"""Resumable upload intents for audio masters and cover art (AUDIO_PHASE_1_DESIGN section 6).

Files arrive in numbered parts through the API, each hashed and size-checked, so memory stays
bounded and an interrupted upload resumes from the parts already received. Completing assembles
the parts into a write-once object, verifies the whole file, and hands it to its target (a track
version or a release cover). Bytes are QUARANTINED until the media checks accept them (Phase 3).
"""

from __future__ import annotations

import hashlib
import math
from collections.abc import AsyncIterable, AsyncIterator
from dataclasses import dataclass
from datetime import timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, NotFoundError
from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.infra.settings import Settings
from cornerroom.infra.storage import (
    ObjectStorage,
    assert_storage_class_allowed,
    get_storage,
    new_asset_id,
)
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import MEDIA_UPLOAD_COMPLETED, DomainEvent
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.documents.domain.models import MediaAsset, UploadIntent, UploadPart

# Artwork may also go to an event (OD-06): same checks, attached to the event when accepted.
PURPOSE_TARGETS = {"AUDIO_MASTER": {"track_version"}, "COVER_ART": {"release_cover", "event_cover"}}
PURPOSE_CLASS = {"AUDIO_MASTER": "catalog_audio", "COVER_ART": "catalog_art"}
SHA256_HEX = frozenset("0123456789abcdef")


@dataclass(slots=True)
class TargetInfo:
    organization_id: UUID | None
    profile_type: str | None
    profile_id: UUID | None


def _clean_filename(name: str) -> str:
    base = name.replace("\\", "/").split("/")[-1].strip()
    cleaned = "".join(ch for ch in base if ch.isprintable())[:255]
    return cleaned or "upload"


def _valid_sha(value: str | None) -> bool:
    return value is not None and len(value) == 64 and set(value) <= SHA256_HEX


def part_key(intent_id: UUID, number: int) -> str:
    return f"_upload_parts/{intent_id}/{number:05d}"


class UploadService:
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

    # --- targets -------------------------------------------------------------------------

    async def _authorize_target(self, ctx: AuthContext, target_type: str, target_id: UUID) -> TargetInfo:
        from cornerroom.modules.music.application.service import MusicService

        music = MusicService(self.session, settings=self.settings)
        if target_type == "track_version":
            track, _version = await music.authorize_master_upload(ctx, target_id)
            kind, profile = music.profile_of(track)
            return TargetInfo(track.primary_org_id, kind, profile)
        if target_type == "release_cover":
            release = await music.authorize_cover_upload(ctx, target_id)
            kind, profile = music.profile_of(release)
            return TargetInfo(release.primary_org_id, kind, profile)
        if target_type == "event_cover":
            from cornerroom.modules.events.application.service import EventService

            event = await EventService(self.session, clock=self.clock).authorize_cover_upload(ctx, target_id)
            return TargetInfo(event.organization_id, None, None)
        raise AppError("VALIDATION_ERROR", "Unknown upload target", 422)

    def _max_bytes(self, purpose: str) -> int:
        if purpose == "AUDIO_MASTER":
            return self.settings.media_master_max_bytes
        return self.settings.media_cover_max_bytes

    # --- intents -------------------------------------------------------------------------

    async def create_intent(
        self,
        ctx: AuthContext,
        *,
        purpose: str,
        target_type: str,
        target_id: UUID,
        filename: str,
        byte_size: int,
        sha256: str | None = None,
    ) -> tuple[UploadIntent, bool]:
        """Open (or resume) an upload. Returns (intent, resumed)."""
        if target_type not in PURPOSE_TARGETS.get(purpose, set()):
            raise AppError("VALIDATION_ERROR", "This file type cannot go to that target", 422)
        if byte_size <= 0:
            raise AppError("VALIDATION_ERROR", "The file is empty", 422, extras={"finding": "ZERO_LENGTH"})
        if byte_size > self._max_bytes(purpose):
            raise AppError(
                "UPLOAD_TOO_LARGE",
                "File too large",
                422,
                f"The limit is {self._max_bytes(purpose)} bytes",
                extras={"max_bytes": self._max_bytes(purpose)},
            )
        if sha256 is not None:
            sha256 = sha256.lower()
            if not _valid_sha(sha256):
                raise AppError("VALIDATION_ERROR", "sha256 must be 64 hex characters", 422)
        storage_class = PURPOSE_CLASS[purpose]
        assert_storage_class_allowed(storage_class, self.settings)
        target = await self._authorize_target(ctx, target_type, target_id)
        clean_name = _clean_filename(filename)
        now = self.clock.now()

        existing = (
            await self.session.execute(
                select(UploadIntent).where(
                    UploadIntent.owner_user_id == ctx.user_id,
                    UploadIntent.target_type == target_type,
                    UploadIntent.target_id == target_id,
                    UploadIntent.status == "OPEN",
                )
            )
        ).scalars().all()
        for intent in existing:
            same_file = (
                intent.declared_byte_size == byte_size
                and intent.filename == clean_name
                and intent.declared_sha256 == sha256
                and intent.expires_at > now
            )
            if same_file:
                return intent, True
            await self._cancel(intent, actor_id=ctx.user_id, reason="REPLACED")

        open_count = (
            await self.session.execute(
                select(func.count())
                .select_from(UploadIntent)
                .where(UploadIntent.owner_user_id == ctx.user_id, UploadIntent.status == "OPEN")
            )
        ).scalar_one()
        if open_count >= self.settings.upload_max_open_intents:
            raise AppError(
                "TOO_MANY_UPLOADS",
                "Too many uploads in progress",
                429,
                "Finish or cancel an upload before starting another",
            )

        asset_id = new_asset_id()
        part_size = self.settings.upload_part_size_bytes
        asset = MediaAsset(
            id=asset_id,
            storage_class=storage_class,
            bucket=self.storage.bucket,
            object_key=f"{storage_class}/{'masters' if purpose == 'AUDIO_MASTER' else 'covers'}/{asset_id}/original",
            mime="application/octet-stream",
            byte_size=byte_size,
            sha256="",
            status="PENDING",
            scan_status="PENDING",
            purpose=purpose,
            uploaded_by=ctx.user_id,
            on_behalf_profile_type=target.profile_type,
            on_behalf_profile_id=target.profile_id,
            immutable=True,
            created_by=ctx.user_id,
        )
        self.session.add(asset)
        await self.session.flush()
        intent = UploadIntent(
            media_asset_id=asset_id,
            purpose=purpose,
            owner_user_id=ctx.user_id,
            target_type=target_type,
            target_id=target_id,
            filename=clean_name,
            declared_byte_size=byte_size,
            declared_sha256=sha256,
            part_size=part_size,
            part_count=max(1, math.ceil(byte_size / part_size)),
            status="OPEN",
            expires_at=now + timedelta(seconds=self.settings.upload_intent_ttl_seconds),
        )
        self.session.add(intent)
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx,
            action="upload.intent_created",
            entity_type="UploadIntent",
            entity_id=intent.id,
            new_state={
                "purpose": purpose,
                "target_type": target_type,
                "target_id": str(target_id),
                "byte_size": byte_size,
                "media_asset_id": str(asset_id),
            },
            organization_id=target.organization_id,
        )
        return intent, False

    async def _owned_intent(self, ctx: AuthContext, intent_id: UUID, *, lock: bool = False) -> UploadIntent:
        stmt = select(UploadIntent).where(UploadIntent.id == intent_id)
        if lock:
            stmt = stmt.with_for_update()
        intent = (await self.session.execute(stmt)).scalar_one_or_none()
        if intent is None or intent.owner_user_id != ctx.user_id:
            raise NotFoundError("Upload not found")
        return intent

    async def _expire_if_due(self, intent: UploadIntent) -> None:
        if intent.status == "OPEN" and intent.expires_at <= self.clock.now():
            await self._expire(intent)
        if intent.status == "EXPIRED":
            raise AppError("INTENT_EXPIRED", "This upload expired", 410, "Start the upload again")

    async def get_intent(self, ctx: AuthContext, intent_id: UUID) -> tuple[UploadIntent, list[int]]:
        intent = await self._owned_intent(ctx, intent_id)
        received = await self._received_parts(intent.id)
        return intent, received

    async def find_open(self, ctx: AuthContext, target_type: str, target_id: UUID) -> tuple[UploadIntent, list[int]] | None:
        intent = (
            await self.session.execute(
                select(UploadIntent)
                .where(
                    UploadIntent.owner_user_id == ctx.user_id,
                    UploadIntent.target_type == target_type,
                    UploadIntent.target_id == target_id,
                    UploadIntent.status == "OPEN",
                    UploadIntent.expires_at > self.clock.now(),
                )
                .order_by(UploadIntent.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if intent is None:
            return None
        return intent, await self._received_parts(intent.id)

    async def _received_parts(self, intent_id: UUID) -> list[int]:
        rows = await self.session.execute(
            select(UploadPart.part_number).where(UploadPart.intent_id == intent_id).order_by(UploadPart.part_number)
        )
        return list(rows.scalars().all())

    def _expected_part_size(self, intent: UploadIntent, number: int) -> int:
        if number < intent.part_count:
            return intent.part_size
        return intent.declared_byte_size - intent.part_size * (intent.part_count - 1)

    async def put_part(
        self,
        ctx: AuthContext,
        intent_id: UUID,
        number: int,
        body: AsyncIterable[bytes],
        part_sha256: str | None,
    ) -> list[int]:
        intent = await self._owned_intent(ctx, intent_id)
        await self._expire_if_due(intent)
        if intent.status != "OPEN":
            raise AppError("INVALID_TRANSITION", "This upload is no longer open", 409)
        if number < 1 or number > intent.part_count:
            raise AppError("VALIDATION_ERROR", "Part number out of range", 422)
        part_sha256 = (part_sha256 or "").lower()
        if not _valid_sha(part_sha256):
            raise AppError("VALIDATION_ERROR", "X-Part-SHA256 header is required", 422)
        expected = self._expected_part_size(intent, number)

        existing = await self.session.get(UploadPart, (intent.id, number))
        if existing is not None:
            digest, size = await _hash_bounded(body, expected)
            if digest == existing.sha256 and size == existing.byte_size:
                return await self._received_parts(intent.id)
            raise AppError("PART_CONFLICT", "This part was already received with different bytes", 409)

        key = part_key(intent.id, number)
        await self.storage.delete(key)  # a partial file from an interrupted attempt has no row
        stored = await self.storage.write_once(
            object_key=key, chunks=_limited(body, expected), mime="application/octet-stream"
        )
        if stored.byte_size != expected:
            await self.storage.delete(key)
            raise AppError(
                "SIZE_MISMATCH", "Part size is wrong", 422, extras={"expected": expected, "received": stored.byte_size}
            )
        if stored.sha256 != part_sha256:
            await self.storage.delete(key)
            raise AppError("CHECKSUM_MISMATCH", "Part checksum does not match", 422)
        try:
            async with self.session.begin_nested():
                self.session.add(
                    UploadPart(intent_id=intent.id, part_number=number, byte_size=stored.byte_size, sha256=stored.sha256)
                )
                await self.session.flush()
        except IntegrityError as exc:
            raise AppError("PART_CONFLICT", "This part is being uploaded twice at once", 409) from exc
        return await self._received_parts(intent.id)

    async def complete(self, ctx: AuthContext, intent_id: UUID) -> tuple[UploadIntent, MediaAsset, str | None]:
        """Assemble and verify. Returns (intent, asset, problem); on a problem the rejection is
        recorded and the caller commits it before answering 422."""
        intent = await self._owned_intent(ctx, intent_id, lock=True)
        asset = await self.session.get(MediaAsset, intent.media_asset_id)
        assert asset is not None
        if intent.status == "COMPLETED":
            return intent, asset, None
        await self._expire_if_due(intent)
        if intent.status != "OPEN":
            raise AppError("INVALID_TRANSITION", "This upload is no longer open", 409)
        received = await self._received_parts(intent.id)
        missing = [n for n in range(1, intent.part_count + 1) if n not in set(received)]
        if missing:
            raise AppError(
                "PARTS_MISSING", "Some parts have not arrived yet", 409, extras={"missing_parts": missing[:50]}
            )
        # Re-authorize: the caller may have lost access since the upload started.
        target = await self._authorize_target(ctx, intent.target_type, intent.target_id)

        stored = await self.storage.write_once(
            object_key=asset.object_key,
            chunks=self._assemble(intent),
            mime="application/octet-stream",
        )
        problem: str | None = None
        if stored.byte_size != intent.declared_byte_size:
            problem = "SIZE_MISMATCH"
        elif intent.declared_sha256 and stored.sha256 != intent.declared_sha256:
            problem = "CHECKSUM_MISMATCH"
        if problem is not None:
            await self.storage.delete(asset.object_key)
            asset.status = "REJECTED"
            asset.scan_status = problem
            intent.status = "CANCELLED"
            await self._delete_parts(intent)
            await self.session.flush()
            await self.audit.record_from_auth(
                ctx,
                action="upload.rejected",
                entity_type="MediaAsset",
                entity_id=asset.id,
                new_state={"status": "REJECTED", "reason": problem},
                organization_id=target.organization_id,
            )
            return intent, asset, problem

        asset.byte_size = stored.byte_size
        asset.sha256 = stored.sha256
        asset.bucket = stored.bucket
        asset.status = "QUARANTINED"
        asset.updated_by = ctx.user_id
        intent.status = "COMPLETED"
        intent.completed_at = self.clock.now()
        await self.session.flush()
        await self._delete_parts(intent)
        if intent.target_type == "track_version":
            from cornerroom.modules.music.application.service import MusicService

            await MusicService(self.session, settings=self.settings).attach_uploaded_master(
                ctx, intent.target_id, asset.id
            )
        # Checks run next, from a durable job written in this same transaction.
        from cornerroom.modules.documents.application.media_jobs import MediaJobService

        await MediaJobService(self.session, self.settings, storage=self.storage).enqueue_inspection(asset.id)
        await enqueue_outbox(
            self.session,
            DomainEvent(
                event_type=MEDIA_UPLOAD_COMPLETED,
                producer="documents",
                aggregate_type="MediaAsset",
                aggregate_id=asset.id,
                payload={
                    "media_asset_id": str(asset.id),
                    "purpose": asset.purpose,
                    "target_type": intent.target_type,
                    "target_id": str(intent.target_id),
                },
                occurred_at=self.clock.now(),
                actor_id=ctx.user_id,
                organization_id=target.organization_id,
                correlation_id=ctx.request_id,
            ),
        )
        await self.audit.record_from_auth(
            ctx,
            action="upload.completed",
            entity_type="MediaAsset",
            entity_id=asset.id,
            new_state={"status": asset.status, "byte_size": asset.byte_size, "sha256": asset.sha256},
            organization_id=target.organization_id,
        )
        return intent, asset, None

    async def _assemble(self, intent: UploadIntent) -> AsyncIterator[bytes]:
        for number in range(1, intent.part_count + 1):
            key = part_key(intent.id, number)
            size = await self.storage.stat(key)
            if size is None:
                raise AppError("PARTS_MISSING", "A stored part is missing; upload it again", 409, extras={"missing_parts": [number]})
            async for chunk in self.storage.read_range(key, 0, size - 1):
                yield chunk

    async def _delete_parts(self, intent: UploadIntent) -> None:
        for number in range(1, intent.part_count + 1):
            await self.storage.delete(part_key(intent.id, number))
        rows = (await self.session.execute(select(UploadPart).where(UploadPart.intent_id == intent.id))).scalars().all()
        for row in rows:
            await self.session.delete(row)
        await self.session.flush()

    async def cancel(self, ctx: AuthContext, intent_id: UUID) -> UploadIntent:
        intent = await self._owned_intent(ctx, intent_id, lock=True)
        if intent.status in {"CANCELLED", "EXPIRED"}:
            return intent
        if intent.status != "OPEN":
            raise AppError("INVALID_TRANSITION", "A finished upload cannot be cancelled", 409)
        await self._cancel(intent, actor_id=ctx.user_id, reason="CANCELLED")
        await self.audit.record_from_auth(
            ctx,
            action="upload.cancelled",
            entity_type="UploadIntent",
            entity_id=intent.id,
            new_state={"status": intent.status},
        )
        return intent

    async def _cancel(self, intent: UploadIntent, *, actor_id: UUID | None, reason: str) -> None:
        intent.status = "CANCELLED"
        asset = await self.session.get(MediaAsset, intent.media_asset_id)
        if asset is not None and asset.status == "PENDING":
            asset.status = "REJECTED"
            asset.scan_status = reason
            asset.updated_by = actor_id
        await self._delete_parts(intent)

    async def _expire(self, intent: UploadIntent) -> None:
        intent.status = "EXPIRED"
        asset = await self.session.get(MediaAsset, intent.media_asset_id)
        if asset is not None and asset.status == "PENDING":
            asset.status = "REJECTED"
            asset.scan_status = "EXPIRED"
        await self._delete_parts(intent)
        await self.audit.record(
            action="upload.expired",
            entity_type="UploadIntent",
            entity_id=intent.id,
            actor_id="system:upload-expiry",
            actor_type="system",
            new_state={"status": "EXPIRED"},
        )

    async def expire_due(self, *, batch: int = 100) -> int:
        rows = (
            await self.session.execute(
                select(UploadIntent)
                .where(UploadIntent.status == "OPEN", UploadIntent.expires_at <= self.clock.now())
                .order_by(UploadIntent.expires_at)
                .limit(batch)
                .with_for_update(skip_locked=True)
            )
        ).scalars().all()
        for intent in rows:
            await self._expire(intent)
        return len(rows)


async def _limited(body: AsyncIterable[bytes], limit: int) -> AsyncIterator[bytes]:
    """Pass bytes through, refusing more than `limit` (one byte over is enough to fail the size check)."""
    seen = 0
    async for chunk in body:
        if not chunk:
            continue
        room = limit + 1 - seen
        if room <= 0:
            break
        piece = chunk[:room]
        seen += len(piece)
        yield piece
        if seen > limit:
            break


async def _hash_bounded(body: AsyncIterable[bytes], limit: int) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    async for chunk in _limited(body, limit):
        digest.update(chunk)
        size += len(chunk)
    return digest.hexdigest(), size


def intent_view(intent: UploadIntent, received: list[int]) -> dict[str, Any]:
    return {
        "id": intent.id,
        "media_asset_id": intent.media_asset_id,
        "purpose": intent.purpose,
        "target_type": intent.target_type,
        "target_id": intent.target_id,
        "filename": intent.filename,
        "byte_size": intent.declared_byte_size,
        "part_size": intent.part_size,
        "part_count": intent.part_count,
        "parts_received": received,
        "status": intent.status,
        "expires_at": intent.expires_at,
        "mode": "api_parts",
    }
