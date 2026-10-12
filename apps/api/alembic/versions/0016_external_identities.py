"""Google sign-in: link outside sign-in identities to Corner Room users. Additive only.

Revision ID: 0016_external_identities
Revises: 0015_database_integrity
Create Date: 2026-10-13

One row per (provider, provider subject) while linked. The subject is the stable key, never
the email (Q-GAUTH-01/03). No provider tokens are stored.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0016_external_identities"
down_revision: Union[str, Sequence[str], None] = "0015_database_integrity"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "external_identities",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("subject", sa.String(255), nullable=False),
        sa.Column("email_at_link", sa.String(320), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("unlinked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("provider IN ('google')", name="ck_external_identities_provider"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["identity.users.id"],
            name="fk_external_identities_user_id_users",
        ),
        schema="identity",
    )
    op.create_index(
        "uq_external_identities_provider_subject",
        "external_identities",
        ["provider", "subject"],
        unique=True,
        schema="identity",
        postgresql_where=sa.text("unlinked_at IS NULL"),
    )
    op.create_index(
        "uq_external_identities_user_provider",
        "external_identities",
        ["user_id", "provider"],
        unique=True,
        schema="identity",
        postgresql_where=sa.text("unlinked_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_external_identities_user_provider", table_name="external_identities", schema="identity")
    op.drop_index("uq_external_identities_provider_subject", table_name="external_identities", schema="identity")
    op.drop_table("external_identities", schema="identity")
