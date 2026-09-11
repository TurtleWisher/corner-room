"""Phase 05 ticketing and attendance.

Revision ID: 0006_ticketing_attendance
Revises: 0005_event_venue_management
Create Date: 2026-09-11
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006_ticketing_attendance"
down_revision: Union[str, Sequence[str], None] = "0005_event_venue_management"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(sa.text("CREATE SCHEMA IF NOT EXISTS ticketing"))
    op.execute(sa.text("CREATE SCHEMA IF NOT EXISTS commerce"))
    op.execute(sa.text("CREATE SCHEMA IF NOT EXISTS finance"))

    op.create_table(
        "ticket_types",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="DRAFT"),
        sa.Column("price_amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency_code", sa.String(3), nullable=False),
        sa.Column("quantity_total", sa.Integer(), nullable=False),
        sa.Column("sales_starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sales_ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("metadata", postgresql.JSONB(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('DRAFT','ON_SALE','SOLD_OUT','CLOSED','ARCHIVED')",
            name="ck_ticket_types_status",
        ),
        sa.CheckConstraint("price_amount_minor >= 0", name="ck_ticket_types_price_non_negative"),
        sa.CheckConstraint("quantity_total >= 0", name="ck_ticket_types_quantity_non_negative"),
        sa.ForeignKeyConstraint(["event_id"], ["events.events.id"], name="fk_ticket_types_event_id_events"),
        schema="ticketing",
    )
    op.create_index(
        "ix_ticket_types_event_status",
        "ticket_types",
        ["event_id", "status"],
        schema="ticketing",
    )

    op.create_table(
        "ticket_type_inventory",
        sa.Column("ticket_type_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("remaining", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.CheckConstraint("remaining >= 0", name="ck_ticket_type_inventory_remaining_non_negative"),
        sa.ForeignKeyConstraint(
            ["ticket_type_id"],
            ["ticketing.ticket_types.id"],
            name="fk_ticket_type_inventory_ticket_type_id_ticket_types",
        ),
        schema="ticketing",
    )

    op.create_table(
        "ticket_holds",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("ticket_type_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("order_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="ACTIVE"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('ACTIVE','CONVERTED','EXPIRED','RELEASED')",
            name="ck_ticket_holds_status",
        ),
        sa.CheckConstraint("quantity >= 1", name="ck_ticket_holds_quantity_positive"),
        sa.ForeignKeyConstraint(
            ["ticket_type_id"],
            ["ticketing.ticket_types.id"],
            name="fk_ticket_holds_ticket_type_id_ticket_types",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["identity.users.id"], name="fk_ticket_holds_user_id_users"),
        schema="ticketing",
    )
    op.create_index(
        "ix_ticket_holds_status_expires",
        "ticket_holds",
        ["status", "expires_at"],
        schema="ticketing",
    )
    op.create_index("ix_ticket_holds_ticket_type_id", "ticket_holds", ["ticket_type_id"], schema="ticketing")
    op.create_index("ix_ticket_holds_user_id", "ticket_holds", ["user_id"], schema="ticketing")

    op.create_table(
        "tickets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("ticket_type_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("hold_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("order_item_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="CREATED"),
        sa.Column("qr_asset_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("qr_secret_hash", sa.String(64), nullable=True),
        sa.Column("transferred_from_ticket_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('CREATED','RESERVED','PAYMENT_PENDING','PAID','ISSUED',"
            "'CHECKED_IN','EXPIRED','CANCELLED','REFUNDED')",
            name="ck_tickets_status",
        ),
        sa.ForeignKeyConstraint(
            ["ticket_type_id"],
            ["ticketing.ticket_types.id"],
            name="fk_tickets_ticket_type_id_ticket_types",
        ),
        sa.ForeignKeyConstraint(
            ["hold_id"],
            ["ticketing.ticket_holds.id"],
            name="fk_tickets_hold_id_ticket_holds",
        ),
        sa.ForeignKeyConstraint(["owner_user_id"], ["identity.users.id"], name="fk_tickets_owner_user_id_users"),
        schema="ticketing",
    )
    op.create_index("ix_tickets_owner_user_id", "tickets", ["owner_user_id"], schema="ticketing")
    op.create_index(
        "ix_tickets_ticket_type_status",
        "tickets",
        ["ticket_type_id", "status"],
        schema="ticketing",
    )
    op.create_index("ix_tickets_order_item_id", "tickets", ["order_item_id"], schema="ticketing")
    op.create_index(
        "uq_tickets_qr_secret_hash",
        "tickets",
        ["qr_secret_hash"],
        unique=True,
        schema="ticketing",
        postgresql_where=sa.text("qr_secret_hash IS NOT NULL"),
    )

    op.create_table(
        "check_ins",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("ticket_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("staff_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="RECORDED"),
        sa.Column("scanned_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("status IN ('RECORDED','VOIDED')", name="ck_check_ins_status"),
        sa.ForeignKeyConstraint(["ticket_id"], ["ticketing.tickets.id"], name="fk_check_ins_ticket_id_tickets"),
        sa.ForeignKeyConstraint(["event_id"], ["events.events.id"], name="fk_check_ins_event_id_events"),
        sa.ForeignKeyConstraint(["staff_user_id"], ["identity.users.id"], name="fk_check_ins_staff_user_id_users"),
        sa.UniqueConstraint("ticket_id", name="uq_check_ins_ticket_id"),
        schema="ticketing",
    )
    op.create_index("ix_check_ins_event_id", "check_ins", ["event_id"], schema="ticketing")

    op.create_table(
        "refund_policies",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("scope_type", sa.String(32), nullable=False),
        sa.Column("scope_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("reason_code", sa.String(64), nullable=False),
        sa.Column("eligible_rules", postgresql.JSONB(), nullable=True),
        sa.Column("requires_finance_approve", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("scope_type IN ('PLATFORM','EVENT')", name="ck_refund_policies_scope_type"),
        schema="ticketing",
    )

    op.create_table(
        "orders",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="DRAFT"),
        sa.Column("total_amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency_code", sa.String(3), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('DRAFT','PENDING_PAYMENT','PAID','FULFILLED','CANCELLED',"
            "'PARTIALLY_REFUNDED','REFUNDED')",
            name="ck_orders_status",
        ),
        sa.CheckConstraint("total_amount_minor >= 0", name="ck_orders_total_non_negative"),
        sa.ForeignKeyConstraint(["user_id"], ["identity.users.id"], name="fk_orders_user_id_users"),
        sa.UniqueConstraint("idempotency_key", name="uq_orders_idempotency_key"),
        schema="commerce",
    )
    op.create_index("ix_orders_user_id", "orders", ["user_id"], schema="commerce")

    op.create_table(
        "order_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("order_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("item_type", sa.String(32), nullable=False),
        sa.Column("ref_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency_code", sa.String(3), nullable=False),
        sa.Column("unit_amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "item_type IN ('TICKET','TRACK','SUBSCRIPTION','OTHER')",
            name="ck_order_items_item_type",
        ),
        sa.CheckConstraint("quantity >= 1", name="ck_order_items_quantity_positive"),
        sa.CheckConstraint("amount_minor >= 0", name="ck_order_items_amount_non_negative"),
        sa.ForeignKeyConstraint(["order_id"], ["commerce.orders.id"], name="fk_order_items_order_id_orders"),
        schema="commerce",
    )
    op.create_index("ix_order_items_order_id", "order_items", ["order_id"], schema="commerce")

    op.create_table(
        "tax_lines",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("parent_type", sa.String(32), nullable=False),
        sa.Column("parent_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False, server_default="TAX"),
        sa.Column("rate_bps", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("currency_code", sa.String(3), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "parent_type IN ('ORDER','ORDER_ITEM','INVOICE')",
            name="ck_tax_lines_parent_type",
        ),
        sa.CheckConstraint("kind IN ('TAX','PLATFORM_TAKE','PSP_FEE','OTHER')", name="ck_tax_lines_kind"),
        sa.CheckConstraint("rate_bps >= 0", name="ck_tax_lines_rate_non_negative"),
        sa.CheckConstraint("amount_minor >= 0", name="ck_tax_lines_amount_non_negative"),
        schema="commerce",
    )
    op.create_index("ix_tax_lines_parent", "tax_lines", ["parent_type", "parent_id"], schema="commerce")

    op.create_table(
        "payments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("order_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="CREATED"),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency_code", sa.String(3), nullable=False),
        sa.Column("provider", sa.String(64), nullable=False),
        sa.Column("provider_ref", sa.String(128), nullable=True),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('CREATED','REQUIRES_ACTION','AUTHORIZED','CAPTURED','FAILED','CANCELLED')",
            name="ck_payments_status",
        ),
        sa.CheckConstraint("amount_minor >= 0", name="ck_payments_amount_non_negative"),
        sa.ForeignKeyConstraint(["order_id"], ["commerce.orders.id"], name="fk_payments_order_id_orders"),
        sa.ForeignKeyConstraint(["user_id"], ["identity.users.id"], name="fk_payments_user_id_users"),
        sa.UniqueConstraint("idempotency_key", name="uq_payments_idempotency_key"),
        schema="finance",
    )
    op.create_index("ix_payments_order_id", "payments", ["order_id"], schema="finance")
    op.create_index("ix_payments_user_id", "payments", ["user_id"], schema="finance")

    op.create_table(
        "payment_attempts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("payment_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="STARTED"),
        sa.Column("provider_event_id", sa.String(128), nullable=True),
        sa.Column("raw_status", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("status IN ('STARTED','SUCCEEDED','FAILED')", name="ck_payment_attempts_status"),
        sa.ForeignKeyConstraint(
            ["payment_id"],
            ["finance.payments.id"],
            name="fk_payment_attempts_payment_id_payments",
        ),
        sa.UniqueConstraint("provider_event_id", name="uq_payment_attempts_provider_event_id"),
        schema="finance",
    )
    op.create_index("ix_payment_attempts_payment_id", "payment_attempts", ["payment_id"], schema="finance")


def downgrade() -> None:
    op.drop_index("ix_payment_attempts_payment_id", table_name="payment_attempts", schema="finance")
    op.drop_table("payment_attempts", schema="finance")
    op.drop_index("ix_payments_user_id", table_name="payments", schema="finance")
    op.drop_index("ix_payments_order_id", table_name="payments", schema="finance")
    op.drop_table("payments", schema="finance")
    op.drop_index("ix_tax_lines_parent", table_name="tax_lines", schema="commerce")
    op.drop_table("tax_lines", schema="commerce")
    op.drop_index("ix_order_items_order_id", table_name="order_items", schema="commerce")
    op.drop_table("order_items", schema="commerce")
    op.drop_index("ix_orders_user_id", table_name="orders", schema="commerce")
    op.drop_table("orders", schema="commerce")
    op.drop_table("refund_policies", schema="ticketing")
    op.drop_index("ix_check_ins_event_id", table_name="check_ins", schema="ticketing")
    op.drop_table("check_ins", schema="ticketing")
    op.drop_index("uq_tickets_qr_secret_hash", table_name="tickets", schema="ticketing")
    op.drop_index("ix_tickets_order_item_id", table_name="tickets", schema="ticketing")
    op.drop_index("ix_tickets_ticket_type_status", table_name="tickets", schema="ticketing")
    op.drop_index("ix_tickets_owner_user_id", table_name="tickets", schema="ticketing")
    op.drop_table("tickets", schema="ticketing")
    op.drop_index("ix_ticket_holds_user_id", table_name="ticket_holds", schema="ticketing")
    op.drop_index("ix_ticket_holds_ticket_type_id", table_name="ticket_holds", schema="ticketing")
    op.drop_index("ix_ticket_holds_status_expires", table_name="ticket_holds", schema="ticketing")
    op.drop_table("ticket_holds", schema="ticketing")
    op.drop_table("ticket_type_inventory", schema="ticketing")
    op.drop_index("ix_ticket_types_event_status", table_name="ticket_types", schema="ticketing")
    op.drop_table("ticket_types", schema="ticketing")
    op.execute(sa.text("DROP SCHEMA IF EXISTS finance"))
    op.execute(sa.text("DROP SCHEMA IF EXISTS commerce"))
    op.execute(sa.text("DROP SCHEMA IF EXISTS ticketing"))
