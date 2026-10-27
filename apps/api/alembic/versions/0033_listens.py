"""Listen counts. Additive only.

Revision ID: 0033_listens
Revises: 0032_presale_contact
Create Date: 2026-10-27

Owner, 2026-10-27 (D-LISTEN-01): every song shows how many times it has been listened to. A listen
counts once a play has actually been heard for 30 seconds, once per play (listening session), at
most 30 a day per person per song. Counted automatically by the API; never adjusted by hand.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0033_listens"
down_revision: Union[str, Sequence[str], None] = "0032_presale_contact"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "listens",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("identity.users.id"), nullable=False),
        sa.Column("track_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("music.tracks.id"), nullable=False),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("streaming.listening_sessions.id"),
            nullable=False,
        ),
        sa.Column("listened_ms", sa.Integer(), nullable=False),
        sa.Column("listen_day", sa.Date(), nullable=False),
        sa.Column("counted_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "session_id", name="uq_listens_user_session"),
        schema="streaming",
    )
    op.create_index("ix_listens_track_id", "listens", ["track_id"], schema="streaming")
    op.create_index("ix_listens_user_track_day", "listens", ["user_id", "track_id", "listen_day"], schema="streaming")


def downgrade() -> None:
    op.drop_index("ix_listens_user_track_day", table_name="listens", schema="streaming")
    op.drop_index("ix_listens_track_id", table_name="listens", schema="streaming")
    op.drop_table("listens", schema="streaming")
