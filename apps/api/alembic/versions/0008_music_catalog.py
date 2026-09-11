"""Phase 07 music catalog: releases, tracks, versions, release_tracks, credits.

Revision ID: 0008_music_catalog
Revises: 0007_artist_band_label
Create Date: 2026-09-11
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008_music_catalog"
down_revision: Union[str, Sequence[str], None] = "0007_artist_band_label"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(sa.text("CREATE SCHEMA IF NOT EXISTS music"))

    op.create_table(
        "releases",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("release_type", sa.String(32), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("primary_artist_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("primary_band_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="IDEA"),
        sa.Column("release_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cover_asset_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("primary_org_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("metadata", postgresql.JSONB(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "release_type IN ('SINGLE','EP','ALBUM','COMPILATION','LIVE')",
            name="ck_releases_release_type",
        ),
        sa.CheckConstraint(
            "status IN ('IDEA','DEMO','IN_PRODUCTION','QC','METADATA_REVIEW',"
            "'APPROVED','SCHEDULED','RELEASED','TAKEN_DOWN','ARCHIVED')",
            name="ck_releases_status",
        ),
        sa.CheckConstraint(
            "primary_artist_id IS NULL OR primary_band_id IS NULL",
            name="ck_releases_primary_party",
        ),
        sa.ForeignKeyConstraint(
            ["primary_artist_id"],
            ["artists.artists.id"],
            name="fk_releases_primary_artist_id_artists",
        ),
        sa.ForeignKeyConstraint(
            ["primary_band_id"],
            ["artists.bands.id"],
            name="fk_releases_primary_band_id_bands",
        ),
        sa.ForeignKeyConstraint(
            ["cover_asset_id"],
            ["documents.media_assets.id"],
            name="fk_releases_cover_asset_id_media_assets",
        ),
        sa.ForeignKeyConstraint(
            ["primary_org_id"],
            ["identity.organizations.id"],
            name="fk_releases_primary_org_id_organizations",
        ),
        schema="music",
    )
    op.create_index("ix_releases_status", "releases", ["status"], schema="music")
    op.create_index("ix_releases_release_at", "releases", ["release_at"], schema="music")
    op.create_index("ix_releases_primary_org_id", "releases", ["primary_org_id"], schema="music")

    op.create_table(
        "tracks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("isrc", sa.String(32), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="DRAFT"),
        sa.Column("primary_artist_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("primary_band_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("primary_org_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("metadata", postgresql.JSONB(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('DRAFT','SUBMITTED','IN_REVIEW','APPROVED','SCHEDULED',"
            "'RELEASED','REJECTED','TAKEN_DOWN','ARCHIVED')",
            name="ck_tracks_status",
        ),
        sa.CheckConstraint(
            "primary_artist_id IS NULL OR primary_band_id IS NULL",
            name="ck_tracks_primary_party",
        ),
        sa.ForeignKeyConstraint(
            ["primary_artist_id"],
            ["artists.artists.id"],
            name="fk_tracks_primary_artist_id_artists",
        ),
        sa.ForeignKeyConstraint(
            ["primary_band_id"],
            ["artists.bands.id"],
            name="fk_tracks_primary_band_id_bands",
        ),
        sa.ForeignKeyConstraint(
            ["primary_org_id"],
            ["identity.organizations.id"],
            name="fk_tracks_primary_org_id_organizations",
        ),
        schema="music",
    )
    op.create_index("ix_tracks_status", "tracks", ["status"], schema="music")
    op.create_index("ix_tracks_primary_org_id", "tracks", ["primary_org_id"], schema="music")
    op.create_index(
        "uq_tracks_isrc",
        "tracks",
        ["isrc"],
        unique=True,
        schema="music",
        postgresql_where=sa.text("isrc IS NOT NULL AND deleted_at IS NULL"),
    )

    op.create_table(
        "track_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("track_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version_type", sa.String(32), nullable=False, server_default="MASTER"),
        sa.Column("media_asset_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="UPLOADING"),
        sa.Column("is_current", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('UPLOADING','PROCESSING','READY','REJECTED','SUPERSEDED')",
            name="ck_track_versions_status",
        ),
        sa.CheckConstraint("version_type IN ('MASTER','WORKING')", name="ck_track_versions_version_type"),
        sa.CheckConstraint("duration_ms IS NULL OR duration_ms >= 0", name="ck_track_versions_duration_ms"),
        sa.ForeignKeyConstraint(
            ["track_id"],
            ["music.tracks.id"],
            name="fk_track_versions_track_id_tracks",
        ),
        sa.ForeignKeyConstraint(
            ["media_asset_id"],
            ["documents.media_assets.id"],
            name="fk_track_versions_media_asset_id_media_assets",
        ),
        schema="music",
    )
    op.create_index(
        "ix_track_versions_track_current",
        "track_versions",
        ["track_id", "is_current"],
        schema="music",
    )
    op.create_index(
        "uq_track_versions_current",
        "track_versions",
        ["track_id"],
        unique=True,
        schema="music",
        postgresql_where=sa.text("is_current IS TRUE AND deleted_at IS NULL"),
    )

    op.create_table(
        "release_tracks",
        sa.Column("release_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("track_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.PrimaryKeyConstraint("release_id", "track_id", name="pk_release_tracks"),
        sa.UniqueConstraint("release_id", "position", name="uq_release_tracks_position"),
        sa.CheckConstraint("position >= 1", name="ck_release_tracks_position"),
        sa.ForeignKeyConstraint(
            ["release_id"],
            ["music.releases.id"],
            name="fk_release_tracks_release_id_releases",
        ),
        sa.ForeignKeyConstraint(
            ["track_id"],
            ["music.tracks.id"],
            name="fk_release_tracks_track_id_tracks",
        ),
        schema="music",
    )

    op.create_table(
        "credits",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("track_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("release_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("artist_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("credit_role", sa.String(80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "track_id IS NOT NULL OR release_id IS NOT NULL",
            name="ck_credits_credit_subject",
        ),
        sa.CheckConstraint(
            "artist_id IS NOT NULL OR user_id IS NOT NULL",
            name="ck_credits_credit_party",
        ),
        sa.ForeignKeyConstraint(
            ["track_id"],
            ["music.tracks.id"],
            name="fk_credits_track_id_tracks",
        ),
        sa.ForeignKeyConstraint(
            ["release_id"],
            ["music.releases.id"],
            name="fk_credits_release_id_releases",
        ),
        sa.ForeignKeyConstraint(
            ["artist_id"],
            ["artists.artists.id"],
            name="fk_credits_artist_id_artists",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["identity.users.id"],
            name="fk_credits_user_id_users",
        ),
        schema="music",
    )
    op.create_index("ix_credits_track_id", "credits", ["track_id"], schema="music")
    op.create_index("ix_credits_release_id", "credits", ["release_id"], schema="music")


def downgrade() -> None:
    op.drop_index("ix_credits_release_id", table_name="credits", schema="music")
    op.drop_index("ix_credits_track_id", "credits", schema="music")
    op.drop_table("credits", schema="music")
    op.drop_table("release_tracks", schema="music")
    op.drop_index("uq_track_versions_current", table_name="track_versions", schema="music")
    op.drop_index("ix_track_versions_track_current", table_name="track_versions", schema="music")
    op.drop_table("track_versions", schema="music")
    op.drop_index("uq_tracks_isrc", table_name="tracks", schema="music")
    op.drop_index("ix_tracks_primary_org_id", table_name="tracks", schema="music")
    op.drop_index("ix_tracks_status", table_name="tracks", schema="music")
    op.drop_table("tracks", schema="music")
    op.drop_index("ix_releases_primary_org_id", table_name="releases", schema="music")
    op.drop_index("ix_releases_release_at", table_name="releases", schema="music")
    op.drop_index("ix_releases_status", table_name="releases", schema="music")
    op.drop_table("releases", schema="music")
    op.execute(sa.text("DROP SCHEMA IF EXISTS music"))
