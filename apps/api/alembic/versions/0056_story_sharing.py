"""Story sharing switch on releases. Additive only.

Revision ID: 0056_story_sharing
Revises: 0055_gift_email_composer
Create Date: 2026-11-08

Owner, 2026-11-08 (D-STORY-01): people who own a song can share a moment of it, up to 30 seconds
that they pick, as a story card (a video with the song's sound) on Instagram, Facebook and other
apps. The act can turn story sharing off per release; it is on by default.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0056_story_sharing"
down_revision: Union[str, Sequence[str], None] = "0055_gift_email_composer"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "releases",
        sa.Column("story_sharing", sa.Boolean(), nullable=False, server_default=sa.true()),
        schema="music",
    )


def downgrade() -> None:
    op.drop_column("releases", "story_sharing", schema="music")
