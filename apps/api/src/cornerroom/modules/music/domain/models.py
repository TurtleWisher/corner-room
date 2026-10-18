"""Music catalog tables. Owner: Music. Credits ≠ royalties. No playback or money columns."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    PrimaryKeyConstraint,
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
        CheckConstraint("track_sales IN ('RELEASE_ONLY','TRACKS_ALLOWED')", name="track_sales"),
        CheckConstraint("intake_mode IN ('SELF','ASSISTED','MANAGED')", name="intake_mode"),
        CheckConstraint("takedown_kind IS NULL OR takedown_kind IN ('STANDARD','LEGAL')", name="takedown_kind"),
        Index("ix_releases_status", "status"),
        Index(
            "uq_releases_upc",
            "upc",
            unique=True,
            postgresql_where=text("upc IS NOT NULL AND deleted_at IS NULL"),
        ),
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
    # Audio platform release details (AUDIO_PHASE_1_DESIGN 4.1, D-AUDIO-10/16).
    language_code: Mapped[str | None] = mapped_column(String(16), nullable=True)
    genre_primary: Mapped[str | None] = mapped_column(String(48), ForeignKey("music.genres.key"), nullable=True)
    genre_secondary: Mapped[str | None] = mapped_column(String(48), ForeignKey("music.genres.key"), nullable=True)
    label_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    p_line: Mapped[str | None] = mapped_column(String(300), nullable=True)
    c_line: Mapped[str | None] = mapped_column(String(300), nullable=True)
    release_timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="Asia/Dhaka", server_default="Asia/Dhaka")
    upc: Mapped[str | None] = mapped_column(String(14), nullable=True)
    track_sales: Mapped[str] = mapped_column(String(24), nullable=False, default="RELEASE_ONLY", server_default="RELEASE_ONLY")
    intake_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="SELF", server_default="SELF")
    rights_declared_by: Mapped[UUID | None] = mapped_column(nullable=True)
    rights_declared_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # D-AUDIO-14: STANDARD (buyers keep access) or LEGAL (removed for everyone); null until taken down.
    takedown_kind: Mapped[str | None] = mapped_column(String(16), nullable=True)
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
        CheckConstraint("takedown_kind IS NULL OR takedown_kind IN ('STANDARD','LEGAL')", name="takedown_kind"),
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
    explicit: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    language_code: Mapped[str | None] = mapped_column(String(16), nullable=True)
    version_title: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # D-AUDIO-14: STANDARD (buyers keep access) or LEGAL (removed for everyone); null until taken down.
    takedown_kind: Mapped[str | None] = mapped_column(String(16), nullable=True)
    genre_primary: Mapped[str | None] = mapped_column(String(48), ForeignKey("music.genres.key"), nullable=True)
    genre_secondary: Mapped[str | None] = mapped_column(String(48), ForeignKey("music.genres.key"), nullable=True)
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
    # Audio platform: who uploaded, for which profile, and the last safe processing code for the UI.
    uploaded_by: Mapped[UUID | None] = mapped_column(nullable=True)
    on_behalf_profile_type: Mapped[str | None] = mapped_column(String(8), nullable=True)
    on_behalf_profile_id: Mapped[UUID | None] = mapped_column(nullable=True)
    processing_detail: Mapped[str | None] = mapped_column(String(64), nullable=True)
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
        # Widened by 0019: a typed name is allowed for non-performer credits (D-AUDIO-16).
        CheckConstraint(
            "artist_id IS NOT NULL OR user_id IS NOT NULL OR display_name IS NOT NULL", name="credit_party"
        ),
        Index("ix_credits_track_id", "track_id"),
        Index("ix_credits_release_id", "release_id"),
        {"schema": "music"},
    )

    track_id: Mapped[UUID | None] = mapped_column(ForeignKey("music.tracks.id"), nullable=True)
    release_id: Mapped[UUID | None] = mapped_column(ForeignKey("music.releases.id"), nullable=True)
    artist_id: Mapped[UUID | None] = mapped_column(ForeignKey("artists.artists.id"), nullable=True)
    user_id: Mapped[UUID | None] = mapped_column(ForeignKey("identity.users.id"), nullable=True)
    credit_role: Mapped[str] = mapped_column(String(80), nullable=False)
    role_key: Mapped[str | None] = mapped_column(String(32), ForeignKey("music.credit_roles.key"), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    instrument: Mapped[str | None] = mapped_column(String(80), nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")


class RenditionProfile(TimestampMixin, Base):
    """A copy recipe, stored as data. PLAYBACK copies stream (D-AUDIO-03; CANDIDATE until the
    listening test); DOWNLOAD copies are what buyers download (D-AUDIO-06). sample_rate_hz 0 and
    bitrate_kbps 0 mean "as the master" (lossless FLAC keeps the master's rate and bit depth)."""

    __tablename__ = "rendition_profiles"
    __table_args__ = (
        CheckConstraint("status IN ('CANDIDATE','ACTIVE','RETIRED')", name="status"),
        CheckConstraint("codec IN ('opus','mp3','flac')", name="codec"),
        CheckConstraint("purpose IN ('PLAYBACK','DOWNLOAD')", name="purpose"),
        {"schema": "music"},
    )

    key: Mapped[str] = mapped_column(String(32), primary_key=True)
    codec: Mapped[str] = mapped_column(String(16), nullable=False)
    container: Mapped[str] = mapped_column(String(16), nullable=False)
    bitrate_kbps: Mapped[int] = mapped_column(Integer, nullable=False)
    sample_rate_hz: Mapped[int] = mapped_column(Integer, nullable=False)
    channels: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    profile_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="CANDIDATE")
    required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    purpose: Mapped[str] = mapped_column(String(16), nullable=False, default="PLAYBACK", server_default="PLAYBACK")


