"""Addresses and phone numbers anywhere in the world. Additive only (existing rows stay valid).

Revision ID: 0036_international_addresses
Revises: 0035_band_member_names
Create Date: 2026-10-27

Owner, 2026-10-27 (D-ADDR-02, replaces D-ADDR-01's Bangladesh-only rule): a gift address can be in
any country and phone numbers carry their country code. Every existing address is a Bangladesh one
with a +880 mobile, so it gets country_code 'BD' and keeps its fields. A Bangladesh address still
fills division to house/road; elsewhere address lines, city, region and postal code.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0036_international_addresses"
down_revision: Union[str, Sequence[str], None] = "0035_band_member_names"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = (("identity", "delivery_addresses"), ("commerce", "order_delivery_addresses"))
BD_FIELDS = ("division", "district", "upazila", "area", "house_road")


def upgrade() -> None:
    for schema, table in TABLES:
        op.add_column(table, sa.Column("country_code", sa.String(2), nullable=False, server_default="BD"), schema=schema)
        op.add_column(table, sa.Column("phone_country", sa.String(2), nullable=True), schema=schema)
        op.add_column(table, sa.Column("address_line1", sa.String(200), nullable=True), schema=schema)
        op.add_column(table, sa.Column("address_line2", sa.String(200), nullable=True), schema=schema)
        op.add_column(table, sa.Column("city", sa.String(120), nullable=True), schema=schema)
        op.add_column(table, sa.Column("region", sa.String(120), nullable=True), schema=schema)
        op.alter_column(table, "postcode", type_=sa.String(16), existing_nullable=True, schema=schema)
        for column in BD_FIELDS:
            op.alter_column(table, column, nullable=True, schema=schema)
        op.execute(f"UPDATE {schema}.{table} SET phone_country = 'BD' WHERE phone LIKE '+880%'")

    op.drop_constraint("ck_delivery_addresses_phone_bd_mobile", "delivery_addresses", schema="identity", type_="check")
    op.drop_constraint("ck_delivery_addresses_postcode_format", "delivery_addresses", schema="identity", type_="check")
    op.create_check_constraint(
        op.f("ck_delivery_addresses_phone_e164"), "delivery_addresses", "phone ~ '^\\+[1-9][0-9]{6,14}$'", schema="identity"
    )
    op.create_check_constraint(
        op.f("ck_delivery_addresses_country_code_format"), "delivery_addresses", "country_code ~ '^[A-Z]{2}$'", schema="identity"
    )
    op.create_check_constraint(
        op.f("ck_delivery_addresses_address_shape"),
        "delivery_addresses",
        "(country_code = 'BD' AND division IS NOT NULL AND district IS NOT NULL AND upazila IS NOT NULL"
        " AND area IS NOT NULL AND house_road IS NOT NULL)"
        " OR (country_code <> 'BD' AND address_line1 IS NOT NULL AND city IS NOT NULL)",
        schema="identity",
    )


def downgrade() -> None:
    # Only Bangladesh addresses fit the old shape; others are removed on the way down.
    for schema, table in TABLES:
        op.execute(f"DELETE FROM {schema}.{table} WHERE country_code <> 'BD' OR phone NOT LIKE '+8801%'")
    for name in ("address_shape", "country_code_format", "phone_e164"):
        op.drop_constraint(f"ck_delivery_addresses_{name}", "delivery_addresses", schema="identity", type_="check")
    for schema, table in TABLES:
        for column in BD_FIELDS:
            op.alter_column(table, column, nullable=False, schema=schema)
        op.alter_column(table, "postcode", type_=sa.String(4), existing_nullable=True, schema=schema)
        for column in ("region", "city", "address_line2", "address_line1", "phone_country", "country_code"):
            op.drop_column(table, column, schema=schema)
    op.create_check_constraint(
        op.f("ck_delivery_addresses_phone_bd_mobile"), "delivery_addresses", "phone ~ '^\\+8801[3-9][0-9]{8}$'", schema="identity"
    )
    op.create_check_constraint(
        op.f("ck_delivery_addresses_postcode_format"),
        "delivery_addresses",
        "postcode IS NULL OR postcode ~ '^[0-9]{4}$'",
        schema="identity",
    )
