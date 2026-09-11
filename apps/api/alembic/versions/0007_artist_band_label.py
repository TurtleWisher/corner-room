"""Phase 06 artist, band, follow, and event lineup.

Revision ID: 0007_artist_band_label
Revises: 0006_ticketing_attendance
Create Date: 2026-09-11
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007_artist_band_label"
down_revision: Union[str, Sequence[str], None] = "0006_ticketing_attendance"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(sa.text("CREATE SCHEMA IF NOT EXISTS artists"))

    op.create_table(
        "artists",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("claimed_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("stage_name", sa.String(200), nullable=False),
        sa.Column("legal_name", sa.String(200), nullable=True),
        sa.Column("bio", sa.Text(), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="APPLIED"),
        sa.Column("primary_org_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("portrait_asset_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("metadata", postgresql.JSONB(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('APPLIED','UNDER_REVIEW','APPROVED','CONTRACT_PENDING',"
            "'SIGNED','ACTIVE','SUSPENDED','TERMINATED','REJECTED')",
            name="ck_artists_status",
        ),
        sa.ForeignKeyConstraint(["claimed_user_id"], ["identity.users.id"], name="fk_artists_claimed_user_id_users"),
        sa.ForeignKeyConstraint(
            ["primary_org_id"],
            ["identity.organizations.id"],
            name="fk_artists_primary_org_id_organizations",
        ),
        sa.ForeignKeyConstraint(
            ["portrait_asset_id"],
            ["documents.media_assets.id"],
            name="fk_artists_portrait_asset_id_media_assets",
        ),
        schema="artists",
    )
    op.create_index("ix_artists_status", "artists", ["status"], schema="artists")
    op.create_index("ix_artists_stage_name", "artists", ["stage_name"], schema="artists")
    op.create_index("ix_artists_primary_org_id", "artists", ["primary_org_id"], schema="artists")
    op.create_index(
        "uq_artists_claimed_user_id",
        "artists",
        ["claimed_user_id"],
        unique=True,
        schema="artists",
        postgresql_where=sa.text("claimed_user_id IS NOT NULL AND deleted_at IS NULL"),
    )

    op.create_table(
        "artist_applications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("artist_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="SUBMITTED"),
        sa.Column("payload", postgresql.JSONB(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED','WITHDRAWN')",
            name="ck_artist_applications_status",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["identity.users.id"], name="fk_artist_applications_user_id_users"),
        sa.ForeignKeyConstraint(
            ["artist_id"],
            ["artists.artists.id"],
            name="fk_artist_applications_artist_id_artists",
        ),
        schema="artists",
    )
    op.create_index("ix_artist_applications_user_id", "artist_applications", ["user_id"], schema="artists")
    op.create_index("ix_artist_applications_artist_id", "artist_applications", ["artist_id"], schema="artists")
    op.create_index("ix_artist_applications_status", "artist_applications", ["status"], schema="artists")
    op.create_index(
        "uq_artist_applications_outstanding_user",
        "artist_applications",
        ["user_id"],
        unique=True,
        schema="artists",
        postgresql_where=sa.text("status IN ('SUBMITTED','UNDER_REVIEW') AND deleted_at IS NULL"),
    )

    op.create_table(
        "bands",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="FORMING"),
        sa.Column("primary_org_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("bio", sa.Text(), nullable=True),
        sa.Column("portrait_asset_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("metadata", postgresql.JSONB(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('FORMING','ACTIVE','HIATUS','DISBANDED')",
            name="ck_bands_status",
        ),
        sa.ForeignKeyConstraint(
            ["primary_org_id"],
            ["identity.organizations.id"],
            name="fk_bands_primary_org_id_organizations",
        ),
        sa.ForeignKeyConstraint(
            ["portrait_asset_id"],
            ["documents.media_assets.id"],
            name="fk_bands_portrait_asset_id_media_assets",
        ),
        schema="artists",
    )
    op.create_index("ix_bands_status", "bands", ["status"], schema="artists")
    op.create_index("ix_bands_name", "bands", ["name"], schema="artists")
    op.create_index("ix_bands_primary_org_id", "bands", ["primary_org_id"], schema="artists")

    op.create_table(
        "band_members",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("band_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("artist_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("role_label", sa.String(80), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="INVITED"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('INVITED','ACTIVE','LEFT','REMOVED')",
            name="ck_band_members_status",
        ),
        sa.CheckConstraint(
            "user_id IS NOT NULL OR artist_id IS NOT NULL",
            name="ck_band_members_member_party",
        ),
        sa.ForeignKeyConstraint(["band_id"], ["artists.bands.id"], name="fk_band_members_band_id_bands"),
        sa.ForeignKeyConstraint(["user_id"], ["identity.users.id"], name="fk_band_members_user_id_users"),
        sa.ForeignKeyConstraint(["artist_id"], ["artists.artists.id"], name="fk_band_members_artist_id_artists"),
        schema="artists",
    )
    op.create_index("ix_band_members_band_id", "band_members", ["band_id"], schema="artists")
    op.create_index("ix_band_members_user_id", "band_members", ["user_id"], schema="artists")
    op.create_index("ix_band_members_artist_id", "band_members", ["artist_id"], schema="artists")
    op.create_index(
        "uq_band_members_active_user",
        "band_members",
        ["band_id", "user_id"],
        unique=True,
        schema="artists",
        postgresql_where=sa.text("status = 'ACTIVE' AND user_id IS NOT NULL AND deleted_at IS NULL"),
    )
    op.create_index(
        "uq_band_members_active_artist",
        "band_members",
        ["band_id", "artist_id"],
        unique=True,
        schema="artists",
        postgresql_where=sa.text("status = 'ACTIVE' AND artist_id IS NOT NULL AND deleted_at IS NULL"),
    )

    op.create_table(
        "follows",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("target_type", sa.String(16), nullable=False),
        sa.Column("target_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="ACTIVE"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('ACTIVE','UNFOLLOWED')", name="ck_follows_status"),
        sa.CheckConstraint("target_type IN ('ARTIST','BAND')", name="ck_follows_target_type"),
        sa.ForeignKeyConstraint(["user_id"], ["identity.users.id"], name="fk_follows_user_id_users"),
        schema="artists",
    )
    op.create_index("ix_follows_user_id", "follows", ["user_id"], schema="artists")
    op.create_index("ix_follows_target", "follows", ["target_type", "target_id"], schema="artists")
    op.create_index(
        "uq_follows_active",
        "follows",
        ["user_id", "target_type", "target_id"],
        unique=True,
        schema="artists",
        postgresql_where=sa.text("status = 'ACTIVE' AND deleted_at IS NULL"),
    )

    op.create_table(
        "event_lineups",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("artist_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("band_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("billing_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(32), nullable=False, server_default="INVITED"),
        sa.Column("contract_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("metadata", postgresql.JSONB(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('INVITED','CONFIRMED','PERFORMED','WITHDRAWN','NO_SHOW')",
            name="ck_event_lineups_status",
        ),
        sa.CheckConstraint(
            "(artist_id IS NOT NULL AND band_id IS NULL) OR (artist_id IS NULL AND band_id IS NOT NULL)",
            name="ck_event_lineups_lineup_party",
        ),
        sa.ForeignKeyConstraint(["event_id"], ["events.events.id"], name="fk_event_lineups_event_id_events"),
        sa.ForeignKeyConstraint(["artist_id"], ["artists.artists.id"], name="fk_event_lineups_artist_id_artists"),
        sa.ForeignKeyConstraint(["band_id"], ["artists.bands.id"], name="fk_event_lineups_band_id_bands"),
        schema="events",
    )
    op.create_index("ix_event_lineups_event_id", "event_lineups", ["event_id"], schema="events")
    op.create_index("ix_event_lineups_artist_id", "event_lineups", ["artist_id"], schema="events")
    op.create_index("ix_event_lineups_band_id", "event_lineups", ["band_id"], schema="events")
    op.create_index(
        "uq_event_lineups_active_artist",
        "event_lineups",
        ["event_id", "artist_id"],
        unique=True,
        schema="events",
        postgresql_where=sa.text(
            "artist_id IS NOT NULL AND status IN ('INVITED','CONFIRMED') AND deleted_at IS NULL"
        ),
    )
    op.create_index(
        "uq_event_lineups_active_band",
        "event_lineups",
        ["event_id", "band_id"],
        unique=True,
        schema="events",
        postgresql_where=sa.text(
            "band_id IS NOT NULL AND status IN ('INVITED','CONFIRMED') AND deleted_at IS NULL"
        ),
    )


def downgrade() -> None:
    op.drop_table("event_lineups", schema="events")
    op.drop_table("follows", schema="artists")
    op.drop_table("band_members", schema="artists")
    op.drop_table("bands", schema="artists")
    op.drop_table("artist_applications", schema="artists")
    op.drop_table("artists", schema="artists")
    op.execute(sa.text("DROP SCHEMA IF EXISTS artists"))
