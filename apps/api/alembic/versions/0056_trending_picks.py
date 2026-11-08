"""Trending Corner: songs and releases staff pick for the home page. Additive only.

Revision ID: 0056_trending_picks
Revises: 0055_gift_email_composer
Create Date: 2026-11-08

Owner, 2026-11-08 (D-TRENDING-01): the home page's Trending Corner shows the music selling and
being heard the most. Staff choose it by hand (no formula decides it), with each one's sales and
listens beside it to help, and set the order. Only released music shows to the public.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0056_trending_picks"
down_revision: Union[str, Sequence[str], None] = "0055_gift_email_composer"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)
S = "music"


def upgrade() -> None:
    op.create_table(
        "trending_picks",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("track_id", UUID, sa.ForeignKey("music.tracks.id", ondelete="CASCADE"), nullable=True),
        sa.Column("release_id", UUID, sa.ForeignKey("music.releases.id", ondelete="CASCADE"), nullable=True),
        sa.Column("organization_id", UUID, sa.ForeignKey("identity.organizations.id"), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by", UUID, nullable=True),
        sa.Column("updated_by", UUID, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("kind IN ('TRACK','RELEASE')", name="ck_trending_picks_kind"),
        sa.CheckConstraint(
            "(kind = 'TRACK' AND track_id IS NOT NULL AND release_id IS NULL)"
            " OR (kind = 'RELEASE' AND release_id IS NOT NULL AND track_id IS NULL)",
            name="ck_trending_picks_one_subject",
        ),
        sa.UniqueConstraint("track_id", name="uq_trending_picks_track"),
        sa.UniqueConstraint("release_id", name="uq_trending_picks_release"),
        schema=S,
    )
    op.create_index("ix_trending_picks_position", "trending_picks", ["position"], schema=S)


def downgrade() -> None:
    op.drop_index("ix_trending_picks_position", table_name="trending_picks", schema=S)
    op.drop_table("trending_picks", schema=S)
