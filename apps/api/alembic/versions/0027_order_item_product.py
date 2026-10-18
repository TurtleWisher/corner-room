"""Order lines record the exact product bought. Additive only.

Revision ID: 0027_order_item_product
Revises: 0026_payment_submissions
Create Date: 2026-10-18

Module pass (Commerce gap): fulfilment looked the product up by subject_id only, so a subject with
two product types (a song product and a catalog product) could be fulfilled with the wrong access.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0027_order_item_product"
down_revision: Union[str, Sequence[str], None] = "0026_payment_submissions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "order_items",
        sa.Column("product_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("commerce.products.id"), nullable=True),
        schema="commerce",
    )


def downgrade() -> None:
    op.drop_column("order_items", "product_id", schema="commerce")
