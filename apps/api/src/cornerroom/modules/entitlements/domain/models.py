"""Entitlement rows. Owner: EntitlementService. Not catalog playability."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from cornerroom.infra.base import ActorMixin, Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin


class Entitlement(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, Base):
    __tablename__ = "entitlements"
    __table_args__ = (
        CheckConstraint(
            "entitlement_type IN ('PURCHASE','SUBSCRIPTION','ADMIN_GRANT','PROMOTIONAL_GRANT')",
            name="entitlement_type",
        ),
        CheckConstraint("status IN ('ACTIVE','REVOKED','EXPIRED')", name="status"),
        CheckConstraint("scope IN ('TRACK','CATALOG')", name="scope"),
        Index("ix_entitlements_user_type_status", "user_id", "entitlement_type", "status"),
        UniqueConstraint(
            "user_id",
            "entitlement_type",
            "ref_id",
            "source_id",
            name="uq_entitlements_user_type_ref_source",
        ),
        {"schema": "commerce"},
    )

    user_id: Mapped[UUID] = mapped_column(ForeignKey("identity.users.id"), nullable=False)
    entitlement_type: Mapped[str] = mapped_column(String(32), nullable=False)
    ref_id: Mapped[UUID] = mapped_column(nullable=False)
    scope: Mapped[str] = mapped_column(String(32), nullable=False, default="TRACK")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    source_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    source_id: Mapped[UUID | None] = mapped_column(nullable=True)
