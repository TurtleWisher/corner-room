"""Finance instruments and the central ledger. No independent module books."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from cornerroom.infra.base import ActorMixin, Base, TimestampMixin, UUIDPrimaryKeyMixin, VersionMixin
from cornerroom.modules.finance.domain.models_payments import Payment, PaymentAttempt, Refund

__all__ = [
    "Payment",
    "PaymentAttempt",
    "Refund",
    "LedgerAccount",
    "FinanceTransaction",
    "LedgerEntry",
    "Revenue",
    "ExpenseCategory",
    "Expense",
    "Adjustment",
    "Invoice",
    "InvoiceLine",
    "PayoutMethod",
    "PayeeCompliance",
    "Payout",
    "FinanceConfig",
    "ReconciliationItem",
]


class LedgerAccount(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, Base):
    """Org-scoped FinancialAccount. Seeds are provisional (Q-P1-22)."""

    __tablename__ = "ledger_accounts"
    __table_args__ = (
        CheckConstraint(
            "type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')",
            name="type",
        ),
        CheckConstraint("status IN ('ACTIVE','RETIRED')", name="status"),
        UniqueConstraint("organization_id", "code", name="uq_ledger_accounts_org_code"),
        Index("ix_ledger_accounts_org_type", "organization_id", "type"),
        {"schema": "finance"},
    )

    organization_id: Mapped[UUID] = mapped_column(
        ForeignKey("identity.organizations.id"),
        nullable=False,
    )
    code: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    type: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="ACTIVE")
    provisional: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class FinanceTransaction(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, Base):
    """Journal header. Posted rows are reversed, never deleted."""

    __tablename__ = "transactions"
    __table_args__ = (
        CheckConstraint(
            "type IN ('TICKET_SALE','MUSIC_PURCHASE','SUBSCRIPTION','SPONSORSHIP',"
            "'OTHER_INCOME','REFUND','EXPENSE','ADJUSTMENT','ROYALTY_ACCRUAL',"
            "'SETTLEMENT_PAYOUT','PAYOUT_FEE','TAX')",
            name="type",
        ),
        CheckConstraint(
            "source_module IN ('TICKETING','SUBSCRIPTIONS','MUSIC','EVENTS','CAMPAIGNS',"
            "'ROYALTIES','FINANCE','ADMIN','COMMERCE')",
            name="source_module",
        ),
        CheckConstraint("status IN ('DRAFT','POSTED','REVERSED')", name="status"),
        UniqueConstraint("idempotency_key", name="uq_transactions_idempotency_key"),
        Index("ix_transactions_org_occurred", "organization_id", "occurred_at"),
        Index("ix_transactions_source", "source_type", "source_id"),
        {"schema": "finance"},
    )

    organization_id: Mapped[UUID] = mapped_column(
        ForeignKey("identity.organizations.id"),
        nullable=False,
    )
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    source_module: Mapped[str] = mapped_column(String(32), nullable=False)
    source_type: Mapped[str] = mapped_column(String(64), nullable=False)
    source_id: Mapped[UUID] = mapped_column(nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="DRAFT")
    actor_id: Mapped[UUID | None] = mapped_column(nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(160), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    reversal_of_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("finance.transactions.id"),
        nullable=True,
    )


class LedgerEntry(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "ledger_entries"
    __table_args__ = (
        CheckConstraint("direction IN ('DEBIT','CREDIT')", name="direction"),
        CheckConstraint("amount_minor > 0", name="amount_positive"),
        Index("ix_ledger_entries_transaction_id", "transaction_id"),
        Index("ix_ledger_entries_account_created", "account_id", "created_at"),
        Index("ix_ledger_entries_event_id", "event_id"),
        Index("ix_ledger_entries_payee", "payee_type", "payee_id"),
        {"schema": "finance"},
    )

    transaction_id: Mapped[UUID] = mapped_column(
        ForeignKey("finance.transactions.id"),
        nullable=False,
    )
    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("finance.ledger_accounts.id"),
        nullable=False,
    )
    direction: Mapped[str] = mapped_column(String(8), nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    event_id: Mapped[UUID | None] = mapped_column(nullable=True)
    artist_id: Mapped[UUID | None] = mapped_column(nullable=True)
    track_id: Mapped[UUID | None] = mapped_column(nullable=True)
    campaign_id: Mapped[UUID | None] = mapped_column(nullable=True)
    organization_id: Mapped[UUID | None] = mapped_column(nullable=True)
    payee_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    payee_id: Mapped[UUID | None] = mapped_column(nullable=True)


class Revenue(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, Base):
    __tablename__ = "revenues"
    __table_args__ = (
        CheckConstraint("status IN ('DRAFT','RECOGNIZED','REVERSED')", name="status"),
        CheckConstraint("amount_minor >= 0", name="amount_non_negative"),
        UniqueConstraint("source_type", "source_id", "category", name="uq_revenues_recognition"),
        Index("ix_revenues_org_status", "organization_id", "status"),
        {"schema": "finance"},
    )

    organization_id: Mapped[UUID] = mapped_column(
        ForeignKey("identity.organizations.id"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="DRAFT")
    category: Mapped[str] = mapped_column(String(64), nullable=False)
    source_type: Mapped[str] = mapped_column(String(64), nullable=False)
    source_id: Mapped[UUID] = mapped_column(nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    recognized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    transaction_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("finance.transactions.id"),
        nullable=True,
    )
    event_id: Mapped[UUID | None] = mapped_column(nullable=True)
    track_id: Mapped[UUID | None] = mapped_column(nullable=True)
    period_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ExpenseCategory(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, Base):
    __tablename__ = "expense_categories"
    __table_args__ = (
        CheckConstraint("status IN ('ACTIVE','RETIRED')", name="status"),
        UniqueConstraint("organization_id", "code", name="uq_expense_categories_org_code"),
        {"schema": "finance"},
    )

    organization_id: Mapped[UUID] = mapped_column(
        ForeignKey("identity.organizations.id"),
        nullable=False,
    )
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    account_code: Mapped[str] = mapped_column(String(32), nullable=False, default="5000")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="ACTIVE")


class Expense(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, VersionMixin, Base):
    __tablename__ = "expenses"
    __table_args__ = (
        CheckConstraint("status IN ('DRAFT','APPROVED','RECOGNIZED','REVERSED')", name="status"),
        CheckConstraint("amount_minor >= 0", name="amount_non_negative"),
        UniqueConstraint("source_type", "source_id", "category", name="uq_expenses_recognition"),
        Index("ix_expenses_org_status", "organization_id", "status"),
        {"schema": "finance"},
    )

    organization_id: Mapped[UUID] = mapped_column(
        ForeignKey("identity.organizations.id"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="DRAFT")
    category: Mapped[str] = mapped_column(String(64), nullable=False)
    source_type: Mapped[str] = mapped_column(String(64), nullable=False)
    source_id: Mapped[UUID] = mapped_column(nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    recognized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    transaction_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("finance.transactions.id"),
        nullable=True,
    )
    event_id: Mapped[UUID | None] = mapped_column(nullable=True)
    approved_by: Mapped[UUID | None] = mapped_column(nullable=True)
    __mapper_args__ = {"version_id_col": "version"}


class Adjustment(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, Base):
    __tablename__ = "adjustments"
    __table_args__ = (
        CheckConstraint("status IN ('DRAFT','POSTED','REVERSED')", name="status"),
        UniqueConstraint("idempotency_key", name="uq_adjustments_idempotency_key"),
        {"schema": "finance"},
    )

    organization_id: Mapped[UUID] = mapped_column(
        ForeignKey("identity.organizations.id"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="DRAFT")
    reason_code: Mapped[str] = mapped_column(String(64), nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    target_type: Mapped[str] = mapped_column(String(64), nullable=False)
    target_id: Mapped[UUID] = mapped_column(nullable=False)
    transaction_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("finance.transactions.id"),
        nullable=True,
    )
    idempotency_key: Mapped[str] = mapped_column(String(160), nullable=False)


class Invoice(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, VersionMixin, Base):
    __tablename__ = "invoices"
    __table_args__ = (
        CheckConstraint("direction IN ('AR','AP')", name="direction"),
        CheckConstraint(
            "status IN ('DRAFT','ISSUED','PARTIALLY_PAID','PAID','VOIDED','OVERDUE')",
            name="status",
        ),
        CheckConstraint("total_amount_minor >= 0", name="amount_non_negative"),
        Index("ix_invoices_org_status", "organization_id", "status"),
        {"schema": "finance"},
    )

    organization_id: Mapped[UUID] = mapped_column(
        ForeignKey("identity.organizations.id"),
        nullable=False,
    )
    direction: Mapped[str] = mapped_column(String(8), nullable=False)
    counterparty_type: Mapped[str] = mapped_column(String(32), nullable=False)
    counterparty_id: Mapped[UUID] = mapped_column(nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="DRAFT")
    total_amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    document_id: Mapped[UUID | None] = mapped_column(nullable=True)
    issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    transaction_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("finance.transactions.id"),
        nullable=True,
    )
    __mapper_args__ = {"version_id_col": "version"}


class InvoiceLine(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "invoice_lines"
    __table_args__ = (
        CheckConstraint("amount_minor >= 0", name="amount_non_negative"),
        Index("ix_invoice_lines_invoice_id", "invoice_id"),
        {"schema": "finance"},
    )

    invoice_id: Mapped[UUID] = mapped_column(ForeignKey("finance.invoices.id"), nullable=False)
    description: Mapped[str] = mapped_column(String(240), nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)


class PayoutMethod(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, Base):
    __tablename__ = "payout_methods"
    __table_args__ = (
        CheckConstraint("status IN ('ACTIVE','RETIRED')", name="status"),
        Index("ix_payout_methods_payee", "payee_type", "payee_id"),
        {"schema": "finance"},
    )

    payee_type: Mapped[str] = mapped_column(String(32), nullable=False)
    payee_id: Mapped[UUID] = mapped_column(nullable=False)
    organization_id: Mapped[UUID] = mapped_column(
        ForeignKey("identity.organizations.id"),
        nullable=False,
    )
    provider: Mapped[str] = mapped_column(String(64), nullable=False, default="SANDBOX")
    token_ref: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="ACTIVE")


class PayeeCompliance(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, Base):
    """Presence flags only. Does not invent KYC product rules (Q-P1-13)."""

    __tablename__ = "payee_compliance"
    __table_args__ = (
        UniqueConstraint("payee_type", "payee_id", "organization_id", name="uq_payee_compliance_payee_org"),
        {"schema": "finance"},
    )

    organization_id: Mapped[UUID] = mapped_column(
        ForeignKey("identity.organizations.id"),
        nullable=False,
    )
    payee_type: Mapped[str] = mapped_column(String(32), nullable=False)
    payee_id: Mapped[UUID] = mapped_column(nullable=False)
    kyc_present: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    tax_record_present: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class Payout(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, VersionMixin, Base):
    __tablename__ = "payouts"
    __table_args__ = (
        CheckConstraint("status IN ('PENDING','PROCESSING','PAID','FAILED')", name="status"),
        CheckConstraint("amount_minor >= 0", name="amount_non_negative"),
        UniqueConstraint("idempotency_key", name="uq_payouts_idempotency_key"),
        Index("ix_payouts_settlement_id", "settlement_id"),
        {"schema": "finance"},
    )

    organization_id: Mapped[UUID] = mapped_column(
        ForeignKey("identity.organizations.id"),
        nullable=False,
    )
    settlement_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("royalties.settlements.id"),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="PENDING")
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    provider: Mapped[str] = mapped_column(String(64), nullable=False, default="SANDBOX")
    provider_ref: Mapped[str | None] = mapped_column(String(128), nullable=True)
    payout_method_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("finance.payout_methods.id"),
        nullable=True,
    )
    approved_by: Mapped[UUID | None] = mapped_column(nullable=True)
    second_approved_by: Mapped[UUID | None] = mapped_column(nullable=True)
    initiated_by: Mapped[UUID | None] = mapped_column(nullable=True)
    transaction_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("finance.transactions.id"),
        nullable=True,
    )
    idempotency_key: Mapped[str] = mapped_column(String(160), nullable=False)
    __mapper_args__ = {"version_id_col": "version"}


class FinanceConfig(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, Base):
    """Typed config. NULL / missing keys fail closed. Never source rates from code."""

    __tablename__ = "finance_config"
    __table_args__ = (
        UniqueConstraint("organization_id", "key", name="uq_finance_config_org_key"),
        {"schema": "finance"},
    )

    organization_id: Mapped[UUID] = mapped_column(
        ForeignKey("identity.organizations.id"),
        nullable=False,
    )
    key: Mapped[str] = mapped_column(String(80), nullable=False)
    int_value: Mapped[int | None] = mapped_column(Integer, nullable=True)
    text_value: Mapped[str | None] = mapped_column(String(120), nullable=True)
    json_value: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


class ReconciliationItem(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, Base):
    __tablename__ = "reconciliation_items"
    __table_args__ = (
        CheckConstraint("status IN ('MATCHED','MISMATCH','UNRECONCILED')", name="status"),
        UniqueConstraint("idempotency_key", name="uq_reconciliation_items_idempotency"),
        Index("ix_reconciliation_org_status", "organization_id", "status"),
        {"schema": "finance"},
    )

    organization_id: Mapped[UUID] = mapped_column(
        ForeignKey("identity.organizations.id"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="UNRECONCILED")
    expected_amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    actual_amount_minor: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    provider_ref: Mapped[str | None] = mapped_column(String(128), nullable=True)
    payment_id: Mapped[UUID | None] = mapped_column(ForeignKey("finance.payments.id"), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(160), nullable=False)
