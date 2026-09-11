"""AudioDeliveryPort — signed URLs only. No unrestricted masters. Q-P0-12 honored."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Protocol
from uuid import UUID

import jwt

from cornerroom.infra.errors import AppError, UnauthorizedError
from cornerroom.infra.settings import Settings
from cornerroom.infra.storage import ObjectStorage
from cornerroom.kernel.ids import new_uuid

# Technical default from ObjectStorage.signed_url. Not a closed product TTL (Q-P8-01).
ADAPTER_SIGNED_URL_SECONDS = 300
AUDIO_TOKEN_USE = "audio_delivery"


@dataclass(frozen=True, slots=True)
class SignedAudioUrl:
    url: str
    expires_at: datetime
    track_id: UUID
    track_version_id: UUID
    media_asset_id: UUID
    object_key: str | None = None


class AudioDeliveryPort(Protocol):
    def expiry_seconds(self) -> int: ...

    def mint(
        self,
        *,
        user_id: UUID,
        track_id: UUID,
        track_version_id: UUID,
        media_asset_id: UUID,
        object_key: str,
        now: datetime | None = None,
    ) -> SignedAudioUrl: ...

    def parse_token(self, token: str) -> dict: ...


class ObjectStorageAudioDelivery:
    """Mints a purpose-bound JWT. Bytes still come from ObjectStorage after playability re-check."""

    def __init__(self, settings: Settings, storage: ObjectStorage) -> None:
        self.settings = settings
        self.storage = storage

    def expiry_seconds(self) -> int:
        return ADAPTER_SIGNED_URL_SECONDS

    def mint(
        self,
        *,
        user_id: UUID,
        track_id: UUID,
        track_version_id: UUID,
        media_asset_id: UUID,
        object_key: str,
        now: datetime | None = None,
    ) -> SignedAudioUrl:
        issued = now or datetime.now(timezone.utc)
        ttl = self.expiry_seconds()
        expires = issued + timedelta(seconds=ttl)
        payload = {
            "iss": self.settings.jwt_issuer,
            "sub": str(user_id),
            "tid": str(track_id),
            "vid": str(track_version_id),
            "aid": str(media_asset_id),
            "iat": int(issued.timestamp()),
            "exp": int(expires.timestamp()),
            "jti": str(new_uuid()),
            "token_use": AUDIO_TOKEN_USE,
        }
        token = jwt.encode(payload, self.settings.jwt_secret, algorithm="HS256")
        return SignedAudioUrl(
            url=f"/api/v1/playback/media/{token}",
            expires_at=expires,
            track_id=track_id,
            track_version_id=track_version_id,
            media_asset_id=media_asset_id,
            object_key=object_key,
        )

    def parse_token(self, token: str) -> dict:
        try:
            payload = jwt.decode(
                token,
                self.settings.jwt_secret,
                algorithms=["HS256"],
                issuer=self.settings.jwt_issuer,
            )
        except jwt.PyJWTError as exc:
            raise UnauthorizedError("Invalid or expired audio token") from exc
        if payload.get("token_use") != AUDIO_TOKEN_USE:
            raise UnauthorizedError("Invalid token type")
        return payload

    async def read_bytes(self, object_key: str) -> bytes:
        try:
            return await self.storage.get_bytes(object_key)
        except FileNotFoundError as exc:
            raise AppError(
                "TRACK_AUDIO_UNAVAILABLE",
                "Audio is not available",
                409,
                "Object storage has no bytes for this version (Q-P0-12)",
            ) from exc
        except NotImplementedError as exc:
            raise AppError(
                "TRACK_AUDIO_UNAVAILABLE",
                "Audio is not available",
                409,
                "Object storage GET is not wired until a cloud region is named (Q-P0-12)",
            ) from exc
