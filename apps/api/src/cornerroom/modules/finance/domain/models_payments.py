"""Payment instruments. Reused from Phase 05 / 09. Ledger posting is Phase 11."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import BigInteger, CheckConstraint, ForeignKey, Index, String, UniqueConstraint
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
