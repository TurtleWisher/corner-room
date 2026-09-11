"""Ticketing tables. Owner: Ticketing. Inventory is independent of venue.capacity."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from cornerroom.infra.base import (
    ActorMixin,
    Base,
    SoftDeleteMixin,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)


class TicketType(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, Base):
    __tablename__ = "ticket_types"
    __table_args__ = (
        CheckConstraint(
            "status IN ('DRAFT','ON_SALE','SOLD_OUT','CLOSED','ARCHIVED')",
            name="status",
        ),
        CheckConstraint("price_amount_minor >= 0", name="price_non_negative"),
        CheckConstraint("quantity_total >= 0", name="quantity_non_negative"),
        Index("ix_ticket_types_event_status", "event_id", "status"),
        {"schema": "ticketing"},
    )

    event_id: Mapped[UUID] = mapped_column(ForeignKey("events.events.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="DRAFT")
    price_amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    quantity_total: Mapped[int] = mapped_column(Integer, nullable=False)
    sales_starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sales_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    extra_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    __mapper_args__ = {"version_id_col": version}


class TicketTypeInventory(Base):
    """Transactional remaining counter. ASSUMED in 03_; remaining >= 0."""

    __tablename__ = "ticket_type_inventory"
    __table_args__ = (
        CheckConstraint("remaining >= 0", name="remaining_non_negative"),
        {"schema": "ticketing"},
    )

    ticket_type_id: Mapped[UUID] = mapped_column(
        ForeignKey("ticketing.ticket_types.id"),
        primary_key=True,
    )
    remaining: Mapped[int] = mapped_column(Integer, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    __mapper_args__ = {"version_id_col": version}


class TicketHold(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, Base):
    __tablename__ = "ticket_holds"
    __table_args__ = (
        CheckConstraint(
            "status IN ('ACTIVE','CONVERTED','EXPIRED','RELEASED')",
            name="status",
        ),
        CheckConstraint("quantity >= 1", name="quantity_positive"),
        Index("ix_ticket_holds_status_expires", "status", "expires_at"),
        Index("ix_ticket_holds_ticket_type_id", "ticket_type_id"),
        Index("ix_ticket_holds_user_id", "user_id"),
        {"schema": "ticketing"},
    )

    ticket_type_id: Mapped[UUID] = mapped_column(
        ForeignKey("ticketing.ticket_types.id"),
        nullable=False,
    )
    user_id: Mapped[UUID | None] = mapped_column(ForeignKey("identity.users.id"), nullable=True)
    order_id: Mapped[UUID | None] = mapped_column(nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class Ticket(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, Base):
    __tablename__ = "tickets"
    __table_args__ = (
        CheckConstraint(
            "status IN ('CREATED','RESERVED','PAYMENT_PENDING','PAID','ISSUED',"
            "'CHECKED_IN','EXPIRED','CANCELLED','REFUNDED')",
            name="status",
        ),
        Index("ix_tickets_owner_user_id", "owner_user_id"),
        Index("ix_tickets_ticket_type_status", "ticket_type_id", "status"),
        Index("ix_tickets_order_item_id", "order_item_id"),
        Index(
            "uq_tickets_qr_secret_hash",
            "qr_secret_hash",
            unique=True,
            postgresql_where=text("qr_secret_hash IS NOT NULL"),
        ),
        {"schema": "ticketing"},
    )

    ticket_type_id: Mapped[UUID] = mapped_column(
        ForeignKey("ticketing.ticket_types.id"),
        nullable=False,
    )
    hold_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("ticketing.ticket_holds.id"),
        nullable=True,
    )
    order_item_id: Mapped[UUID | None] = mapped_column(nullable=True)
    owner_user_id: Mapped[UUID] = mapped_column(ForeignKey("identity.users.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="CREATED")
    qr_asset_id: Mapped[UUID | None] = mapped_column(nullable=True)
    qr_secret_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    transferred_from_ticket_id: Mapped[UUID | None] = mapped_column(nullable=True)


class CheckIn(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "check_ins"
    __table_args__ = (
        CheckConstraint("status IN ('RECORDED','VOIDED')", name="status"),
        UniqueConstraint("ticket_id", name="uq_check_ins_ticket_id"),
        Index("ix_check_ins_event_id", "event_id"),
        {"schema": "ticketing"},
    )

    ticket_id: Mapped[UUID] = mapped_column(ForeignKey("ticketing.tickets.id"), nullable=False)
    event_id: Mapped[UUID] = mapped_column(ForeignKey("events.events.id"), nullable=False)
    staff_user_id: Mapped[UUID] = mapped_column(ForeignKey("identity.users.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="RECORDED")
    scanned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class RefundPolicy(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Policy rows only. Refund execution is Finance / Phase 11 (Q-P0-05)."""

    __tablename__ = "refund_policies"
    __table_args__ = (
        CheckConstraint("scope_type IN ('PLATFORM','EVENT','PRODUCT','PLAN')", name="scope_type"),
        {"schema": "ticketing"},
    )

    scope_type: Mapped[str] = mapped_column(String(32), nullable=False)
    scope_id: Mapped[UUID | None] = mapped_column(nullable=True)
    reason_code: Mapped[str] = mapped_column(String(64), nullable=False)
    eligible_rules: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    requires_finance_approve: Mapped[bool] = mapped_column(nullable=False, default=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
