"""Permission tables. Owner: Permissions. Keys are data-driven; Phase 04 seeds event.* / venue.*."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    PrimaryKeyConstraint,
    String,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from cornerroom.infra.base import ActorMixin, Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin

FOUNDATION_PERMISSIONS = (
    "user.admin",
    "role.admin",
    "org.admin",
    "audit.read",
    "event.read",
    "event.write",
    "event.publish",
    "event.cancel",
    "venue.read",
    "venue.write",
    "ticket.checkin",
    "ticket.refund_request",
    "ticket.sell_admin",
    "artist.manage",
    "music.write",
    "music.approve",
    "music.takedown",
    "analytics.read",
    "finance.read",
    "finance.post",
    "finance.payout_approve",
    "commerce.write",
    "commerce.grant",
    "royalty.read",
    "royalty.run",
    "campaign.write",
)

RESOURCE_TYPES = (
    "organization",
    "artist",
    "band",
    "event",
    "venue",
    "campaign",
    "track",
    "release",
    "product",
    "offer",
    "subscription_plan",
    "rights",
    "royalty_rule",
    "revenue_pool",
    "royalty",
    "royalty_statement",
    "invoice",
    "payout",
    "journal",
    "contract",
    "settlement",
    "document",
)


class Role(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, Base):
    __tablename__ = "roles"
    __table_args__ = (
        CheckConstraint("status IN ('ACTIVE','RETIRED')", name="status"),
        Index("uq_roles_key", "key", unique=True),
        {"schema": "permissions"},
    )

    key: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")


class Permission(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "permissions"
    __table_args__ = (
        Index("uq_permissions_key", "key", unique=True),
        {"schema": "permissions"},
    )

    key: Mapped[str] = mapped_column(String(64), nullable=False)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)


class RolePermission(Base):
    __tablename__ = "role_permissions"
    __table_args__ = (
        PrimaryKeyConstraint("role_id", "permission_id", name="pk_role_permissions"),
        {"schema": "permissions"},
    )

    role_id: Mapped[UUID] = mapped_column(
        ForeignKey("permissions.roles.id"),
        nullable=False,
    )
    permission_id: Mapped[UUID] = mapped_column(
        ForeignKey("permissions.permissions.id"),
        nullable=False,
    )


class RoleAssignment(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, Base):
    __tablename__ = "role_assignments"
    __table_args__ = (
        CheckConstraint("status IN ('ACTIVE','REVOKED')", name="status"),
        Index("ix_role_assignments_user_status", "user_id", "status"),
        Index(
            "uq_role_assignments_active_org",
            "user_id",
            "role_id",
            "organization_id",
            unique=True,
            postgresql_where=text(
                "status = 'ACTIVE' AND deleted_at IS NULL AND organization_id IS NOT NULL"
            ),
        ),
        Index(
            "uq_role_assignments_active_unscoped",
            "user_id",
            "role_id",
            unique=True,
            postgresql_where=text(
                "status = 'ACTIVE' AND deleted_at IS NULL AND organization_id IS NULL"
            ),
        ),
        {"schema": "permissions"},
    )

    user_id: Mapped[UUID] = mapped_column(nullable=False)
    role_id: Mapped[UUID] = mapped_column(
        ForeignKey("permissions.roles.id"),
        nullable=False,
    )
    organization_id: Mapped[UUID | None] = mapped_column(nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ResourceGrant(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, Base):
    __tablename__ = "resource_grants"
    __table_args__ = (
        CheckConstraint("status IN ('ACTIVE','REVOKED')", name="status"),
        CheckConstraint(
            "principal_type IN ('user','role','org_membership')",
            name="principal_type",
        ),
        Index(
            "uq_resource_grants_active",
            "principal_type",
            "principal_id",
            "permission_key",
            "resource_type",
            "resource_id",
            unique=True,
            postgresql_where=text("status = 'ACTIVE' AND deleted_at IS NULL"),
        ),
        Index("ix_resource_grants_resource", "resource_type", "resource_id"),
        Index("ix_resource_grants_principal_status", "principal_id", "status"),
        {"schema": "permissions"},
    )

    principal_type: Mapped[str] = mapped_column(String(32), nullable=False)
    principal_id: Mapped[UUID] = mapped_column(nullable=False)
    permission_key: Mapped[str] = mapped_column(String(64), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(64), nullable=False)
    resource_id: Mapped[UUID] = mapped_column(nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
