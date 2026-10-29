"""Commerce kernel tables. Phase 05 ticket path; Phase 09 Product/Offer/catalog items."""

from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from sqlalchemy import BigInteger, Boolean, CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, declared_attr, mapped_column

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
            "purpose IN ('TICKET','TRACK','SUBSCRIPTION','RELEASE')",
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
    # D-PRESALE-02: bought at the pre-sale price before the release was out (unlocks on release day).
    is_presale: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")


class OrderItem(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "order_items"
    __table_args__ = (
        CheckConstraint(
            "item_type IN ('TICKET','TRACK','SUBSCRIPTION','OTHER','RELEASE')",
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
    # The exact product bought (offer checkouts), so fulfilment never guesses it from subject_id
    # (one subject can carry two product types). NULL on older lines and on ticket/plan lines.
    product_id: Mapped[UUID | None] = mapped_column(ForeignKey("commerce.products.id"), nullable=True)


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
            "product_type IN ('TRACK','CATALOG_ACCESS','SUBSCRIPTION_PLAN','RELEASE')",
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
    # The version column comes from VersionMixin, so reference the Column, not its name.
    @declared_attr.directive
    def __mapper_args__(cls) -> dict[str, object]:
        return {"version_id_col": cls.__table__.c.version}


class Offer(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, VersionMixin, Base):
    """Staff-configured price. Integer minor units. No invented defaults."""

    __tablename__ = "offers"
    __table_args__ = (
        CheckConstraint("status IN ('DRAFT','ACTIVE','RETIRED')", name="status"),
        CheckConstraint("amount_minor >= 0", name="amount_non_negative"),
        CheckConstraint("audience IN ('EVERYONE','OWNS_PART_OF_RELEASE','PRESALE')", name="audience"),
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
    # Who this price is for (D-AUDIO-11): everyone, or fans who already own part of the release.
    audience: Mapped[str] = mapped_column(String(24), nullable=False, default="EVERYONE", server_default="EVERYONE")
    # The version column comes from VersionMixin, so reference the Column, not its name.
    @declared_attr.directive
    def __mapper_args__(cls) -> dict[str, object]:
        return {"version_id_col": cls.__table__.c.version}


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


class OfferProposal(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A price an artist proposes for a track or release; ops accept or counter it (D-AUDIO-11, D-AUDIO-15).

    Money is stored as given (integer minor units and currency). Nothing here computes a price.
    """

    __tablename__ = "offer_proposals"
    __table_args__ = (
        CheckConstraint("subject_type IN ('TRACK','RELEASE')", name="subject_type"),
        CheckConstraint("audience IN ('EVERYONE','OWNS_PART_OF_RELEASE','PRESALE')", name="audience"),
        CheckConstraint("status IN ('PROPOSED','ACCEPTED','COUNTERED','WITHDRAWN')", name="status"),
        CheckConstraint("amount_minor >= 0", name="amount_non_negative"),
        Index("ix_offer_proposals_subject", "subject_type", "subject_id"),
        Index("ix_offer_proposals_status", "status"),
        {"schema": "commerce"},
    )

    release_id: Mapped[UUID] = mapped_column(nullable=False)
    subject_type: Mapped[str] = mapped_column(String(16), nullable=False)
    subject_id: Mapped[UUID] = mapped_column(nullable=False)
    audience: Mapped[str] = mapped_column(String(24), nullable=False, default="EVERYONE")
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    proposed_by: Mapped[UUID] = mapped_column(nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="PROPOSED")
    decided_by: Mapped[UUID | None] = mapped_column(nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decision_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    resulting_offer_id: Mapped[UUID | None] = mapped_column(nullable=True)


class OrderDeliveryAddress(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """The delivery address the buyer confirmed for this order (D-ADDR-01), copied at checkout so
    a later change to the account's address does not rewrite past orders. Personal data."""

    __tablename__ = "order_delivery_addresses"
    __table_args__ = (
        UniqueConstraint("order_id", name="uq_order_delivery_addresses_order_id"),
        {"schema": "commerce"},
    )

    order_id: Mapped[UUID] = mapped_column(ForeignKey("commerce.orders.id"), nullable=False)
    # D-ADDR-02: anywhere in the world. D-ADDR-03: one shape, address_line1 to postcode; the other
    # columns are from earlier shapes and filled only on old orders (copied into address_line1 by 0041).
    country_code: Mapped[str] = mapped_column(String(2), nullable=False, default="BD", server_default="BD")
    recipient_name: Mapped[str] = mapped_column(String(120), nullable=False)
    phone_country: Mapped[str | None] = mapped_column(String(2), nullable=True)
    phone: Mapped[str] = mapped_column(String(16), nullable=False)
    division: Mapped[str | None] = mapped_column(String(32), nullable=True)
    district: Mapped[str | None] = mapped_column(String(64), nullable=True)
    upazila: Mapped[str | None] = mapped_column(String(80), nullable=True)
    area: Mapped[str | None] = mapped_column(String(120), nullable=True)
    house_road: Mapped[str | None] = mapped_column(String(200), nullable=True)
    address_line1: Mapped[str | None] = mapped_column(Text, nullable=True)
    address_line2: Mapped[str | None] = mapped_column(String(200), nullable=True)
    city: Mapped[str | None] = mapped_column(String(120), nullable=True)
    region: Mapped[str | None] = mapped_column(String(120), nullable=True)
    postcode: Mapped[str | None] = mapped_column(String(16), nullable=True)
    landmark: Mapped[str | None] = mapped_column(String(200), nullable=True)

PRESALE_STATUSES = ("WAITING", "CLAIMED", "CANCELLED")


class PresaleClaim(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, Base):
    """A sale made before Corner Room existed (owner, 2026-10-25: the MIZULS single's ~90 buyers).

    Staff list who paid and how much. When that email becomes a verified Corner Room account, the
    pre-sale becomes a normal order and payment through the usual pipeline, so the buyer owns the
    song and it counts in sales and finance from then on (`PresaleService.claim_for_user`).
    Personal data: name and email only (no phone or address)."""

    __tablename__ = "presale_claims"
    __table_args__ = (
        CheckConstraint("status IN ('WAITING','CLAIMED','CANCELLED')", name="status"),
        CheckConstraint("amount_minor >= 0", name="amount_not_negative"),  # 0 = a gift (owner, 2026-10-25)
        Index("ix_presale_claims_email", "email"),
        Index(
            "uq_presale_claims_product_email_live",
            "product_id",
            "email",
            unique=True,
            postgresql_where=text("status <> 'CANCELLED'"),
        ),
        {"schema": "commerce"},
    )

    organization_id: Mapped[UUID] = mapped_column(ForeignKey("identity.organizations.id"), nullable=False)
    product_id: Mapped[UUID] = mapped_column(ForeignKey("commerce.products.id"), nullable=False)
    # Always stored lower-case and trimmed, the way accounts store emails.
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    buyer_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    paid_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    # From the sheet (owner, 2026-10-27): seen only by staff with customer access.
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="WAITING")
    claimed_user_id: Mapped[UUID | None] = mapped_column(ForeignKey("identity.users.id"), nullable=True)
    order_id: Mapped[UUID | None] = mapped_column(ForeignKey("commerce.orders.id"), nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
