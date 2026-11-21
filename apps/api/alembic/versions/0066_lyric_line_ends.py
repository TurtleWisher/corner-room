"""Lyric line ends: when each sung line's singing ends. Additive only.

Revision ID: 0066_lyric_line_ends
Revises: 0065_collectible_notes
Create Date: 2026-11-21

Owner, 2026-11-21 (D-LYRICS-05): every line of a song's lyrics gets an end tap as well as its
start. Staff hold the tap key while a line is sung; letting go marks its end. One end per start
time (milliseconds from the start of the song); null means only the starts were tapped.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0066_lyric_line_ends"
down_revision: Union[str, Sequence[str], None] = "0065_collectible_notes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tracks", sa.Column("lyrics_line_ends", postgresql.JSONB(), nullable=True), schema="music")


def downgrade() -> None:
    op.drop_column("tracks", "lyrics_line_ends", schema="music")
