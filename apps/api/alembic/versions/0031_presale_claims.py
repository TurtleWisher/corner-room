"""Pre-sales: buyers who paid before Corner Room existed. Additive only.

Revision ID: 0031_presale_claims
Revises: 0030_activate_playback_profiles
Create Date: 2026-10-25

Owner, 2026-10-25 (D-PRESALE-01): about 90 people paid for the MIZULS single before launch. Staff
list them (email, name, amount, date paid). When a listed email becomes a verified Corner Room
account, the pre-sale becomes a normal order and captured payment, so the buyer owns the song and
the sale counts in the artist's sales and in finance from then on.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0031_presale_claims"
down_revision: Union[str, Sequence[str], None] = "0030_activate_playback_profiles"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "presale_claims",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("identity.organizations.id"), nullable=False),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("commerce.products.id"), nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("buyer_name", sa.String(200), nullable=True),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency_code", sa.String(3), nullable=False),
        sa.Column("paid_on", sa.Date(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="WAITING"),
        sa.Column("claimed_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("identity.users.id"), nullable=True),
        sa.Column("order_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("commerce.orders.id"), nullable=True),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint("status IN ('WAITING','CLAIMED','CANCELLED')", name="ck_presale_claims_status"),
        sa.CheckConstraint("amount_minor >= 0", name="ck_presale_claims_amount_not_negative"),  # 0 = a gift
        schema="commerce",
    )
    op.create_index("ix_presale_claims_email", "presale_claims", ["email"], schema="commerce")
    op.create_index(
        "uq_presale_claims_product_email_live",
        "presale_claims",
        ["product_id", "email"],
        unique=True,
        schema="commerce",
        postgresql_where=sa.text("status <> 'CANCELLED'"),
    )


def downgrade() -> None:
    op.drop_index("uq_presale_claims_product_email_live", table_name="presale_claims", schema="commerce")
    op.drop_index("ix_presale_claims_email", table_name="presale_claims", schema="commerce")
    op.drop_table("presale_claims", schema="commerce")
