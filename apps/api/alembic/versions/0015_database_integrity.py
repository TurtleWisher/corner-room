"""Phase 15 Gate 2 — additive integrity only. Does not enable RLS.

Revision ID: 0015_database_integrity
Revises: 0014_notifications_search_analytics
Create Date: 2026-09-13

Does not rewrite 0001–0014. Does not add policies, bypass roles, or
unrestricted USING clauses. Runtime Compose/app user remains cluster
superuser (Q-P15-01 / Q-P14-12). Isolation on that role would be theater.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0015_database_integrity"
down_revision: Union[str, Sequence[str], None] = "0014_notifications_search_analytics"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_foreign_key(
        "fk_ledger_entries_organization_id_organizations",
        "ledger_entries",
        "organizations",
        ["organization_id"],
        ["id"],
        source_schema="finance",
        referent_schema="identity",
    )
    op.create_index(
        "ix_ledger_entries_organization_id",
        "ledger_entries",
        ["organization_id"],
        schema="finance",
    )
    op.create_index(
        "ix_payouts_organization_created",
        "payouts",
        ["organization_id", "created_at"],
        schema="finance",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_payouts_organization_created",
        table_name="payouts",
        schema="finance",
    )
    op.drop_index(
        "ix_ledger_entries_organization_id",
        table_name="ledger_entries",
        schema="finance",
    )
    op.drop_constraint(
        "fk_ledger_entries_organization_id_organizations",
        "ledger_entries",
        schema="finance",
        type_="foreignkey",
    )
