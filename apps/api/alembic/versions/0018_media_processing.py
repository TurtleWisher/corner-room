"""Audio platform Phase 3: media checks, durable media jobs, playback copies. Additive only.

Revision ID: 0018_media_processing
Revises: 0017_media_uploads
Create Date: 2026-10-17

Design: docs/phases/AUDIO_PHASE_1_DESIGN.md sections 4.1, 4.2, 5.2, 7. Five new tables. Rendition
profiles are seeded by the application seed (infra/seed.py) as CANDIDATE rows, not here.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0018_media_processing"
down_revision: Union[str, Sequence[str], None] = "0017_media_uploads"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "media_inspections",
        sa.Column("id", UUID, nullable=False),
        sa.Column("media_asset_id", UUID, nullable=False),
        sa.Column("tool", sa.String(48), nullable=False),
        sa.Column("tool_version", sa.String(64), nullable=False),
        sa.Column("container", sa.String(16), nullable=True),
        sa.Column("codec", sa.String(16), nullable=True),
        sa.Column("wav_format_code", sa.Integer(), nullable=True),
        sa.Column("sample_rate_hz", sa.Integer(), nullable=True),
        sa.Column("bit_depth", sa.Integer(), nullable=True),
        sa.Column("sample_format", sa.String(16), nullable=True),
        sa.Column("channels", sa.Integer(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("integrated_lufs", sa.Numeric(6, 2), nullable=True),
        sa.Column("loudness_range_lu", sa.Numeric(6, 2), nullable=True),
        sa.Column("true_peak_dbtp", sa.Numeric(6, 2), nullable=True),
        sa.Column("width_px", sa.Integer(), nullable=True),
        sa.Column("height_px", sa.Integer(), nullable=True),
        sa.Column("verified_sha256", sa.String(64), nullable=False),
        sa.Column("outcome", sa.String(32), nullable=False),
        sa.Column("inspected_at", sa.DateTime(timezone=True), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_media_inspections"),
        sa.ForeignKeyConstraint(
            ["media_asset_id"], ["documents.media_assets.id"], name="fk_media_inspections_media_asset_id_media_assets"
        ),
        sa.UniqueConstraint("media_asset_id", "tool_version", name="uq_media_inspections_asset_tool"),
        sa.CheckConstraint(
            "outcome IN ('ACCEPTED','ACCEPTED_WITH_WARNINGS','REJECTED')", name="ck_media_inspections_outcome"
        ),
        schema="documents",
    )
    op.create_table(
        "media_findings",
        sa.Column("id", UUID, nullable=False),
        sa.Column("inspection_id", UUID, nullable=False),
        sa.Column("code", sa.String(48), nullable=False),
        sa.Column("severity", sa.String(8), nullable=False),
        sa.Column("measured", sa.String(64), nullable=True),
        sa.Column("limit", sa.String(64), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_media_findings"),
        sa.ForeignKeyConstraint(
            ["inspection_id"],
            ["documents.media_inspections.id"],
            name="fk_media_findings_inspection_id_media_inspections",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint("severity IN ('BLOCK','WARN')", name="ck_media_findings_severity"),
        schema="documents",
    )
    op.create_index("ix_media_findings_inspection", "media_findings", ["inspection_id"], schema="documents")
    op.create_table(
        "media_jobs",
        sa.Column("id", UUID, nullable=False),
        sa.Column("media_asset_id", UUID, nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("target_id", UUID, nullable=True),
        sa.Column("profile_key", sa.String(32), nullable=True),
        sa.Column("idempotency_key", sa.String(160), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("max_attempts", sa.Integer(), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_error_code", sa.String(64), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("worker_id", sa.String(64), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_media_jobs"),
        sa.ForeignKeyConstraint(
            ["media_asset_id"], ["documents.media_assets.id"], name="fk_media_jobs_media_asset_id_media_assets"
        ),
        sa.UniqueConstraint("idempotency_key", name="uq_media_jobs_idempotency_key"),
        sa.CheckConstraint("kind IN ('INSPECT','TRANSCODE')", name="ck_media_jobs_kind"),
        sa.CheckConstraint(
            "status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','DEAD','CANCELLED')", name="ck_media_jobs_status"
        ),
        schema="documents",
    )
    op.create_index("ix_media_jobs_status_next", "media_jobs", ["status", "next_attempt_at"], schema="documents")
    op.create_index("ix_media_jobs_asset", "media_jobs", ["media_asset_id"], schema="documents")

    op.create_table(
        "rendition_profiles",
        sa.Column("key", sa.String(32), nullable=False),
        sa.Column("codec", sa.String(16), nullable=False),
        sa.Column("container", sa.String(16), nullable=False),
        sa.Column("bitrate_kbps", sa.Integer(), nullable=False),
        sa.Column("sample_rate_hz", sa.Integer(), nullable=False),
        sa.Column("channels", sa.Integer(), nullable=False),
        sa.Column("profile_version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("required", sa.Boolean(), nullable=False),
        sa.Column("sort", sa.Integer(), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("key", name="pk_rendition_profiles"),
        sa.CheckConstraint("status IN ('CANDIDATE','ACTIVE','RETIRED')", name="ck_rendition_profiles_status"),
        sa.CheckConstraint("codec IN ('opus','mp3')", name="ck_rendition_profiles_codec"),
        schema="music",
    )
    op.create_table(
        "track_renditions",
        sa.Column("id", UUID, nullable=False),
        sa.Column("track_version_id", UUID, nullable=False),
        sa.Column("profile_key", sa.String(32), nullable=False),
        sa.Column("profile_version", sa.Integer(), nullable=False),
        sa.Column("media_asset_id", UUID, nullable=False),
        sa.Column("codec", sa.String(16), nullable=False),
        sa.Column("container", sa.String(16), nullable=False),
        sa.Column("bitrate_kbps", sa.Integer(), nullable=False),
        sa.Column("sample_rate_hz", sa.Integer(), nullable=False),
        sa.Column("channels", sa.Integer(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("encoder", sa.String(32), nullable=False),
        sa.Column("encoder_version", sa.String(64), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_track_renditions"),
        sa.ForeignKeyConstraint(
            ["track_version_id"], ["music.track_versions.id"], name="fk_track_renditions_track_version_id_track_versions"
        ),
        sa.ForeignKeyConstraint(
            ["media_asset_id"], ["documents.media_assets.id"], name="fk_track_renditions_media_asset_id_media_assets"
        ),
        sa.UniqueConstraint(
            "track_version_id", "profile_key", "profile_version", name="uq_track_renditions_version_profile"
        ),
        sa.CheckConstraint("status IN ('READY','RETIRED')", name="ck_track_renditions_status"),
        schema="music",
    )
    op.create_index("ix_track_renditions_version", "track_renditions", ["track_version_id"], schema="music")


def downgrade() -> None:
    op.drop_index("ix_track_renditions_version", table_name="track_renditions", schema="music")
    op.drop_table("track_renditions", schema="music")
    op.drop_table("rendition_profiles", schema="music")
    op.drop_index("ix_media_jobs_asset", table_name="media_jobs", schema="documents")
    op.drop_index("ix_media_jobs_status_next", table_name="media_jobs", schema="documents")
    op.drop_table("media_jobs", schema="documents")
    op.drop_index("ix_media_findings_inspection", table_name="media_findings", schema="documents")
    op.drop_table("media_findings", schema="documents")
    op.drop_table("media_inspections", schema="documents")
