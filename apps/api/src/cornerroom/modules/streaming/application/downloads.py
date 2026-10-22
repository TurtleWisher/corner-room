"""Buyer downloads (AUDIO Phase 8; D-AUDIO-06, -13, -14).

Who: only people who bought the song, or a release it is on now. Catalog access (a pass or a
subscription) is listening, not ownership, and never downloads. What: the current version's
verified copies only, never the master: FLAC (lossless, the master's rate and bit depth) or MP3 320.
A remaster replaces what buyers get at no charge (D-AUDIO-13). When: any time, as often as wanted;
each grant is audited and an abuse limiter applies when configured. After an ordinary takedown
buyers keep their downloads; a legal takedown or a refund removes them.

A grant is a short-lived, download-only token; every request with it re-checks all of the above.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID

import jwt
import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, NotFoundError, UnauthorizedError
from cornerroom.infra.redis import get_redis, namespaced_key
from cornerroom.infra.settings import Settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.ids import new_uuid
from cornerroom.modules.artists.domain.models import Artist, Band
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.documents.domain.models import MediaAsset
from cornerroom.modules.entitlements.application.service import EntitlementService
from cornerroom.modules.music.domain.models import Track, TrackRendition, TrackVersion

log = structlog.get_logger("streaming.downloads")

DOWNLOAD_TOKEN_USE = "track_download"
GRANT_SECONDS = 600
# format -> (copy purpose, codec, file extension, label)
FORMATS: dict[str, tuple[str, str, str, str]] = {
    "flac": ("DOWNLOAD", "flac", "flac", "FLAC (lossless)"),
    "mp3": ("PLAYBACK", "mp3", "mp3", "MP3 320 kbps"),
}


@dataclass(frozen=True, slots=True)
class DownloadOption:
    format: str
    label: str
    available: bool
    byte_size: int | None
    sample_rate_hz: int | None
    bit_depth: int | None
    bitrate_kbps: int | None


@dataclass(frozen=True, slots=True)
class DownloadGrant:
    url: str
    expires_at: datetime
    filename: str
    format: str
    content_type: str
    byte_size: int
    sha256: str


def safe_filename(artist: str | None, title: str, extension: str) -> str:
    """"Artist - Title.flac", safe on every common file system. Bangla letters are kept."""
    base = f"{artist} - {title}" if artist else title
    base = unicodedata.normalize("NFC", base)
    base = re.sub(r'[\\/:*?"<>|\x00-\x1f]', " ", base)
    base = re.sub(r"\s+", " ", base).strip(" .") or "Corner Room track"
    return f"{base[:150]}.{extension}"


class DownloadService:
    def __init__(self, session: AsyncSession, settings: Settings, *, clock: Clock | None = None) -> None:
        self.session = session
        self.settings = settings
        self.clock = clock or SystemClock()
        self.entitlements = EntitlementService(session, clock=self.clock)
        self.audit = AuditService(session)

    # --- rules ---------------------------------------------------------------------------------

    async def _track_for_buyer(self, user_id: UUID, track_id: UUID) -> tuple[Track, TrackVersion]:
        track = await self.session.get(Track, track_id)
        if track is None or track.deleted_at is not None:
            raise NotFoundError("Track not found")
        if not await self.entitlements.owns_by_purchase(user_id, track_id):
            raise AppError(
                "DOWNLOAD_NOT_OWNED", "Downloads come with buying the song or its release", 403,
                "A plan or catalog pass lets you listen; it does not include downloads",
            )
        if track.status == "TAKEN_DOWN" and track.takedown_kind == "LEGAL":
            raise AppError("TRACK_TAKEN_DOWN", "This song was removed and can no longer be downloaded", 409)
        if track.status not in {"RELEASED", "TAKEN_DOWN"}:
            raise AppError("TRACK_NOT_RELEASED", "This song is not available", 409)
        version = (
            await self.session.execute(
                select(TrackVersion).where(
                    TrackVersion.track_id == track.id,
                    TrackVersion.is_current.is_(True),
                    TrackVersion.status == "READY",
                    TrackVersion.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if version is None:
            raise AppError("VERSION_NOT_READY", "This song's audio is not ready", 409)
        return track, version

    async def _copies(self, version_id: UUID) -> dict[str, tuple[TrackRendition, MediaAsset]]:
        rows = (
            await self.session.execute(
                select(TrackRendition, MediaAsset)
                .join(MediaAsset, MediaAsset.id == TrackRendition.media_asset_id)
                .where(
                    TrackRendition.track_version_id == version_id,
                    TrackRendition.status == "READY",
                    MediaAsset.deleted_at.is_(None),
                )
            )
        ).all()
        found: dict[str, tuple[TrackRendition, MediaAsset]] = {}
        for fmt, (purpose, codec, _ext, _label) in FORMATS.items():
            for rendition, asset in rows:
                if rendition.purpose == purpose and rendition.codec == codec:
                    found[fmt] = (rendition, asset)
                    break
        return found

    async def _artist_name(self, track: Track) -> str | None:
        if track.primary_artist_id is not None:
            artist = await self.session.get(Artist, track.primary_artist_id)
            return artist.stage_name if artist else None
        if track.primary_band_id is not None:
            band = await self.session.get(Band, track.primary_band_id)
            return band.name if band else None
        return None

    async def _limit(self, user_id: UUID) -> None:
        cap = self.settings.download_rate_limit_max
        window = self.settings.download_rate_limit_window_seconds
        if cap <= 0 or window <= 0:
            return
        key = namespaced_key("downloads", "rl", str(user_id), settings=self.settings)
        try:
            client = get_redis()
            count = await client.incr(key)
            if count == 1:
                await client.expire(key, window)
        except Exception:
            log.warning("download_rate_limit_unavailable")
            raise AppError("RATE_LIMIT_UNAVAILABLE", "Downloads are briefly unavailable", 503) from None
        if count > cap:
            raise AppError("RATE_LIMITED", "Too many downloads in a short time. Try again later.", 429)

    # --- use cases -----------------------------------------------------------------------------

    async def options(self, ctx: AuthContext, track_id: UUID) -> list[DownloadOption]:
        _track, version = await self._track_for_buyer(ctx.user_id, track_id)
        copies = await self._copies(version.id)
        out = []
        for fmt, (_purpose, _codec, _ext, label) in FORMATS.items():
            hit = copies.get(fmt)
            rendition = hit[0] if hit else None
            out.append(
                DownloadOption(
                    format=fmt,
                    label=label,
                    available=hit is not None,
                    byte_size=rendition.byte_size if rendition else None,
                    sample_rate_hz=rendition.sample_rate_hz if rendition else None,
                    bit_depth=rendition.bit_depth if rendition else None,
                    bitrate_kbps=rendition.bitrate_kbps if rendition else None,
                )
            )
        return out

    async def grant(self, ctx: AuthContext, track_id: UUID, fmt: str) -> DownloadGrant:
        if fmt not in FORMATS:
            raise AppError("VALIDATION_ERROR", "Choose FLAC or MP3", 422)
        track, version = await self._track_for_buyer(ctx.user_id, track_id)
        hit = (await self._copies(version.id)).get(fmt)
        if hit is None:
            raise AppError(
                "DOWNLOAD_PREPARING", "This download is still being prepared. Try again in a few minutes.", 409
            )
        rendition, asset = hit
        await self._limit(ctx.user_id)
        now = self.clock.now()
        expires = now + timedelta(seconds=GRANT_SECONDS)
        token = jwt.encode(
            {
                "iss": self.settings.jwt_issuer,
                "sub": str(ctx.user_id),
                "tid": str(track.id),
                "vid": str(version.id),
                "aid": str(asset.id),
                "fmt": fmt,
                "iat": int(now.timestamp()),
                "exp": int(expires.timestamp()),
                "jti": str(new_uuid()),
                "token_use": DOWNLOAD_TOKEN_USE,
            },
            self.settings.media_secret,
            algorithm="HS256",
        )
        _purpose, _codec, extension, _label = FORMATS[fmt]
        filename = safe_filename(await self._artist_name(track), track.title, extension)
        await self.audit.record_from_auth(
            ctx, action="track.download.granted", entity_type="Track", entity_id=track.id,
            new_state={"format": fmt, "track_version_id": str(version.id), "media_asset_id": str(asset.id), "sha256": rendition.sha256},
            organization_id=track.primary_org_id,
        )
        return DownloadGrant(
            url=f"/api/v1/downloads/{token}",
            expires_at=expires,
            filename=filename,
            format=fmt,
            content_type=asset.mime or "application/octet-stream",
            byte_size=rendition.byte_size,
            sha256=rendition.sha256,
        )

    async def open(self, token: str) -> tuple[MediaAsset, str]:
        """Re-check everything for this request and return the exact copy the grant names."""
        try:
            payload = jwt.decode(token, self.settings.media_secret, algorithms=["HS256"], issuer=self.settings.jwt_issuer)
        except jwt.PyJWTError as exc:
            raise UnauthorizedError("This download link has expired. Start the download again.") from exc
        if payload.get("token_use") != DOWNLOAD_TOKEN_USE or payload.get("fmt") not in FORMATS:
            raise UnauthorizedError("Invalid download link")
        fmt = str(payload["fmt"])
        track, version = await self._track_for_buyer(UUID(str(payload["sub"])), UUID(str(payload["tid"])))
        if version.id != UUID(str(payload["vid"])):
            raise AppError("DOWNLOAD_SUPERSEDED", "This song was updated. Start the download again.", 409)
        hit = (await self._copies(version.id)).get(fmt)
        if hit is None or hit[1].id != UUID(str(payload["aid"])):
            raise AppError("DOWNLOAD_SUPERSEDED", "This song was updated. Start the download again.", 409)
        _purpose, _codec, extension, _label = FORMATS[fmt]
        return hit[1], safe_filename(await self._artist_name(track), track.title, extension)

