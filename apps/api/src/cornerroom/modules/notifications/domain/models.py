"""In-app notifications and delivery rows. Vendors are adapters, not this table."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, PrimaryKeyConstraint, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from cornerroom.infra.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Notification(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "notifications"
    __table_args__ = {"schema": "notifications"}

    user_id: Mapped[UUID] = mapped_column(nullable=False)
    type: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="UNREAD")
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    locale: Mapped[str] = mapped_column(String(8), nullable=False, default="en")
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    aggregate_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    aggregate_id: Mapped[UUID | None] = mapped_column(nullable=True)


class NotificationDelivery(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "notification_deliveries"
    __table_args__ = {"schema": "notifications"}

    notification_id: Mapped[UUID] = mapped_column(
        ForeignKey("notifications.notifications.id"),
        nullable=False,
    )
    channel: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING")
    provider_ref: Mapped[str | None] = mapped_column(String(128), nullable=True)
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class NotificationPreference(TimestampMixin, Base):
    __tablename__ = "notification_preferences"
    __table_args__ = (
        PrimaryKeyConstraint("user_id", "notification_type", name="pk_notification_preferences"),
        {"schema": "notifications"},
    )

    user_id: Mapped[UUID] = mapped_column(nullable=False)
    notification_type: Mapped[str] = mapped_column(String(64), nullable=False)
    in_app: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    email: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    push: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sms: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class NotificationTemplate(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "notification_templates"
    __table_args__ = {"schema": "notifications"}

    type: Mapped[str] = mapped_column(String(64), nullable=False)
    locale: Mapped[str] = mapped_column(String(8), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    body: Mapped[str] = mapped_column(Text, nullable=False)
