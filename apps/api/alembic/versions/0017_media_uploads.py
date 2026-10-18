"""Audio platform Phase 2: resumable uploads, media asset ownership, band admins. Additive only.

Revision ID: 0017_media_uploads
Revises: 0016_external_identities
Create Date: 2026-10-17

Design: docs/phases/AUDIO_PHASE_1_DESIGN.md sections 3.3, 4.2 and 6. New nullable columns on
media_assets (rows created before this keep NULL), a boolean band admin flag (default false),
and two new tables for upload intents and their parts. Nothing existing is rewritten.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0017_media_uploads"
down_revision: Union[str, Sequence[str], None] = "0016_external_identities"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.add_column("media_assets", sa.Column("purpose", sa.String(24), nullable=True), schema="documents")
    op.add_column("media_assets", sa.Column("uploaded_by", UUID, nullable=True), schema="documents")
    op.add_column(
        "media_assets", sa.Column("on_behalf_profile_type", sa.String(8), nullable=True), schema="documents"
    )
    op.add_column("media_assets", sa.Column("on_behalf_profile_id", UUID, nullable=True), schema="documents")
    op.add_column("media_assets", sa.Column("parent_asset_id", UUID, nullable=True), schema="documents")
    op.add_column(
        "media_assets",
        sa.Column("immutable", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        schema="documents",
    )
    op.create_foreign_key(
        "fk_media_assets_parent_asset_id_media_assets",
        "media_assets",
        "media_assets",
        ["parent_asset_id"],
        ["id"],
        source_schema="documents",
        referent_schema="documents",
    )

    op.add_column(
        "band_members",
        sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        schema="artists",
    )

    op.add_column("track_versions", sa.Column("uploaded_by", UUID, nullable=True), schema="music")
    op.add_column(
        "track_versions", sa.Column("on_behalf_profile_type", sa.String(8), nullable=True), schema="music"
    )
    op.add_column("track_versions", sa.Column("on_behalf_profile_id", UUID, nullable=True), schema="music")
    op.add_column("track_versions", sa.Column("processing_detail", sa.String(64), nullable=True), schema="music")

    op.create_table(
        "upload_intents",
        sa.Column("id", UUID, nullable=False),
        sa.Column("media_asset_id", UUID, nullable=False),
        sa.Column("purpose", sa.String(24), nullable=False),
        sa.Column("owner_user_id", UUID, nullable=False),
        sa.Column("target_type", sa.String(24), nullable=False),
        sa.Column("target_id", UUID, nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("declared_byte_size", sa.BigInteger(), nullable=False),
        sa.Column("declared_sha256", sa.String(64), nullable=True),
        sa.Column("part_size", sa.Integer(), nullable=False),
        sa.Column("part_count", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_upload_intents"),
        sa.ForeignKeyConstraint(
            ["media_asset_id"],
            ["documents.media_assets.id"],
            name="fk_upload_intents_media_asset_id_media_assets",
        ),
        sa.UniqueConstraint("media_asset_id", name="uq_upload_intents_media_asset_id"),
        sa.CheckConstraint("purpose IN ('AUDIO_MASTER','COVER_ART')", name="ck_upload_intents_purpose"),
        sa.CheckConstraint(
            "target_type IN ('track_version','release_cover')", name="ck_upload_intents_target_type"
        ),
        sa.CheckConstraint(
            "status IN ('OPEN','COMPLETING','COMPLETED','CANCELLED','EXPIRED')",
            name="ck_upload_intents_status",
        ),
        sa.CheckConstraint("declared_byte_size > 0", name="ck_upload_intents_declared_byte_size"),
        sa.CheckConstraint("part_size > 0 AND part_count > 0", name="ck_upload_intents_parts"),
        schema="documents",
    )
    op.create_index(
        "ix_upload_intents_status_expires", "upload_intents", ["status", "expires_at"], schema="documents"
    )
    op.create_index("ix_upload_intents_owner", "upload_intents", ["owner_user_id", "status"], schema="documents")

    op.create_table(
        "upload_parts",
        sa.Column("intent_id", UUID, nullable=False),
        sa.Column("part_number", sa.Integer(), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("intent_id", "part_number", name="pk_upload_parts"),
        sa.ForeignKeyConstraint(
            ["intent_id"],
            ["documents.upload_intents.id"],
            name="fk_upload_parts_intent_id_upload_intents",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint("part_number >= 1", name="ck_upload_parts_part_number"),
        sa.CheckConstraint("byte_size > 0", name="ck_upload_parts_byte_size"),
        schema="documents",
    )


def downgrade() -> None:
    op.drop_table("upload_parts", schema="documents")
    op.drop_index("ix_upload_intents_owner", table_name="upload_intents", schema="documents")
    op.drop_index("ix_upload_intents_status_expires", table_name="upload_intents", schema="documents")
    op.drop_table("upload_intents", schema="documents")
    for column in ("processing_detail", "on_behalf_profile_id", "on_behalf_profile_type", "uploaded_by"):
        op.drop_column("track_versions", column, schema="music")
    op.drop_column("band_members", "is_admin", schema="artists")
    op.drop_constraint(
        "fk_media_assets_parent_asset_id_media_assets", "media_assets", schema="documents", type_="foreignkey"
    )
    for column in (
        "immutable",
        "parent_asset_id",
        "on_behalf_profile_id",
        "on_behalf_profile_type",
        "uploaded_by",
        "purpose",
    ):
        op.drop_column("media_assets", column, schema="documents")
