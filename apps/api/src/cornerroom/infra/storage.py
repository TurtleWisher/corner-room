"""Object storage protocol + local / S3-compatible stubs. Residency gate applies."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Protocol
from uuid import UUID

from cornerroom.infra.errors import ResidencyGateError
from cornerroom.infra.settings import Settings
from cornerroom.kernel.ids import new_uuid

GATED_STORAGE_CLASSES = frozenset({"catalog_audio", "legal_document"})
ALLOWED_UPLOAD_CLASSES = frozenset({"public_media", "campaign_asset", "ticket_artifact"})


@dataclass(slots=True)
class StoredObject:
    bucket: str
    object_key: str
    byte_size: int
    sha256: str
    mime: str


class ObjectStorage(Protocol):
    async def put(
        self,
        *,
        object_key: str,
        data: bytes,
        mime: str,
        storage_class: str,
    ) -> StoredObject: ...

    async def get_bytes(self, object_key: str) -> bytes: ...

    async def signed_url(self, object_key: str, expires_seconds: int = 300) -> str: ...


class LocalObjectStorage:
    def __init__(self, root: str, bucket: str = "local") -> None:
        self.root = Path(root)
        self.bucket = bucket
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, object_key: str) -> Path:
        path = self.root / object_key
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    async def put(
        self,
        *,
        object_key: str,
        data: bytes,
        mime: str,
        storage_class: str,
    ) -> StoredObject:
        path = self._path(object_key)
        path.write_bytes(data)
        digest = hashlib.sha256(data).hexdigest()
        return StoredObject(
            bucket=self.bucket,
            object_key=object_key,
            byte_size=len(data),
            sha256=digest,
            mime=mime,
        )

    async def get_bytes(self, object_key: str) -> bytes:
        return self._path(object_key).read_bytes()

    async def signed_url(self, object_key: str, expires_seconds: int = 300) -> str:
        expires = datetime.now(timezone.utc) + timedelta(seconds=expires_seconds)
        return f"local://{self.bucket}/{object_key}?expires={int(expires.timestamp())}"


class S3CompatibleStorage:
    """Stub adapter — real client wiring waits for a named region (Q-P0-12)."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def put(
        self,
        *,
        object_key: str,
        data: bytes,
        mime: str,
        storage_class: str,
    ) -> StoredObject:
        digest = hashlib.sha256(data).hexdigest()
        return StoredObject(
            bucket=self.settings.s3_bucket or "unconfigured",
            object_key=object_key,
            byte_size=len(data),
            sha256=digest,
            mime=mime,
        )

    async def get_bytes(self, object_key: str) -> bytes:
        raise NotImplementedError("S3 GET is not wired until a storage provider is chosen")

    async def signed_url(self, object_key: str, expires_seconds: int = 300) -> str:
        return f"https://s3.example.invalid/{object_key}?stub=1&ttl={expires_seconds}"


def assert_storage_class_allowed(storage_class: str, settings: Settings) -> None:
    if storage_class in GATED_STORAGE_CLASSES:
        if settings.is_production and not settings.residency_region:
            raise ResidencyGateError(
                "Production storage of masters and government ID documents "
                "is blocked until a cloud region is named (Q-P0-12)."
            )
        if not settings.residency_region and settings.app_env not in {"local", "test", "staging"}:
            raise ResidencyGateError()


def build_object_key(storage_class: str, asset_id: UUID, filename: str) -> str:
    safe = filename.replace("\\", "/").split("/")[-1] or "blob"
    return f"{storage_class}/{asset_id}/{safe}"


def new_asset_id() -> UUID:
    return new_uuid()


def get_storage(settings: Settings) -> ObjectStorage:
    if settings.storage_backend == "s3":
        return S3CompatibleStorage(settings)
    return LocalObjectStorage(settings.storage_local_path)