class TrackRendition(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A verified copy of one track version (playback or download), made from its master only."""

    __tablename__ = "track_renditions"
    __table_args__ = (
        UniqueConstraint(
            "track_version_id", "profile_key", "profile_version", name="uq_track_renditions_version_profile"
        ),
        CheckConstraint("status IN ('READY','RETIRED')", name="status"),
        CheckConstraint("purpose IN ('PLAYBACK','DOWNLOAD')", name="purpose"),
        Index("ix_track_renditions_version", "track_version_id"),
        {"schema": "music"},
    )

    track_version_id: Mapped[UUID] = mapped_column(ForeignKey("music.track_versions.id"), nullable=False)
    profile_key: Mapped[str] = mapped_column(String(32), nullable=False)
    profile_version: Mapped[int] = mapped_column(Integer, nullable=False)
    media_asset_id: Mapped[UUID] = mapped_column(ForeignKey("documents.media_assets.id"), nullable=False)
    codec: Mapped[str] = mapped_column(String(16), nullable=False)
    container: Mapped[str] = mapped_column(String(16), nullable=False)
    bitrate_kbps: Mapped[int] = mapped_column(Integer, nullable=False)
    sample_rate_hz: Mapped[int] = mapped_column(Integer, nullable=False)
    channels: Mapped[int] = mapped_column(Integer, nullable=False)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    byte_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    encoder: Mapped[str] = mapped_column(String(32), nullable=False)
    encoder_version: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="READY")
    purpose: Mapped[str] = mapped_column(String(16), nullable=False, default="PLAYBACK", server_default="PLAYBACK")
    bit_depth: Mapped[int | None] = mapped_column(Integer, nullable=True)


class CreditRole(Base):
    """Fixed credit vocabulary (D-AUDIO-16). Performer roles must link to an Artist."""

    __tablename__ = "credit_roles"
    __table_args__ = {"schema": "music"}

    key: Mapped[str] = mapped_column(String(32), primary_key=True)
    label_en: Mapped[str] = mapped_column(String(80), nullable=False)
    label_bn: Mapped[str | None] = mapped_column(String(80), nullable=True)
    performer: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    allows_instrument: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class Genre(Base):
    """Genre list (D-AUDIO-16, S10). Data, not code; staff may extend it later."""

    __tablename__ = "genres"
    __table_args__ = (CheckConstraint("status IN ('ACTIVE','RETIRED')", name="status"), {"schema": "music"})

    key: Mapped[str] = mapped_column(String(48), primary_key=True)
    label_en: Mapped[str] = mapped_column(String(80), nullable=False)
    label_bn: Mapped[str | None] = mapped_column(String(80), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="ACTIVE")
    sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class ReleaseContributor(Base):
    """Staff who prepared a release: the two-person rule keeps them from approving it (D-AUDIO-09)."""

    __tablename__ = "release_contributors"
    __table_args__ = (
        CheckConstraint("role IN ('PREPARER')", name="role"),
        {"schema": "music"},
    )

    release_id: Mapped[UUID] = mapped_column(ForeignKey("music.releases.id"), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(primary_key=True)
    role: Mapped[str] = mapped_column(String(16), primary_key=True)
    first_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class IntakeRecord(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Staff involvement in one release: assisted (B) or managed (D), with the artist's confirmation."""

    __tablename__ = "intake_records"
    __table_args__ = (
        UniqueConstraint("release_id", name="uq_intake_records_release_id"),
        CheckConstraint("mode IN ('ASSISTED','MANAGED')", name="mode"),
        CheckConstraint("status IN ('OPEN','CONFIRMED','CLOSED')", name="status"),
        CheckConstraint("profile_type IN ('artist','band')", name="profile_type"),
        {"schema": "music"},
    )

    release_id: Mapped[UUID] = mapped_column(ForeignKey("music.releases.id"), nullable=False)
    profile_type: Mapped[str] = mapped_column(String(8), nullable=False)
    profile_id: Mapped[UUID] = mapped_column(nullable=False)
    mode: Mapped[str] = mapped_column(String(16), nullable=False, default="ASSISTED")
    opened_by: Mapped[UUID] = mapped_column(nullable=False)
    managed_enabled_by: Mapped[UUID | None] = mapped_column(nullable=True)
    managed_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    managed_enabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    artist_confirmed_by: Mapped[UUID | None] = mapped_column(nullable=True)
    artist_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="OPEN")


class ReleaseReview(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One reviewer decision on a release, with the note the artist sees (design 5.4, Phase 6)."""

    __tablename__ = "release_reviews"
    __table_args__ = (
        CheckConstraint(
            "action IN ('start_review','approve','request_changes','schedule','release','takedown')", name="action"
        ),
        Index("ix_release_reviews_release", "release_id", "created_at"),
        {"schema": "music"},
    )

    release_id: Mapped[UUID] = mapped_column(ForeignKey("music.releases.id"), nullable=False)
    reviewer_id: Mapped[UUID] = mapped_column(nullable=False)
    action: Mapped[str] = mapped_column(String(24), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    from_status: Mapped[str] = mapped_column(String(32), nullable=False)
    to_status: Mapped[str] = mapped_column(String(32), nullable=False)
