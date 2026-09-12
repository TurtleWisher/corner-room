"""Analytics tables. Owner: Analytics. Not a ledger, not playback_events, not audit_log.

daily_* metric_date is the calendar date in ASSUMED timezone Asia/Dhaka (09_ §2).
Do not treat play_count as unique listeners. No unique_listeners / activation / CAC / ROAS columns.
"""

from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from cornerroom.infra.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class AnalyticsEvent(UUIDPrimaryKeyMixin, Base):
    """Append-only ingest row. Idempotent on (source_event_id, consumer)."""

    __tablename__ = "analytics_events"
    __table_args__ = (
        UniqueConstraint("source_event_id", "consumer", name="uq_analytics_events_source_consumer"),
        Index("ix_analytics_events_occurred_at", "occurred_at"),
        Index("ix_analytics_events_organization_id", "organization_id"),
        Index("ix_analytics_events_event_type", "event_type"),
        Index("ix_analytics_events_source_entity", "source_entity_type", "source_entity_id"),
        Index("ix_analytics_events_correlation_id", "correlation_id"),
        {"schema": "analytics"},
    )

    source_event_id: Mapped[UUID] = mapped_column(nullable=False)
    consumer: Mapped[str] = mapped_column(String(64), nullable=False)
    event_type: Mapped[str] = mapped_column(String(128), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    actor_id: Mapped[UUID | None] = mapped_column(nullable=True)
    organization_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("identity.organizations.id"),
        nullable=True,
    )
    source_module: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source_entity_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source_entity_id: Mapped[UUID | None] = mapped_column(nullable=True)
    correlation_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    properties: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'{}'::jsonb"),
    )


class DailyTrackMetrics(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Incremental daily track projection. Empty until Domain ingest runs."""

    __tablename__ = "daily_track_metrics"
    __table_args__ = (
        CheckConstraint("play_count >= 0", name="play_count"),
        CheckConstraint("completed_play_count >= 0", name="completed_play_count"),
        CheckConstraint("listen_duration_ms >= 0", name="listen_duration_ms"),
        UniqueConstraint(
            "metric_date",
            "track_id",
            "metric_definition_version",
            name="uq_daily_track_metrics_date_track_version",
        ),
        Index("ix_daily_track_metrics_organization_id", "organization_id"),
        Index("ix_daily_track_metrics_metric_date", "metric_date"),
        {"schema": "analytics"},
    )

    metric_date: Mapped[date] = mapped_column(Date, nullable=False)
    track_id: Mapped[UUID] = mapped_column(nullable=False)
    organization_id: Mapped[UUID | None] = mapped_column(nullable=True)
    metric_definition_version: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
        server_default="1",
    )
    play_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    completed_play_count: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
        default=0,
        server_default="0",
    )
    listen_duration_ms: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
        default=0,
        server_default="0",
    )


class DailyEventMetrics(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Incremental daily event projection. Counts are facts, not remaining inventory."""

    __tablename__ = "daily_event_metrics"
    __table_args__ = (
        CheckConstraint("ticket_paid_count >= 0", name="ticket_paid_count"),
        CheckConstraint("ticket_issued_count >= 0", name="ticket_issued_count"),
        CheckConstraint("ticket_checked_in_count >= 0", name="ticket_checked_in_count"),
        UniqueConstraint(
            "metric_date",
            "event_id",
            "metric_definition_version",
            name="uq_daily_event_metrics_date_event_version",
        ),
        Index("ix_daily_event_metrics_organization_id", "organization_id"),
        Index("ix_daily_event_metrics_metric_date", "metric_date"),
        {"schema": "analytics"},
    )

    metric_date: Mapped[date] = mapped_column(Date, nullable=False)
    event_id: Mapped[UUID] = mapped_column(nullable=False)
    organization_id: Mapped[UUID | None] = mapped_column(nullable=True)
    metric_definition_version: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
        server_default="1",
    )
    ticket_paid_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    ticket_issued_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    ticket_checked_in_count: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
        default=0,
        server_default="0",
    )


class DailyCampaignMetrics(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Incremental daily campaign projection. No CAC/ROAS/attribution columns."""

    __tablename__ = "daily_campaign_metrics"
    __table_args__ = (
        CheckConstraint("ingested_event_count >= 0", name="ingested_event_count"),
        UniqueConstraint(
            "metric_date",
            "campaign_id",
            "metric_definition_version",
            name="uq_daily_campaign_metrics_date_campaign_version",
        ),
        Index("ix_daily_campaign_metrics_organization_id", "organization_id"),
        Index("ix_daily_campaign_metrics_metric_date", "metric_date"),
        {"schema": "analytics"},
    )

    metric_date: Mapped[date] = mapped_column(Date, nullable=False)
    campaign_id: Mapped[UUID] = mapped_column(nullable=False)
    organization_id: Mapped[UUID | None] = mapped_column(nullable=True)
    metric_definition_version: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
        server_default="1",
    )
    ingested_event_count: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
        default=0,
        server_default="0",
    )
