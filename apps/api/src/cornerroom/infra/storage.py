"""Object storage protocol + local adapter. S3 fails closed until a provider and region exist.

Residency gate applies (Q-P0-12). Streaming methods keep memory bounded: uploads arrive in parts,
playback reads byte ranges, and write-once keys can never be overwritten.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
from collections.abc import AsyncIterable, AsyncIterator
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Protocol
from uuid import UUID

from cornerroom.infra.errors import AppError, ResidencyGateError
from cornerroom.infra.settings import Settings
from cornerroom.kernel.ids import new_uuid

GATED_STORAGE_CLASSES = frozenset({"catalog_audio", "legal_document"})
ALLOWED_UPLOAD_CLASSES = frozenset({"public_media", "campaign_asset", "ticket_artifact"})
READ_CHUNK_BYTES = 256 * 1024


class StorageUnavailableError(AppError):
    def __init__(self, detail: str = "Object storage is not configured on this server yet") -> None:
        super().__init__("STORAGE_NOT_CONFIGURED", "Storage not configured", 503, detail)


class ObjectExistsError(AppError):
    def __init__(self) -> None:
        super().__init__("OBJECT_EXISTS", "Object already exists", 409, "Write-once object keys cannot be overwritten")


@dataclass(slots=True)
class StoredObject:
    bucket: str
    object_key: str
    byte_size: int
    sha256: str
    mime: str


class ObjectStorage(Protocol):
    bucket: str

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

    async def write_once(
        self, *, object_key: str, chunks: AsyncIterable[bytes], mime: str
    ) -> StoredObject: ...

    async def stat(self, object_key: str) -> int | None: ...

    def read_range(self, object_key: str, start: int, end: int) -> AsyncIterator[bytes]: ...

    async def delete(self, object_key: str) -> None: ...

    def local_path(self, object_key: str) -> Path: ...

    def scratch_dir(self) -> Path: ...


class LocalObjectStorage:
    def __init__(self, root: str, bucket: str = "local") -> None:
        self.root = Path(root).resolve()
        self.bucket = bucket
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, object_key: str) -> Path:
        path = (self.root / object_key).resolve()
        if self.root not in path.parents:
            raise AppError("VALIDATION_ERROR", "Invalid object key", 422)
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
        """A label, not a credential (Gate 1 M5): no route serves local:// keys, so it opens nothing.
        Local bytes leave only through API routes that re-check access on every request; real
        presigned URLs arrive with the S3 adapter once a provider and region exist (Q-P0-12)."""
        expires = datetime.now(timezone.utc) + timedelta(seconds=expires_seconds)
        return f"local://{self.bucket}/{object_key}?expires={int(expires.timestamp())}"

    async def write_once(
        self, *, object_key: str, chunks: AsyncIterable[bytes], mime: str
    ) -> StoredObject:
        """Stream chunks into a new object; fails if the key already exists (never overwrites)."""
        path = self._path(object_key)
        try:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o600)
        except FileExistsError as exc:
            raise ObjectExistsError() from exc
        digest = hashlib.sha256()
        size = 0
        try:
            with os.fdopen(fd, "wb") as handle:
                async for chunk in chunks:
                    if not chunk:
                        continue
                    digest.update(chunk)
                    size += len(chunk)
                    await asyncio.to_thread(handle.write, chunk)
        except BaseException:
            path.unlink(missing_ok=True)
            raise
        return StoredObject(
            bucket=self.bucket, object_key=object_key, byte_size=size, sha256=digest.hexdigest(), mime=mime
        )

    async def stat(self, object_key: str) -> int | None:
        path = self._path(object_key)
        return path.stat().st_size if path.exists() else None

    async def read_range(self, object_key: str, start: int, end: int) -> AsyncIterator[bytes]:
        """Yield bytes start..end inclusive in bounded chunks."""
        path = self._path(object_key)
        remaining = end - start + 1
        with path.open("rb") as handle:
            handle.seek(start)
            while remaining > 0:
                chunk = await asyncio.to_thread(handle.read, min(READ_CHUNK_BYTES, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    async def delete(self, object_key: str) -> None:
        self._path(object_key).unlink(missing_ok=True)

    def local_path(self, object_key: str) -> Path:
        """A readable file path for tools such as FFmpeg (local storage only)."""
        return self._path(object_key)

    def scratch_dir(self) -> Path:
        path = self.root / "_scratch"
        path.mkdir(parents=True, exist_ok=True)
        return path


class S3CompatibleStorage:
    """Not wired until the owner names a provider and region (Q-P0-12, D-AUDIO-01).

    Every call fails closed with STORAGE_NOT_CONFIGURED; nothing pretends to store or serve bytes.
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.bucket = settings.s3_bucket or "unconfigured"

    async def put(self, *, object_key: str, data: bytes, mime: str, storage_class: str) -> StoredObject:
        raise StorageUnavailableError()

    async def get_bytes(self, object_key: str) -> bytes:
        raise StorageUnavailableError()

    async def signed_url(self, object_key: str, expires_seconds: int = 300) -> str:
        raise StorageUnavailableError()

    async def write_once(
        self, *, object_key: str, chunks: AsyncIterable[bytes], mime: str
    ) -> StoredObject:
        raise StorageUnavailableError()

    async def stat(self, object_key: str) -> int | None:
        raise StorageUnavailableError()

    async def read_range(self, object_key: str, start: int, end: int) -> AsyncIterator[bytes]:
        raise StorageUnavailableError()
        yield b""  # pragma: no cover - makes this an async generator

    async def delete(self, object_key: str) -> None:
        raise StorageUnavailableError()

    def local_path(self, object_key: str) -> Path:
        raise StorageUnavailableError()

    def scratch_dir(self) -> Path:
        raise StorageUnavailableError()


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
