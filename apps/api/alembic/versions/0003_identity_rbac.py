"""Phase 02 identity/RBAC schema extensions.

Revision ID: 0003_identity_rbac
Revises: 0002_outbox_foundation
Create Date: 2026-09-07
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003_identity_rbac"
down_revision: Union[str, Sequence[str], None] = "0002_outbox_foundation"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True),
        schema="identity",
    )
    op.add_column(
        "users",
        sa.Column("security_locked_at", sa.DateTime(timezone=True), nullable=True),
        schema="identity",
    )

    op.add_column(
        "sessions",
        sa.Column("family_id", postgresql.UUID(as_uuid=True), nullable=True),
        schema="identity",
    )
    op.add_column(
        "sessions",
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        schema="identity",
    )
    op.add_column(
        "sessions",
        sa.Column("status", sa.String(32), nullable=False, server_default="ACTIVE"),
        schema="identity",
    )
    op.execute(
        sa.text(
            "UPDATE identity.sessions SET family_id = id WHERE family_id IS NULL"
        )
    )
    op.alter_column(
        "sessions",
        "family_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=False,
        schema="identity",
    )
    op.create_index("ix_sessions_family_id", "sessions", ["family_id"], schema="identity")
    op.create_check_constraint(
        "ck_sessions_status",
        "sessions",
        "status IN ('ACTIVE','REVOKED')",
        schema="identity",
    )
    op.execute(
        sa.text(
            "UPDATE identity.sessions SET status = 'REVOKED' WHERE revoked_at IS NOT NULL"
        )
    )

    op.create_table(
        "identity_challenges",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("purpose", sa.String(32), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="ISSUED"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "purpose IN ('EMAIL_VERIFICATION','PASSWORD_RECOVERY')",
            name="ck_identity_challenges_purpose",
        ),
        sa.CheckConstraint(
            "status IN ('ISSUED','CONSUMED','REVOKED','EXPIRED')",
            name="ck_identity_challenges_status",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["identity.users.id"],
            name="fk_identity_challenges_user_id_users",
        ),
        schema="identity",
    )
    op.create_index(
        "ix_identity_challenges_token_hash",
        "identity_challenges",
        ["token_hash"],
        unique=True,
        schema="identity",
    )
    op.create_index(
        "ix_identity_challenges_user_purpose",
        "identity_challenges",
        ["user_id", "purpose", "status"],
        schema="identity",
    )

    op.create_index(
        "uq_role_assignments_active_org",
        "role_assignments",
        ["user_id", "role_id", "organization_id"],
        unique=True,
        schema="permissions",
        postgresql_where=sa.text(
            "status = 'ACTIVE' AND deleted_at IS NULL AND organization_id IS NOT NULL"
        ),
    )
    op.create_index(
        "uq_role_assignments_active_unscoped",
        "role_assignments",
        ["user_id", "role_id"],
        unique=True,
        schema="permissions",
        postgresql_where=sa.text(
            "status = 'ACTIVE' AND deleted_at IS NULL AND organization_id IS NULL"
        ),
    )


def downgrade() -> None:
    op.drop_index("uq_role_assignments_active_unscoped", table_name="role_assignments", schema="permissions")
    op.drop_index("uq_role_assignments_active_org", table_name="role_assignments", schema="permissions")
    op.drop_index("ix_identity_challenges_user_purpose", table_name="identity_challenges", schema="identity")
    op.drop_index("ix_identity_challenges_token_hash", table_name="identity_challenges", schema="identity")
    op.drop_table("identity_challenges", schema="identity")
    op.drop_constraint("ck_sessions_status", "sessions", schema="identity")
    op.drop_index("ix_sessions_family_id", table_name="sessions", schema="identity")
    op.drop_column("sessions", "status", schema="identity")
    op.drop_column("sessions", "last_used_at", schema="identity")
    op.drop_column("sessions", "family_id", schema="identity")
    op.drop_column("users", "security_locked_at", schema="identity")
    op.drop_column("users", "email_verified_at", schema="identity")
