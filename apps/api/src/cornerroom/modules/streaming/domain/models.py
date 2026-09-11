"""Streaming tables. Owner: Streaming. PlaybackEvent is append-only. No money columns."""

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
)
from sqlalchemy.orm import Mapped, mapped_column

from cornerroom.infra.base import (
    ActorMixin,
    Base,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)


class ListeningSession(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, Base):
    """Listener playback session. Distinct from identity.sessions."""

    __tablename__ = "listening_sessions"
    __table_args__ = (
        CheckConstraint("status IN ('OPEN','CLOSED')", name="status"),
        Index("ix_listening_sessions_user_status", "user_id", "status"),
        {"schema": "streaming"},
    )

    user_id: Mapped[UUID] = mapped_column(ForeignKey("identity.users.id"), nullable=False)
    device: Mapped[str | None] = mapped_column(String(120), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="OPEN")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    __mapper_args__ = {"version_id_col": version}


class PlaybackEvent(UUIDPrimaryKeyMixin, Base):
    """Immutable listen fact. Not QualifiedStream. No soft delete."""

    __tablename__ = "playback_events"
    __table_args__ = (
        UniqueConstraint("user_id", "client_event_id", name="uq_playback_events_user_client"),
        CheckConstraint("duration_ms >= 0", name="duration_ms"),
        Index("ix_playback_events_track_started", "track_id", "started_at"),
        Index("ix_playback_events_started_at", "started_at"),
        Index("ix_playback_events_session_id", "session_id"),
        {"schema": "streaming"},
    )

    client_event_id: Mapped[str] = mapped_column(String(128), nullable=False)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("identity.users.id"), nullable=False)
    track_id: Mapped[UUID] = mapped_column(ForeignKey("music.tracks.id"), nullable=False)
    track_version_id: Mapped[UUID] = mapped_column(
        ForeignKey("music.track_versions.id"),
        nullable=False,
    )
    session_id: Mapped[UUID] = mapped_column(
        ForeignKey("streaming.listening_sessions.id"),
        nullable=False,
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    completed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    region: Mapped[str | None] = mapped_column(String(64), nullable=True)
    eligible_hint: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    ignored: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class Playlist(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, Base):
    __tablename__ = "playlists"
    __table_args__ = (
        CheckConstraint("kind IN ('USER','EDITORIAL')", name="kind"),
        CheckConstraint("status IN ('ACTIVE','ARCHIVED','DRAFT','PUBLISHED')", name="status"),
        Index("ix_playlists_owner_user_id", "owner_user_id"),
        Index("ix_playlists_kind_status", "kind", "status"),
        {"schema": "streaming"},
    )

    owner_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("identity.users.id"),
        nullable=True,
    )
    kind: Mapped[str] = mapped_column(String(32), nullable=False, default="USER")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    __mapper_args__ = {"version_id_col": version}


class PlaylistItem(TimestampMixin, ActorMixin, Base):
    __tablename__ = "playlist_items"
    __table_args__ = (
        PrimaryKeyConstraint("playlist_id", "track_id", name="pk_playlist_items"),
        UniqueConstraint("playlist_id", "position", name="uq_playlist_items_position"),
        CheckConstraint("position >= 1", name="position"),
        {"schema": "streaming"},
    )

    playlist_id: Mapped[UUID] = mapped_column(
        ForeignKey("streaming.playlists.id"),
        nullable=False,
    )
    track_id: Mapped[UUID] = mapped_column(ForeignKey("music.tracks.id"), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)


class LibraryItem(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "library_items"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "item_type",
            "item_id",
            "kind",
            name="uq_library_items_user_item_kind",
        ),
        CheckConstraint("kind IN ('LIKE','SAVE','PURCHASE_REF')", name="kind"),
        CheckConstraint("item_type IN ('track','release','artist','playlist')", name="item_type"),
        Index("ix_library_items_user_id", "user_id"),
        {"schema": "streaming"},
    )

    user_id: Mapped[UUID] = mapped_column(ForeignKey("identity.users.id"), nullable=False)
    item_type: Mapped[str] = mapped_column(String(32), nullable=False)
    item_id: Mapped[UUID] = mapped_column(nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
