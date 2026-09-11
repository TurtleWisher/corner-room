"""Phase 03 organizations/workspace schema.

Revision ID: 0004_organizations_workspace
Revises: 0003_identity_rbac
Create Date: 2026-09-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004_organizations_workspace"
down_revision: Union[str, Sequence[str], None] = "0003_identity_rbac"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "sessions",
        sa.Column("active_organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        schema="identity",
    )
    op.create_foreign_key(
        "fk_sessions_active_organization_id_organizations",
        "sessions",
        "organizations",
        ["active_organization_id"],
        ["id"],
        source_schema="identity",
        referent_schema="identity",
    )
    op.create_index(
        "ix_sessions_active_organization_id",
        "sessions",
        ["active_organization_id"],
        schema="identity",
    )

    op.drop_index("uq_org_memberships_active", table_name="organization_memberships", schema="identity")
    op.create_index(
        "uq_org_memberships_active",
        "organization_memberships",
        ["organization_id", "user_id"],
        unique=True,
        schema="identity",
        postgresql_where=sa.text("status IN ('INVITED','ACTIVE') AND deleted_at IS NULL"),
    )

    op.create_table(
        "organization_invitations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("invited_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("role_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="ISSUED"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("accepted_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("membership_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('ISSUED','ACCEPTED','REVOKED','EXPIRED')",
            name="ck_organization_invitations_status",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["identity.organizations.id"],
            name="fk_organization_invitations_organization_id_organizations",
        ),
        sa.ForeignKeyConstraint(
            ["invited_user_id"],
            ["identity.users.id"],
            name="fk_organization_invitations_invited_user_id_users",
        ),
        sa.ForeignKeyConstraint(
            ["accepted_by_user_id"],
            ["identity.users.id"],
            name="fk_organization_invitations_accepted_by_user_id_users",
        ),
        sa.ForeignKeyConstraint(
            ["membership_id"],
            ["identity.organization_memberships.id"],
            name="fk_organization_invitations_membership_id_organization_memberships",
        ),
        schema="identity",
    )
    op.create_index(
        "ix_org_invitations_token_hash",
        "organization_invitations",
        ["token_hash"],
        unique=True,
        schema="identity",
    )
    op.create_index(
        "ix_org_invitations_org_status",
        "organization_invitations",
        ["organization_id", "status"],
        schema="identity",
    )
    op.create_index(
        "uq_org_invitations_outstanding_email",
        "organization_invitations",
        ["organization_id", "email"],
        unique=True,
        schema="identity",
        postgresql_where=sa.text("status = 'ISSUED' AND deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_org_invitations_outstanding_email",
        table_name="organization_invitations",
        schema="identity",
    )
    op.drop_index("ix_org_invitations_org_status", table_name="organization_invitations", schema="identity")
    op.drop_index("ix_org_invitations_token_hash", table_name="organization_invitations", schema="identity")
    op.drop_table("organization_invitations", schema="identity")
    op.drop_index("uq_org_memberships_active", table_name="organization_memberships", schema="identity")
    op.create_index(
        "uq_org_memberships_active",
        "organization_memberships",
        ["organization_id", "user_id"],
        unique=True,
        schema="identity",
        postgresql_where=sa.text("status = 'ACTIVE' AND deleted_at IS NULL"),
    )
    op.drop_index("ix_sessions_active_organization_id", table_name="sessions", schema="identity")
    op.drop_constraint(
        "fk_sessions_active_organization_id_organizations",
        "sessions",
        schema="identity",
        type_="foreignkey",
    )
    op.drop_column("sessions", "active_organization_id", schema="identity")
