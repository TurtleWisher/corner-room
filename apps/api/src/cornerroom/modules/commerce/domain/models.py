"""Commerce kernel tables. Phase 05 ticket path; Phase 09 Product/Offer/catalog items."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import BigInteger, CheckConstraint, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from cornerroom.infra.base import ActorMixin, Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin, VersionMixin


class Order(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, Base):
    __tablename__ = "orders"
    __table_args__ = (
        CheckConstraint(
            "status IN ('DRAFT','PENDING_PAYMENT','PAID','FULFILLED','CANCELLED',"
            "'PARTIALLY_REFUNDED','REFUNDED')",
            name="status",
        ),
        CheckConstraint(
            "purpose IN ('TICKET','TRACK','SUBSCRIPTION')",
            name="purpose",
        ),
        CheckConstraint("total_amount_minor >= 0", name="total_non_negative"),
        UniqueConstraint("idempotency_key", name="uq_orders_idempotency_key"),
        Index("ix_orders_user_id", "user_id"),
        {"schema": "commerce"},
    )

    user_id: Mapped[UUID] = mapped_column(ForeignKey("identity.users.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="DRAFT")
    total_amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    purpose: Mapped[str] = mapped_column(String(32), nullable=False, default="TICKET")


class OrderItem(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "order_items"
    __table_args__ = (
        CheckConstraint(
            "item_type IN ('TICKET','TRACK','SUBSCRIPTION','OTHER')",
            name="item_type",
        ),
        CheckConstraint("quantity >= 1", name="quantity_positive"),
        CheckConstraint("amount_minor >= 0", name="amount_non_negative"),
        Index("ix_order_items_order_id", "order_id"),
        {"schema": "commerce"},
    )

    order_id: Mapped[UUID] = mapped_column(ForeignKey("commerce.orders.id"), nullable=False)
    item_type: Mapped[str] = mapped_column(String(32), nullable=False)
    ref_id: Mapped[UUID] = mapped_column(nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    unit_amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)


class TaxLine(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Tax lines stored; rate from config (default 0). Do not invent a VAT percentage."""

    __tablename__ = "tax_lines"
    __table_args__ = (
        CheckConstraint("parent_type IN ('ORDER','ORDER_ITEM','INVOICE')", name="parent_type"),
        CheckConstraint("kind IN ('TAX','PLATFORM_TAKE','PSP_FEE','OTHER')", name="kind"),
        CheckConstraint("rate_bps >= 0", name="rate_non_negative"),
        CheckConstraint("amount_minor >= 0", name="amount_non_negative"),
        Index("ix_tax_lines_parent", "parent_type", "parent_id"),
        {"schema": "commerce"},
    )

    parent_type: Mapped[str] = mapped_column(String(32), nullable=False)
    parent_id: Mapped[UUID] = mapped_column(nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False, default="TAX")
    rate_bps: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)


class Product(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, VersionMixin, Base):
    """Staff-configured commercial SKU. Additive to 03_ (Q-P9-01). Prices live on Offer."""

    __tablename__ = "products"
    __table_args__ = (
        CheckConstraint(
            "product_type IN ('TRACK','CATALOG_ACCESS','SUBSCRIPTION_PLAN')",
            name="product_type",
        ),
        CheckConstraint("status IN ('DRAFT','ACTIVE','RETIRED')", name="status"),
        Index("ix_products_org_status", "organization_id", "status"),
        Index("ix_products_subject", "product_type", "subject_id"),
        {"schema": "commerce"},
    )

    organization_id: Mapped[UUID] = mapped_column(
        ForeignKey("identity.organizations.id"),
        nullable=False,
    )
    product_type: Mapped[str] = mapped_column(String(32), nullable=False)
    subject_id: Mapped[UUID] = mapped_column(nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="DRAFT")
    __mapper_args__ = {"version_id_col": "version"}


class Offer(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, VersionMixin, Base):
    """Staff-configured price. Integer minor units. No invented defaults."""

    __tablename__ = "offers"
    __table_args__ = (
        CheckConstraint("status IN ('DRAFT','ACTIVE','RETIRED')", name="status"),
        CheckConstraint("amount_minor >= 0", name="amount_non_negative"),
        Index("ix_offers_product_status", "product_id", "status"),
        Index("ix_offers_org_status", "organization_id", "status"),
        {"schema": "commerce"},
    )

    organization_id: Mapped[UUID] = mapped_column(
        ForeignKey("identity.organizations.id"),
        nullable=False,
    )
    product_id: Mapped[UUID] = mapped_column(ForeignKey("commerce.products.id"), nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="DRAFT")
    __mapper_args__ = {"version_id_col": "version"}


class RefundEntitlementPolicy(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, Base):
    """If no row matches, do not auto-revoke (Q-P9-06)."""

    __tablename__ = "refund_entitlement_policies"
    __table_args__ = (
        CheckConstraint("scope_type IN ('PLATFORM','PRODUCT','PLAN')", name="scope_type"),
        CheckConstraint("action IN ('REVOKE','KEEP')", name="action"),
        UniqueConstraint("scope_type", "scope_id", "reason_code", name="uq_refund_entitlement_scope_reason"),
        {"schema": "commerce"},
    )

    scope_type: Mapped[str] = mapped_column(String(32), nullable=False)
    scope_id: Mapped[UUID | None] = mapped_column(nullable=True)
    reason_code: Mapped[str] = mapped_column(String(64), nullable=False)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
