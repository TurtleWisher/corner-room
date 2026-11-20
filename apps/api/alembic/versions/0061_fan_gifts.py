"""Fan gifts and gift credit. Additive only.

Revision ID: 0061_fan_gifts
Revises: 0060_gift_update_told
Create Date: 2026-11-20

Owner, 2026-11-20 (D-GIFT-FAN-01): a fan buys music for people they know by email and pays first;
the sale counts when the giver pays. Someone who already owns it keeps the amount as credit for that
act's music, passes it on or declines it (the giver then gets the credit), and a gift nobody claims
in 7 days goes back to the giver as that credit. `orders.paid_with_credit_minor` marks an order paid
with that credit (no new money: the sale counted when the gift was paid for).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0061_fan_gifts"
down_revision: Union[str, Sequence[str], None] = "0060_gift_update_told"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def _stamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    ]


def upgrade() -> None:
    op.create_table(
        "fan_gifts",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("giver_user_id", UUID, sa.ForeignKey("identity.users.id"), nullable=False),
        sa.Column("order_id", UUID, sa.ForeignKey("commerce.orders.id"), nullable=False),
        sa.Column("organization_id", UUID, sa.ForeignKey("identity.organizations.id"), nullable=False),
        sa.Column("product_id", UUID, sa.ForeignKey("commerce.products.id"), nullable=False),
        sa.Column("work_type", sa.String(8), nullable=False),
        sa.Column("work_id", UUID, nullable=False),
        sa.Column("act_id", UUID, nullable=False),
        sa.Column("unit_amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency_code", sa.String(3), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("note_state", sa.String(10), nullable=False, server_default="NONE"),
        sa.Column("note_reviewed_by", UUID, nullable=True),
        sa.Column("note_reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="PENDING_PAYMENT"),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        *_stamps(),
        sa.CheckConstraint(
            "status IN ('PENDING_PAYMENT','WAITING_NOTE','DELIVERED','CANCELLED')", name="ck_fan_gifts_status"
        ),
        sa.CheckConstraint("note_state IN ('NONE','WAITING','APPROVED','REMOVED')", name="ck_fan_gifts_note_state"),
        sa.CheckConstraint("work_type IN ('TRACK','RELEASE')", name="ck_fan_gifts_work_type"),
        sa.CheckConstraint("unit_amount_minor > 0", name="ck_fan_gifts_unit_amount_positive"),
        sa.UniqueConstraint("order_id", name="uq_fan_gifts_order_id"),
        schema="commerce",
    )
    op.create_index("ix_fan_gifts_giver", "fan_gifts", ["giver_user_id"], schema="commerce")
    op.create_index("ix_fan_gifts_note_state", "fan_gifts", ["note_state", "status"], schema="commerce")

    op.create_table(
        "fan_gift_recipients",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("gift_id", UUID, sa.ForeignKey("commerce.fan_gifts.id"), nullable=False),
        sa.Column("order_item_id", UUID, sa.ForeignKey("commerce.order_items.id"), nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("name", sa.String(120), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="WAITING"),
        sa.Column("user_id", UUID, sa.ForeignKey("identity.users.id"), nullable=True),
        sa.Column("token_hash", sa.String(64), nullable=True),
        sa.Column("passed_from_id", UUID, sa.ForeignKey("commerce.fan_gift_recipients.id"), nullable=True),
        sa.Column("emailed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        *_stamps(),
        sa.CheckConstraint(
            "status IN ('WAITING','GIVEN','WAITING_ACCOUNT','CHOOSING','KEPT_CREDIT','PASSED_ON','DECLINED','EXPIRED')",
            name="ck_fan_gift_recipients_status",
        ),
        sa.UniqueConstraint("token_hash", name="uq_fan_gift_recipients_token_hash"),
        schema="commerce",
    )
    op.create_index("ix_fan_gift_recipients_email_status", "fan_gift_recipients", ["email", "status"], schema="commerce")
    op.create_index("ix_fan_gift_recipients_gift", "fan_gift_recipients", ["gift_id"], schema="commerce")
    op.create_index("ix_fan_gift_recipients_open", "fan_gift_recipients", ["status", "expires_at"], schema="commerce")

    op.create_table(
        "gift_credits",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("user_id", UUID, sa.ForeignKey("identity.users.id"), nullable=False),
        sa.Column("act_id", UUID, nullable=False),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency_code", sa.String(3), nullable=False),
        sa.Column("reason", sa.String(20), nullable=False),
        sa.Column("fan_gift_recipient_id", UUID, sa.ForeignKey("commerce.fan_gift_recipients.id"), nullable=True),
        sa.Column("order_id", UUID, sa.ForeignKey("commerce.orders.id"), nullable=True),
        *_stamps(),
        sa.CheckConstraint(
            "reason IN ('GIFT_KEPT','GIFT_DECLINED','GIFT_NOT_CLAIMED','SPENT')", name="ck_gift_credits_reason"
        ),
        sa.CheckConstraint("amount_minor <> 0", name="ck_gift_credits_amount_not_zero"),
        schema="commerce",
    )
    op.create_index("ix_gift_credits_user_act", "gift_credits", ["user_id", "act_id"], schema="commerce")

    op.add_column(
        "orders",
        sa.Column("paid_with_credit_minor", sa.BigInteger(), nullable=False, server_default="0"),
        schema="commerce",
    )


def downgrade() -> None:
    op.drop_column("orders", "paid_with_credit_minor", schema="commerce")
    op.drop_index("ix_gift_credits_user_act", table_name="gift_credits", schema="commerce")
    op.drop_table("gift_credits", schema="commerce")
    op.drop_index("ix_fan_gift_recipients_open", table_name="fan_gift_recipients", schema="commerce")
    op.drop_index("ix_fan_gift_recipients_gift", table_name="fan_gift_recipients", schema="commerce")
    op.drop_index("ix_fan_gift_recipients_email_status", table_name="fan_gift_recipients", schema="commerce")
    op.drop_table("fan_gift_recipients", schema="commerce")
    op.drop_index("ix_fan_gifts_note_state", table_name="fan_gifts", schema="commerce")
    op.drop_index("ix_fan_gifts_giver", table_name="fan_gifts", schema="commerce")
    op.drop_table("fan_gifts", schema="commerce")
