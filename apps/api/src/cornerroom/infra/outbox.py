"""Outbox table + writer. Same transaction as the domain write."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, Index, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from cornerroom.infra.base import Base, UUIDPrimaryKeyMixin
from cornerroom.kernel.events import DomainEvent

OUTBOX_PENDING = "PENDING"
OUTBOX_PUBLISHED = "PUBLISHED"
OUTBOX_FAILED = "FAILED"


class OutboxEvent(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "outbox_events"
    __table_args__ = (
        CheckConstraint(
            "status IN ('PENDING','PUBLISHED','FAILED')",
            name="status",
        ),
        Index("ix_outbox_events_status_created", "status", "created_at"),
        Index("ix_outbox_events_status_next_attempt", "status", "next_attempt_at"),
        {"schema": "infra"},
    )

    event_type: Mapped[str] = mapped_column(String(128), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=OUTBOX_PENDING)
    aggregate_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    aggregate_id: Mapped[UUID | None] = mapped_column(nullable=True)
    correlation_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    attempts: Mapped[int] = mapped_column(nullable=False, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)


class PostgresOutboxWriter:
    async def record(self, session: AsyncSession, event: DomainEvent) -> OutboxEvent:
        row = OutboxEvent(
            id=event.event_id,
            event_type=event.event_type,
            payload=event.to_payload(),
            status=OUTBOX_PENDING,
            aggregate_type=event.aggregate_type,
            aggregate_id=event.aggregate_id,
            correlation_id=event.correlation_id,
            occurred_at=event.occurred_at,
        )
        session.add(row)
        await session.flush()
        return row


outbox_writer = PostgresOutboxWriter()


async def enqueue_outbox(session: AsyncSession, event: DomainEvent) -> OutboxEvent:
    return await outbox_writer.record(session, event)


async def claim_pending_outbox(session: AsyncSession, limit: int = 50) -> list[OutboxEvent]:
    result = await session.execute(
        text(
            """
            SELECT id FROM infra.outbox_events
            WHERE status = 'PENDING'
              AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
            ORDER BY created_at
            LIMIT :limit
            FOR UPDATE SKIP LOCKED
            """
        ),
        {"limit": limit},
    )
    ids = [row[0] for row in result.fetchall()]
    if not ids:
        return []
    rows: list[OutboxEvent] = []
    for item_id in ids:
        row = await session.get(OutboxEvent, UUID(str(item_id)))
        if row is not None:
            rows.append(row)
    return rows


async def mark_published(session: AsyncSession, row: OutboxEvent) -> None:
    row.status = OUTBOX_PUBLISHED
    row.published_at = datetime.now(timezone.utc)
    row.attempts += 1
    row.next_attempt_at = None
    row.last_error = None
    await session.flush()


async def mark_retry_or_fail(
    session: AsyncSession,
    row: OutboxEvent,
    error: str,
    *,
    max_attempts: int,
    backoff_seconds: int,
) -> None:
    row.attempts += 1
    row.last_error = error[:2000]
    if row.attempts >= max_attempts:
        row.status = OUTBOX_FAILED
        row.next_attempt_at = None
    else:
        row.status = OUTBOX_PENDING
        row.next_attempt_at = datetime.now(timezone.utc) + timedelta(seconds=backoff_seconds * row.attempts)
    await session.flush()


async def mark_failed(session: AsyncSession, row: OutboxEvent, error: str) -> None:
    """Terminal failure — used when retry budget is exhausted or by operators."""
    row.status = OUTBOX_FAILED
    row.last_error = error[:2000]
    row.attempts += 1
    row.next_attempt_at = None
    await session.flush()
