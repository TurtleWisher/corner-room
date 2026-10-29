"""One simple delivery address shape for every country. Additive only (existing rows stay valid).

Revision ID: 0041_simple_addresses
Revises: 0040_presales_on_site
Create Date: 2026-10-29

Owner, 2026-10-29 (D-ADDR-03): drop Area and the other redundant inputs; every country gives a
detailed address, district or city, division/state/region and postcode, so people outside
Bangladesh can fill it in easily. Those live in address_line1, city, region and postcode. Old
addresses are copied into them: in Bangladesh, house/road, area, upazila and landmark become the
detailed address, district becomes city and division becomes region (those old columns keep their
values, so a downgrade can restore them); elsewhere the second address line and landmark join the
first. The old columns are cleared when the address is next saved.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0041_simple_addresses"
down_revision: Union[str, Sequence[str], None] = "0040_presales_on_site"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = (("identity", "delivery_addresses"), ("commerce", "order_delivery_addresses"))
OLD_SHAPE = (
    "(country_code = 'BD' AND division IS NOT NULL AND district IS NOT NULL AND upazila IS NOT NULL"
    " AND area IS NOT NULL AND house_road IS NOT NULL)"
    " OR (country_code <> 'BD' AND address_line1 IS NOT NULL AND city IS NOT NULL)"
)


def upgrade() -> None:
    for schema, table in TABLES:
        # The joined older parts can be longer than one address line was.
        op.alter_column(table, "address_line1", type_=sa.Text(), existing_type=sa.String(200), existing_nullable=True, schema=schema)
        op.execute(
            f"UPDATE {schema}.{table} SET"
            " address_line1 = NULLIF(concat_ws(', ', house_road, area, upazila, landmark), ''),"
            " city = district, region = division"
            " WHERE country_code = 'BD' AND address_line1 IS NULL"
        )
        op.execute(
            f"UPDATE {schema}.{table} SET"
            " address_line1 = concat_ws(', ', address_line1, address_line2, landmark),"
            " address_line2 = NULL, landmark = NULL"
            " WHERE country_code <> 'BD' AND (address_line2 IS NOT NULL OR landmark IS NOT NULL)"
        )
    op.drop_constraint("ck_delivery_addresses_address_shape", "delivery_addresses", schema="identity", type_="check")
    op.create_check_constraint(
        op.f("ck_delivery_addresses_address_shape"),
        "delivery_addresses",
        "address_line1 IS NOT NULL AND city IS NOT NULL",
        schema="identity",
    )


def downgrade() -> None:
    # Bangladesh addresses saved in the simple shape have no division-to-house/road parts, so they
    # do not fit the old shape and are removed on the way down (as 0036 did for its own shape).
    op.execute(
        "DELETE FROM identity.delivery_addresses WHERE country_code = 'BD' AND (division IS NULL"
        " OR district IS NULL OR upazila IS NULL OR area IS NULL OR house_road IS NULL)"
    )
    op.drop_constraint("ck_delivery_addresses_address_shape", "delivery_addresses", schema="identity", type_="check")
    op.create_check_constraint(op.f("ck_delivery_addresses_address_shape"), "delivery_addresses", OLD_SHAPE, schema="identity")
    for schema, table in TABLES:
        # Bangladesh rows that still have their old parts go back to them alone.
        op.execute(
            f"UPDATE {schema}.{table} SET address_line1 = NULL, city = NULL, region = NULL"
            " WHERE country_code = 'BD' AND house_road IS NOT NULL"
        )
        op.execute(f"UPDATE {schema}.{table} SET address_line1 = left(address_line1, 200)")
        op.alter_column(table, "address_line1", type_=sa.String(200), existing_type=sa.Text(), existing_nullable=True, schema=schema)
