"""When a gift's buyer was last told about its status. Additive only.

Revision ID: 0060_gift_update_told
Revises: 0059_open_price
Create Date: 2026-11-20

Owner, 2026-11-20 (D-CAMPAIGN-08): moving a gift to Dispatched, Returned or Missing no longer emails
the buyer by itself. The act presses Send update when it is ready. `told_at` is empty after every
move and set when that update goes out, so the page can count who is still waiting to be told.
Gifts already in one of those statuses were emailed the moment they moved (the old rule), so they
count as told.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0060_gift_update_told"
down_revision: Union[str, Sequence[str], None] = "0059_open_price"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("gift_recipients", sa.Column("told_at", sa.DateTime(timezone=True), nullable=True), schema="commerce")
    op.execute(
        "UPDATE commerce.gift_recipients SET told_at = COALESCE(outcome_at, dispatched_at, updated_at) "
        "WHERE status IN ('DISPATCHED', 'RETURNED', 'MISSING')"
    )


def downgrade() -> None:
    op.drop_column("gift_recipients", "told_at", schema="commerce")
