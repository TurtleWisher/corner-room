"""Phase 11 finance ledger and settlement payout.

Revision ID: 0012_finance_settlement
Revises: 0011_royalty_engine
Create Date: 2026-09-11

Does not rewrite 0001–0011. Extends royalties.settlements status only.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0012_finance_settlement"
down_revision: Union[str, Sequence[str], None] = "0011_royalty_engine"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(sa.text("CREATE SCHEMA IF NOT EXISTS finance"))

    op.drop_constraint("ck_settlements_status", "settlements", schema="royalties", type_="check")
    op.create_check_constraint(
        "ck_settlements_status",
        "settlements",
        "status IN ('CALCULATED','APPROVED','PROCESSING','PAID','COMPLETED','FAILED','VOIDED')",
        schema="royalties",
    )

    op.create_table(
        "ledger_accounts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("type", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="ACTIVE"),
        sa.Column("provisional", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint("type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')", name="ck_ledger_accounts_type"),
        sa.CheckConstraint("status IN ('ACTIVE','RETIRED')", name="ck_ledger_accounts_status"),
        sa.ForeignKeyConstraint(["organization_id"], ["identity.organizations.id"], name="fk_ledger_accounts_organization_id_organizations"),
        sa.UniqueConstraint("organization_id", "code", name="uq_ledger_accounts_org_code"),
        schema="finance",
    )
    op.create_index("ix_ledger_accounts_org_type", "ledger_accounts", ["organization_id", "type"], schema="finance")

    op.create_table(
        "transactions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("type", sa.String(32), nullable=False),
        sa.Column("source_module", sa.String(32), nullable=False),
        sa.Column("source_type", sa.String(64), nullable=False),
        sa.Column("source_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="DRAFT"),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("idempotency_key", sa.String(160), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("currency_code", sa.String(3), nullable=False),
        sa.Column("reversal_of_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint(
            "type IN ('TICKET_SALE','MUSIC_PURCHASE','SUBSCRIPTION','SPONSORSHIP',"
            "'OTHER_INCOME','REFUND','EXPENSE','ADJUSTMENT','ROYALTY_ACCRUAL',"
            "'SETTLEMENT_PAYOUT','PAYOUT_FEE','TAX')",
            name="ck_transactions_type",
        ),
        sa.CheckConstraint(
            "source_module IN ('TICKETING','SUBSCRIPTIONS','MUSIC','EVENTS','CAMPAIGNS',"
            "'ROYALTIES','FINANCE','ADMIN','COMMERCE')",
            name="ck_transactions_source_module",
        ),
        sa.CheckConstraint("status IN ('DRAFT','POSTED','REVERSED')", name="ck_transactions_status"),
        sa.ForeignKeyConstraint(["organization_id"], ["identity.organizations.id"], name="fk_transactions_organization_id_organizations"),
        sa.ForeignKeyConstraint(["reversal_of_id"], ["finance.transactions.id"], name="fk_transactions_reversal_of_id_transactions"),
        sa.UniqueConstraint("idempotency_key", name="uq_transactions_idempotency_key"),
        schema="finance",
    )
    op.create_index("ix_transactions_org_occurred", "transactions", ["organization_id", "occurred_at"], schema="finance")
    op.create_index("ix_transactions_source", "transactions", ["source_type", "source_id"], schema="finance")

    op.create_table(
        "ledger_entries",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("transaction_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("direction", sa.String(8), nullable=False),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency_code", sa.String(3), nullable=False),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("artist_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("track_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("campaign_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("payee_type", sa.String(32), nullable=True),
        sa.Column("payee_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("direction IN ('DEBIT','CREDIT')", name="ck_ledger_entries_direction"),
        sa.CheckConstraint("amount_minor > 0", name="ck_ledger_entries_amount_positive"),
        sa.ForeignKeyConstraint(["transaction_id"], ["finance.transactions.id"], name="fk_ledger_entries_transaction_id_transactions"),
        sa.ForeignKeyConstraint(["account_id"], ["finance.ledger_accounts.id"], name="fk_ledger_entries_account_id_ledger_accounts"),
        schema="finance",
    )
    op.create_index("ix_ledger_entries_transaction_id", "ledger_entries", ["transaction_id"], schema="finance")
    op.create_index("ix_ledger_entries_account_created", "ledger_entries", ["account_id", "created_at"], schema="finance")
    op.create_index("ix_ledger_entries_event_id", "ledger_entries", ["event_id"], schema="finance")
    op.create_index("ix_ledger_entries_payee", "ledger_entries", ["payee_type", "payee_id"], schema="finance")

    op.create_table(
        "revenues",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="DRAFT"),
        sa.Column("category", sa.String(64), nullable=False),
        sa.Column("source_type", sa.String(64), nullable=False),
        sa.Column("source_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency_code", sa.String(3), nullable=False),
        sa.Column("recognized_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("transaction_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("track_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("period_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("period_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint("status IN ('DRAFT','RECOGNIZED','REVERSED')", name="ck_revenues_status"),
        sa.CheckConstraint("amount_minor >= 0", name="ck_revenues_amount_non_negative"),
        sa.ForeignKeyConstraint(["organization_id"], ["identity.organizations.id"], name="fk_revenues_organization_id_organizations"),
        sa.ForeignKeyConstraint(["transaction_id"], ["finance.transactions.id"], name="fk_revenues_transaction_id_transactions"),
        sa.UniqueConstraint("source_type", "source_id", "category", name="uq_revenues_recognition"),
        schema="finance",
    )
    op.create_index("ix_revenues_org_status", "revenues", ["organization_id", "status"], schema="finance")

    op.create_table(
        "expense_categories",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("code", sa.String(64), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("account_code", sa.String(32), nullable=False, server_default="5000"),
        sa.Column("status", sa.String(16), nullable=False, server_default="ACTIVE"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint("status IN ('ACTIVE','RETIRED')", name="ck_expense_categories_status"),
        sa.ForeignKeyConstraint(["organization_id"], ["identity.organizations.id"], name="fk_expense_categories_organization_id_organizations"),
        sa.UniqueConstraint("organization_id", "code", name="uq_expense_categories_org_code"),
        schema="finance",
    )

    op.create_table(
        "expenses",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="DRAFT"),
        sa.Column("category", sa.String(64), nullable=False),
        sa.Column("source_type", sa.String(64), nullable=False),
        sa.Column("source_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency_code", sa.String(3), nullable=False),
        sa.Column("recognized_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("transaction_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("approved_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint("status IN ('DRAFT','APPROVED','RECOGNIZED','REVERSED')", name="ck_expenses_status"),
        sa.CheckConstraint("amount_minor >= 0", name="ck_expenses_amount_non_negative"),
        sa.ForeignKeyConstraint(["organization_id"], ["identity.organizations.id"], name="fk_expenses_organization_id_organizations"),
        sa.ForeignKeyConstraint(["transaction_id"], ["finance.transactions.id"], name="fk_expenses_transaction_id_transactions"),
        sa.UniqueConstraint("source_type", "source_id", "category", name="uq_expenses_recognition"),
        schema="finance",
    )
    op.create_index("ix_expenses_org_status", "expenses", ["organization_id", "status"], schema="finance")

    op.create_table(
        "adjustments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="DRAFT"),
        sa.Column("reason_code", sa.String(64), nullable=False),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency_code", sa.String(3), nullable=False),
        sa.Column("target_type", sa.String(64), nullable=False),
        sa.Column("target_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("transaction_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("idempotency_key", sa.String(160), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint("status IN ('DRAFT','POSTED','REVERSED')", name="ck_adjustments_status"),
        sa.ForeignKeyConstraint(["organization_id"], ["identity.organizations.id"], name="fk_adjustments_organization_id_organizations"),
        sa.ForeignKeyConstraint(["transaction_id"], ["finance.transactions.id"], name="fk_adjustments_transaction_id_transactions"),
        sa.UniqueConstraint("idempotency_key", name="uq_adjustments_idempotency_key"),
        schema="finance",
    )

    op.create_table(
        "invoices",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("direction", sa.String(8), nullable=False),
        sa.Column("counterparty_type", sa.String(32), nullable=False),
        sa.Column("counterparty_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="DRAFT"),
        sa.Column("total_amount_minor", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("currency_code", sa.String(3), nullable=False),
        sa.Column("document_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("transaction_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint("direction IN ('AR','AP')", name="ck_invoices_direction"),
        sa.CheckConstraint(
            "status IN ('DRAFT','ISSUED','PARTIALLY_PAID','PAID','VOIDED','OVERDUE')",
            name="ck_invoices_status",
        ),
        sa.CheckConstraint("total_amount_minor >= 0", name="ck_invoices_amount_non_negative"),
        sa.ForeignKeyConstraint(["organization_id"], ["identity.organizations.id"], name="fk_invoices_organization_id_organizations"),
        sa.ForeignKeyConstraint(["transaction_id"], ["finance.transactions.id"], name="fk_invoices_transaction_id_transactions"),
        schema="finance",
    )
    op.create_index("ix_invoices_org_status", "invoices", ["organization_id", "status"], schema="finance")

    op.create_table(
        "invoice_lines",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("invoice_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("description", sa.String(240), nullable=False),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("amount_minor >= 0", name="ck_invoice_lines_amount_non_negative"),
        sa.ForeignKeyConstraint(["invoice_id"], ["finance.invoices.id"], name="fk_invoice_lines_invoice_id_invoices"),
        schema="finance",
    )
    op.create_index("ix_invoice_lines_invoice_id", "invoice_lines", ["invoice_id"], schema="finance")

    op.create_table(
        "payout_methods",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("payee_type", sa.String(32), nullable=False),
        sa.Column("payee_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("provider", sa.String(64), nullable=False, server_default="SANDBOX"),
        sa.Column("token_ref", sa.String(128), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="ACTIVE"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint("status IN ('ACTIVE','RETIRED')", name="ck_payout_methods_status"),
        sa.ForeignKeyConstraint(["organization_id"], ["identity.organizations.id"], name="fk_payout_methods_organization_id_organizations"),
        schema="finance",
    )
    op.create_index("ix_payout_methods_payee", "payout_methods", ["payee_type", "payee_id"], schema="finance")

    op.create_table(
        "payee_compliance",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("payee_type", sa.String(32), nullable=False),
        sa.Column("payee_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("kyc_present", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("tax_record_present", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["identity.organizations.id"], name="fk_payee_compliance_organization_id_organizations"),
        sa.UniqueConstraint("payee_type", "payee_id", "organization_id", name="uq_payee_compliance_payee_org"),
        schema="finance",
    )

    op.create_table(
        "payouts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("settlement_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="PENDING"),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency_code", sa.String(3), nullable=False),
        sa.Column("provider", sa.String(64), nullable=False, server_default="SANDBOX"),
        sa.Column("provider_ref", sa.String(128), nullable=True),
        sa.Column("payout_method_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("approved_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("second_approved_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("initiated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("transaction_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("idempotency_key", sa.String(160), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint("status IN ('PENDING','PROCESSING','PAID','FAILED')", name="ck_payouts_status"),
        sa.CheckConstraint("amount_minor >= 0", name="ck_payouts_amount_non_negative"),
        sa.ForeignKeyConstraint(["organization_id"], ["identity.organizations.id"], name="fk_payouts_organization_id_organizations"),
        sa.ForeignKeyConstraint(["settlement_id"], ["royalties.settlements.id"], name="fk_payouts_settlement_id_settlements"),
        sa.ForeignKeyConstraint(["payout_method_id"], ["finance.payout_methods.id"], name="fk_payouts_payout_method_id_payout_methods"),
        sa.ForeignKeyConstraint(["transaction_id"], ["finance.transactions.id"], name="fk_payouts_transaction_id_transactions"),
        sa.UniqueConstraint("idempotency_key", name="uq_payouts_idempotency_key"),
        schema="finance",
    )
    op.create_index("ix_payouts_settlement_id", "payouts", ["settlement_id"], schema="finance")

    op.create_table(
        "finance_config",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("key", sa.String(80), nullable=False),
        sa.Column("int_value", sa.Integer(), nullable=True),
        sa.Column("text_value", sa.String(120), nullable=True),
        sa.Column("json_value", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["identity.organizations.id"], name="fk_finance_config_organization_id_organizations"),
        sa.UniqueConstraint("organization_id", "key", name="uq_finance_config_org_key"),
        schema="finance",
    )

    op.create_table(
        "reconciliation_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="UNRECONCILED"),
        sa.Column("expected_amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("actual_amount_minor", sa.BigInteger(), nullable=True),
        sa.Column("currency_code", sa.String(3), nullable=False),
        sa.Column("provider_ref", sa.String(128), nullable=True),
        sa.Column("payment_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("idempotency_key", sa.String(160), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint("status IN ('MATCHED','MISMATCH','UNRECONCILED')", name="ck_reconciliation_items_status"),
        sa.ForeignKeyConstraint(["organization_id"], ["identity.organizations.id"], name="fk_reconciliation_items_organization_id_organizations"),
        sa.ForeignKeyConstraint(["payment_id"], ["finance.payments.id"], name="fk_reconciliation_items_payment_id_payments"),
        sa.UniqueConstraint("idempotency_key", name="uq_reconciliation_items_idempotency"),
        schema="finance",
    )
    op.create_index(
        "ix_reconciliation_org_status",
        "reconciliation_items",
        ["organization_id", "status"],
        schema="finance",
    )


def downgrade() -> None:
    op.drop_table("reconciliation_items", schema="finance")
    op.drop_table("finance_config", schema="finance")
    op.drop_table("payouts", schema="finance")
    op.drop_table("payee_compliance", schema="finance")
    op.drop_table("payout_methods", schema="finance")
    op.drop_table("invoice_lines", schema="finance")
    op.drop_table("invoices", schema="finance")
    op.drop_table("adjustments", schema="finance")
    op.drop_table("expenses", schema="finance")
    op.drop_table("expense_categories", schema="finance")
    op.drop_table("revenues", schema="finance")
    op.drop_table("ledger_entries", schema="finance")
    op.drop_table("transactions", schema="finance")
    op.drop_table("ledger_accounts", schema="finance")
    op.drop_constraint("ck_settlements_status", "settlements", schema="royalties", type_="check")
    op.create_check_constraint(
        "ck_settlements_status",
        "settlements",
        "status IN ('CALCULATED','APPROVED','PROCESSING','PAID','COMPLETED')",
        schema="royalties",
    )
