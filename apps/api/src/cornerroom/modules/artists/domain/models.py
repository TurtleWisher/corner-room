"""Artists tables. Owner: Artists module. Not User.role. No catalog or money columns."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from cornerroom.infra.base import (
    ActorMixin,
    Base,
    SoftDeleteMixin,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)


class Artist(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, Base):
    __tablename__ = "artists"
    __table_args__ = (
        CheckConstraint(
            "status IN ('APPLIED','UNDER_REVIEW','APPROVED','CONTRACT_PENDING',"
            "'SIGNED','ACTIVE','SUSPENDED','TERMINATED','REJECTED')",
            name="status",
        ),
        Index("ix_artists_status", "status"),
        Index("ix_artists_stage_name", "stage_name"),
        Index("ix_artists_primary_org_id", "primary_org_id"),
        Index(
            "uq_artists_claimed_user_id",
            "claimed_user_id",
            unique=True,
            postgresql_where=text("claimed_user_id IS NOT NULL AND deleted_at IS NULL"),
        ),
        {"schema": "artists"},
    )

    claimed_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("identity.users.id"),
        nullable=True,
    )
    stage_name: Mapped[str] = mapped_column(String(200), nullable=False)
    legal_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="APPLIED")
    primary_org_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("identity.organizations.id"),
        nullable=True,
    )
    portrait_asset_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("documents.media_assets.id"),
        nullable=True,
    )
    extra_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    __mapper_args__ = {"version_id_col": version}


class ArtistApplication(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, Base):
    __tablename__ = "artist_applications"
    __table_args__ = (
        CheckConstraint(
            "status IN ('SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED','WITHDRAWN')",
            name="status",
        ),
        Index("ix_artist_applications_user_id", "user_id"),
        Index("ix_artist_applications_artist_id", "artist_id"),
        Index("ix_artist_applications_status", "status"),
        Index(
            "uq_artist_applications_outstanding_user",
            "user_id",
            unique=True,
            postgresql_where=text(
                "status IN ('SUBMITTED','UNDER_REVIEW') AND deleted_at IS NULL"
            ),
        ),
        {"schema": "artists"},
    )

    user_id: Mapped[UUID] = mapped_column(ForeignKey("identity.users.id"), nullable=False)
    artist_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("artists.artists.id"),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="SUBMITTED")
    payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    __mapper_args__ = {"version_id_col": version}


class Band(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, Base):
    __tablename__ = "bands"
    __table_args__ = (
        CheckConstraint(
            "status IN ('FORMING','ACTIVE','HIATUS','DISBANDED')",
            name="status",
        ),
        Index("ix_bands_status", "status"),
        Index("ix_bands_name", "name"),
        Index("ix_bands_primary_org_id", "primary_org_id"),
        {"schema": "artists"},
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="FORMING")
    primary_org_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("identity.organizations.id"),
        nullable=True,
    )
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    portrait_asset_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("documents.media_assets.id"),
        nullable=True,
    )
    extra_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    __mapper_args__ = {"version_id_col": version}


class BandMember(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, Base):
    __tablename__ = "band_members"
    __table_args__ = (
        CheckConstraint(
            "status IN ('INVITED','ACTIVE','LEFT','REMOVED')",
            name="status",
        ),
        CheckConstraint(
            "user_id IS NOT NULL OR artist_id IS NOT NULL",
            name="member_party",
        ),
        Index("ix_band_members_band_id", "band_id"),
        Index("ix_band_members_user_id", "user_id"),
        Index("ix_band_members_artist_id", "artist_id"),
        Index(
            "uq_band_members_active_user",
            "band_id",
            "user_id",
            unique=True,
            postgresql_where=text(
                "status = 'ACTIVE' AND user_id IS NOT NULL AND deleted_at IS NULL"
            ),
        ),
        Index(
            "uq_band_members_active_artist",
            "band_id",
            "artist_id",
            unique=True,
            postgresql_where=text(
                "status = 'ACTIVE' AND artist_id IS NOT NULL AND deleted_at IS NULL"
            ),
        ),
        {"schema": "artists"},
    )

    band_id: Mapped[UUID] = mapped_column(ForeignKey("artists.bands.id"), nullable=False)
    user_id: Mapped[UUID | None] = mapped_column(ForeignKey("identity.users.id"), nullable=True)
    artist_id: Mapped[UUID | None] = mapped_column(ForeignKey("artists.artists.id"), nullable=True)
    role_label: Mapped[str | None] = mapped_column(String(80), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="INVITED")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Follow(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, Base):
    __tablename__ = "follows"
    __table_args__ = (
        CheckConstraint("status IN ('ACTIVE','UNFOLLOWED')", name="status"),
        CheckConstraint("target_type IN ('ARTIST','BAND')", name="target_type"),
        Index(
            "uq_follows_active",
            "user_id",
            "target_type",
            "target_id",
            unique=True,
            postgresql_where=text("status = 'ACTIVE' AND deleted_at IS NULL"),
        ),
        Index("ix_follows_target", "target_type", "target_id"),
        Index("ix_follows_user_id", "user_id"),
        {"schema": "artists"},
    )

    user_id: Mapped[UUID] = mapped_column(ForeignKey("identity.users.id"), nullable=False)
    target_type: Mapped[str] = mapped_column(String(16), nullable=False)
    target_id: Mapped[UUID] = mapped_column(nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
