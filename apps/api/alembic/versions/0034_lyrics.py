"""Song lyrics. Additive only.

Revision ID: 0034_lyrics
Revises: 0033_listens
Create Date: 2026-10-27

Owner, 2026-10-27 (D-LYRICS-01): the artist adds a song's lyrics with its details; staff review them
with the release, and listeners see them once the song is out. After release, a change waits in
`lyrics_pending` until someone other than the artist approves it.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0034_lyrics"
down_revision: Union[str, Sequence[str], None] = "0033_listens"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tracks", sa.Column("lyrics", sa.Text(), nullable=True), schema="music")
    op.add_column("tracks", sa.Column("lyrics_pending", sa.Text(), nullable=True), schema="music")
    op.add_column(
        "tracks", sa.Column("lyrics_pending_at", sa.DateTime(timezone=True), nullable=True), schema="music"
    )
    op.add_column(
        "tracks", sa.Column("lyrics_pending_by", postgresql.UUID(as_uuid=True), nullable=True), schema="music"
    )
    op.add_column("tracks", sa.Column("lyrics_review_note", sa.Text(), nullable=True), schema="music")
    op.create_index(
        "ix_tracks_lyrics_pending",
        "tracks",
        ["primary_org_id"],
        schema="music",
        postgresql_where=sa.text("lyrics_pending_at IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_tracks_lyrics_pending", table_name="tracks", schema="music")
    for column in ("lyrics_review_note", "lyrics_pending_by", "lyrics_pending_at", "lyrics_pending", "lyrics"):
        op.drop_column("tracks", column, schema="music")
