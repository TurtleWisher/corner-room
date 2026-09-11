"""Phase 12 marketing campaigns.

Revision ID: 0013_marketing_campaigns
Revises: 0012_finance_settlement
Create Date: 2026-09-11

Does not rewrite 0001–0012. Adds campaigns schema and nullable
finance.expenses.campaign_id (no FK to campaigns).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0013_marketing_campaigns"
down_revision: Union[str, Sequence[str], None] = "0012_finance_settlement"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(sa.text("CREATE SCHEMA IF NOT EXISTS campaigns"))

    op.create_table(
        "campaigns",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="PLANNING"),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("budget_amount_minor", sa.BigInteger(), nullable=True),
        sa.Column("currency_code", sa.String(3), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('PLANNING','CONTENT_PREPARATION','SCHEDULED','ACTIVE',"
            "'OPTIMIZATION','COMPLETED','REPORTING','CANCELLED')",
            name="ck_campaigns_status",
        ),
        sa.CheckConstraint(
            "ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at",
            name="ck_campaigns_ends_after_starts",
        ),
        sa.CheckConstraint(
            "(budget_amount_minor IS NULL AND currency_code IS NULL) OR "
            "(budget_amount_minor IS NOT NULL AND currency_code IS NOT NULL)",
            name="ck_campaigns_budget_pair",
        ),
        sa.CheckConstraint(
            "budget_amount_minor IS NULL OR budget_amount_minor >= 0",
            name="ck_campaigns_budget_non_negative",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["identity.organizations.id"],
            name="fk_campaigns_organization_id_organizations",
        ),
        schema="campaigns",
    )
    op.create_index("ix_campaigns_organization_id", "campaigns", ["organization_id"], schema="campaigns")
    op.create_index("ix_campaigns_status", "campaigns", ["status"], schema="campaigns")

    op.create_table(
        "campaign_tasks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("campaign_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="TODO"),
        sa.Column("assignee_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('TODO','IN_PROGRESS','BLOCKED','DONE','CANCELLED')",
            name="ck_campaign_tasks_status",
        ),
        sa.ForeignKeyConstraint(
            ["campaign_id"],
            ["campaigns.campaigns.id"],
            name="fk_campaign_tasks_campaign_id_campaigns",
        ),
        schema="campaigns",
    )
    op.create_index("ix_campaign_tasks_campaign_id", "campaign_tasks", ["campaign_id"], schema="campaigns")
    op.create_index("ix_campaign_tasks_assignee_user_id", "campaign_tasks", ["assignee_user_id"], schema="campaigns")

    op.create_table(
        "campaign_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("campaign_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("subject_type", sa.String(32), nullable=False),
        sa.Column("subject_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "subject_type IN ('ARTIST','RELEASE','EVENT')",
            name="ck_campaign_links_subject_type",
        ),
        sa.ForeignKeyConstraint(
            ["campaign_id"],
            ["campaigns.campaigns.id"],
            name="fk_campaign_links_campaign_id_campaigns",
        ),
        schema="campaigns",
    )
    op.create_index("ix_campaign_links_campaign_id", "campaign_links", ["campaign_id"], schema="campaigns")
    op.create_index(
        "uq_campaign_links_active_subject",
        "campaign_links",
        ["campaign_id", "subject_type", "subject_id"],
        unique=True,
        schema="campaigns",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    op.create_table(
        "campaign_assets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("campaign_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("media_asset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["campaign_id"],
            ["campaigns.campaigns.id"],
            name="fk_campaign_assets_campaign_id_campaigns",
        ),
        sa.ForeignKeyConstraint(
            ["media_asset_id"],
            ["documents.media_assets.id"],
            name="fk_campaign_assets_media_asset_id_media_assets",
        ),
        schema="campaigns",
    )
    op.create_index("ix_campaign_assets_campaign_id", "campaign_assets", ["campaign_id"], schema="campaigns")
    op.create_index(
        "uq_campaign_assets_active_media",
        "campaign_assets",
        ["campaign_id", "media_asset_id"],
        unique=True,
        schema="campaigns",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    op.create_table(
        "campaign_channels",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("campaign_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "code IN ('IN_APP','EMAIL','SOCIAL','PRESS','OTHER')",
            name="ck_campaign_channels_code",
        ),
        sa.ForeignKeyConstraint(
            ["campaign_id"],
            ["campaigns.campaigns.id"],
            name="fk_campaign_channels_campaign_id_campaigns",
        ),
        schema="campaigns",
    )
    op.create_index("ix_campaign_channels_campaign_id", "campaign_channels", ["campaign_id"], schema="campaigns")
    op.create_index(
        "uq_campaign_channels_active_code",
        "campaign_channels",
        ["campaign_id", "code"],
        unique=True,
        schema="campaigns",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    op.create_table(
        "campaign_kpi_targets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("campaign_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("metric_key", sa.String(64), nullable=False),
        sa.Column("target_value", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["campaign_id"],
            ["campaigns.campaigns.id"],
            name="fk_campaign_kpi_targets_campaign_id_campaigns",
        ),
        schema="campaigns",
    )
    op.create_index(
        "ix_campaign_kpi_targets_campaign_id",
        "campaign_kpi_targets",
        ["campaign_id"],
        schema="campaigns",
    )

    op.add_column(
        "expenses",
        sa.Column("campaign_id", postgresql.UUID(as_uuid=True), nullable=True),
        schema="finance",
    )
    op.create_index("ix_expenses_campaign_id", "expenses", ["campaign_id"], schema="finance")


def downgrade() -> None:
    op.drop_index("ix_expenses_campaign_id", table_name="expenses", schema="finance")
    op.drop_column("expenses", "campaign_id", schema="finance")
    op.drop_index("ix_campaign_kpi_targets_campaign_id", table_name="campaign_kpi_targets", schema="campaigns")
    op.drop_table("campaign_kpi_targets", schema="campaigns")
    op.drop_index("uq_campaign_channels_active_code", table_name="campaign_channels", schema="campaigns")
    op.drop_index("ix_campaign_channels_campaign_id", table_name="campaign_channels", schema="campaigns")
    op.drop_table("campaign_channels", schema="campaigns")
    op.drop_index("uq_campaign_assets_active_media", table_name="campaign_assets", schema="campaigns")
    op.drop_index("ix_campaign_assets_campaign_id", table_name="campaign_assets", schema="campaigns")
    op.drop_table("campaign_assets", schema="campaigns")
    op.drop_index("uq_campaign_links_active_subject", table_name="campaign_links", schema="campaigns")
    op.drop_index("ix_campaign_links_campaign_id", table_name="campaign_links", schema="campaigns")
    op.drop_table("campaign_links", schema="campaigns")
    op.drop_index("ix_campaign_tasks_assignee_user_id", table_name="campaign_tasks", schema="campaigns")
    op.drop_index("ix_campaign_tasks_campaign_id", table_name="campaign_tasks", schema="campaigns")
    op.drop_table("campaign_tasks", schema="campaigns")
    op.drop_index("ix_campaigns_status", table_name="campaigns", schema="campaigns")
    op.drop_index("ix_campaigns_organization_id", table_name="campaigns", schema="campaigns")
    op.drop_table("campaigns", schema="campaigns")
    op.execute(sa.text("DROP SCHEMA IF EXISTS campaigns"))
