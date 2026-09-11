"""Idempotency store for later money/playback paths. Infrastructure only."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import DateTime, Integer, String, Text, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from cornerroom.infra.base import Base
from cornerroom.infra.errors import ConflictError

IDEMPOTENCY_IN_PROGRESS = "IN_PROGRESS"
IDEMPOTENCY_COMPLETED = "COMPLETED"
IDEMPOTENCY_FAILED = "FAILED"


class IdempotencyRecord(Base):
    __tablename__ = "idempotency_records"
    __table_args__ = {"schema": "infra"}

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=IDEMPOTENCY_IN_PROGRESS)
    response_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    response_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


@dataclass(frozen=True, slots=True)
class IdempotencyReplay:
    status_code: int
    body: str | None


def fingerprint_payload(payload: Any) -> str:
    raw = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def compose_idempotency_key(scope: str, key: str) -> str:
    return f"{scope}:{key}"[:128]


async def begin_idempotent(
    session: AsyncSession,
    *,
    key: str,
    request_hash: str,
    ttl_seconds: int,
) -> IdempotencyRecord | IdempotencyReplay:
    now = datetime.now(timezone.utc)
    existing = await session.get(IdempotencyRecord, key)
    if existing is not None:
        if existing.expires_at <= now:
            await session.delete(existing)
            await session.flush()
        elif existing.request_hash != request_hash:
            raise ConflictError("Idempotency-Key reused with a different payload")
        elif existing.status == IDEMPOTENCY_COMPLETED and existing.response_code is not None:
            return IdempotencyReplay(existing.response_code, existing.response_body)
        elif existing.status == IDEMPOTENCY_IN_PROGRESS:
            raise ConflictError("A request with this Idempotency-Key is already in progress")
        else:
            existing.status = IDEMPOTENCY_IN_PROGRESS
            existing.response_code = None
            existing.response_body = None
            existing.expires_at = now + timedelta(seconds=ttl_seconds)
            await session.flush()
            return existing

    row = IdempotencyRecord(
        key=key,
        request_hash=request_hash,
        status=IDEMPOTENCY_IN_PROGRESS,
        expires_at=now + timedelta(seconds=ttl_seconds),
    )
    session.add(row)
    await session.flush()
    return row


async def complete_idempotent(
    session: AsyncSession,
    row: IdempotencyRecord,
    *,
    status_code: int,
    body: str | None,
) -> None:
    row.status = IDEMPOTENCY_COMPLETED
    row.response_code = status_code
    row.response_body = body
    await session.flush()


async def fail_idempotent(session: AsyncSession, row: IdempotencyRecord) -> None:
    row.status = IDEMPOTENCY_FAILED
    await session.flush()


async def get_idempotent(session: AsyncSession, key: str) -> IdempotencyRecord | None:
    return (
        await session.execute(select(IdempotencyRecord).where(IdempotencyRecord.key == key))
    ).scalar_one_or_none()
