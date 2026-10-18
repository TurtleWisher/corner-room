"""Artists tables. Owner: Artists module. Not User.role. No catalog or money columns."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
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
    # Applications through a label's join link go to that label (owner, 2026-10-17).
    join_link_id: Mapped[UUID | None] = mapped_column(ForeignKey("artists.artist_join_links.id"), nullable=True)
    organization_id: Mapped[UUID | None] = mapped_column(ForeignKey("identity.organizations.id"), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    __mapper_args__ = {"version_id_col": version}


class ArtistJoinLink(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, Base):
    """A link a label shares with artists (owner, 2026-10-17: "one shared link + review").

    Holding it lets someone create an account and apply to that label; staff still review every
    application. It can be switched off at any time, and optionally ends on a date or after a
    number of uses (both set by staff, no defaults). The code is kept readable so staff can copy
    the link again: its only power is starting an application that staff review.
    """

    __tablename__ = "artist_join_links"
    __table_args__ = (
        CheckConstraint("status IN ('ACTIVE','DISABLED')", name="status"),
        CheckConstraint("max_uses IS NULL OR max_uses > 0", name="max_uses"),
        CheckConstraint("uses >= 0", name="uses"),
        UniqueConstraint("code", name="uq_artist_join_links_code"),
        Index("ix_artist_join_links_organization_id", "organization_id"),
        {"schema": "artists"},
    )

    organization_id: Mapped[UUID] = mapped_column(ForeignKey("identity.organizations.id"), nullable=False)
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="ACTIVE")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    max_uses: Mapped[int | None] = mapped_column(Integer, nullable=True)
    uses: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


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
    # Band admin may publish the band's music (D-AUDIO-05). Only members with an account.
    is_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
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
