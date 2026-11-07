"""Teasers: short excerpts of a song's master that anyone can hear for free. Additive only.

Revision ID: 0053_teasers
Revises: 0052_gift_people_added
Create Date: 2026-11-07

Owner, 2026-11-07 (D-TEASER-00 to D-TEASER-04): an artist cuts a teaser from the song's own master
(never a second upload), staff approve each version, and anyone can listen to a published teaser as
often as they like without buying the song. A teaser belongs to one track from the start, so the
same teaser stays on the same song before and after its release.

- music.teasers: the teaser and which version the public hears;
- music.teaser_versions: edit settings (start, end, fades, gain) and their review; never changed
  once processed, editing again makes a new version;
- music.teaser_renditions: the encoded teaser files (class teaser_audio, never catalog_audio);
- music.track_waveforms: peaks of a master for the editor, made once by the worker;
- music.teaser_counts: running totals per teaser per hour, nothing about a listener.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0053_teasers"
down_revision: Union[str, Sequence[str], None] = "0052_gift_people_added"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)
NOW = sa.text("now()")


def upgrade() -> None:
    # Two new worker job kinds: WAVEFORM (editor peaks) and TEASER (teaser copies).
    op.drop_constraint("ck_media_jobs_kind", "media_jobs", schema="documents", type_="check")
    op.create_check_constraint(
        "ck_media_jobs_kind", "media_jobs", "kind IN ('INSPECT','TRANSCODE','WAVEFORM','TEASER')", schema="documents"
    )
    op.create_table(
        "teasers",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("track_id", UUID, sa.ForeignKey("music.tracks.id"), nullable=False),
        sa.Column("title", sa.String(120), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="DRAFT"),
        sa.Column("live_version_id", UUID, nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", UUID, nullable=True),
        sa.Column("updated_by", UUID, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        sa.CheckConstraint("status IN ('DRAFT','IN_REVIEW','PUBLISHED','UNPUBLISHED')", name="ck_teasers_status"),
        schema="music",
    )
    op.create_index(
        "ix_teasers_track", "teasers", ["track_id"], schema="music", postgresql_where=sa.text("deleted_at IS NULL")
    )
    op.create_table(
        "teaser_versions",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("teaser_id", UUID, sa.ForeignKey("music.teasers.id"), nullable=False),
        sa.Column("number", sa.Integer, nullable=False),
        sa.Column("source_track_version_id", UUID, sa.ForeignKey("music.track_versions.id"), nullable=False),
        sa.Column("start_ms", sa.Integer, nullable=False),
        sa.Column("end_ms", sa.Integer, nullable=False),
        sa.Column("fade_in_ms", sa.Integer, nullable=False, server_default="0"),
        sa.Column("fade_out_ms", sa.Integer, nullable=False, server_default="0"),
        sa.Column("gain_cdb", sa.Integer, nullable=False, server_default="0"),
        sa.Column("status", sa.String(16), nullable=False, server_default="DRAFT"),
        sa.Column("failure_code", sa.String(64), nullable=True),
        sa.Column("processing_version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("duration_ms", sa.Integer, nullable=True),
        sa.Column("integrated_lufs", sa.Numeric(6, 2), nullable=True),
        sa.Column("true_peak_dbtp", sa.Numeric(6, 2), nullable=True),
        sa.Column("review_status", sa.String(16), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("submitted_by", UUID, nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_by", UUID, nullable=True),
        sa.Column("review_note", sa.Text, nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("retired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", UUID, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
        sa.UniqueConstraint("teaser_id", "number", name="uq_teaser_versions_teaser_id"),
        sa.CheckConstraint("start_ms >= 0 AND end_ms > start_ms", name="ck_teaser_versions_span"),
        sa.CheckConstraint("fade_in_ms >= 0 AND fade_out_ms >= 0", name="ck_teaser_versions_fades"),
        sa.CheckConstraint("status IN ('DRAFT','PROCESSING','READY','FAILED')", name="ck_teaser_versions_status"),
        sa.CheckConstraint(
            "review_status IS NULL OR review_status IN ('WAITING','APPROVED','RETURNED','WITHDRAWN')",
            name="ck_teaser_versions_review",
        ),
        schema="music",
    )
    op.create_foreign_key(
        "fk_teasers_live_version", "teasers", "teaser_versions", ["live_version_id"], ["id"],
        source_schema="music", referent_schema="music",
    )
    op.create_index(
        "ix_teaser_versions_waiting", "teaser_versions", ["submitted_at"], schema="music",
        postgresql_where=sa.text("review_status = 'WAITING'"),
    )
    op.create_table(
        "teaser_renditions",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("teaser_version_id", UUID, sa.ForeignKey("music.teaser_versions.id"), nullable=False),
        sa.Column("profile_key", sa.String(32), nullable=False),
        sa.Column("profile_version", sa.Integer, nullable=False),
        sa.Column("media_asset_id", UUID, sa.ForeignKey("documents.media_assets.id"), nullable=False),
        sa.Column("codec", sa.String(16), nullable=False),
        sa.Column("container", sa.String(16), nullable=False),
        sa.Column("bitrate_kbps", sa.Integer, nullable=False),
        sa.Column("duration_ms", sa.Integer, nullable=False),
        sa.Column("byte_size", sa.BigInteger, nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("encoder_version", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
        sa.UniqueConstraint("teaser_version_id", "profile_key", "profile_version", name="uq_teaser_renditions_teaser_version_id"),
        schema="music",
    )
    op.create_table(
        "track_waveforms",
        sa.Column("track_version_id", UUID, sa.ForeignKey("music.track_versions.id"), primary_key=True),
        sa.Column("points", postgresql.JSONB, nullable=False),
        sa.Column("bucket_ms", sa.Integer, nullable=False),
        sa.Column("duration_ms", sa.Integer, nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
        schema="music",
    )
    op.create_table(
        "teaser_counts",
        sa.Column("teaser_id", UUID, sa.ForeignKey("music.teasers.id"), primary_key=True),
        sa.Column("hour", sa.DateTime(timezone=True), primary_key=True),
        sa.Column("starts", sa.Integer, nullable=False, server_default="0"),
        sa.Column("completes", sa.Integer, nullable=False, server_default="0"),
        sa.Column("prompt_clicks", sa.Integer, nullable=False, server_default="0"),
        schema="music",
    )


def downgrade() -> None:
    op.drop_table("teaser_counts", schema="music")
    op.drop_table("track_waveforms", schema="music")
    op.drop_table("teaser_renditions", schema="music")
    op.drop_constraint("fk_teasers_live_version", "teasers", schema="music", type_="foreignkey")
    op.drop_index("ix_teaser_versions_waiting", table_name="teaser_versions", schema="music")
    op.drop_table("teaser_versions", schema="music")
    op.drop_index("ix_teasers_track", table_name="teasers", schema="music")
    op.drop_table("teasers", schema="music")
    op.execute("DELETE FROM documents.media_jobs WHERE kind IN ('WAVEFORM','TEASER')")
    op.drop_constraint("ck_media_jobs_kind", "media_jobs", schema="documents", type_="check")
    op.create_check_constraint("ck_media_jobs_kind", "media_jobs", "kind IN ('INSPECT','TRANSCODE')", schema="documents")
