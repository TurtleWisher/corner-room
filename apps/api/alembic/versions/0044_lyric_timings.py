"""Lyric timings: when each sung line starts. Additive only.

Revision ID: 0044_lyric_timings
Revises: 0043_credit_part_of
Create Date: 2026-11-01

Owner, 2026-11-01 (D-LYRICS-03): staff tap along to a released song once per line, and the
listening room then moves the lyric ring in time with the singing. One start time per sung line
(milliseconds from the start of the song); null means the lines are paced across the song as before.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0044_lyric_timings"
down_revision: Union[str, Sequence[str], None] = "0043_credit_part_of"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tracks", sa.Column("lyrics_timings", postgresql.JSONB(), nullable=True), schema="music")


def downgrade() -> None:
    op.drop_column("tracks", "lyrics_timings", schema="music")
