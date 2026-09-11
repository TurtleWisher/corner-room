"""Music catalog tables. Owner: Music. Credits ≠ royalties. No playback or money columns."""

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
    PrimaryKeyConstraint,
    String,
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


class Release(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, Base):
    __tablename__ = "releases"
    __table_args__ = (
        CheckConstraint(
            "release_type IN ('SINGLE','EP','ALBUM','COMPILATION','LIVE')",
            name="release_type",
        ),
        CheckConstraint(
            "status IN ('IDEA','DEMO','IN_PRODUCTION','QC','METADATA_REVIEW',"
            "'APPROVED','SCHEDULED','RELEASED','TAKEN_DOWN','ARCHIVED')",
            name="status",
        ),
        CheckConstraint(
            "primary_artist_id IS NULL OR primary_band_id IS NULL",
            name="primary_party",
        ),
        Index("ix_releases_status", "status"),
        Index("ix_releases_release_at", "release_at"),
        Index("ix_releases_primary_org_id", "primary_org_id"),
        {"schema": "music"},
    )

    release_type: Mapped[str] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    primary_artist_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("artists.artists.id"),
        nullable=True,
    )
    primary_band_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("artists.bands.id"),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="IDEA")
    release_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cover_asset_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("documents.media_assets.id"),
        nullable=True,
    )
    primary_org_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("identity.organizations.id"),
        nullable=True,
    )
    extra_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    __mapper_args__ = {"version_id_col": version}


class Track(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, Base):
    __tablename__ = "tracks"
    __table_args__ = (
        CheckConstraint(
            "status IN ('DRAFT','SUBMITTED','IN_REVIEW','APPROVED','SCHEDULED',"
            "'RELEASED','REJECTED','TAKEN_DOWN','ARCHIVED')",
            name="status",
        ),
        CheckConstraint(
            "primary_artist_id IS NULL OR primary_band_id IS NULL",
            name="primary_party",
        ),
        Index("ix_tracks_status", "status"),
        Index("ix_tracks_primary_org_id", "primary_org_id"),
        Index(
            "uq_tracks_isrc",
            "isrc",
            unique=True,
            postgresql_where=text("isrc IS NOT NULL AND deleted_at IS NULL"),
        ),
        {"schema": "music"},
    )

    title: Mapped[str] = mapped_column(String(300), nullable=False)
    isrc: Mapped[str | None] = mapped_column(String(32), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="DRAFT")
    primary_artist_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("artists.artists.id"),
        nullable=True,
    )
    primary_band_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("artists.bands.id"),
        nullable=True,
    )
    primary_org_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("identity.organizations.id"),
        nullable=True,
    )
    extra_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    __mapper_args__ = {"version_id_col": version}


class TrackVersion(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, Base):
    __tablename__ = "track_versions"
    __table_args__ = (
        CheckConstraint(
            "status IN ('UPLOADING','PROCESSING','READY','REJECTED','SUPERSEDED')",
            name="status",
        ),
        CheckConstraint("version_type IN ('MASTER','WORKING')", name="version_type"),
        CheckConstraint("duration_ms IS NULL OR duration_ms >= 0", name="duration_ms"),
        Index("ix_track_versions_track_current", "track_id", "is_current"),
        Index(
            "uq_track_versions_current",
            "track_id",
            unique=True,
            postgresql_where=text("is_current IS TRUE AND deleted_at IS NULL"),
        ),
        {"schema": "music"},
    )

    track_id: Mapped[UUID] = mapped_column(ForeignKey("music.tracks.id"), nullable=False)
    version_type: Mapped[str] = mapped_column(String(32), nullable=False, default="MASTER")
    media_asset_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("documents.media_assets.id"),
        nullable=True,
    )
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="UPLOADING")
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    __mapper_args__ = {"version_id_col": version}


class ReleaseTrack(TimestampMixin, ActorMixin, Base):
    __tablename__ = "release_tracks"
    __table_args__ = (
        PrimaryKeyConstraint("release_id", "track_id", name="pk_release_tracks"),
        UniqueConstraint("release_id", "position", name="uq_release_tracks_position"),
        CheckConstraint("position >= 1", name="position"),
        {"schema": "music"},
    )

    release_id: Mapped[UUID] = mapped_column(ForeignKey("music.releases.id"), nullable=False)
    track_id: Mapped[UUID] = mapped_column(ForeignKey("music.tracks.id"), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)


class Credit(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, Base):
    __tablename__ = "credits"
    __table_args__ = (
        CheckConstraint("track_id IS NOT NULL OR release_id IS NOT NULL", name="credit_subject"),
        CheckConstraint("artist_id IS NOT NULL OR user_id IS NOT NULL", name="credit_party"),
        Index("ix_credits_track_id", "track_id"),
        Index("ix_credits_release_id", "release_id"),
        {"schema": "music"},
    )

    track_id: Mapped[UUID | None] = mapped_column(ForeignKey("music.tracks.id"), nullable=True)
    release_id: Mapped[UUID | None] = mapped_column(ForeignKey("music.releases.id"), nullable=True)
    artist_id: Mapped[UUID | None] = mapped_column(ForeignKey("artists.artists.id"), nullable=True)
    user_id: Mapped[UUID | None] = mapped_column(ForeignKey("identity.users.id"), nullable=True)
    credit_role: Mapped[str] = mapped_column(String(80), nullable=False)
