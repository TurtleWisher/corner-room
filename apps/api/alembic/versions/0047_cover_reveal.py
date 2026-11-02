"""Early cover reveal before release. Additive only.

Revision ID: 0047_cover_reveal
Revises: 0046_artist_mail_studio
Create Date: 2026-11-02

Owner, 2026-11-02 (D-COVER-02): a release's cover stays hidden from fans until release unless the
artist shows it early, a chosen time before release (`cover_reveal_lead_minutes`) or at once
(`cover_revealed_at`).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0047_cover_reveal"
down_revision: Union[str, Sequence[str], None] = "0046_artist_mail_studio"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("releases", sa.Column("cover_reveal_lead_minutes", sa.Integer(), nullable=True), schema="music")
    op.add_column("releases", sa.Column("cover_revealed_at", sa.DateTime(timezone=True), nullable=True), schema="music")
    op.create_check_constraint(
        "ck_releases_cover_reveal_lead", "releases", "cover_reveal_lead_minutes IS NULL OR cover_reveal_lead_minutes > 0", schema="music"
    )


def downgrade() -> None:
    op.drop_constraint("ck_releases_cover_reveal_lead", "releases", schema="music", type_="check")
    op.drop_column("releases", "cover_revealed_at", schema="music")
    op.drop_column("releases", "cover_reveal_lead_minutes", schema="music")
