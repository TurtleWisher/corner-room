"""People added to a gift campaign by hand or from a sheet. Additive only.

Revision ID: 0052_gift_people_added
Revises: 0051_collectible_tracking
Create Date: 2026-11-07

Owner, 2026-11-07 (D-CAMPAIGN-04): a gift campaign can include people who bought outside Corner
Room and aren't on the imported pre-sale list (for example paid by hand). Staff or the act's team
type them in or paste them from a sheet with a name, email, phone and address. An email or a phone
is enough (email becomes optional). Staff additions count at once; the act's additions wait for
staff (`waiting`). Buyers found on Corner Room stay `source = 'BUYER'`.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0052_gift_people_added"
down_revision: Union[str, Sequence[str], None] = "0051_collectible_tracking"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)
T = "gift_recipients"
S = "commerce"


def upgrade() -> None:
    op.add_column(T, sa.Column("source", sa.String(8), nullable=False, server_default="BUYER"), schema=S)
    op.add_column(T, sa.Column("name", sa.String(200), nullable=True), schema=S)
    op.add_column(T, sa.Column("phone", sa.String(40), nullable=True), schema=S)
    op.add_column(T, sa.Column("address", sa.Text(), nullable=True), schema=S)
    op.add_column(T, sa.Column("added_by", UUID, nullable=True), schema=S)
    op.add_column(T, sa.Column("waiting", sa.Boolean(), nullable=False, server_default=sa.false()), schema=S)
    op.add_column(T, sa.Column("approved_by", UUID, nullable=True), schema=S)
    op.add_column(T, sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True), schema=S)
    op.alter_column(T, "email", existing_type=sa.String(320), nullable=True, schema=S)
    op.create_check_constraint("ck_gift_recipients_source", T, "source IN ('BUYER','ADDED')", schema=S)
    op.create_check_constraint("ck_gift_recipients_reachable", T, "email IS NOT NULL OR phone IS NOT NULL", schema=S)


def downgrade() -> None:
    op.drop_constraint("ck_gift_recipients_reachable", T, schema=S, type_="check")
    op.drop_constraint("ck_gift_recipients_source", T, schema=S, type_="check")
    # People added by hand (and any without an email) can't exist in the older shape.
    op.execute(f"DELETE FROM {S}.{T} WHERE source = 'ADDED' OR email IS NULL")
    op.alter_column(T, "email", existing_type=sa.String(320), nullable=False, schema=S)
    for col in ("approved_at", "approved_by", "waiting", "added_by", "address", "phone", "name", "source"):
        op.drop_column(T, col, schema=S)
