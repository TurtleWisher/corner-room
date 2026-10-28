"""Plays before counting started, and cover changes waiting for staff. Additive only.

Revision ID: 0037_listens_before_cover_review
Revises: 0036_international_addresses
Create Date: 2026-10-28

Owner, 2026-10-28:
- D-LISTEN-02: a song can carry the plays it had before listen counting started (Chaya Pore: 641),
  set by staff and audited; the public count is that number plus every counted listen since.
- D-COVER-01: a new cover for a release that is already approved or out waits for staff every time
  (`cover_pending_asset_id`); listeners keep the current cover until someone other than the
  uploader approves it.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0037_listens_before_cover_review"
down_revision: Union[str, Sequence[str], None] = "0036_international_addresses"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tracks",
        sa.Column("listens_before_counting", sa.Integer(), nullable=False, server_default="0"),
        schema="music",
    )
    op.create_check_constraint(
        op.f("ck_tracks_listens_before_counting"), "tracks", "listens_before_counting >= 0", schema="music"
    )
    op.add_column(
        "releases",
        sa.Column(
            "cover_pending_asset_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("documents.media_assets.id"),
            nullable=True,
        ),
        schema="music",
    )
    op.add_column(
        "releases", sa.Column("cover_pending_at", sa.DateTime(timezone=True), nullable=True), schema="music"
    )
    op.add_column(
        "releases", sa.Column("cover_pending_by", postgresql.UUID(as_uuid=True), nullable=True), schema="music"
    )
    op.add_column("releases", sa.Column("cover_review_note", sa.Text(), nullable=True), schema="music")
    op.create_index(
        "ix_releases_cover_pending",
        "releases",
        ["primary_org_id"],
        schema="music",
        postgresql_where=sa.text("cover_pending_asset_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_releases_cover_pending", table_name="releases", schema="music")
    for column in ("cover_review_note", "cover_pending_by", "cover_pending_at", "cover_pending_asset_id"):
        op.drop_column("releases", column, schema="music")
    op.drop_constraint("ck_tracks_listens_before_counting", "tracks", schema="music", type_="check")
    op.drop_column("tracks", "listens_before_counting", schema="music")
