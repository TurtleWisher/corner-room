"""Delivery addresses: the account's Bangladesh gift address and its copy on each order. Additive.

Revision ID: 0025_delivery_addresses
Revises: 0024_refund_tickets
Create Date: 2026-10-18

Owner, 2026-10-18 (D-ADDR-01): before every payment the buyer gives (or confirms) a Bangladesh
address where gifts can be received; buyers abroad give a Bangladesh address to send gifts to.
Saved once to the account, copied onto each order at checkout. Personal data.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0025_delivery_addresses"
down_revision: Union[str, Sequence[str], None] = "0024_refund_tickets"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _address_columns() -> list[sa.Column]:
    return [
        sa.Column("recipient_name", sa.String(120), nullable=False),
        sa.Column("phone", sa.String(16), nullable=False),
        sa.Column("division", sa.String(32), nullable=False),
        sa.Column("district", sa.String(64), nullable=False),
        sa.Column("upazila", sa.String(80), nullable=False),
        sa.Column("area", sa.String(120), nullable=False),
        sa.Column("house_road", sa.String(200), nullable=False),
        sa.Column("postcode", sa.String(4), nullable=True),
        sa.Column("landmark", sa.String(200), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    ]


def upgrade() -> None:
    op.create_table(
        "delivery_addresses",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("identity.users.id"), nullable=False),
        *_address_columns(),
        sa.UniqueConstraint("user_id", name="uq_delivery_addresses_user_id"),
        sa.CheckConstraint("phone ~ '^\\+8801[3-9][0-9]{8}$'", name="ck_delivery_addresses_phone_bd_mobile"),
        sa.CheckConstraint("postcode IS NULL OR postcode ~ '^[0-9]{4}$'", name="ck_delivery_addresses_postcode_format"),
        schema="identity",
    )
    op.create_table(
        "order_delivery_addresses",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("order_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("commerce.orders.id"), nullable=False),
        *_address_columns(),
        sa.UniqueConstraint("order_id", name="uq_order_delivery_addresses_order_id"),
        schema="commerce",
    )


def downgrade() -> None:
    op.drop_table("order_delivery_addresses", schema="commerce")
    op.drop_table("delivery_addresses", schema="identity")
