"""Phase 08 streaming platform: sessions, playback events, playlists, library.

Revision ID: 0009_streaming_platform
Revises: 0008_music_catalog
Create Date: 2026-09-11

Monthly partitioning of playback_events is documented, not implemented.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009_streaming_platform"
down_revision: Union[str, Sequence[str], None] = "0008_music_catalog"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(sa.text("CREATE SCHEMA IF NOT EXISTS streaming"))

    op.create_table(
        "listening_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("device", sa.String(120), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="OPEN"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint("status IN ('OPEN','CLOSED')", name="ck_listening_sessions_status"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["identity.users.id"],
            name="fk_listening_sessions_user_id_users",
        ),
        schema="streaming",
    )
    op.create_index(
        "ix_listening_sessions_user_status",
        "listening_sessions",
        ["user_id", "status"],
        schema="streaming",
    )

    op.create_table(
        "playback_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("client_event_id", sa.String(128), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("track_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("track_version_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("completed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("region", sa.String(64), nullable=True),
        sa.Column("eligible_hint", sa.Boolean(), nullable=True),
        sa.Column("ignored", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("duration_ms >= 0", name="ck_playback_events_duration_ms"),
        sa.UniqueConstraint(
            "user_id",
            "client_event_id",
            name="uq_playback_events_user_client",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["identity.users.id"],
            name="fk_playback_events_user_id_users",
        ),
        sa.ForeignKeyConstraint(
            ["track_id"],
            ["music.tracks.id"],
            name="fk_playback_events_track_id_tracks",
        ),
        sa.ForeignKeyConstraint(
            ["track_version_id"],
            ["music.track_versions.id"],
            name="fk_playback_events_track_version_id_track_versions",
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["streaming.listening_sessions.id"],
            name="fk_playback_events_session_id_listening_sessions",
        ),
        schema="streaming",
    )
    op.create_index(
        "ix_playback_events_track_started",
        "playback_events",
        ["track_id", "started_at"],
        schema="streaming",
    )
    op.create_index(
        "ix_playback_events_started_at",
        "playback_events",
        ["started_at"],
        schema="streaming",
    )
    op.create_index(
        "ix_playback_events_session_id",
        "playback_events",
        ["session_id"],
        schema="streaming",
    )

    op.create_table(
        "playlists",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("kind", sa.String(32), nullable=False, server_default="USER"),
        sa.Column("status", sa.String(32), nullable=False, server_default="ACTIVE"),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint("kind IN ('USER','EDITORIAL')", name="ck_playlists_kind"),
        sa.CheckConstraint(
            "status IN ('ACTIVE','ARCHIVED','DRAFT','PUBLISHED')",
            name="ck_playlists_status",
        ),
        sa.ForeignKeyConstraint(
            ["owner_user_id"],
            ["identity.users.id"],
            name="fk_playlists_owner_user_id_users",
        ),
        schema="streaming",
    )
    op.create_index("ix_playlists_owner_user_id", "playlists", ["owner_user_id"], schema="streaming")
    op.create_index("ix_playlists_kind_status", "playlists", ["kind", "status"], schema="streaming")

    op.create_table(
        "playlist_items",
        sa.Column("playlist_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("track_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.PrimaryKeyConstraint("playlist_id", "track_id", name="pk_playlist_items"),
        sa.UniqueConstraint("playlist_id", "position", name="uq_playlist_items_position"),
        sa.CheckConstraint("position >= 1", name="ck_playlist_items_position"),
        sa.ForeignKeyConstraint(
            ["playlist_id"],
            ["streaming.playlists.id"],
            name="fk_playlist_items_playlist_id_playlists",
        ),
        sa.ForeignKeyConstraint(
            ["track_id"],
            ["music.tracks.id"],
            name="fk_playlist_items_track_id_tracks",
        ),
        schema="streaming",
    )

    op.create_table(
        "library_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("item_type", sa.String(32), nullable=False),
        sa.Column("item_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("kind IN ('LIKE','SAVE','PURCHASE_REF')", name="ck_library_items_kind"),
        sa.CheckConstraint(
            "item_type IN ('track','release','artist','playlist')",
            name="ck_library_items_item_type",
        ),
        sa.UniqueConstraint(
            "user_id",
            "item_type",
            "item_id",
            "kind",
            name="uq_library_items_user_item_kind",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["identity.users.id"],
            name="fk_library_items_user_id_users",
        ),
        schema="streaming",
    )
    op.create_index("ix_library_items_user_id", "library_items", ["user_id"], schema="streaming")


def downgrade() -> None:
    op.drop_index("ix_library_items_user_id", table_name="library_items", schema="streaming")
    op.drop_table("library_items", schema="streaming")
    op.drop_table("playlist_items", schema="streaming")
    op.drop_index("ix_playlists_kind_status", table_name="playlists", schema="streaming")
    op.drop_index("ix_playlists_owner_user_id", table_name="playlists", schema="streaming")
    op.drop_table("playlists", schema="streaming")
    op.drop_index("ix_playback_events_session_id", table_name="playback_events", schema="streaming")
    op.drop_index("ix_playback_events_started_at", table_name="playback_events", schema="streaming")
    op.drop_index("ix_playback_events_track_started", table_name="playback_events", schema="streaming")
    op.drop_table("playback_events", schema="streaming")
    op.drop_index("ix_listening_sessions_user_status", table_name="listening_sessions", schema="streaming")
    op.drop_table("listening_sessions", schema="streaming")
    op.execute(sa.text("DROP SCHEMA IF EXISTS streaming"))
