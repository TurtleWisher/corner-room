"""Official artwork: music covers and event posters (OD-05, OD-06; owner 2026-10-23: the official
image always shows when there is one; the letter cube is only the fallback). Owned by documents,
which holds the assets; music and events decide which asset is a release's cover or an event's.

Images are served at a few fixed square web sizes made from the accepted original and kept in
storage next to it. Public reads resolve artwork only for released music and published events.
Anything else (Studio, staff review, unpublished events) leaves only through short-lived signed
links, because an <img> request carries no session.
"""

from __future__ import annotations

import asyncio
import io
from datetime import UTC, datetime, timedelta
from uuid import UUID

import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import NotFoundError, UnauthorizedError
from cornerroom.infra.settings import Settings, get_settings
from cornerroom.infra.storage import ObjectStorage, get_storage
from cornerroom.modules.documents.domain.models import MediaAsset, MediaFinding, MediaInspection, UploadIntent
from cornerroom.modules.events.domain.lifecycle import PUBLIC_EVENT_STATUSES
from cornerroom.modules.events.domain.models import Event
from cornerroom.modules.music.domain.models import Release, ReleaseTrack, Track

COVER_SIZES = (160, 480, 1200)
COVER_TOKEN_USE = "cover"
COVER_LINK_SECONDS = 3600
USABLE_ASSET_STATUSES = frozenset({"ACCEPTED", "READY"})
PUBLIC_STATUS = "RELEASED"


def _resize(original: bytes, size: int) -> bytes:
    from PIL import Image

    with Image.open(io.BytesIO(original)) as image:
        image = image.convert("RGB")
        image.thumbnail((size, size), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        image.save(out, format="JPEG", quality=86, optimize=True, progressive=True)
        return out.getvalue()


class CoverService:
    def __init__(self, session: AsyncSession, settings: Settings | None = None, storage: ObjectStorage | None = None) -> None:
        self.session = session
        self.settings = settings or get_settings()
        self.storage = storage or get_storage(self.settings)

    # --- which cover ------------------------------------------------------------------------

    async def public_release_cover(self, release_id: UUID) -> UUID | None:
        release = await self.session.get(Release, release_id)
        if release is None or release.deleted_at is not None or release.status != PUBLIC_STATUS:
            return None
        return release.cover_asset_id

    async def public_track_cover(self, track_id: UUID) -> UUID | None:
        """A released song shows the cover of the first released release it is on."""
        track = await self.session.get(Track, track_id)
        if track is None or track.deleted_at is not None or track.status != PUBLIC_STATUS:
            return None
        return (
            await self.session.execute(
                select(Release.cover_asset_id)
                .join(ReleaseTrack, ReleaseTrack.release_id == Release.id)
                .where(
                    ReleaseTrack.track_id == track_id,
                    Release.status == PUBLIC_STATUS,
                    Release.deleted_at.is_(None),
                    Release.cover_asset_id.is_not(None),
                )
                .order_by(Release.release_at.asc().nulls_last(), Release.created_at.asc())
                .limit(1)
            )
        ).scalar_one_or_none()

    async def public_event_cover(self, event_id: UUID) -> UUID | None:
        """A published event's poster (same visibility as the public event page)."""
        event = await self.session.get(Event, event_id)
        if event is None or event.deleted_at is not None or event.published_at is None or event.status not in PUBLIC_EVENT_STATUSES:
            return None
        return event.cover_asset_id

    # --- signed links for unreleased covers ----------------------------------------------------

    def signed_path(self, asset_id: UUID, size: int = 480, *, now: datetime | None = None) -> str:
        issued = now or datetime.now(UTC)
        token = jwt.encode(
            {
                "iss": self.settings.jwt_issuer,
                "aid": str(asset_id),
                "iat": int(issued.timestamp()),
                "exp": int((issued + timedelta(seconds=COVER_LINK_SECONDS)).timestamp()),
                "token_use": COVER_TOKEN_USE,
            },
            self.settings.media_secret,
            algorithm="HS256",
        )
        return f"/api/v1/covers/signed/{token}/{size}"

    def asset_from_token(self, token: str) -> UUID:
        try:
            payload = jwt.decode(token, self.settings.media_secret, algorithms=["HS256"], issuer=self.settings.jwt_issuer)
        except jwt.PyJWTError as exc:
            raise UnauthorizedError("Invalid or expired cover link") from exc
        if payload.get("token_use") != COVER_TOKEN_USE:
            raise UnauthorizedError("Invalid token type")
        return UUID(payload["aid"])

    # --- bytes -------------------------------------------------------------------------------

    async def image(self, asset_id: UUID, size: int) -> bytes:
        """A JPEG of the accepted cover at `size` px (made once, then kept in storage)."""
        if size not in COVER_SIZES:
            raise NotFoundError("Cover not found")
        asset = await self.session.get(MediaAsset, asset_id)
        if asset is None or asset.deleted_at is not None or asset.purpose != "COVER_ART" or asset.status not in USABLE_ASSET_STATUSES:
            raise NotFoundError("Cover not found")
        key = f"catalog_art/covers/{asset.id}/web-{size}.jpg"
        if await self.storage.stat(key):
            return await self.storage.get_bytes(key)
        try:
            original = await self.storage.get_bytes(asset.object_key)
        except FileNotFoundError as exc:
            raise NotFoundError("Cover not found") from exc
        data = await asyncio.to_thread(_resize, original, size)
        await self.storage.put(object_key=key, data=data, mime="image/jpeg", storage_class="catalog_art")
        return data


async def latest_artwork_report(
    session: AsyncSession, *, target_type: str, target_id: UUID, current_asset_id: UUID | None
) -> dict | None:
    """The latest finished artwork upload to a release or event and what the checks found (None
    before any). Callers check access first."""
    intent = (
        await session.execute(
            select(UploadIntent)
            .where(UploadIntent.target_type == target_type, UploadIntent.target_id == target_id, UploadIntent.status == "COMPLETED")
            .order_by(UploadIntent.completed_at.desc().nulls_last(), UploadIntent.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if intent is None:
        return None
    asset = await session.get(MediaAsset, intent.media_asset_id)
    inspection = (
        await session.execute(
            select(MediaInspection)
            .where(MediaInspection.media_asset_id == intent.media_asset_id)
            .order_by(MediaInspection.inspected_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    findings: list[dict] = []
    if inspection is not None:
        rows = (await session.execute(select(MediaFinding).where(MediaFinding.inspection_id == inspection.id))).scalars().all()
        order = {"BLOCK": 0, "WARN": 1}
        findings = sorted(
            ({"code": f.code, "severity": f.severity, "measured": f.measured, "limit": f.limit_value} for f in rows),
            key=lambda f: order.get(f["severity"], 2),
        )
    return {
        "filename": intent.filename,
        "uploaded_at": intent.completed_at,
        "asset_status": asset.status if asset is not None else None,
        "outcome": inspection.outcome if inspection is not None else None,
        "width_px": inspection.width_px if inspection is not None else None,
        "height_px": inspection.height_px if inspection is not None else None,
        "findings": findings,
        "is_current": current_asset_id == intent.media_asset_id,
    }
