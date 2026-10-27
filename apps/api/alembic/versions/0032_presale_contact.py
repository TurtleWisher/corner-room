"""Pre-sale buyers' phone and address. Additive only.

Revision ID: 0032_presale_contact
Revises: 0031_presale_claims
Create Date: 2026-10-27

Owner, 2026-10-27 (amends D-PRESALE-01): keep the pre-sale buyers' phone number and address from
the sheet, so admins and finance staff see them in the customer list. Both are optional; only
staff with customer access can read them, and every view of the list is audited.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0032_presale_contact"
down_revision: Union[str, Sequence[str], None] = "0031_presale_claims"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("presale_claims", sa.Column("phone", sa.String(32), nullable=True), schema="commerce")
    op.add_column("presale_claims", sa.Column("address", sa.Text(), nullable=True), schema="commerce")


def downgrade() -> None:
    op.drop_column("presale_claims", "address", schema="commerce")
    op.drop_column("presale_claims", "phone", schema="commerce")
