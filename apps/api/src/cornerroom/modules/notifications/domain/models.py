"""In-app notifications and delivery rows. Vendors are adapters, not this table.

Phase 13 Gate 2 extends Phase 1 tables additively. Quiet hours are nullable
config storage only (NULL = off). Do not hard-code 22:00–08:00.
"""

from __future__ import annotations

from datetime import datetime, time
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    PrimaryKeyConstraint,
    String,
    Text,
    Time,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from cornerroom.infra.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Notification(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "notifications"
    __table_args__ = (
        CheckConstraint("status IN ('UNREAD','READ')", name="status"),
        CheckConstraint(
            "category IS NULL OR category IN ('TRANSACTIONAL','MARKETING','SECURITY')",
            name="category",
        ),
        CheckConstraint(
            "(source_event_id IS NULL AND consumer IS NULL) OR "
            "(source_event_id IS NOT NULL AND consumer IS NOT NULL)",
            name="ingest_pair",
        ),
        Index("ix_notifications_user_status_created", "user_id", "status", "created_at"),
        Index("ix_notifications_organization_id", "organization_id"),
        Index("ix_notifications_correlation_id", "correlation_id"),
        Index(
            "uq_notifications_ingest_idempotency",
            "consumer",
            "source_event_id",
            "type",
            "user_id",
            unique=True,
            postgresql_where=text("source_event_id IS NOT NULL"),
        ),
        {"schema": "notifications"},
    )

    user_id: Mapped[UUID] = mapped_column(nullable=False)
    type: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="UNREAD")
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    locale: Mapped[str] = mapped_column(String(8), nullable=False, default="en")
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    aggregate_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    aggregate_id: Mapped[UUID | None] = mapped_column(nullable=True)
    correlation_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    organization_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("identity.organizations.id"),
        nullable=True,
    )
    category: Mapped[str | None] = mapped_column(String(32), nullable=True)
    consumer: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source_event_id: Mapped[UUID | None] = mapped_column(nullable=True)


class NotificationDelivery(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "notification_deliveries"
    __table_args__ = (
        CheckConstraint(
            "status IN ('PENDING','SENT','DELIVERED','FAILED','SUPPRESSED')",
            name="status",
        ),
        Index("ix_notification_deliveries_status_next_attempt", "status", "next_attempt_at"),
        Index("ix_notification_deliveries_notification_id", "notification_id"),
        {"schema": "notifications"},
    )

    notification_id: Mapped[UUID] = mapped_column(
        ForeignKey("notifications.notifications.id"),
        nullable=False,
    )
    channel: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING")
    provider_ref: Mapped[str | None] = mapped_column(String(128), nullable=True)
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    provider_code: Mapped[str | None] = mapped_column(String(32), nullable=True)


class NotificationPreference(TimestampMixin, Base):
    __tablename__ = "notification_preferences"
    __table_args__ = (
        PrimaryKeyConstraint("user_id", "notification_type", name="pk_notification_preferences"),
        CheckConstraint(
            "(quiet_hours_start IS NULL AND quiet_hours_end IS NULL AND quiet_hours_timezone IS NULL) OR "
            "(quiet_hours_start IS NOT NULL AND quiet_hours_end IS NOT NULL AND quiet_hours_timezone IS NOT NULL)",
            name="quiet_hours_pair",
        ),
        {"schema": "notifications"},
    )

    user_id: Mapped[UUID] = mapped_column(nullable=False)
    notification_type: Mapped[str] = mapped_column(String(64), nullable=False)
    in_app: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    email: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    push: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sms: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    quiet_hours_start: Mapped[time | None] = mapped_column(Time, nullable=True)
    quiet_hours_end: Mapped[time | None] = mapped_column(Time, nullable=True)
    quiet_hours_timezone: Mapped[str | None] = mapped_column(String(64), nullable=True)


class NotificationTemplate(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "notification_templates"
    __table_args__ = {"schema": "notifications"}

    type: Mapped[str] = mapped_column(String(64), nullable=False)
    locale: Mapped[str] = mapped_column(String(8), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    body: Mapped[str] = mapped_column(Text, nullable=False)
