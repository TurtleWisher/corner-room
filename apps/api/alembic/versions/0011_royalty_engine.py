"""Phase 10 royalty engine.

Revision ID: 0011_royalty_engine
Revises: 0010_purchases_subscriptions
Create Date: 2026-09-11

Does not rewrite 0001–0010. Does not create a Finance ledger or payouts.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0011_royalty_engine"
down_revision: Union[str, Sequence[str], None] = "0010_purchases_subscriptions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(sa.text("CREATE SCHEMA IF NOT EXISTS royalties"))

    op.create_table(
        "rights",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("track_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("contract_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("territory", sa.String(16), nullable=False, server_default="WW"),
        sa.Column("status", sa.String(32), nullable=False, server_default="DRAFT"),
        sa.Column("residual_payee_type", sa.String(32), nullable=True),
        sa.Column("residual_payee_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('DRAFT','ACTIVE','DISPUTED','RETIRED')",
            name="ck_rights_status",
        ),
        sa.CheckConstraint(
            "residual_payee_type IS NULL OR residual_payee_type IN ('ARTIST','USER','ORGANIZATION')",
            name="ck_rights_residual_payee_type",
        ),
        sa.CheckConstraint(
            "(residual_payee_type IS NULL) = (residual_payee_id IS NULL)",
            name="ck_rights_residual_payee_pair",
        ),
        sa.ForeignKeyConstraint(["track_id"], ["music.tracks.id"], name="fk_rights_track_id_tracks"),
        schema="royalties",
    )
    op.create_index("ix_rights_track_id", "rights", ["track_id"], schema="royalties")
    op.create_index("ix_rights_status", "rights", ["status"], schema="royalties")

    op.create_table(
        "right_shares",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("rights_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("right_type", sa.String(32), nullable=False),
        sa.Column("payee_type", sa.String(32), nullable=False),
        sa.Column("payee_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("share_bps", sa.Integer(), nullable=False),
        sa.Column("effective_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("effective_to", sa.DateTime(timezone=True), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint("share_bps >= 0 AND share_bps <= 10000", name="ck_right_shares_share_bps"),
        sa.CheckConstraint(
            "payee_type IN ('ARTIST','USER','ORGANIZATION')",
            name="ck_right_shares_payee_type",
        ),
        sa.CheckConstraint(
            "effective_to IS NULL OR effective_to > effective_from",
            name="ck_right_shares_effective_range",
        ),
        sa.ForeignKeyConstraint(["rights_id"], ["royalties.rights.id"], name="fk_right_shares_rights_id_rights"),
        schema="royalties",
    )
    op.create_index(
        "ix_right_shares_rights_type_from",
        "right_shares",
        ["rights_id", "right_type", "effective_from"],
        schema="royalties",
    )
    op.create_index("ix_right_shares_payee", "right_shares", ["payee_type", "payee_id"], schema="royalties")

    op.create_table(
        "royalty_rules",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("key", sa.String(80), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="DRAFT"),
        sa.Column("definition", postgresql.JSONB(), nullable=False),
        sa.Column("row_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.UniqueConstraint("key", "version", name="uq_royalty_rules_key_version"),
        sa.CheckConstraint("status IN ('DRAFT','ACTIVE','SUPERSEDED')", name="ck_royalty_rules_status"),
        sa.CheckConstraint("version >= 1", name="ck_royalty_rules_version_number"),
        schema="royalties",
    )
    op.create_index("ix_royalty_rules_key_status", "royalty_rules", ["key", "status"], schema="royalties")

    op.create_table(
        "recognized_revenue_intakes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("source_type", sa.String(32), nullable=False),
        sa.Column("source_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("period_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("period_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("currency_code", sa.String(3), nullable=False),
        sa.Column("amount_minor", sa.Integer(), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.UniqueConstraint("idempotency_key", name="uq_recognized_revenue_intakes_idempotency"),
        sa.CheckConstraint("amount_minor >= 0", name="ck_recognized_revenue_intakes_amount_minor"),
        sa.CheckConstraint(
            "source_type IN ('STREAMING_SUB','MUSIC_PURCHASE','OTHER')",
            name="ck_recognized_revenue_intakes_source_type",
        ),
        schema="royalties",
    )
    op.create_index(
        "ix_recognized_revenue_period",
        "recognized_revenue_intakes",
        ["source_type", "period_start", "period_end", "currency_code"],
        schema="royalties",
    )

    op.create_table(
        "revenue_pools",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("period_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("period_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source_type", sa.String(32), nullable=False),
        sa.Column("currency_code", sa.String(3), nullable=False),
        sa.Column("amount_minor", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(32), nullable=False, server_default="OPEN"),
        sa.Column("rule_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("funding_intake_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.UniqueConstraint(
            "period_start",
            "period_end",
            "source_type",
            "currency_code",
            "rule_id",
            name="uq_revenue_pools_close",
        ),
        sa.CheckConstraint("amount_minor >= 0", name="ck_revenue_pools_amount_minor"),
        sa.CheckConstraint(
            "status IN ('OPEN','FROZEN','ALLOCATED','CLOSED')",
            name="ck_revenue_pools_status",
        ),
        sa.CheckConstraint(
            "source_type IN ('STREAMING_SUB','MUSIC_PURCHASE','OTHER')",
            name="ck_revenue_pools_source_type",
        ),
        sa.ForeignKeyConstraint(["rule_id"], ["royalties.royalty_rules.id"], name="fk_revenue_pools_rule_id_royalty_rules"),
        sa.ForeignKeyConstraint(
            ["funding_intake_id"],
            ["royalties.recognized_revenue_intakes.id"],
            name="fk_revenue_pools_funding_intake_id_recognized_revenue_intakes",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["identity.organizations.id"],
            name="fk_revenue_pools_organization_id_organizations",
        ),
        schema="royalties",
    )
    op.create_index("ix_revenue_pools_status", "revenue_pools", ["status"], schema="royalties")

    op.create_table(
        "royalties",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("revenue_pool_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="CALCULATING"),
        sa.Column("rule_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("run_kind", sa.String(32), nullable=False, server_default="PRIMARY"),
        sa.Column("pool_amount_minor_snapshot", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("unallocated_minor", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("rule_key_snapshot", sa.String(80), nullable=True),
        sa.Column("rule_version_snapshot", sa.Integer(), nullable=True),
        sa.Column("rule_definition_snapshot", postgresql.JSONB(), nullable=True),
        sa.Column("eligibility_snapshot", postgresql.JSONB(), nullable=True),
        sa.Column("units_snapshot", postgresql.JSONB(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('CALCULATING','CALCULATED','APPROVED','POSTED')",
            name="ck_royalties_status",
        ),
        sa.CheckConstraint("run_kind IN ('PRIMARY','CORRECTION')", name="ck_royalties_run_kind"),
        sa.CheckConstraint("unallocated_minor >= 0", name="ck_royalties_unallocated_minor"),
        sa.ForeignKeyConstraint(
            ["revenue_pool_id"],
            ["royalties.revenue_pools.id"],
            name="fk_royalties_revenue_pool_id_revenue_pools",
        ),
        sa.ForeignKeyConstraint(["rule_id"], ["royalties.royalty_rules.id"], name="fk_royalties_rule_id_royalty_rules"),
        schema="royalties",
    )
    op.create_index(
        "uq_royalties_pool_rule_primary",
        "royalties",
        ["revenue_pool_id", "rule_id"],
        unique=True,
        schema="royalties",
        postgresql_where=sa.text("run_kind = 'PRIMARY'"),
    )
    op.create_index("ix_royalties_pool_status", "royalties", ["revenue_pool_id", "status"], schema="royalties")

    op.create_table(
        "royalty_lines",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("royalty_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("payee_type", sa.String(32), nullable=False),
        sa.Column("payee_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("track_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("rights_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("right_share_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("right_type", sa.String(32), nullable=True),
        sa.Column("revenue_pool_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("rule_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("eligible_units", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("share_bps_snapshot", sa.Integer(), nullable=False),
        sa.Column("amount_minor", sa.Integer(), nullable=False),
        sa.Column("currency_code", sa.String(3), nullable=False),
        sa.Column("is_residual", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("amount_minor >= 0", name="ck_royalty_lines_amount_minor"),
        sa.CheckConstraint("eligible_units >= 0", name="ck_royalty_lines_eligible_units"),
        sa.CheckConstraint(
            "payee_type IN ('ARTIST','USER','ORGANIZATION')",
            name="ck_royalty_lines_payee_type",
        ),
        sa.ForeignKeyConstraint(["royalty_id"], ["royalties.royalties.id"], name="fk_royalty_lines_royalty_id_royalties"),
        sa.ForeignKeyConstraint(["track_id"], ["music.tracks.id"], name="fk_royalty_lines_track_id_tracks"),
        sa.ForeignKeyConstraint(["rights_id"], ["royalties.rights.id"], name="fk_royalty_lines_rights_id_rights"),
        sa.ForeignKeyConstraint(
            ["right_share_id"],
            ["royalties.right_shares.id"],
            name="fk_royalty_lines_right_share_id_right_shares",
        ),
        sa.ForeignKeyConstraint(
            ["revenue_pool_id"],
            ["royalties.revenue_pools.id"],
            name="fk_royalty_lines_revenue_pool_id_revenue_pools",
        ),
        sa.ForeignKeyConstraint(["rule_id"], ["royalties.royalty_rules.id"], name="fk_royalty_lines_rule_id_royalty_rules"),
        schema="royalties",
    )
    op.create_index("ix_royalty_lines_payee", "royalty_lines", ["payee_type", "payee_id"], schema="royalties")
    op.create_index("ix_royalty_lines_track_id", "royalty_lines", ["track_id"], schema="royalties")
    op.create_index("ix_royalty_lines_royalty_id", "royalty_lines", ["royalty_id"], schema="royalties")

    op.create_table(
        "royalty_statements",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("payee_type", sa.String(32), nullable=False),
        sa.Column("payee_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("period_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("period_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="DRAFT"),
        sa.Column("document_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("total_amount_minor", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("currency_code", sa.String(3), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("royalty_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.UniqueConstraint(
            "payee_type",
            "payee_id",
            "period_start",
            "period_end",
            "version_number",
            name="uq_royalty_statements_payee_period_version",
        ),
        sa.CheckConstraint(
            "status IN ('DRAFT','ISSUED','ACKNOWLEDGED','DISPUTED')",
            name="ck_royalty_statements_status",
        ),
        sa.CheckConstraint(
            "payee_type IN ('ARTIST','USER','ORGANIZATION')",
            name="ck_royalty_statements_payee_type",
        ),
        sa.ForeignKeyConstraint(
            ["royalty_id"],
            ["royalties.royalties.id"],
            name="fk_royalty_statements_royalty_id_royalties",
        ),
        schema="royalties",
    )
    op.create_index(
        "ix_royalty_statements_payee",
        "royalty_statements",
        ["payee_type", "payee_id", "status"],
        schema="royalties",
    )

    op.create_table(
        "royalty_adjustments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("statement_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("payee_type", sa.String(32), nullable=False),
        sa.Column("payee_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("amount_minor", sa.Integer(), nullable=False),
        sa.Column("currency_code", sa.String(3), nullable=False),
        sa.Column("reason", sa.String(200), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="POSTED"),
        sa.Column("royalty_line_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint("status IN ('POSTED')", name="ck_royalty_adjustments_status"),
        sa.CheckConstraint(
            "payee_type IN ('ARTIST','USER','ORGANIZATION')",
            name="ck_royalty_adjustments_payee_type",
        ),
        sa.ForeignKeyConstraint(
            ["statement_id"],
            ["royalties.royalty_statements.id"],
            name="fk_royalty_adjustments_statement_id_royalty_statements",
        ),
        sa.ForeignKeyConstraint(
            ["royalty_line_id"],
            ["royalties.royalty_lines.id"],
            name="fk_royalty_adjustments_royalty_line_id_royalty_lines",
        ),
        schema="royalties",
    )
    op.create_index(
        "ix_royalty_adjustments_statement_id",
        "royalty_adjustments",
        ["statement_id"],
        schema="royalties",
    )

    op.create_table(
        "settlements",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("kind", sa.String(32), nullable=False, server_default="ROYALTY"),
        sa.Column("payee_type", sa.String(32), nullable=False),
        sa.Column("payee_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="CALCULATED"),
        sa.Column("amount_minor", sa.Integer(), nullable=False),
        sa.Column("currency_code", sa.String(3), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint("kind IN ('ROYALTY','EVENT_PARTNER','VENUE','OTHER')", name="ck_settlements_kind"),
        sa.CheckConstraint(
            "status IN ('CALCULATED','APPROVED','PROCESSING','PAID','COMPLETED')",
            name="ck_settlements_status",
        ),
        sa.CheckConstraint(
            "payee_type IN ('ARTIST','USER','ORGANIZATION')",
            name="ck_settlements_payee_type",
        ),
        sa.CheckConstraint("amount_minor >= 0", name="ck_settlements_amount_minor"),
        schema="royalties",
    )
    op.create_index(
        "ix_settlements_payee_status",
        "settlements",
        ["payee_type", "payee_id", "status"],
        schema="royalties",
    )

    op.create_table(
        "settlement_lines",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("settlement_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_type", sa.String(32), nullable=False),
        sa.Column("source_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("amount_minor", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["settlement_id"],
            ["royalties.settlements.id"],
            name="fk_settlement_lines_settlement_id_settlements",
        ),
        schema="royalties",
    )
    op.create_index("ix_settlement_lines_settlement_id", "settlement_lines", ["settlement_id"], schema="royalties")


def downgrade() -> None:
    op.drop_table("settlement_lines", schema="royalties")
    op.drop_table("settlements", schema="royalties")
    op.drop_table("royalty_adjustments", schema="royalties")
    op.drop_table("royalty_statements", schema="royalties")
    op.drop_table("royalty_lines", schema="royalties")
    op.drop_table("royalties", schema="royalties")
    op.drop_table("revenue_pools", schema="royalties")
    op.drop_table("recognized_revenue_intakes", schema="royalties")
    op.drop_table("royalty_rules", schema="royalties")
    op.drop_table("right_shares", schema="royalties")
    op.drop_table("rights", schema="royalties")
    op.execute(sa.text("DROP SCHEMA IF EXISTS royalties"))
