"""Bangla QR staff verification: payment submissions and the paused hold. Additive only.

Revision ID: 0026_payment_submissions
Revises: 0025_delivery_addresses
Create Date: 2026-10-18

Owner, 2026-10-18 (Q-PAY-01 "both, staff first", Q-PAY-05): the buyer submits the transaction ID,
the number paid from and the app; finance staff confirm or reject. While a submission waits, the
ticket hold does not expire; a rejection restarts the normal hold time.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0026_payment_submissions"
down_revision: Union[str, Sequence[str], None] = "0025_delivery_addresses"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "payment_submissions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("payment_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("finance.payments.id"), nullable=False),
        sa.Column("order_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("transaction_ref", sa.String(64), nullable=False),
        sa.Column("paid_from", sa.String(32), nullable=False),
        sa.Column("paid_with", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="SUBMITTED"),
        sa.Column("decided_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decision_note", sa.String(300), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("status IN ('SUBMITTED','CONFIRMED','REJECTED')", name="ck_payment_submissions_status"),
        sa.CheckConstraint(
            "paid_with IN ('BKASH','NAGAD','ROCKET','UPAY','BANK_APP','OTHER')", name="ck_payment_submissions_paid_with"
        ),
        schema="finance",
    )
    op.create_index("ix_payment_submissions_payment_id", "payment_submissions", ["payment_id"], schema="finance")
    op.create_index("ix_payment_submissions_status", "payment_submissions", ["status"], schema="finance")
    op.create_index(
        "uq_payment_submissions_live_transaction_ref",
        "payment_submissions",
        [sa.text("lower(transaction_ref)")],
        unique=True,
        schema="finance",
        postgresql_where=sa.text("status <> 'REJECTED'"),
    )
    op.add_column(
        "ticket_holds",
        sa.Column("verification_pending", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        schema="ticketing",
    )


def downgrade() -> None:
    op.drop_column("ticket_holds", "verification_pending", schema="ticketing")
    op.drop_index("uq_payment_submissions_live_transaction_ref", table_name="payment_submissions", schema="finance")
    op.drop_index("ix_payment_submissions_status", table_name="payment_submissions", schema="finance")
    op.drop_index("ix_payment_submissions_payment_id", table_name="payment_submissions", schema="finance")
    op.drop_table("payment_submissions", schema="finance")
