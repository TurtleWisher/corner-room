"""Corner Room Wrap: a personal look back at a stretch of time, set up by platform staff. Additive only.

Revision ID: 0067_corner_room_wrap
Revises: 0066_lyric_line_ends
Create Date: 2026-11-28

Owner, 2026-11-28 (D-WRAP-01): like a yearly wrapped or a year in review, every listener gets their
own Corner Room Wrap built from what they did in a period staff choose: the songs and acts they
heard most, when they listened, what they bought, the events they went to, the gifts they gave.
Staff run each Wrap end to end (period, when it opens and closes, look, cards and their order,
words, thresholds, sharing). Listeners share it as a story picture.

- `analytics.wrap_seasons`: one Wrap (DRAFT, LIVE, ENDED) with its settings.
- `analytics.wrap_snapshots`: each person's numbers for a Wrap, built the first time they open it
  so it stays the same every time they come back. Staff can rebuild them. Never money.
- `analytics.wrap_counts`: running totals per Wrap, day and kind (opened, finished, shared by
  channel). Counts only; nothing about who.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0067_corner_room_wrap"
down_revision: Union[str, Sequence[str], None] = "0066_lyric_line_ends"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)
JSONB = postgresql.JSONB()
S = "analytics"


def upgrade() -> None:
    op.create_table(
        "wrap_seasons",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="DRAFT"),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("ends_on", sa.Date(), nullable=False),
        sa.Column("opens_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closes_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("settings", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("went_live_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", UUID, nullable=True),
        sa.Column("updated_by", UUID, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("status IN ('DRAFT','LIVE','ENDED')", name="ck_wrap_seasons_status"),
        sa.CheckConstraint("ends_on >= starts_on", name="ck_wrap_seasons_period"),
        sa.CheckConstraint("closes_at IS NULL OR opens_at IS NULL OR closes_at > opens_at", name="ck_wrap_seasons_window"),
        schema=S,
    )
    op.create_index("ix_wrap_seasons_status", "wrap_seasons", ["status"], schema=S)

    op.create_table(
        "wrap_snapshots",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("season_id", UUID, sa.ForeignKey("analytics.wrap_seasons.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", UUID, sa.ForeignKey("identity.users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("stats", JSONB, nullable=False),
        sa.Column("built_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("season_id", "user_id", name="uq_wrap_snapshots_season_user"),
        schema=S,
    )

    op.create_table(
        "wrap_counts",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("season_id", UUID, sa.ForeignKey("analytics.wrap_seasons.id", ondelete="CASCADE"), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("count", sa.Integer(), nullable=False, server_default="0"),
        sa.CheckConstraint("count >= 0", name="ck_wrap_counts_count"),
        sa.UniqueConstraint("season_id", "day", "kind", name="uq_wrap_counts_season_day_kind"),
        schema=S,
    )


def downgrade() -> None:
    op.drop_table("wrap_counts", schema=S)
    op.drop_table("wrap_snapshots", schema=S)
    op.drop_index("ix_wrap_seasons_status", table_name="wrap_seasons", schema=S)
    op.drop_table("wrap_seasons", schema=S)
