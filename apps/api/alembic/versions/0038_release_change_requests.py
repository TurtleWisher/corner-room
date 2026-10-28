"""Changes to released music, reviewed by staff. Additive only.

Revision ID: 0038_release_change_requests
Revises: 0037_listens_before_cover_review
Create Date: 2026-10-28

Owner, 2026-10-28 (D-CHANGES-01): after publishing, a band or artist may change anything about
their music (release and song details, credits, the audio file); every change waits for staff and
goes public only once approved. One open request per release holds the checked changes as JSON;
a replacement audio version is processed but stays off the air until the request is approved.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0038_release_change_requests"
down_revision: Union[str, Sequence[str], None] = "0037_listens_before_cover_review"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "release_change_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("release_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("music.releases.id"), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="OPEN"),
        sa.Column("changes", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("submitted_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint(
            "status IN ('OPEN','SUBMITTED','APPROVED','REJECTED','WITHDRAWN')",
            name="ck_release_change_requests_status",
        ),
        schema="music",
    )
    op.create_index("ix_release_change_requests_release", "release_change_requests", ["release_id", "status"], schema="music")
    op.create_index(
        "uq_release_change_requests_live",
        "release_change_requests",
        ["release_id"],
        unique=True,
        schema="music",
        postgresql_where=sa.text("status IN ('OPEN','SUBMITTED')"),
    )


def downgrade() -> None:
    op.drop_index("uq_release_change_requests_live", table_name="release_change_requests", schema="music")
    op.drop_index("ix_release_change_requests_release", table_name="release_change_requests", schema="music")
    op.drop_table("release_change_requests", schema="music")
