"""Audio platform Phase 7: selling whole releases. Additive only.

Revision ID: 0021_release_commerce
Revises: 0020_release_reviews
Create Date: 2026-10-17

Design 4.3 and 9: product type, order item type, order purpose and entitlement scope gain RELEASE
(an album purchase covers the release's current tracklist, D-AUDIO-12); offers gain an audience
(everyone, or fans who already own part of the release, D-AUDIO-11). Checks are widened, never
narrowed; existing rows are untouched.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0021_release_commerce"
down_revision: Union[str, Sequence[str], None] = "0020_release_reviews"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

WIDENED = (
    ("products", "ck_products_product_type", "product_type", ("TRACK", "CATALOG_ACCESS", "SUBSCRIPTION_PLAN")),
    ("order_items", "ck_order_items_item_type", "item_type", ("TICKET", "TRACK", "SUBSCRIPTION", "OTHER")),
    ("orders", "ck_orders_purpose", "purpose", ("TICKET", "TRACK", "SUBSCRIPTION")),
    ("entitlements", "ck_entitlements_scope", "scope", ("TRACK", "CATALOG")),
)


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({','.join(repr(v) for v in values)})"


def upgrade() -> None:
    for table, name, column, values in WIDENED:
        op.drop_constraint(name, table, schema="commerce", type_="check")
        op.create_check_constraint(name, table, _in(column, values + ("RELEASE",)), schema="commerce")
    op.add_column(
        "offers",
        sa.Column("audience", sa.String(24), nullable=False, server_default="EVERYONE"),
        schema="commerce",
    )
    op.create_check_constraint(
        "ck_offers_audience", "offers", "audience IN ('EVERYONE','OWNS_PART_OF_RELEASE')", schema="commerce"
    )


def downgrade() -> None:
    op.drop_constraint("ck_offers_audience", "offers", schema="commerce", type_="check")
    op.drop_column("offers", "audience", schema="commerce")
    # Release rows cannot satisfy the old checks; remove them before narrowing back.
    op.execute("DELETE FROM commerce.entitlements WHERE scope = 'RELEASE'")
    op.execute("DELETE FROM commerce.order_items WHERE item_type = 'RELEASE'")
    op.execute("UPDATE commerce.orders SET purpose = 'TRACK' WHERE purpose = 'RELEASE'")
    op.execute("DELETE FROM commerce.offers WHERE product_id IN (SELECT id FROM commerce.products WHERE product_type = 'RELEASE')")
    op.execute("DELETE FROM commerce.products WHERE product_type = 'RELEASE'")
    for table, name, column, values in WIDENED:
        op.drop_constraint(name, table, schema="commerce", type_="check")
        op.create_check_constraint(name, table, _in(column, values), schema="commerce")
