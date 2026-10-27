"""Band members by name. Additive only.

Revision ID: 0035_band_member_names
Revises: 0034_lyrics
Create Date: 2026-10-27

Owner, 2026-10-27 (D-LINEUP-01): song, release and band pages show the band's members in a fold-out.
A member who has no artist page or account can be listed by a typed name, attribution only (like a
typed credit, D-AUDIO-16): no account, no access, no money.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0035_band_member_names"
down_revision: Union[str, Sequence[str], None] = "0034_lyrics"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("band_members", sa.Column("display_name", sa.String(200), nullable=True), schema="artists")
    op.drop_constraint("ck_band_members_member_party", "band_members", schema="artists", type_="check")
    op.create_check_constraint(
        op.f("ck_band_members_member_party"),
        "band_members",
        "user_id IS NOT NULL OR artist_id IS NOT NULL OR display_name IS NOT NULL",
        schema="artists",
    )


def downgrade() -> None:
    op.execute("DELETE FROM artists.band_members WHERE user_id IS NULL AND artist_id IS NULL")
    op.drop_constraint("ck_band_members_member_party", "band_members", schema="artists", type_="check")
    op.create_check_constraint(
        op.f("ck_band_members_member_party"),
        "band_members",
        "user_id IS NOT NULL OR artist_id IS NOT NULL",
        schema="artists",
    )
    op.drop_column("band_members", "display_name", schema="artists")
