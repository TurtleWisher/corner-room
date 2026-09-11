"""Identity tables. Owner: Identity. Do not import other modules' models here."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from cornerroom.infra.base import (
    ActorMixin,
    Base,
    SoftDeleteMixin,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)

USER_STATUSES = ("PENDING_VERIFICATION", "ACTIVE", "SUSPENDED", "CLOSED")
PROFILE_STATUSES = ("ACTIVE", "HIDDEN")
ORG_TYPES = ("PLATFORM", "LABEL", "EVENT_ORG", "VENUE_PARTNER", "SPONSOR", "AGENCY")
ORG_STATUSES = ("PENDING", "ACTIVE", "SUSPENDED", "ARCHIVED")
MEMBERSHIP_STATUSES = ("INVITED", "ACTIVE", "REVOKED")
INVITATION_STATUSES = ("ISSUED", "ACCEPTED", "REVOKED", "EXPIRED")
SESSION_STATUSES = ("ACTIVE", "REVOKED")
CHALLENGE_PURPOSES = ("EMAIL_VERIFICATION", "PASSWORD_RECOVERY")
CHALLENGE_STATUSES = ("ISSUED", "CONSUMED", "REVOKED", "EXPIRED")


class User(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "status IN ('PENDING_VERIFICATION','ACTIVE','SUSPENDED','CLOSED')",
            name="status",
        ),
        Index("ix_users_status", "status"),
        Index(
            "uq_users_email_active",
            "email",
            unique=True,
            postgresql_where=text("email IS NOT NULL AND deleted_at IS NULL"),
        ),
        Index(
            "uq_users_phone_active",
            "phone",
            unique=True,
            postgresql_where=text("phone IS NOT NULL AND deleted_at IS NULL"),
        ),
        {"schema": "identity"},
    )

    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING_VERIFICATION")
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    security_locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CustomerProfile(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, Base):
    __tablename__ = "customer_profiles"
    __table_args__ = (
        CheckConstraint("status IN ('ACTIVE','HIDDEN')", name="status"),
        CheckConstraint("locale IN ('en','bn')", name="locale"),
        UniqueConstraint("user_id", name="uq_customer_profiles_user_id"),
        {"schema": "identity"},
    )

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("identity.users.id"),
        nullable=False,
    )
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
    locale: Mapped[str] = mapped_column(String(8), nullable=False, default="en")


class Organization(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, Base):
    __tablename__ = "organizations"
    __table_args__ = (
        CheckConstraint(
            "type IN ('PLATFORM','LABEL','EVENT_ORG','VENUE_PARTNER','SPONSOR','AGENCY')",
            name="type",
        ),
        CheckConstraint(
            "status IN ('PENDING','ACTIVE','SUSPENDED','ARCHIVED')",
            name="status",
        ),
        CheckConstraint(
            "share_bps IS NULL OR (share_bps >= 0 AND share_bps <= 10000)",
            name="share_bps",
        ),
        Index("ix_organizations_status", "status"),
        {"schema": "identity"},
    )

    type: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING")
    share_bps: Mapped[int | None] = mapped_column(nullable=True)


class OrganizationMembership(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, Base):
    __tablename__ = "organization_memberships"
    __table_args__ = (
        CheckConstraint("status IN ('INVITED','ACTIVE','REVOKED')", name="status"),
        Index(
            "uq_org_memberships_active",
            "organization_id",
            "user_id",
            unique=True,
            postgresql_where=text(
                "status IN ('INVITED','ACTIVE') AND deleted_at IS NULL"
            ),
        ),
        Index("ix_org_memberships_user_status", "user_id", "status"),
        {"schema": "identity"},
    )

    organization_id: Mapped[UUID] = mapped_column(
        ForeignKey("identity.organizations.id"),
        nullable=False,
    )
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("identity.users.id"),
        nullable=False,
    )
    role_id: Mapped[UUID | None] = mapped_column(nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="INVITED")
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Session(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "sessions"
    __table_args__ = (
        CheckConstraint("status IN ('ACTIVE','REVOKED')", name="status"),
        Index("ix_sessions_user_id", "user_id"),
        Index("ix_sessions_expires_at", "expires_at"),
        Index("ix_sessions_refresh_hash", "refresh_token_hash", unique=True),
        Index("ix_sessions_family_id", "family_id"),
        {"schema": "identity"},
    )

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("identity.users.id"),
        nullable=False,
    )
    family_id: Mapped[UUID] = mapped_column(nullable=False)
    refresh_token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    rotated_from_id: Mapped[UUID | None] = mapped_column(nullable=True)
    active_organization_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("identity.organizations.id"),
        nullable=True,
    )


class IdentityChallenge(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Hashed single-use verification/recovery credentials. No plaintext tokens."""

    __tablename__ = "identity_challenges"
    __table_args__ = (
        CheckConstraint(
            "purpose IN ('EMAIL_VERIFICATION','PASSWORD_RECOVERY')",
            name="purpose",
        ),
        CheckConstraint(
            "status IN ('ISSUED','CONSUMED','REVOKED','EXPIRED')",
            name="status",
        ),
        Index("ix_identity_challenges_token_hash", "token_hash", unique=True),
        Index("ix_identity_challenges_user_purpose", "user_id", "purpose", "status"),
        {"schema": "identity"},
    )

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("identity.users.id"),
        nullable=False,
    )
    purpose: Mapped[str] = mapped_column(String(32), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ISSUED")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class OrganizationInvitation(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, Base):
    """Hashed single-use org invites. Plaintext returned once at issue. No invented TTL."""

    __tablename__ = "organization_invitations"
    __table_args__ = (
        CheckConstraint(
            "status IN ('ISSUED','ACCEPTED','REVOKED','EXPIRED')",
            name="status",
        ),
        Index("ix_org_invitations_token_hash", "token_hash", unique=True),
        Index("ix_org_invitations_org_status", "organization_id", "status"),
        Index(
            "uq_org_invitations_outstanding_email",
            "organization_id",
            "email",
            unique=True,
            postgresql_where=text("status = 'ISSUED' AND deleted_at IS NULL"),
        ),
        {"schema": "identity"},
    )

    organization_id: Mapped[UUID] = mapped_column(
        ForeignKey("identity.organizations.id"),
        nullable=False,
    )
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    invited_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("identity.users.id"),
        nullable=True,
    )
    role_id: Mapped[UUID | None] = mapped_column(nullable=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ISSUED")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    accepted_by_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("identity.users.id"),
        nullable=True,
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    membership_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("identity.organization_memberships.id"),
        nullable=True,
    )
