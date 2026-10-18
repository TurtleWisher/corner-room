"""Per-ticket refunds: a refund records which tickets it covers. Additive only.

Revision ID: 0024_refund_tickets
Revises: 0023_artist_join_links
Create Date: 2026-10-18

Owner, 2026-10-18 (Q-COM-01): staff choose the exact tickets to refund; the refund amount is those
tickets' paid price and only those tickets stop working. NULL means the refund names no tickets
(a whole-order refund, or a goodwill part refund that leaves every ticket valid).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0024_refund_tickets"
down_revision: Union[str, Sequence[str], None] = "0023_artist_join_links"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("refunds", sa.Column("ticket_ids", postgresql.JSONB(), nullable=True), schema="finance")


def downgrade() -> None:
    op.drop_column("refunds", "ticket_ids", schema="finance")
