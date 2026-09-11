"""Subscription tables. Plan versions snapshot commercial terms (Q-P9-02)."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from cornerroom.infra.base import ActorMixin, Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin, VersionMixin


class SubscriptionPlan(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, VersionMixin, Base):
    __tablename__ = "subscription_plans"
    __table_args__ = (
        CheckConstraint("status IN ('DRAFT','ACTIVE','RETIRED')", name="status"),
        CheckConstraint("price_amount_minor >= 0", name="price_non_negative"),
        UniqueConstraint("key", name="uq_subscription_plans_key"),
        Index("ix_subscription_plans_org_status", "organization_id", "status"),
        {"schema": "subscriptions"},
    )

    organization_id: Mapped[UUID] = mapped_column(
        ForeignKey("identity.organizations.id"),
        nullable=False,
    )
    key: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="DRAFT")
    price_amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    interval: Mapped[str] = mapped_column(String(16), nullable=False)
    interval_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    features: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    current_version_id: Mapped[UUID | None] = mapped_column(nullable=True)
    __mapper_args__ = {"version_id_col": "version"}


class SubscriptionPlanVersion(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, Base):
    """Immutable commercial terms once a subscription has referenced the version."""

    __tablename__ = "subscription_plan_versions"
    __table_args__ = (
        CheckConstraint("price_amount_minor >= 0", name="price_non_negative"),
        CheckConstraint("interval_count >= 1", name="interval_count_positive"),
        CheckConstraint("trial_days IS NULL OR trial_days >= 0", name="trial_days_non_negative"),
        UniqueConstraint("plan_id", "version_number", name="uq_plan_versions_number"),
        Index("ix_plan_versions_plan_id", "plan_id"),
        {"schema": "subscriptions"},
    )

    plan_id: Mapped[UUID] = mapped_column(
        ForeignKey("subscriptions.subscription_plans.id"),
        nullable=False,
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    price_amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    interval: Mapped[str] = mapped_column(String(16), nullable=False)
    interval_count: Mapped[int] = mapped_column(Integer, nullable=False)
    trial_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    features: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


class Subscription(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, VersionMixin, Base):
    __tablename__ = "subscriptions"
    __table_args__ = (
        CheckConstraint(
            "status IN ('TRIALING','ACTIVE','PAST_DUE','CANCELLED','EXPIRED')",
            name="status",
        ),
        Index("ix_subscriptions_user_status", "user_id", "status"),
        Index("ix_subscriptions_plan_id", "plan_id"),
        {"schema": "subscriptions"},
    )

    user_id: Mapped[UUID] = mapped_column(ForeignKey("identity.users.id"), nullable=False)
    plan_id: Mapped[UUID] = mapped_column(
        ForeignKey("subscriptions.subscription_plans.id"),
        nullable=False,
    )
    plan_version_id: Mapped[UUID] = mapped_column(
        ForeignKey("subscriptions.subscription_plan_versions.id"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    current_period_id: Mapped[UUID | None] = mapped_column(nullable=True)
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    __mapper_args__ = {"version_id_col": "version"}


class SubscriptionPeriod(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, Base):
    __tablename__ = "subscription_periods"
    __table_args__ = (
        CheckConstraint("status IN ('OPEN','PAID','UNPAID','CLOSED')", name="status"),
        CheckConstraint("amount_minor >= 0", name="amount_non_negative"),
        UniqueConstraint("subscription_id", "starts_at", name="uq_subscription_periods_starts"),
        Index("ix_subscription_periods_subscription_id", "subscription_id"),
        {"schema": "subscriptions"},
    )

    subscription_id: Mapped[UUID] = mapped_column(
        ForeignKey("subscriptions.subscriptions.id"),
        nullable=False,
    )
    plan_version_id: Mapped[UUID] = mapped_column(
        ForeignKey("subscriptions.subscription_plan_versions.id"),
        nullable=False,
    )
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="OPEN")
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    order_id: Mapped[UUID | None] = mapped_column(ForeignKey("commerce.orders.id"), nullable=True)
