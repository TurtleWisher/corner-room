"""Payment instruments. Reused from Phase 05 / 09. Ledger posting is Phase 11."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from cornerroom.infra.base import ActorMixin, Base, TimestampMixin, UUIDPrimaryKeyMixin


class Payment(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, Base):
    __tablename__ = "payments"
    __table_args__ = (
        CheckConstraint(
            "status IN ('CREATED','REQUIRES_ACTION','AUTHORIZED','CAPTURED','FAILED','CANCELLED')",
            name="status",
        ),
        CheckConstraint("amount_minor >= 0", name="amount_non_negative"),
        UniqueConstraint("idempotency_key", name="uq_payments_idempotency_key"),
        Index("ix_payments_order_id", "order_id"),
        Index("ix_payments_user_id", "user_id"),
        {"schema": "finance"},
    )

    order_id: Mapped[UUID | None] = mapped_column(ForeignKey("commerce.orders.id"), nullable=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("identity.users.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="CREATED")
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    provider_ref: Mapped[str | None] = mapped_column(String(128), nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)


class PaymentAttempt(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "payment_attempts"
    __table_args__ = (
        CheckConstraint("status IN ('STARTED','SUCCEEDED','FAILED')", name="status"),
        UniqueConstraint("provider_event_id", name="uq_payment_attempts_provider_event_id"),
        Index("ix_payment_attempts_payment_id", "payment_id"),
        {"schema": "finance"},
    )

    payment_id: Mapped[UUID] = mapped_column(ForeignKey("finance.payments.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="STARTED")
    provider_event_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    raw_status: Mapped[str | None] = mapped_column(String(64), nullable=True)


class Refund(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, Base):
    """Additive refund. Never mutates the original Payment amount (Q-P9-06)."""

    __tablename__ = "refunds"
    __table_args__ = (
        CheckConstraint(
            "status IN ('REQUESTED','APPROVED','PROCESSING','COMPLETED','REJECTED')",
            name="status",
        ),
        CheckConstraint("amount_minor >= 0", name="amount_non_negative"),
        UniqueConstraint("idempotency_key", name="uq_refunds_idempotency_key"),
        Index("ix_refunds_payment_id", "payment_id"),
        {"schema": "finance"},
    )

    payment_id: Mapped[UUID] = mapped_column(ForeignKey("finance.payments.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="REQUESTED")
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    reason_code: Mapped[str] = mapped_column(String(64), nullable=False)
    policy_id: Mapped[UUID | None] = mapped_column(nullable=True)
    approved_by: Mapped[UUID | None] = mapped_column(nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    # Q-COM-01: the tickets this refund covers (ids as strings). NULL: names no tickets.
    ticket_ids: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)


class PaymentSubmission(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A buyer's report of a Bangla QR payment, waiting for finance staff to check it (Q-PAY-01).

    The buyer gives the transaction ID, the number paid from and the app. Staff confirm (the
    payment is captured through the normal pipeline) or reject with a reason (the buyer may fix
    and resend, Q-PAY-05). A transaction ID can't be on two live submissions.
    """

    __tablename__ = "payment_submissions"
    __table_args__ = (
        CheckConstraint("status IN ('SUBMITTED','CONFIRMED','REJECTED')", name="status"),
        CheckConstraint("paid_with IN ('BKASH','NAGAD','ROCKET','UPAY','BANK_APP','OTHER')", name="paid_with"),
        Index("ix_payment_submissions_payment_id", "payment_id"),
        Index("ix_payment_submissions_status", "status"),
        Index(
            "uq_payment_submissions_live_transaction_ref",
            text("lower(transaction_ref)"),
            unique=True,
            postgresql_where=text("status <> 'REJECTED'"),
        ),
        {"schema": "finance"},
    )

    payment_id: Mapped[UUID] = mapped_column(ForeignKey("finance.payments.id"), nullable=False)
    order_id: Mapped[UUID | None] = mapped_column(nullable=True)
    user_id: Mapped[UUID] = mapped_column(nullable=False)
    transaction_ref: Mapped[str] = mapped_column(String(64), nullable=False)
    paid_from: Mapped[str] = mapped_column(String(32), nullable=False)
    paid_with: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="SUBMITTED")
    decided_by: Mapped[UUID | None] = mapped_column(nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decision_note: Mapped[str | None] = mapped_column(String(300), nullable=True)