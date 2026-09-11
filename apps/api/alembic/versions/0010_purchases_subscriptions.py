"""Phase 09 purchases and subscriptions.

Revision ID: 0010_purchases_subscriptions
Revises: 0009_streaming_platform
Create Date: 2026-09-11

Does not rewrite 0001–0009. Ledger / royalties remain Phase 11 / 10.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0010_purchases_subscriptions"
down_revision: Union[str, Sequence[str], None] = "0009_streaming_platform"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(sa.text("CREATE SCHEMA IF NOT EXISTS subscriptions"))

    op.add_column(
        "orders",
        sa.Column("purpose", sa.String(32), nullable=False, server_default="TICKET"),
        schema="commerce",
    )
    op.create_check_constraint(
        "ck_orders_purpose",
        "orders",
        "purpose IN ('TICKET','TRACK','SUBSCRIPTION')",
        schema="commerce",
    )

    op.drop_constraint("ck_refund_policies_scope_type", "refund_policies", schema="ticketing")
    op.create_check_constraint(
        "ck_refund_policies_scope_type",
        "refund_policies",
        "scope_type IN ('PLATFORM','EVENT','PRODUCT','PLAN')",
        schema="ticketing",
    )

    op.create_table(
        "products",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("product_type", sa.String(32), nullable=False),
        sa.Column("subject_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="DRAFT"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "product_type IN ('TRACK','CATALOG_ACCESS','SUBSCRIPTION_PLAN')",
            name="ck_products_product_type",
        ),
        sa.CheckConstraint("status IN ('DRAFT','ACTIVE','RETIRED')", name="ck_products_status"),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["identity.organizations.id"],
            name="fk_products_organization_id_organizations",
        ),
        schema="commerce",
    )
    op.create_index(
        "ix_products_org_status",
        "products",
        ["organization_id", "status"],
        schema="commerce",
    )
    op.create_index(
        "ix_products_subject",
        "products",
        ["product_type", "subject_id"],
        schema="commerce",
    )

    op.create_table(
        "offers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency_code", sa.String(3), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="DRAFT"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('DRAFT','ACTIVE','RETIRED')", name="ck_offers_status"),
        sa.CheckConstraint("amount_minor >= 0", name="ck_offers_amount_non_negative"),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["identity.organizations.id"],
            name="fk_offers_organization_id_organizations",
        ),
        sa.ForeignKeyConstraint(
            ["product_id"],
            ["commerce.products.id"],
            name="fk_offers_product_id_products",
        ),
        schema="commerce",
    )
    op.create_index("ix_offers_product_status", "offers", ["product_id", "status"], schema="commerce")
    op.create_index("ix_offers_org_status", "offers", ["organization_id", "status"], schema="commerce")

    op.create_table(
        "entitlements",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("entitlement_type", sa.String(32), nullable=False),
        sa.Column("ref_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("scope", sa.String(32), nullable=False, server_default="TRACK"),
        sa.Column("status", sa.String(32), nullable=False, server_default="ACTIVE"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source_type", sa.String(32), nullable=True),
        sa.Column("source_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "entitlement_type IN ('PURCHASE','SUBSCRIPTION','ADMIN_GRANT','PROMOTIONAL_GRANT')",
            name="ck_entitlements_type",
        ),
        sa.CheckConstraint("status IN ('ACTIVE','REVOKED','EXPIRED')", name="ck_entitlements_status"),
        sa.CheckConstraint("scope IN ('TRACK','CATALOG')", name="ck_entitlements_scope"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["identity.users.id"],
            name="fk_entitlements_user_id_users",
        ),
        sa.UniqueConstraint(
            "user_id",
            "entitlement_type",
            "ref_id",
            "source_id",
            name="uq_entitlements_user_type_ref_source",
        ),
        schema="commerce",
    )
    op.create_index(
        "ix_entitlements_user_type_status",
        "entitlements",
        ["user_id", "entitlement_type", "status"],
        schema="commerce",
    )

    op.create_table(
        "refund_entitlement_policies",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("scope_type", sa.String(32), nullable=False),
        sa.Column("scope_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("reason_code", sa.String(64), nullable=False),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint(
            "scope_type IN ('PLATFORM','PRODUCT','PLAN')",
            name="ck_refund_entitlement_policies_scope_type",
        ),
        sa.CheckConstraint(
            "action IN ('REVOKE','KEEP')",
            name="ck_refund_entitlement_policies_action",
        ),
        sa.UniqueConstraint(
            "scope_type",
            "scope_id",
            "reason_code",
            name="uq_refund_entitlement_scope_reason",
        ),
        schema="commerce",
    )

    op.create_table(
        "subscription_plans",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("key", sa.String(64), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="DRAFT"),
        sa.Column("price_amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency_code", sa.String(3), nullable=False),
        sa.Column("interval", sa.String(16), nullable=False),
        sa.Column("interval_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("features", postgresql.JSONB(), nullable=True),
        sa.Column("current_version_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('DRAFT','ACTIVE','RETIRED')", name="ck_subscription_plans_status"),
        sa.CheckConstraint("price_amount_minor >= 0", name="ck_subscription_plans_price_non_negative"),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["identity.organizations.id"],
            name="fk_subscription_plans_organization_id_organizations",
        ),
        sa.UniqueConstraint("key", name="uq_subscription_plans_key"),
        schema="subscriptions",
    )
    op.create_index(
        "ix_subscription_plans_org_status",
        "subscription_plans",
        ["organization_id", "status"],
        schema="subscriptions",
    )

    op.create_table(
        "subscription_plan_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("plan_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("price_amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency_code", sa.String(3), nullable=False),
        sa.Column("interval", sa.String(16), nullable=False),
        sa.Column("interval_count", sa.Integer(), nullable=False),
        sa.Column("trial_days", sa.Integer(), nullable=True),
        sa.Column("features", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint(
            "price_amount_minor >= 0",
            name="ck_subscription_plan_versions_price_non_negative",
        ),
        sa.CheckConstraint(
            "interval_count >= 1",
            name="ck_subscription_plan_versions_interval_count_positive",
        ),
        sa.CheckConstraint(
            "trial_days IS NULL OR trial_days >= 0",
            name="ck_subscription_plan_versions_trial_days_non_negative",
        ),
        sa.ForeignKeyConstraint(
            ["plan_id"],
            ["subscriptions.subscription_plans.id"],
            name="fk_plan_versions_plan_id_plans",
        ),
        sa.UniqueConstraint("plan_id", "version_number", name="uq_plan_versions_number"),
        schema="subscriptions",
    )
    op.create_index(
        "ix_plan_versions_plan_id",
        "subscription_plan_versions",
        ["plan_id"],
        schema="subscriptions",
    )

    op.create_table(
        "subscriptions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("plan_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("plan_version_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("current_period_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("cancel_at_period_end", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('TRIALING','ACTIVE','PAST_DUE','CANCELLED','EXPIRED')",
            name="ck_subscriptions_status",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["identity.users.id"],
            name="fk_subscriptions_user_id_users",
        ),
        sa.ForeignKeyConstraint(
            ["plan_id"],
            ["subscriptions.subscription_plans.id"],
            name="fk_subscriptions_plan_id_plans",
        ),
        sa.ForeignKeyConstraint(
            ["plan_version_id"],
            ["subscriptions.subscription_plan_versions.id"],
            name="fk_subscriptions_plan_version_id_versions",
        ),
        schema="subscriptions",
    )
    op.create_index(
        "ix_subscriptions_user_status",
        "subscriptions",
        ["user_id", "status"],
        schema="subscriptions",
    )
    op.create_index("ix_subscriptions_plan_id", "subscriptions", ["plan_id"], schema="subscriptions")

    op.create_table(
        "subscription_periods",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("subscription_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("plan_version_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="OPEN"),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency_code", sa.String(3), nullable=False),
        sa.Column("order_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('OPEN','PAID','UNPAID','CLOSED')",
            name="ck_subscription_periods_status",
        ),
        sa.CheckConstraint("amount_minor >= 0", name="ck_subscription_periods_amount_non_negative"),
        sa.ForeignKeyConstraint(
            ["subscription_id"],
            ["subscriptions.subscriptions.id"],
            name="fk_subscription_periods_subscription_id",
        ),
        sa.ForeignKeyConstraint(
            ["plan_version_id"],
            ["subscriptions.subscription_plan_versions.id"],
            name="fk_subscription_periods_plan_version_id",
        ),
        sa.ForeignKeyConstraint(
            ["order_id"],
            ["commerce.orders.id"],
            name="fk_subscription_periods_order_id_orders",
        ),
        sa.UniqueConstraint("subscription_id", "starts_at", name="uq_subscription_periods_starts"),
        schema="subscriptions",
    )
    op.create_index(
        "ix_subscription_periods_subscription_id",
        "subscription_periods",
        ["subscription_id"],
        schema="subscriptions",
    )

    op.create_table(
        "refunds",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("payment_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="REQUESTED"),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency_code", sa.String(3), nullable=False),
        sa.Column("reason_code", sa.String(64), nullable=False),
        sa.Column("policy_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("approved_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('REQUESTED','APPROVED','PROCESSING','COMPLETED','REJECTED')",
            name="ck_refunds_status",
        ),
        sa.CheckConstraint("amount_minor >= 0", name="ck_refunds_amount_non_negative"),
        sa.ForeignKeyConstraint(
            ["payment_id"],
            ["finance.payments.id"],
            name="fk_refunds_payment_id_payments",
        ),
        sa.UniqueConstraint("idempotency_key", name="uq_refunds_idempotency_key"),
        schema="finance",
    )
    op.create_index("ix_refunds_payment_id", "refunds", ["payment_id"], schema="finance")


def downgrade() -> None:
    op.drop_index("ix_refunds_payment_id", table_name="refunds", schema="finance")
    op.drop_table("refunds", schema="finance")
    op.drop_index(
        "ix_subscription_periods_subscription_id",
        table_name="subscription_periods",
        schema="subscriptions",
    )
    op.drop_table("subscription_periods", schema="subscriptions")
    op.drop_index("ix_subscriptions_plan_id", table_name="subscriptions", schema="subscriptions")
    op.drop_index("ix_subscriptions_user_status", table_name="subscriptions", schema="subscriptions")
    op.drop_table("subscriptions", schema="subscriptions")
    op.drop_index("ix_plan_versions_plan_id", table_name="subscription_plan_versions", schema="subscriptions")
    op.drop_table("subscription_plan_versions", schema="subscriptions")
    op.drop_index(
        "ix_subscription_plans_org_status",
        table_name="subscription_plans",
        schema="subscriptions",
    )
    op.drop_table("subscription_plans", schema="subscriptions")
    op.drop_table("refund_entitlement_policies", schema="commerce")
    op.drop_index("ix_entitlements_user_type_status", table_name="entitlements", schema="commerce")
    op.drop_table("entitlements", schema="commerce")
    op.drop_index("ix_offers_org_status", table_name="offers", schema="commerce")
    op.drop_index("ix_offers_product_status", table_name="offers", schema="commerce")
    op.drop_table("offers", schema="commerce")
    op.drop_index("ix_products_subject", table_name="products", schema="commerce")
    op.drop_index("ix_products_org_status", table_name="products", schema="commerce")
    op.drop_table("products", schema="commerce")
    op.drop_constraint("ck_refund_policies_scope_type", "refund_policies", schema="ticketing")
    op.create_check_constraint(
        "ck_refund_policies_scope_type",
        "refund_policies",
        "scope_type IN ('PLATFORM','EVENT')",
        schema="ticketing",
    )
    op.drop_constraint("ck_orders_purpose", "orders", schema="commerce")
    op.drop_column("orders", "purpose", schema="commerce")
    op.execute(sa.text("DROP SCHEMA IF EXISTS subscriptions"))
