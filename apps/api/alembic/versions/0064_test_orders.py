"""Staff test buys. Additive only.

Revision ID: 0064_test_orders
Revises: 0063_gift_stays_a_surprise
Create Date: 2026-11-21

Owner, 2026-11-21 (D-STREAM-03, D-TEST-BUY-01): platform admins can play every song, and when they
buy it is a test: they go through checkout as a fan would and finish with "Complete as a test"
instead of paying. No money moves, and the order never reaches sales, royalties, finance, the
artist's emails, gift campaigns, pre-sale numbers or analytics. `orders.is_test` marks it.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0064_test_orders"
down_revision: Union[str, Sequence[str], None] = "0063_gift_stays_a_surprise"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "orders", sa.Column("is_test", sa.Boolean(), nullable=False, server_default=sa.text("false")), schema="commerce"
    )


def downgrade() -> None:
    op.drop_column("orders", "is_test", schema="commerce")
