"""A musician credit can say which act it played as part of. Additive only.

Revision ID: 0043_credit_part_of
Revises: 0042_one_artist_kind
Create Date: 2026-10-31

Owner, 2026-10-31 (D-CREDITS-05): on a song page, the people who played in an act (for example
MIZULS' singer and guitarist) fold under that act's credit ("Songwriter & Composer: MIZULS"), while
collaborators such as recording, mixing and artwork stay on their own rows. A Musician credit names
the act by the same thing the act's credit uses: its Corner Room profile (`part_of_artist_id`) or,
for an act without a profile here, its typed name (`part_of_name`). Positions are not used, so
dragging credits into a new order (D-CREDITS-04) keeps every musician with their act.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0043_credit_part_of"
down_revision: Union[str, Sequence[str], None] = "0042_one_artist_kind"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.add_column("credits", sa.Column("part_of_artist_id", UUID, nullable=True), schema="music")
    op.add_column("credits", sa.Column("part_of_name", sa.String(200), nullable=True), schema="music")
    op.create_foreign_key(
        "fk_credits_part_of_artist_id_artists", "credits", "artists", ["part_of_artist_id"], ["id"],
        source_schema="music", referent_schema="artists",
    )
    op.create_check_constraint(
        "ck_credits_part_of_one", "credits", "part_of_artist_id IS NULL OR part_of_name IS NULL", schema="music"
    )


def downgrade() -> None:
    op.drop_constraint("ck_credits_part_of_one", "credits", schema="music", type_="check")
    op.drop_constraint("fk_credits_part_of_artist_id_artists", "credits", schema="music", type_="foreignkey")
    op.drop_column("credits", "part_of_name", schema="music")
    op.drop_column("credits", "part_of_artist_id", schema="music")
