"""Open price on price proposals and offers. Additive only.

Revision ID: 0059_open_price
Revises: 0058_gift_mail_sends
Create Date: 2026-11-16

Owner, 2026-11-15 (D-OPEN-PRICE-01): an artist can turn on "open price" when proposing the price
of a song or release. The agreed price is then the lowest amount, and each buyer chooses what
they pay from there up. The switch travels from the proposal to the offer staff agree to.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0059_open_price"
down_revision: Union[str, Sequence[str], None] = "0058_gift_mail_sends"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    for table in ("offer_proposals", "offers"):
        op.add_column(
            table,
            sa.Column("open_price", sa.Boolean(), nullable=False, server_default=sa.false()),
            schema="commerce",
        )


def downgrade() -> None:
    for table in ("offers", "offer_proposals"):
        op.drop_column(table, "open_price", schema="commerce")
