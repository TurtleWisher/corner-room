"""Pre-sales on Corner Room. Additive only (existing rows stay valid).

Revision ID: 0040_presales_on_site
Revises: 0039_gift_campaigns
Create Date: 2026-10-28

Owner, 2026-10-28 (D-PRESALE-02): fans pre-order a release before it is out at its own pre-sale
price (an offer with audience PRESALE, agreed like any price). Orders made that way are marked
`is_presale`; the music unlocks on release day.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0040_presales_on_site"
down_revision: Union[str, Sequence[str], None] = "0039_gift_campaigns"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OLD = "audience IN ('EVERYONE','OWNS_PART_OF_RELEASE')"
REVIEW_OLD = "action IN ('start_review','approve','request_changes','schedule','release','takedown')"
REVIEW_NEW = "action IN ('start_review','approve','request_changes','schedule','release','takedown','cancel_presale')"
NEW = "audience IN ('EVERYONE','OWNS_PART_OF_RELEASE','PRESALE')"


def upgrade() -> None:
    for table in ("offers", "offer_proposals"):
        op.drop_constraint(f"ck_{table}_audience", table, schema="commerce", type_="check")
        op.create_check_constraint(op.f(f"ck_{table}_audience"), table, NEW, schema="commerce")
    op.add_column("orders", sa.Column("is_presale", sa.Boolean(), nullable=False, server_default=sa.false()), schema="commerce")
    # Release history records a cancelled pre-sale.
    op.drop_constraint("ck_release_reviews_action", "release_reviews", schema="music", type_="check")
    op.create_check_constraint(op.f("ck_release_reviews_action"), "release_reviews", REVIEW_NEW, schema="music")


def downgrade() -> None:
    op.execute("DELETE FROM music.release_reviews WHERE action = 'cancel_presale'")
    op.drop_constraint("ck_release_reviews_action", "release_reviews", schema="music", type_="check")
    op.create_check_constraint(op.f("ck_release_reviews_action"), "release_reviews", REVIEW_OLD, schema="music")
    op.drop_column("orders", "is_presale", schema="commerce")
    for table in ("offers", "offer_proposals"):
        op.execute(f"UPDATE commerce.{table} SET audience = 'EVERYONE' WHERE audience = 'PRESALE'")
        op.drop_constraint(f"ck_{table}_audience", table, schema="commerce", type_="check")
        op.create_check_constraint(op.f(f"ck_{table}_audience"), table, OLD, schema="commerce")
