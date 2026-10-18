"""Audio platform Phase 6: release review history. Additive only.

Revision ID: 0020_release_reviews
Revises: 0019_catalog_intake
Create Date: 2026-10-17

One row per reviewer decision with the note the artist sees (design 5.4). Release commerce
moves to 0021 (Phase 7).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0020_release_reviews"
down_revision: Union[str, Sequence[str], None] = "0019_catalog_intake"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "release_reviews",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("release_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("reviewer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("action", sa.String(24), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("from_status", sa.String(32), nullable=False),
        sa.Column("to_status", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_release_reviews"),
        sa.ForeignKeyConstraint(["release_id"], ["music.releases.id"], name="fk_release_reviews_release_id_releases"),
        sa.CheckConstraint(
            "action IN ('start_review','approve','request_changes','schedule','release','takedown')",
            name="ck_release_reviews_action",
        ),
        schema="music",
    )
    op.create_index("ix_release_reviews_release", "release_reviews", ["release_id", "created_at"], schema="music")


def downgrade() -> None:
    op.drop_index("ix_release_reviews_release", table_name="release_reviews", schema="music")
    op.drop_table("release_reviews", schema="music")
